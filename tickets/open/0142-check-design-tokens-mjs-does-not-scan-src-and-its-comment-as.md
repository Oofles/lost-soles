---
id: 142
slug: check-design-tokens-mjs-does-not-scan-src-and-its-comment-as
title: check-design-tokens.mjs does not scan src/, and its comment asserts src/ does not exist
type: bug
priority: med
status: open
size: s
capability: 02-deploy-and-auth
depends_on: []
blocked_by: []
source: agent
created: 2026-09-02T01:55:50Z
started: 2026-09-02T02:13:25Z
---

## Description

`scripts/check-design-tokens.mjs` enforces 06 §8's rule that raw hex lives in `app/tokens.css` and
nowhere else. It scans `ROOTS = ["app", "components", "lib"]` (line 31), and its header comment
states, as justification for that list:

> NOTE ON THE TICKET: 0016's criterion 8 specifies `grep -rn ... src/`. There is no src/ directory
> in this project — the layout is app/, components/, lib/ — so that grep would have scanned nothing
> and passed vacuously […] Amended to the real dirs.

That was true and correct when 0016 shipped it on 2026-08-31. **It stopped being true when ticket
`0025` created `src/domain/`**, and `01-architecture.md` §3 puts `src/pipeline/` and
`src/adapters/` there too as capabilities `04`–`06` land. The comment now asserts something false,
and the gate is blind to a directory that is about to hold most of the project's code.

**Nothing is broken today** — `src/` currently contains five files and zero hex colours, verified at
the capability `02` close audit. This is a latent gap, filed while it is still cheap, which is the
same reason 0016 landed the check itself while there were almost no components to check.

The irony is worth keeping in the record: the comment explaining why a vacuous grep was replaced has
itself become the vacuous grep's twin — a scan whose stated scope no longer matches the tree. That
is the failure mode 0013 found in the lint script and 0123 found in the skill frontmatter, and it is
the third instance of the same class.

## Acceptance criteria

- [x] `check-design-tokens.mjs` scans `src/` in addition to `app/`, `components/` and `lib/`.
      It now derives ten roots from disk: `amplify, app, components, docs, lib, prompts, scripts,
      src, tickets, types`.
- [x] The header comment no longer claims `src/` does not exist; it names what is scanned and why,
      and keeps the history as the argument for deriving rather than listing.
- [x] `--self-test` gains a case proving a raw hex **in `src/`** is a hit — the check must be shown
      to fire there, not merely configured to look there.
      `src/domain/leak.ts` must fire, `src/domain/fine.ts` must pass. Also proven against the real
      tree: a planted `src/domain/__leak-proof.ts` exits 1 naming the file and line, and the tree
      was restored.
- [x] The root list cannot silently go stale again: either it is derived from what is on disk, or a
      test asserts every top-level source directory in the repo is covered. Pick one and say which
      in the Resolution; a hand-maintained list is this bug with a longer fuse (see `0141`).
      **Chose: derived from disk.** Reasoning in the Resolution.

## Steps to reproduce

1. `grep -n 'ROOTS =' scripts/check-design-tokens.mjs` → `["app", "components", "lib"]`.
2. `ls src/` → `domain/`, created by ticket `0025`.
3. Plant `const c = "#ff0000"` in a new file under `src/domain/` and run
   `node scripts/check-design-tokens.mjs` → exits 0. The palette leaked and the gate is green.

## Expected vs actual

**Expected:** a raw hex anywhere in the project's source tree fails the check, on both CI surfaces.

**Actual:** `src/` is unscanned, so a raw hex there passes the gate in `gate.yml` *and* on the
deploy path in `amplify.yml`.

## Notes

Found by the capability `02` close audit (2026-09-02), AUDIT.md §2, resolved as `code-was-wrong`.
Recorded as divergence 3 of 4 in that audit and in **D-176**.

Related: `0141` (a hand-maintained list drifting from the checker that reads it) is the same shape
one layer over. If a general fix suggests itself for both, say so rather than fixing them twice.

## Resolution

**Criterion 4's choice: derived from disk, not a list plus a coverage test.**

