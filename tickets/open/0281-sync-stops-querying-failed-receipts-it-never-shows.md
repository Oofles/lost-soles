---
id: 281
slug: sync-stops-querying-failed-receipts-it-never-shows
title: Sync stops querying failed receipts it never shows
type: chore
priority: low
status: open
size: s
capability: 14-webhook-and-automatic-sync
depends_on: []
blocked_by: []
source: agent
created: 2026-10-16T04:17:56Z
---

## Description

`app/sync-action.ts:174-188` runs `listFailedReceipts` (one DynamoDB query) after every sweep and
folds the count into `syncResultLine`. Since D-318 the plinth shows none of it:
`plinthSyncResult` (`lib/plinth/sync-result.ts`) reads only `outcomes`, and neither `line` nor
`failedCount` is logged. The query is paid on every press for an answer nobody reads.

Found by the capability `13` audit. It is not design drift, because D-318 governs what is shown,
not what is computed. Filed here because capability `14` replaces the interim Sync button, and
the cleanup belongs with that work.

## Acceptance criteria

- [ ] If the Sync action survives capability `14`: it no longer queries failed receipts, and
      `SyncSummary` drops `failedCount`. If it does not survive, this closes with the button's
      removal, and the Resolution says so.
- [ ] `0044`'s failed-import record is still reachable where `0178` expects it: the receipt table and
      the alarm. Only the per-press count goes.

## Steps to reproduce

1. Press Sync on `/`.

## Expected vs actual

**Expected:** no query whose result is discarded.

**Actual:** one `listFailedReceipts` query per press.

## Notes

`lib/sources/sync-message.ts`'s `failedLine` may become dead code with it; check for other callers.

## Operator validation

None: no visible change. Smoke test: a Sync press against the deployed app still queues and shows
`N activities queued.`.
