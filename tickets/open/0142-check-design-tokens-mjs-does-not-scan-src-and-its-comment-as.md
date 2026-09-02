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

- [ ] `check-design-tokens.mjs` scans `src/` in addition to `app/`, `components/` and `lib/`.
- [ ] The header comment no longer claims `src/` does not exist; it names what is scanned and why.
- [ ] `--self-test` gains a case proving a raw hex **in `src/`** is a hit — the check must be shown
      to fire there, not merely configured to look there.
- [ ] The root list cannot silently go stale again: either it is derived from what is on disk, or a
      test asserts every top-level source directory in the repo is covered. Pick one and say which
      in the Resolution; a hand-maintained list is this bug with a longer fuse (see `0141`).

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

## Operator validation

None expected — this is a CI check with no user-visible surface, and the meaningful proof is the
`--self-test` case required by criterion 3 rather than anything on a screen. If that turns out to be
wrong when the ticket is worked, say so in the Resolution instead of writing "None" by reflex.
