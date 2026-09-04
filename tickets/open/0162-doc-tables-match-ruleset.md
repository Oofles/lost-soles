---
id: 162
slug: doc-tables-match-ruleset
title: Extend the doc-vs-ruleset assertion from 04 §1.3's example to the prose tables that restate rows
type: chore
priority: med
status: open
size: m
capability: 18-mvp-hardening
depends_on: []
blocked_by: []
source: agent
created: 2026-09-04T17:05:22Z
---

## Description

**D-193 holds by review today, which is the weakest kind of enforcement and the reason the
failure it describes has now happened twice.** This ticket gives it a check.

`src/rules/doc-schema.test.ts` already does the job for exactly one passage: it asserts that
every row of `04-game-design.md` §1.3's YAML example agrees with `rules/xp-rules-v1.yaml` field
by field, and that the example still passes the real validator. The mechanism works. It covers
one example and no prose.

The capability `04` audit found three tables outside that example restating ruleset values, all
stale, all falsified by changes D-031 promises are free:

| Where | Said | Shipped |
|---|---|---|
| `04-game-design.md` §1.1 | Roving **35 XP/km** | 60, since `0158` |
| `04-game-design.md` §3.2 | no Vigil / Roving / Cadence row | five distance skills exist |
| `02-data-model.md` §3.2 | `unit` is `km \| rep \| second \| cell` | `share` is also in use |

All three were amended by that audit. Nothing stops the fourth.

## Acceptance criteria

- [ ] A check parses the ruleset-derived values out of the design docs' **prose tables** — at
      minimum `04` §1.1 and §3.2, and `02` §3.2's attribute vocabularies — and compares them to
      `rules/xp-rules-v1.yaml`.
- [ ] It **fails** when a rate, unit or flag in a doc disagrees with the file. Proven by changing
      one number in a scratch copy and watching it go red, naming the doc, the row and both values.
- [ ] It **fails** when a skill row is added to the YAML and a table that enumerates skills does
      not gain a row — the `0157` case, which is the one that actually happened twice.
- [ ] A dated snapshot table, which D-193 explicitly permits, is either exempt by an explicit
      marker or is itself checked against its stated date. Whichever is chosen is written down;
      an exemption nobody can see is how the next table drifts.
- [ ] The check runs in CI on every build, alongside the other `scripts/check-*.mjs` gates.
- [ ] It reports every disagreement, not the first — the same discipline as the rules validator.

## Notes

**Scope discipline.** This is a checker for values the ruleset owns. It is **not** a prose linter
and must not try to verify design *reasoning* — §3.2's session-parity argument is prose that
happens to contain numbers, and the check's job is the numbers, not the argument. If that
distinction turns out to be unmakeable mechanically, that is a finding worth recording rather
than a reason to widen the check until it produces noise.

Filed by the `04-domain-contract-and-rules` drift audit, which recorded D-193 and needed
somewhere honest to put "and this is not enforced yet".

## Operator validation

None. A CI check with no rendered surface. Verify by agent: each failure mode above is shown to
go RED on a seeded disagreement before the check is trusted green — this project has twice been
bitten by a gate that had only ever been seen passing.