Both options close the hole. Deriving is better here for a reason specific to this check: a coverage
test still requires someone to define "top-level source directory", and that definition is the same
judgement call that went stale the first time — it would just move the staleness from
`check-design-tokens.mjs` into a test file. Deriving removes the judgement entirely. A new directory
is scanned because it is on disk, not because anyone remembered.

```js
const EXCLUDED = new Set(["node_modules"])
function rootsFor(base) {
  return readdirSync(base, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith(".") && !EXCLUDED.has(e.name))
    .map((e) => e.name).sort()
}
```

**What is excluded, and the deliberate refusal to exclude more.** Dot-directories go by the leading
dot — `.next`, `.amplify`, `.git`, `.github`, `.claude`, `.githooks` are build output and tooling.
`node_modules` needs naming because it has no dot and walking it is pointless and slow.

**Nothing else is excluded**, and that is the load-bearing decision. The tempting version excludes
`docs/`, `tickets/` and `scripts/` because they "obviously have no colours in them" — but that is
exactly the judgement that goes stale, and it is what this ticket is about. They are scanned and
cost a `readdir`: `docs/` and `tickets/` hold `.md`, `scripts/` holds `.mjs`, and none of those
extensions are in `EXTS`. The check now derives ten roots and still passes on the real tree.

That `.mjs` is not in `EXTS` is load-bearing in one direction worth stating: `scripts/` contains the
checkers, and `check-design-tokens.mjs` holds `/#(?:000000|ffffff|000|fff)\b/i` as a **pattern**. If
`.mjs` were ever added to `EXTS`, this check would flag itself. That is a live trap for whoever
extends `EXTS`, and it is now the reason `scripts/` can be scanned rather than exempted.

**`scan()` derives per-call**, from the base directory it is given rather than from the repo root.
That is what lets `--self-test` exercise the *same* derivation against its fixture instead of a
stubbed list — a self-test that hard-codes what the real code derives proves less than it appears to.

**The self-test case that actually guards this.** Beyond `src/domain/leak.ts` (criterion 3), the
fixture carries `packages/ui/button.tsx` — a directory named in **no list anywhere**, not in the
script and not in this project. It fires because it is on disk. If someone reverts to a hand-written
`ROOTS`, that is the case that goes red, and it goes red with a name that explains why. The
self-test also asserts the derivation directly, printing the roots it found.

**Nothing was actually leaking.** `src/` held five files and zero hex, as the audit reported. This
closes a latent gap before capability `04` fills `src/domain/` and `src/pipeline/`.

**Files touched:** `scripts/check-design-tokens.mjs` only. 11 self-test cases (was 8) plus 5
derivation assertions.

**Not done, and deliberately.** The same hand-maintained-list shape exists in
`check-boundaries.mjs`, which pins `roots: ["src/domain", "src/pipeline"]`. It is **not** the same
bug — those two are named by D-100 as the specific directories that must stay source-agnostic, so
the list is the specification rather than an approximation of one. Widening it to whatever is on
disk would change what D-100 means, which is a decision, not a fix. Left alone on purpose; noted
here so the next reader does not have to re-derive that it was considered.

## Operator validation

None — this is a CI check with no user-visible surface, and the original ticket's prediction was
right. The meaningful proof is mechanical and was performed here, 2026-09-02:

- **`--self-test`: 11 cases plus 5 derivation assertions, all pass.** `src/domain/leak.ts` fires,
  `src/domain/fine.ts` passes, `packages/ui/button.tsx` fires from a directory in no list.
- **Proven against the real tree, not only a fixture.** A planted
  `src/domain/__leak-proof.ts` containing `"#0B1020"` made the check exit 1 naming the file, the
  line and the rule; removing it returned exit 0, and `git status` confirmed the tree was restored.
  This is the ticket's own reproduction step 3, run in reverse.
- **The whole gate is green locally** — typecheck, lint, `npm test`, both boundary checks, both
  token checks, the index check and `bash -n` on the hook.

The observable result for the operator is the same as `0140`'s: `gate.yml` staying green on the
Actions tab for this commit, with the `design tokens` steps passing.
