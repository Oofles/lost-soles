---
id: 342
slug: split-strength-log
title: A split strength log: one activity, one minutes set per body region
type: feature
priority: high
status: open
size: m
capability: 10-add-workout
depends_on: [341]
blocked_by: []
source: agent
created: 2026-11-04T05:04:40Z
---

## Description

D-483's Strength workout entry is one log of N minutes split by percentage across Upper / Lower / Core & total body. It must land as **one activity** carrying one minutes set per region with a non-zero share. Each set's exercise feeds that region's skill (via `0341`), so one session trains up to three skills, each with its own soft cap.

The ruleset declares the split — which exercises it spans, their labels and the share step — so the regions are data, not code (D-031). Neither the entry boundary nor `log-workout` names a region.

## Acceptance criteria

- [ ] The ruleset schema can declare a split entry: an id, a label, `entry: minutes`, the member exercises (each one an existing `minutes` exercise), a share step (10%) and quick values. The validator refuses unknown members, a step that does not divide 100, and duplicates.
- [ ] `lib/log/workout-entry.ts` and the `log-workout` Lambda accept a split log of total minutes plus shares summing to 100%. They apportion whole seconds — the remainder goes to the largest share, with ties broken by declared member order — and write one activity with one set per non-zero share.
- [ ] A log whose shares do not sum to 100, are not multiples of the step, or name an exercise outside the split is refused before any write, with a typed error.
- [ ] Through the real adapter and `processActivity`: 45 min at 40/30/30 under a test ruleset awards 540 / 405 / 405 XP to the three region skills and the matching feeds; 45 min at 100/0/0 writes one set.
- [ ] Offline queue, idempotency key and undo (`06` §6.4) treat a split log as one log: one undo removes the whole activity.

## Notes

Decision: D-483. Cited design: `06-ui-ux.md` §6.4 (commit/undo), `02` §3.2, `lib/log/*`. Depends on `0341`. The UI is `0344`; this ticket only needs a minimal call path for tests.

## Operator validation

None perceptual. Smoke test: direct invocations of the live `log-workout` Lambda with invalid splits (refused before any write), as `0329` did. The first accepted log is the operator's real session after `0344`.
