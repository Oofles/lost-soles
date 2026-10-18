---
id: 287
slug: runs-and-chronicle-readers-hide-tombstoned-activities
title: Runs and Chronicle readers hide tombstoned activities
type: feature
priority: med
status: open
size: m
capability: 14-webhook-and-automatic-sync
depends_on: []
blocked_by: []
source: agent
created: 2026-10-18T13:09:34Z
---

## Description

`0282` (D-355) tombstones an activity that was deleted at its source: T3 `status = TOMBSTONED`,
and nothing else changes. The operator kept that ticket write-only (Q5), so **no reader filters on
`status` yet**. A deleted run still shows in `/api/runs/latest`, the runs trace web and the
Chronicle, while `02-data-model.md` §4.7 says a tombstoned activity leaves the list.

Make the readers honour it. By D-020 and D-135 the cells it revealed stay revealed and its XP
stays: only the *list* views drop it.

## Acceptance criteria

- [ ] `lib/runs` (including `/api/runs/latest`) skips `TOMBSTONED` activities.
- [ ] The Chronicle does not list a `TOMBSTONED` activity.
- [ ] The runs trace web leaves out a tombstoned activity's trace, or the ticket records why it
      keeps it (the cells stay revealed either way, D-020).
- [ ] Map cells, the ledger and Total Level are unchanged by a tombstone, asserted by a test.
- [ ] Tests cover each reader with one active and one tombstoned activity.

## Notes

Filed at the merge of capability 14's wave (tickets `0282`, `0286`), 2026-10-18. Read 02 §4.7
and D-355. A tombstone is sticky: persist never writes `ACTIVE` back over it.

## Operator validation

None expected beyond a smoke test: tombstone a synthetic activity in a throwaway user's T3 row,
or through `retractActivity` in a test, and read each endpoint.
