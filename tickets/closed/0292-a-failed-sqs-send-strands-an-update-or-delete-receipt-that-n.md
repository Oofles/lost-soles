---
id: 292
slug: a-failed-sqs-send-strands-an-update-or-delete-receipt-that-n
title: A failed SQS send strands an update or delete receipt that no retry or sweep reopens
type: bug
priority: low
status: closed
size: s
capability: 14-webhook-and-automatic-sync
depends_on: []
blocked_by: []
source: agent
created: 2026-10-19T05:23:49Z
started: 2026-11-05T18:52:06Z
closed: 2026-11-05T19:08:25Z
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

- [x] When `deps.send` throws for an **update** or **delete** command, the webhook releases the
      receipt it just wrote to `RECLAIMABLE` (a conditional write that only succeeds while the row is
      still `QUEUED` with 0 attempts), then answers 500 as today. Strava's retry then re-claims it.
- [x] The re-claim path accepts `RECLAIMABLE` for update keys as it already does for delete keys
      (D-360's `reopenReclaimable`). `create` behaviour is unchanged, because the sweep still covers
      it.
- [x] The release needs no new IAM grant. If it would, stop and ask: the webhook's grants are
      a §4.5 control.
- [x] If the release itself fails, the handler still answers 500 and logs it. It never throws past
      the handler.
- [x] Tests: a send failure on update and on delete leaves the key `RECLAIMABLE`, and a redelivery
      queues it; a send failure on create leaves it `QUEUED` as before; the release's condition never
      reopens a `DONE` or `PROCESSING` key.
- [x] The handler's "HOLE BETWEEN THE TWO WRITES" comment is rewritten to say which path fills the
      hole for each aspect.

## Notes

Check the webhook's current `PutItem` grant first: the release may be expressible as a conditional
`PutItem` replacing the row. Its `UpdateItem` is held to `rate#*` keys by `LeadingKeys` (D-349)
and must stay that way.

## Operator validation

None expected. Smoke test: the unit suite covers the failure path, because forcing a live SQS
send failure would mean breaking the deployed queue policy. After deploy, one synthetic update to
the Function URL still logs `queued`, which shows the happy path is unchanged.

**Result, 2026-11-05 (agent, deployed stack, Amplify job 459, commit `68b2160`; smoke test).**
I posted one synthetic `update` for activity `15668986664` (owner `51449053`, subscription
`377486`, `event_time` 1793905642) to the Function URL. It answered 200, and the webhook logged
`webhook-ack` with outcome `queued` under key `dd1fa6ca…`. The worker picked it up, and the
receipt in `LostSolesIngestReceipt` is `DONE`, attempts 1, xpAwarded 169. That is the run's
existing XP: a re-fetch awards nothing new. The ingest DLQ depth is 0. So the update path's new
`reopenReclaimable` gate and `sendOrRelease` wrapper leave the happy path as it was. I did not
force the failure path live, because that would mean breaking the deployed queue policy;
`send-failure.test.ts` covers it. No perceptual check: nothing visible changed.

## Resolution

**Files.**
- `src/pipeline/ingest-receipt.ts` — new `releaseUnsentReceipt`. It is a conditional `PutItem`
  that rewrites the receipt as `RECLAIMABLE`, under `#status = :queued AND attempts = :zero`.
  It returns `released` or `kept` and rethrows anything other than a condition failure. It is
  a Put, not an Update, because the webhook's role holds `PutItem` on the table and `UpdateItem`
  only on `rate#*` (D-349). That means **no IAM change**: `amplify/backend.ts` is untouched. A
  Put replaces the row, so it writes the whole item again, with a fresh `acceptedAt` and `ttl`.
  The comments on `ReceiptStatus` and `AcceptOptions` now name the second writer of
  `RECLAIMABLE` and the second caller of `reopenReclaimable`.
- `amplify/functions/ingest-webhook/handler.ts` — new `sendOrRelease`, used by `forwardRetract`
  and by the `reingest` (update) branch of `enqueue`. It catches a failed send, attempts the
  release, logs `send-failed-released`, `send-failed-kept` or `release-failed` (error class
  only), then rethrows **the send's error**. The existing catch then answers 500, as before. The
  `reingest` accept now passes `reopenReclaimable: true`; `ingest` (create) does not, and still
  calls `deps.send` directly. The "HOLE BETWEEN THE TWO WRITES" comment now says which path fills
  the hole for each aspect: the sweep for create, Strava's retry through `RECLAIMABLE` for update
  and delete.
- `amplify/functions/ingest-webhook/send-failure.test.ts` (new, 11 tests). Its fake receipt
  table evaluates each Put condition by its exact text, so a changed condition fails the test
  rather than slipping past.
  - Update and delete: a send failure answers 500 and leaves the key `RECLAIMABLE`. The
    redelivery queues it, and the next redelivery is a duplicate again.
  - Update and delete: a release that throws still answers 500, logs `release-failed`, and the
    500 reports the send's error class.
  - Create: a send failure leaves the key `QUEUED`, the retry is a duplicate, and
    `needsEnqueue` re-sends it. This is the ticket's repro step 3.
  - The release condition keeps `DONE`, `PROCESSING`, `FAILED`, and a `QUEUED` key with attempts
    1. It never mints a missing row, and it is a single conditional `PutCommand`.

Full suite 4853 passed, `tsc` and `eslint` clean.

**One edge, accepted rather than fixed.** If `SendMessage` throws even though the message was
actually delivered (an ambiguous timeout), the release can win the race against the worker's
`recordDelivery`. The receipt then goes `RECLAIMABLE`, and the worker's `claimForScoring` sees
it as a duplicate and stops. Strava's retry then re-claims the key and sends the job again, so
the update or delete still happens, one retry later. If the worker's `recordDelivery` lands
first, attempts becomes 1 and the release correctly loses. The only case that strands a key is
an ambiguous send *and* Strava never retrying, which is narrower than the hole this closes.

No new decision. This builds on D-356, D-355, D-360 (`reopenReclaimable`) and D-349, and changes
none of them.
