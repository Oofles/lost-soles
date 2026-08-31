---
id: 42
slug: process-activity-lambda-and-queue
title: process-activity Lambda, SQS queue and DLQ via the CDK escape hatch
type: feature
priority: high
status: open
size: m
capability: 06-ingest-pipeline
depends_on: [39, 40, 41]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
---

## Description

The worker that runs the pipeline end to end: dequeue an `IngestJob`, load source credentials,
fetch raw, archive (0039), normalize, score-gate the receipt (0040), persist (0041), and — once
`07` lands — write cells and regenerate the blob.

Resources come through `backend.createStack` (the CDK escape hatch, `01-architecture.md` §2), not
through Amplify's `defineFunction` conventions, because the queue and the DLQ are not Amplify
concepts:

- `ActivityIngestQueue` (standard SQS) with a redrive policy to `ActivityIngestDLQ`,
  `maxReceiveCount: 3`, 14-day DLQ retention.
- `process-activity` Lambda: **2048 MB, 900 s timeout, `batchSize: 1`**. The memory is for the
  densify + H3 pass, and `batchSize: 1` means one poisoned message cannot fail a batch of good
  ones.
- No VPC (D-081) — nothing here needs a NAT gateway, and a NAT would blow the D-083 cost target
  on its own.

The queue exists now even though the only producer is the Sync action (0043). Capability `14`
adds the webhook producer to the same queue with no change to this consumer — that is the point of
building it queue-shaped rather than as a direct call.

SQS standard delivery is at-least-once, so the score gate in 0040 is what makes redelivery safe,
not the queue.

## Acceptance criteria

- [ ] `ActivityIngestQueue` + `ActivityIngestDLQ` exist in the custom stack with
      `maxReceiveCount: 3` and 14-day DLQ retention.
- [ ] `process-activity` is configured 2048 MB / 900 s / `batchSize: 1`, no VPC.
- [ ] The Lambda's IAM role can read/write `IngestReceipt` and `Activity`, PUT to `raw/*`, and
      read `SourceAccount` — and holds **no** `dynamodb:DeleteItem` on the cell table (I-7).
- [ ] The handler runs the steps in the fixed order: credentials → fetch → archive → normalize →
      score gate → persist. A test asserts the order, not just that each ran.
- [ ] A message whose handler throws is retried and lands in the DLQ on the fourth delivery.
- [ ] A Strava 401 refreshes once, retries once, then fails to the DLQ — it does not loop.
- [ ] A Strava 429 returns the message to the queue with a delay rather than failing.
- [ ] Cold-start and warm-path timings are logged so 0044 has something to alarm on.

## Notes

`01-architecture.md` §4 "Failure handling" is the specification for the retry rules above; do not
invent different ones. The visible surfacing of a DLQ message is 0044's job — this ticket only has
to make sure the message actually gets there.

Amplify's clean `npm ci` environment is stricter than local (`09-roadmap.md` §8.3): verify every
new path alias resolves in the deployed build and that every new file actually landed in the
commit.

## Operator validation

1. Deploy, then press Sync with one real activity. The activity appears in DynamoDB within a
   minute and CloudWatch shows one invocation, not three.
2. Temporarily point the Strava base URL at a dead host and Sync again. Watch the message get
   retried three times and then appear in `ActivityIngestDLQ` in the SQS console.
3. Restore the URL, redrive the DLQ message from the console, and confirm the run imports cleanly
   — no duplicate `Activity` row.
