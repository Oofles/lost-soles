---
id: 301
slug: rebuild-drill-resurrects-retracted-activities
title: Rebuild drill resurrects retracted activities
type: bug
priority: low
status: open
size: s
capability: 16-rebuild-drill
depends_on: []
blocked_by: []
source: agent
created: 2026-10-21T03:53:20Z
started: 2026-10-21T19:31:21Z
---

## Description

raw/ keeps no record of a D-355 retraction, so the drill (0103) writes a TOMBSTONED activity back as ACTIVE. XP still agrees, because tombstoned XP was kept (D-135), but the activity would reappear in the run list. No tombstoned activities exist live today. Found by 0103.

## Acceptance criteria

- [ ] The drill learns of D-355 retractions from a durable source outside the tables it rebuilds
      (for example a record written beside the raw object at retraction time), and a test retracts
      one fixture activity and asserts the rebuilt Activity row is `TOMBSTONED`.
- [ ] A retracted activity still contributes its kept XP (D-135) and its cells (D-020) in the rebuild.
- [ ] Step 8 check 2's reconciliation accounts for tombstoned activities, if they change the count.

## Steps to reproduce

1. Retract an activity (D-355) so its Activity row is `TOMBSTONED`.
2. Run the drill (`--phase=rebuild`) into a fresh target.
3. Read the rebuilt Activity row.

## Expected vs actual

**Expected:** the rebuilt row is `TOMBSTONED`, as it was before the drill.

**Actual:** it is `ACTIVE`, because `raw/` keeps no record of the retraction, so the activity reappears in the run list after cutover.

## Notes

Found by `0103` (wave 16.2). No tombstoned activities exist live today, so the live drill (`0105`) is not affected yet. Whatever records the retraction must not be deletable by the drill and must not live only in the rebuilt tables, or D-101 ("everything is reconstructible from raw") stays untrue for retractions.

## Operator validation

Smoke test, agent's to run: the fixture test above, and a drill into a scratch target after a synthetic retraction. No perceptual check.
