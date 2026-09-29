---
id: 219
slug: skillstate-level-written-at-ingest
title: SkillState level and levelHighWater written at ingest, in the ledger transaction
type: feature
priority: high
status: open
size: s
capability: 09-xp-engine-and-ledger
depends_on: [62, 63]
blocked_by: []
source: agent
created: 2026-09-29T02:19:08Z
started: 2026-09-29T19:04:46Z
---
## Description

`02` §4.3's transaction sets `level` and `levelHighWater` on each `SkillState` alongside the
`ADD`: *"the Lambda computes them from the pre-read `SkillState` and writes them with a
`ConditionExpression` on the pre-read `xpLedgerSum`"*. `0062` built the ADD, the pre-read and the
condition. It did **not** write `level` or `levelHighWater`, because the curve is `0063`'s and was
not built yet. T2 declares both attributes as optional so rows written before this ticket read
cleanly.

This ticket adds the two SETs to `skillStateUpdateItem` (`src/pipeline/xp-ledger.ts`):
`level = levelForXp(prev + xp, curve)` and `levelHighWater = max(prev.levelHighWater, level)`
(I-17). It also backfills the rows that already exist.

## Acceptance criteria

- [ ] `skillStateUpdateItem` sets `level` and `levelHighWater` from the pre-read row plus this
      activity's XP, using `0063`'s `levelForXp` and the ruleset's `curve`.
- [ ] `levelHighWater` is `max(previous, computed)`: a test with a pre-read high-water above the
      computed level leaves it untouched (I-17).
- [ ] Every `SkillState` row written before this ticket has `level`/`levelHighWater` populated.
      A one-shot script against the deployed table is acceptable; record what it did.
- [ ] Profile `totalXp` (`02` §4.3's `Update Profile` line) is either written here, or confirmed
      to be owned by the ticket that creates T1 (`0182`), with a note saying which.

## Notes

Filed by `0062`. The retry-on-lost-race already covers these SETs: they are computed from the
same pre-read that the condition guards.

## Operator validation

TODO — the level shown on the skills screen once it exists. Until then, a smoke test reading T2.
