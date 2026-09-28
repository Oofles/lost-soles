---
id: 184
slug: the-two-audit-md-4-regression-rows-are-hardcoded-n-a-and-can
title: The two AUDIT.md §4 regression rows are hardcoded n/a and can never activate
type: bug
priority: high
status: open
size: s
capability: 01-ticket-system
depends_on: []
blocked_by: []
source: agent
created: 2026-09-08T17:53:27Z
started: 2026-09-28T01:59:27Z
---

## Description

Found by the `04-domain-contract-and-rules` re-audit (2026-09-08). **The third detector in this
family, after `vigil-test` and `invariant-sweep` (`0161`).**

`AUDIT.md` §4 has two scriptable rows. Both are literal constants in `auditChecks()`:

```js
checks.push(NA("fog-no-refog", "4",
  "no explored blob or fog pipeline exists yet — activates with capability 07 (D-020, I-7)"));
checks.push(NA("xp-not-lower", "4",
  "no XP ledger exists yet — activates with capability 09 (D-135, I-16)"));
```

They take no argument, read nothing, and cannot return anything but `na`. **Every capability audit
from `02` to `19` will print these two lines verbatim, including the audit run the morning after
the fog pipeline ships.**

`fog-no-refog`'s reason is **already false.** `src/domain/explored-blob.ts`,
`src/domain/explored-agg.ts`, `src/pipeline/explored-blob-store.ts`, `explored-cells.ts`,
`explored-generation.ts`, `explored-mirror.ts` and `explored-rebuild.ts` all exist and are tested;
`I-7`, `I-8` and `I-9` are among the nine invariants the sweep now counts as cited. The row says
the subsystem does not exist yet. `xp-not-lower`'s reason is still true in substance — there is no
ledger — but it is true by luck, not because anything checked.

These are the two rows that carry `D-020` and `D-135`, the project's two irreversibility promises.
A row that cannot go red is not protecting them.

## Steps to reproduce

```
node .claude/skills/tickets/scripts/tickets.mjs audit 04-domain-contract-and-rules
#   n/a  fog-no-refog   no explored blob or fog pipeline exists yet — activates with capability 07
ls src/pipeline/explored-*.ts     # the pipeline it says does not exist
```

## Expected vs actual

**Expected:** each row detects whether its subsystem is present, and once it is, runs a real check
— a fixture asserting cell count never falls, a fixture asserting no skill total falls — and can
report `fail`. Until then, an `na` whose reason is checked against the repo rather than asserted
from memory.

**Actual:** two string constants that will read the same on the last day of the project as on the
first, one of which is already wrong.

## Acceptance criteria

- [x] Neither row is a constant: each decides `na` from something it actually looked at, and the
      reason it prints is derived from that, not typed out.
- [x] `fog-no-refog` stops claiming the fog pipeline does not exist while `src/pipeline/explored-*`
      is on disk.
- [x] When a row's subsystem IS present, it runs a real regression check and can return `fail`.
      Shown red before it is trusted green — the `0161` rule.
- [x] `tickets.test.mjs` covers both rows in both states.
- [x] Whatever detection each row uses, it survives a justified rename — the `0161` lesson.

## Notes

**This is the third instance, so it is a pattern rather than three bugs.** `vigil-test` matched a
filename; `invariant-sweep` matched any `I-n` in any test file; these two match nothing at all.
Every one reported something other than the truth in a row that renders green-ish. Worth asking,
while in this code, whether the remaining `na`-capable checks (`npmCheck`, `boundary-greps`,
`script-tests`) can lie the same way — they at least test for a file's existence, which is why they
have not. **If a fourth turns up, the finding is about `NA()` itself**: an `na` reason is free text
written once and never re-evaluated, and nothing makes it face the repo again.

## Operator validation

None — ticket tooling, no rendered surface, nothing deployed. Verify by agent: the reason strings
change when the repo changes, and each row is shown to FAIL under a fixture before it is trusted.

**Performed 2026-09-27, by the agent, WSL2 dev box:**

1. **Red before green.** I temporarily put back 0183's path-based detection (the row only armed on
   `src/pipeline/explored-blob-store.ts`). The new rename test failed. Restored, it passes.
2. `node --test tickets.test.mjs`: 153/153.
3. **Live.** `tickets.mjs audit 01-ticket-system` against the deployed bucket (`devault`):
   `fog-no-refog` still finds the real pipeline through its key template, reads the manifest, and
   reports `no recorded baseline yet … (1 user(s), 1003 cells @ gen 60)`.

## Resolution

**This ticket duplicates `0183`.** Both were filed on 2026-09-08 by two different audits. I only
noticed after 0183 closed. Criteria 1–4 were delivered by **`0183`** (commit `386e2ca`; D-246):
- Neither row is a constant; each decides n/a from what it looked at.
- The fog row reads `manifest.json` from S3 and compares it against a ratcheted baseline.
- Both rows are shown failing on injected regressions.
- 13 tests cover both states.

Read 0183's Resolution for the design.

**Criterion 5, surviving a rename, was NOT met by 0183, and it is the only new code here.**
0183 armed `fog-no-refog` on the path `src/pipeline/explored-blob-store.ts`. A justified rename or
move of that file would quietly switch the row back to n/a, which is the same failure as
`vigil-test`'s filename match in 0161. I missed it in 0183 even though 0183 was itself about a
check that goes quiet.

**Files touched.**
- `tickets.mjs`: `FOG_STORE` (a path) is replaced by `FOG_MANIFEST_KEY`. The row now arms on any
  non-test source under `src/` or `amplify/` that builds the per-user key template
  `users/${…}/manifest.json`. In the real repo only `explored-blob-store.ts` builds it; three other
  files mention `manifest.json` in prose or reads, and the template match excludes them. The n/a
  reason now names what was searched for, not a path.
- `tickets.test.mjs`: one test. A test file carrying the key does not arm the row. The store
  renamed and moved to `src/fog/storage/manifest-keys.ts` still arms it and still reads S3.

**The Notes' question** (do `npmCheck`, `boundary-greps` and `script-tests` lie the same way?):
0183's sweep checked this. Each one tests a file's existence or runs a command, so they fail
closed on a rename: a missing `package.json` script or checker file makes the row n/a with a reason
naming the file. That is not a silent green, because the reason names the file. I found no fourth
instance, so the finding about `NA()` itself does not trigger.

No new decision: this is how D-246 was meant to be applied, not a change to it.
