---
id: 183
slug: audit-fog-no-refog-and-xp-not-lower-are-hardcoded-n-a-they-w
title: audit fog-no-refog and xp-not-lower are hardcoded n/a — they will never activate
type: bug
priority: high
status: open
size: s
capability: 01-ticket-system
depends_on: []
blocked_by: []
source: agent
created: 2026-09-08T15:04:21Z
started: 2026-09-28T01:48:39Z
---

## Description

`AUDIT.md` §4 has two regression checks that guard the two invariants this project treats as
unrecoverable:

> - [ ] `explored-r10.bin` still regenerates and no cell has re-fogged (D-020, `I-7`).
> - [ ] Total XP is unchanged or higher, never lower (D-135, `I-16`).

Both are implemented in `tickets.mjs` as **hardcoded `NA(...)` calls with a literal message**
(lines ~611–614):

```js
checks.push(NA("fog-no-refog", "4",
  "no explored blob or fog pipeline exists yet — activates with capability 07 (D-020, I-7)"));
checks.push(NA("xp-not-lower", "4",
  "no XP ledger exists yet — activates with capability 09 (D-135, I-16)"));
```

There is no condition. **They will report `n/a` forever, including after the thing they say does
not exist has shipped** — which for `fog-no-refog` is now: capability 07 landed `explored-r10.bin`
generation, the manifest, the delta chain and T6 across tickets `0045`–`0051`. Running
`audit 07-fog-projection-and-cells` on 2026-09-08, immediately after that capability's last
ticket closed, still printed:

```
n/a  fog-no-refog   no explored blob or fog pipeline exists yet — activates with capability 07
```

The message is now false, and the check that was supposed to activate at exactly this moment did
not.

**Why this matters more than one stale line.** This is the vacuous-pass failure this repo keeps
finding and keeps writing tests against — `0049`'s IAM synth test reported "grants no DeleteItem"
about an empty statement list; `0142` found the same shape in a sibling script; `check-boundaries`
and `check-fog-hot-path` both carry an explicit "scanned 0 files" guard because of it. An audit
whose §4 line is a constant is worse than an audit missing that line, because the table prints a
row and a reader concludes the question was asked.

And these two are not ordinary checks. §4 is *"regression against earlier capabilities"*, and
these are the two regressions the project has decided are not survivable: a cell that re-fogged
cannot be un-re-fogged (D-020 — the map is the product), and XP that went down has already been
seen by the user (D-135).

## Steps to reproduce

```bash
node .claude/skills/tickets/scripts/tickets.mjs audit 07-fog-projection-and-cells
#   §4
#      n/a  fog-no-refog   no explored blob or fog pipeline exists yet — activates with capability 07
#      n/a  xp-not-lower   no XP ledger exists yet — activates with capability 09

grep -n 'NA("fog-no-refog"' -A 4 .claude/skills/tickets/scripts/tickets.mjs
#   -> an unconditional push. No predicate anywhere.
```

## Expected vs actual

**Expected.** `fog-no-refog` detects that the fog pipeline exists and becomes a real check —
minimally, that `manifest.json` for each user still resolves, its `cellCount` is greater than or
equal to the previously recorded one, and its `generation` has not decreased (I-11). `xp-not-lower`
stays `n/a` with an accurate reason until T4 exists, and then activates the same way.

**Actual.** Both are constants. `fog-no-refog`'s stated reason is false as of 2026-09-08.

## Acceptance criteria

- [x] `fog-no-refog` is a real check with a predicate, not a constant. It activates when the fog
      pipeline is present and reports `n/a` only when it genuinely is not.
- [x] Its `n/a` branch is derived from something observable, so the message cannot go stale the
      way this one did.
- [x] `xp-not-lower` gets the same treatment: `n/a` today for a reason the code can check, and
      active the moment T4 exists.
- [x] **A self-test proves each check FAILS on an injected regression** — a lowered `cellCount`,
      a lowered `generation`. A §4 check that has never been seen to fail is not a check; this is
      the same standard the gate scripts are held to.
- [x] The audit's own summary distinguishes "n/a because the subject does not exist" from
      "n/a because the check could not run", so a broken check never reads as a skipped one.
- [x] Any other hardcoded `PASS`/`NA` in the audit is found and given the same treatment; a grep
      for `NA(` and `PASS(` with a literal message is the sweep.

## Notes

**Do not simply flip `fog-no-refog` to a check that reads `manifest.json` and passes.** The
recorded baseline is the whole point: §4 asks whether the number *regressed*, which needs a
previous value. `audit --record` already writes a recorded audit; the previous `cellCount` and
`generation` belong there, and the check compares against them. Without a baseline it would be
another row that always prints green — which is the bug, moved.

The two checks are not symmetrical and should not be forced into one shape. The fog's baseline
lives in `manifest.json` (S3, authoritative per `02` §6.4). XP's will live in
`snapshots/skillstate/` (`02` §8.2, ticket `0067`) — the one derived fact that is not
re-derivable, which is exactly why that snapshot exists.

