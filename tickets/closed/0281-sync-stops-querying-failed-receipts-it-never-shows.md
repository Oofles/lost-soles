---
id: 281
slug: sync-stops-querying-failed-receipts-it-never-shows
title: Sync stops querying failed receipts it never shows
type: chore
priority: low
status: closed
size: s
capability: 14-webhook-and-automatic-sync
depends_on: []
blocked_by: []
source: agent
created: 2026-10-16T04:17:56Z
started: 2026-10-16T13:42:37Z
closed: 2026-10-16T15:11:08Z
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

- [x] If the Sync action survives capability `14`: it no longer queries failed receipts, and
      `SyncSummary` drops `failedCount`. If it does not survive, this closes with the button's
      removal, and the Resolution says so.
- [x] `0044`'s failed-import record is still reachable where `0178` expects it: the receipt table and
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

## Resolution

**The Sync action survives capability `14`** (`0117` keeps the button as a manual convenience,
`0095` calls it one, and `0177` is extending it in this same wave), so the first branch of
criterion 1 applies: the action no longer queries failed receipts and `SyncSummary` no longer
carries `failedCount`. Per D-318 nothing new consumes the count; the read is removed, not moved.

Files touched:

- `app/sync-action.ts`: dropped the `listFailedReceipts` import and call, the `try/catch` and its
  `failed-receipt-query-failed` log line, `failedCount` on `SyncSummary` and on both returns, and the
  now-unused `log` import. The sweep loop is untouched, so `0177`'s parallel edit should cherry-pick
  cleanly. One risk: if `0177` adds a `log.` call, it needs to re-add that import.
- `app/sync-action.test.ts`: the `0044` wiring tests (read after the sweep, a failed read does not
  fail the press) were replaced. The new tests say the press never calls `listFailedReceipts`, even
  with failures outstanding, and that the summary has no `failedCount` property.
- `lib/sources/sync-message.ts`: removed `syncResultLine`'s `failedCount` parameter and the
  `failedLine` helper. Both became dead code (the ticket's note), and `sync-action.ts` was their
  only caller.
- `lib/sources/sync-message.test.ts`: deleted the "outstanding failures" block, which tested
  `failedLine`.
- `lib/plinth/sync-result.ts` / `.test.ts`: dropped the `failedCount` row from the doc table and
  the test that passed `failedCount` through an `as never` cast.
- `src/pipeline/ingest-receipt.ts`, `amplify/backend.ts`: comments only. They no longer say the
  Sync action reads the index.

**What stays (criterion 2, D-209/D-210):** `recordFailure`, `claimForScoring`'s clearing step, the
`failedUserId` attribute, the sparse `failedByUser` GSI, the receipt table and the DLQ alarm are
all unchanged. `0178`'s re-check scans the receipt table for `errorClass` and does not depend on
the Sync line. `ingest-receipt.test.ts` still passes against the unchanged write path.

**`listFailedReceipts`: kept, with no app caller.** It is the one tested reader of the sparse index
that `recordFailure` still writes. Deleting it would leave the index write-only, with nothing
proving that its key and projection answer the question they were built for. It would also be the
query for a runbook walk or any later surface. Its doc comment now says it has no app caller since
`0281`.

**IAM: unchanged.** The SSR role's `grantReadWriteData` on `LostSolesIngestReceipt` still includes
`<table>/index/*`, so the role keeps a `Query` on `failedByUser` it no longer uses. Narrowing that
grant is not this ticket's scope. The role still needs read/write on the table for the accept gate.

**Found, not fixed:** `0178`'s second `(operator)` criterion still reads *"Pressing Sync afterwards
reports the failure, rather than 'nothing new'"*. That has been false since D-318 and is now
false in the code as well. That ticket needs an amendment from the orchestrator.

**Verification:** all of `amplify.yml`'s build-phase guards, `typecheck`, `lint`, `vitest run`
(3639 passed) and `build` were green in the worktree. `## Operator validation` above stands as
written.

**Result, 2026-10-16 (agent, Amplify job 408, `6f3d2b8`):** a Sync press needs the operator's
signed-in session, which the agent does not hold, so the check was made on the build itself. The
`.next/server` output of the deployed commit contains no `failedByUser` reference anywhere, and
`app/sync-action.ts` has no `listFailedReceipts` call. The press's queue path is unchanged and is
covered by `app/sync-action.test.ts`. The `failedByUser` index stays ACTIVE and is still written
by `recordFailure`.
