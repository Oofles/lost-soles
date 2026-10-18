---
id: 288
slug: a-forged-delete-can-pre-empt-a-genuine-one-for-90-days
title: A forged delete can pre-empt a genuine one for 90 days
type: bug
priority: low
status: open
size: s
capability: 14-webhook-and-automatic-sync
depends_on: []
blocked_by: []
source: agent
created: 2026-10-18T13:09:34Z
started: 2026-10-18T23:16:23Z
---

## Description

D-355 keys a webhook delete as `sha256(strava:<owner>:<object>:delete)`, with no `event_time`.
A **forged** delete of a live activity is confirmed with Strava, logged `forged-or-stale`, and
writes nothing to T3. But it still closes that delete receipt `DONE`. A **genuine** delete of the
same activity within the receipt's 90-day TTL (T8) is then dropped as a duplicate at the gate.

The same happens if Strava ever sends a delete before its own API answers 404 for the activity.

The only effect is that the run stays visible: no XP or cell is touched either way. The
reconciliation sweep (`0095`) lists activities that exist, so it never notices a deletion.

## Steps to reproduce

1. POST a `delete` for a live activity of ours to the webhook (a forgery: Strava never sent it).
2. The worker confirms with Strava (200), logs `forged-or-stale`, and closes the receipt `DONE`.
3. Delete the activity on Strava. Strava sends the genuine `delete`.

## Expected vs actual

- **Expected:** the genuine delete tombstones the activity.
- **Actual:** it hashes to the same `ingestKey`, meets the `DONE` receipt, and is dropped as
  `duplicate` for up to 90 days. The run stays visible.

## Acceptance criteria

- [ ] After a `forged-or-stale` retract, a later genuine delete of the same activity tombstones it.
- [ ] Strava's own redeliveries of one genuine delete still cost one receipt and one confirmation
      each at most, and cannot tombstone twice.
- [ ] The fix stays inside the webhook's grants (`PutItem` on the receipt gate, plus `UpdateItem`
      on `rate#*` keys only).

## Notes

Filed at the merge of capability 14's wave, from `0282`'s report. Two shapes were proposed:
- free the delete key (delete the receipt, or mark it re-claimable) in the worker after
  `forged-or-stale`;
- add `event_time` to the delete key. Q3 declined this when `0282` was built.

Choose with the operator; a forged `event_time` costs only a confirmation call, metered by
D-349's delete budget.

## Operator validation

None expected. Smoke test: a forged delete of a live activity, then a synthetic delete of a
non-existent id under the same key path, against the deployed URL.
