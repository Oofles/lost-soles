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

- [ ] Neither row is a constant: each decides `na` from something it actually looked at, and the
      reason it prints is derived from that, not typed out.
- [ ] `fog-no-refog` stops claiming the fog pipeline does not exist while `src/pipeline/explored-*`
      is on disk.
- [ ] When a row's subsystem IS present, it runs a real regression check and can return `fail`.
      Shown red before it is trusted green — the `0161` rule.
- [ ] `tickets.test.mjs` covers both rows in both states.
- [ ] Whatever detection each row uses, it survives a justified rename — the `0161` lesson.

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