## Operator validation

> **D-181 — this is the AGENT's to run.** Everything above is a script and an S3 read;
> `AWS_PROFILE=devault` answers all of it. Record the smoke test at close.

1. Nothing. This ticket changes an audit script, and its correctness is demonstrated by the
   self-test failing on an injected regression rather than by anything a human can see.

**Performed 2026-09-27, by the agent, WSL2 dev box (no human check needed, per D-181):**

1. **Live read of the real manifest.** Ran `tickets.mjs audit 07-fog-projection-and-cells`
   against the deployed bucket with profile `devault`. `fog-no-refog` read one user's
   `manifest.json` (1003 cells, generation 60), confirmed with `aws s3 cp …/manifest.json -`, and
   reported `n/a — no recorded baseline yet — the next 'audit --record' sets it`. The row is now
   based on real data; before, it was a constant claiming the pipeline did not exist.
2. **Live failure path.** `AWS_PROFILE=nope tickets.mjs audit 07-…` reported
   `ERR fog-no-refog … The config profile (nope) could not be found`, the summary line
   `1 could not run`, and exit 1. A credentials failure no longer reads as n/a.
3. **Mutation check.** Replacing `compareFog`'s body with `return []` made 5 of the 13 new tests
   fail: lowered cellCount, lowered generation, a vanished manifest, the forced-record ratchet, and
   the unit test. The originals were restored afterwards. So the self-tests do fail on an injected
   regression.
4. `node --test tickets.test.mjs`: 152/152. `tickets.mjs validate`: 0 errors, 0 warnings.

## Resolution

**Files touched.**
- `.claude/skills/tickets/scripts/tickets.mjs`:
  - `fogNoRefog`, `xpNotLower`, `compareFog` (exported), `advanceBaseline`, `readManifests`,
    `userDataBucket`, `aws`, `sourceFiles`.
  - A new `ERR` verdict (`status: "error"`), carried through `cmdAudit` (exit code, `--json`'s
    `passed`, the `--record` refusal, `record.mechanical.error`) and `printAuditTable`.
- `.claude/skills/tickets/scripts/tickets.test.mjs`: 13 tests under `0183 — …`.
- `docs/capabilities/AUDIT.md` §4: the rows now say what they check and how the baseline works.
- `docs/decisions/DECISIONS.md`: **D-246**.

**How it works.**
- **`fog-no-refog`**
  - **n/a** only when `src/pipeline/explored-blob-store.ts` does not exist or does not write
    `manifest.json`. The reason comes from the repo, so it cannot go stale.
  - **ERR** when the pipeline exists but the check cannot compare: the bucket is not in the
    gitignored `amplify_outputs.json`, `aws` fails, a manifest is malformed, or the baseline file
    is malformed.
  - **n/a** when the pipeline exists but no baseline has been recorded, never pass.
  - **FAIL** when any baselined user's `cellCount` or `generation` is lower, or their manifest is
    gone.
- **`xp-not-lower`**
  - **n/a** until some non-test file under `src/` or `amplify/` mentions `snapshots/skillstate/`.
  - **FAIL** after that, until someone writes the real comparison. A pass would need the
    snapshot's shape, which does not exist yet.
- **The baseline** is `docs/capabilities/regression-baseline.json`, keyed by `sha256(sub)[:16]`.
  Only `--record` writes it, using the per-field max, so it never falls, even under `--force`.

**Decisions (D-246).**
- **Separate baseline file, not the audit record.** This departs from the ticket's Notes, and the
  operator approved it at session start. Records are append-only and spread across 18 docs; a
  comparison needs one current value. D-225's ratchet file is the precedent.
- **Hashed per-user keys, not totals.** Totals were my first proposal. Hashing keeps the per-user
  precision and still keeps the raw sub out of git.
- **`aws s3 ls`/`s3 cp`, not `s3api list-objects-v2`.** The CLI on this box (2.31.35 on Python
  3.14) crashes on every `s3api list-objects-v2` call with "badly formed help string". A check
  built on it would have reported ERR forever. `TICKETS_AWS_CLI` overrides the binary so the tests
  can inject regressions without an account.

**The sweep (last criterion).** Every other `NA(`/`PASS(` in `auditChecks` was already inside a
branch on `existsSync`, a run result or a count. §4 held the only constants. A test now fails if
the §4 block contains any literal `NA(`/`PASS(`. My first version of that test grepped the whole
file and matched the conditional rows too, so I narrowed it to the §4 block.

**What is not done, deliberately.**
- **The baseline is not armed yet.** Hand-seeding `regression-baseline.json` would be exactly the
  hand-edit the ratchet forbids. The next `audit --record` of any capability arms it; capability
  07 still has 3 open tickets.
- **AUDIT.md's old line named `explored-r10.bin`,** but the live manifest says `res: 11`. I
  rewrote that line around `manifest.json` rather than the blob filename, so it no longer names a
  resolution at all.
