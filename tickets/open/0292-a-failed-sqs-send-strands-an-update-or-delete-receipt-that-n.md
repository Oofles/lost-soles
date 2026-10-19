---
id: 292
slug: a-failed-sqs-send-strands-an-update-or-delete-receipt-that-n
title: A failed SQS send strands an update or delete receipt that no retry or sweep reopens
type: bug
priority: low
status: open
size: s
capability: 14-webhook-and-automatic-sync
depends_on: []
blocked_by: []
source: agent
created: 2026-10-19T05:23:49Z
---

## Description

The webhook writes the receipt (`QUEUED`, attempts 0), then sends to SQS. If the send throws, the
handler answers 500 and Strava retries, but the retry meets the existing receipt and is dropped as
`duplicate`. The header comment in `amplify/functions/ingest-webhook/handler.ts` ("THE HOLE
BETWEEN THE TWO WRITES") says the next sweep fills this hole through `needsEnqueue`. That was true
when `0091` wrote it, but only for `create` keys: `lib/sources/sync.ts` mints the create key and
nothing else. Since `0282`:

- a stranded **update** key (`…:update:<event_time>`, D-356) is never re-sent, so the edit is lost
  for good. D-350 already says the sweep cannot catch edits.
- a stranded **delete** key (D-355) stays `QUEUED`, which D-360 counts as a duplicate, so the
  genuine delete is lost until the receipt's 90-day TTL. The run stays visible.

Found at capability `14`'s audit (03 §2.3). Operator chose to fix it rather than record a known limit
(2026-10-19).

## Steps to reproduce

In a unit test of `amplify/functions/ingest-webhook/handler.ts`:
1. Use a `deps.send` that throws, and POST a valid `update` (or `delete`) event for a known owner.
   The handler answers 500, and the receipt is `QUEUED` with 0 attempts.
2. Restore `deps.send` and POST the same event again, as Strava's retry would.
3. Run `syncSource`'s `needsEnqueue` over the same activity.

## Expected vs actual

**Expected:** the retry in step 2, or the sweep in step 3, sends the job, as the handler's comment
promises.
**Actual:** step 2 logs `duplicate` and sends nothing. Step 3 checks only the activity's `create`
key, so the update or delete key stays `QUEUED` until its 90-day TTL, and nothing ever sends it.

## Acceptance criteria

- [ ] When `deps.send` throws for an **update** or **delete** command, the webhook releases the
      receipt it just wrote to `RECLAIMABLE` (a conditional write that only succeeds while the row is
      still `QUEUED` with 0 attempts), then answers 500 as today. Strava's retry then re-claims it.
- [ ] The re-claim path accepts `RECLAIMABLE` for update keys as it already does for delete keys
      (D-360's `reopenReclaimable`). `create` behaviour is unchanged, because the sweep still covers
      it.
- [ ] The release needs no new IAM grant. If it would, stop and ask: the webhook's grants are
      a §4.5 control.
- [ ] If the release itself fails, the handler still answers 500 and logs it. It never throws past
      the handler.
- [ ] Tests: a send failure on update and on delete leaves the key `RECLAIMABLE`, and a redelivery
      queues it; a send failure on create leaves it `QUEUED` as before; the release's condition never
      reopens a `DONE` or `PROCESSING` key.
- [ ] The handler's "HOLE BETWEEN THE TWO WRITES" comment is rewritten to say which path fills the
      hole for each aspect.

## Notes

Check the webhook's current `PutItem` grant first: the release may be expressible as a conditional
`PutItem` replacing the row. Its `UpdateItem` is held to `rate#*` keys by `LeadingKeys` (D-349)
and must stay that way.

## Operator validation

None expected. Smoke test: the unit suite covers the failure path, because forcing a live SQS
send failure would mean breaking the deployed queue policy. After deploy, one synthetic update to
the Function URL still logs `queued`, which shows the happy path is unchanged.
