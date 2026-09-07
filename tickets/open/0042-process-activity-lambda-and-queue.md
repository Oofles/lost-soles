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
started: 2026-09-07T02:50:56Z
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

- [x] `ActivityIngestQueue` + `ActivityIngestDLQ` exist in the custom stack with
      `maxReceiveCount: 3` and 14-day DLQ retention.
- [x] `process-activity` is configured 2048 MB / 900 s / `batchSize: 1`, no VPC.
- [x] The Lambda's IAM role can read/write `IngestReceipt` and `Activity`, PUT to `raw/*`, and
      **read and write** `SourceAccount` — and holds **no** `dynamodb:DeleteItem` on the cell
      table (I-7).
      *(**Amended.** The criterion said "read `SourceAccount`". `01-architecture.md` §4 step 7 and
      §2's own grants block both say read/write, and the reason is concrete: the provider may
      return a new refresh token on any refresh (`03-integrations.md` §2.2), so an inline refresh
      that cannot write the rotation back leaves the row holding a retired token — the connection
      would die on the FIRST refresh. The lease that stops two refreshers racing is also a
      conditional write. Verified live: the smoke test's `expiresAt` advanced, which is the write
      happening.)*
- [x] The handler runs the steps in the fixed order: credentials → fetch → archive → normalize →
      score gate → persist. A test asserts the order, not just that each ran.
- [x] A message whose handler throws is retried and lands in the DLQ on the fourth delivery.
- [x] A Strava 401 refreshes once, retries once, then fails to the DLQ — it does not loop.
- [x] A Strava 429 returns the message to the queue with a delay rather than failing.
- [x] Cold-start and warm-path timings are logged so 0044 has something to alarm on.

## Notes

`01-architecture.md` §4 "Failure handling" is the specification for the retry rules above; do not
invent different ones. The visible surfacing of a DLQ message is 0044's job — this ticket only has
to make sure the message actually gets there.

Amplify's clean `npm ci` environment is stricter than local (`09-roadmap.md` §8.3): verify every
new path alias resolves in the deployed build and that every new file actually landed in the
commit.

## Resolution

**Files touched**

| File | What |
|---|---|
| `src/pipeline/process-activity.ts` | New. The six phases in one order, with no knowledge that a queue exists. Returns dispositions; throws only for genuine faults. |
| `src/pipeline/process-activity.test.ts` | New, 9 tests. The order assertion is one shared `calls` array, not six "was it called" checks. |
| `amplify/functions/process-activity/resource.ts` | New. 2048 MB / 900 s / no VPC. |
| `amplify/functions/process-activity/handler.ts` | New. The SQS half: the 429 delay, the no-loop rule, and the timings line. |
| `amplify/functions/process-activity/handler.test.ts` | New, 8 tests. Criteria 6 and 7 were handler behaviour with no test file at all. |
| `amplify/backend.ts` | Queue + DLQ + event source + five explicit grants + three environment values + two outputs. |
| `amplify/process-activity-stack.test.ts` | New, 15 tests against the synthesized CloudFormation. |
| `lib/sources/adapter-credentials.ts` | New. §4 step 7's missing half — a job to the credential object an adapter takes. |
| `src/adapters/errors.ts` | `SourceRateLimitedError`. |
| `src/adapters/strava/adapter.ts` | One `apiError()` helper; 429 leaves the directory as the shared type. |
| `src/adapters/registry.ts`, `registry.test.ts` | The ingest adapter registered. |
| `lib/log.ts`, `lib/log.test.ts` | `credentialsMs` added to `NOT_SENSITIVE`. |
| `package.json` | `@aws-sdk/client-sqs`. |

**Four decisions, all put to the operator before any code was written.**

1. **`SourceRateLimitedError` joins the shared error vocabulary.** `check-boundaries.mjs` forbids
   the string `strava` anywhere in `src/pipeline`, so the worker cannot import `StravaApiError` to
   learn that a 429 happened, and matching on a bare `status` property would make §4's rule depend
   on a convention nothing enforces. `src/adapters/errors.ts` exists for exactly this — its own
   header says both halves of the boundary have to agree about these conditions.
2. **`SourceAccount` is granted read/write.** See the amended criterion above.
3. **The ingest adapter is registered** (operator's call). `ADAPTERS` was `{}` and
   `process-activity` reaches its adapter only through `getAdapter(job.source)`, so the whole
   ingest path was a function that throws. This overtakes ticket `0175`, which has a dated note
   recording that its criteria 1-2 are satisfied and its criterion 3 ("`ships empty` is untouched")
   is overturned.
4. **The DLQ transition is proved live**, not just asserted in synth — at the cost of ~48 minutes
   of wall clock, because three receives at a 16-minute visibility timeout is what the design asks
   for.

**Least privilege, and the trap inside it.** Every DynamoDB grant is an explicit action list rather
than `grantReadWriteData`. That started as a style preference and turned into the point of
criterion 3: the convenience method hands out `dynamodb:DeleteItem`, `BatchWriteItem` and `Scan` on
every table it touches, and I-7 is classified **[S] Structural** precisely so the cell table cannot
inherit a delete grant in capability 07 by someone reaching for the same method out of habit. The
S3 grants are a hand-written statement for the same reason: `bucket.grantRead()` also grants
`s3:List*` and `s3:GetBucket*` on the WHOLE bucket, because bucket-level access cannot be scoped to
a prefix, so the worker would have been able to enumerate every user blob. The deployed role holds
fifteen actions and no `dynamodb:Delete*` and no `s3:Delete*`.

**What went wrong on the way — three things, and two of them only in production.**

1. **Narrowing the grants silently dropped the KMS grant.** `Table.grant()` does not grant the
   encryption key; `grantReadWriteData` does. `LostSolesSourceAccount` is the one table with a
   customer-managed key, and a CMK's default policy delegates to IAM rather than granting anything
   itself — so `dynamodb:GetItem` without `kms:Decrypt` is refused by KMS on every read. **Nothing
   in CI noticed**, and it could not have: the synth test asserts the actions that must be absent
   and the ones the pipeline calls, and a missing KMS action is neither. Found by reading the
   deployed role, fixed, and now asserted.
2. **The log redactor blanked `credentialsMs`.** The first successful live import logged
   `"credentialsMs":"<redacted>"` — the by-name credential rule firing on a duration. That is worse
   than an absent field: it reads as though a credential nearly leaked, and criterion 8 exists so
   `0044` can alarm on that number. Added to `lib/log.ts`'s `NOT_SENSITIVE`, which is what that
   list is for, with a test that `credentialsMap` is still redacted so the exemption stays one key
   wide.
3. **`initMs` was not the init duration.** It reported 29 ms beside Lambda's own
   `Init Duration: 349.43 ms`, because `MODULE_LOADED_AT` is set at the END of initialization.
   Renamed `sinceInitMs` and documented for what it actually measures. A field claiming to be one
   thing and reporting a twelfth of it is a worse input to an alarm than no field.

**Two findings filed onto `0044` rather than fixed here.** Both are about the `FAILED` receipt
status and both are that ticket's criteria already:

- **Nothing writes `FAILED`, and that follows from the fixed order.** Every terminal source-side
  failure happens BEFORE the score gate, so the worker holds no claim and `markFailed` — guarded on
  `PROCESSING` — would no-op. Only a persist failure happens after the claim, and that one is
  transient, so marking it would forfeit the retry. `markFailed` (built in `0040`) therefore has no
  caller anywhere yet.
- **A `FAILED` receipt cannot be cleared by a redrive alone.** The stale-reclaim clause matches
  `PROCESSING` only, deliberately, so a redriven message would lose the claim and return to the
  DLQ. `0044`'s criterion 6 needs an explicit clear step.

**A note on the module name.** `01-architecture.md` §3's module tree writes this file as
`pipeline/processActivity.ts`. It is `process-activity.ts`, matching every other file in the
directory (`fetch-archive-normalize.ts`, `ingest-receipt.ts`). Recorded here as a doc divergence for
the capability audit rather than resolved unilaterally.

## Operator validation

**None required. Everything below was run by the agent** against the deployed `main` stack
(account `286588821906`, `us-east-1`, `AWS_PROFILE=devault`), per D-181. The original text asked
for a Sync press, which is `0043`'s button and does not exist yet — so the agent enqueued the same
messages the Sync action will enqueue, which exercises the identical path.

**Deploy.** Amplify job 118, commit `1e1fbfc`, SUCCEED.

**1. The infrastructure is what the ticket asked for** (`aws sqs get-queue-attributes`,
`aws lambda get-function-configuration`, `list-event-source-mappings`):

- `ActivityIngestQueue`: `VisibilityTimeout 960`, `RedrivePolicy {"maxReceiveCount":3}` pointing at
  `ActivityIngestDLQ`.
- `ActivityIngestDLQ`: `MessageRetentionPeriod 1209600` (14 days).
- Lambda: `MemorySize 2048`, `Timeout 900`, `VpcConfig null`, runtime `nodejs22.x`.
- Event source mapping: `BatchSize 1`, `State Enabled`.
- Environment: `ACTIVITY_TABLE`, `RAW_ARCHIVE_BUCKET`, `ACTIVITY_INGEST_QUEUE_URL` all resolved to
  real generated names.

**2. The deployed IAM role holds exactly fifteen actions and no delete** (`aws iam
get-role-policy`): `dynamodb:GetItem|PutItem|UpdateItem`, `kms:Decrypt|Encrypt|GenerateDataKey*|ReEncrypt*`,
`s3:GetObject|PutObject`, `sqs:ChangeMessageVisibility|DeleteMessage|GetQueueAttributes|GetQueueUrl|ReceiveMessage`,
`ssm:GetParameter`. **`dynamodb:DeleteItem` absent. `s3:Delete*` absent.** (`sqs:DeleteMessage` is
the poller removing a handled message and is required.)

**3. A real activity imported end to end.** Enqueued a job for a genuine activity id from the
operator's connected account, having written its accept-gate receipt first:

```
{"outcome":"persisted","totalMs":635,"coldStart":false,
 "timings":{"credentialsMs":19,"fetchMs":457,"archiveMs":104,"normalizeMs":18,"gateMs":6,"persistMs":37}}
```

- `Activity` row present, `__typename Activity`, `owner <sub>::<sub>`, `status ACTIVE`,
  `distanceM 5021.4`, `cellCount 0`.
- **I-13 confirmed on real data**: `startedAt 2025-08-04T01:57:04Z` with
  `startedAtLocal 2025-08-03T21:57:04` and `timezone America/New_York` — the run files under the
  3rd, which is the whole reason the field exists.
- Raw object present at `raw/<uid>/strava/15336494333/<sha256>.json`, 78,847 bytes,
  `schemahint strava/raw-envelope@1`.
- Receipt `status DONE`, `attempts 1`.

**4. The inline token refresh (§4 step 7) really refreshes and writes back.** The stored
`expiresAt` advanced across the first invocation. That single fact proves the SSM read of the
client credentials, the KMS decrypt AND encrypt on T7's customer-managed key, and the conditional
update — the four things the amended criterion 3 is about.

**5. Redelivery is a no-op (layer 2).** Re-sent the identical message:
`{"outcome":"already-done","xpAwarded":0,"newCellCount":0}`. No second `Activity` write, and
`list-object-versions` on the archive key returns **1** version — the content-addressed
`IfNoneMatch: "*"` PUT wrote nothing the second time.

**6. A failing message reaches the DLQ on the fourth delivery.** A job for a nonexistent activity
id, with a valid receipt row so it got past the delivery counter. First invocation at 03:35:19Z:

```
{"outcome":"failed","error":"StravaApiError: Strava activity detail failed with HTTP 404",
 "coldStart":true,"sinceInitMs":29,"totalMs":387}
```

The receipt's `attempts` incremented to 1 and `status` stayed `QUEUED` with
`processingStartedAt` null — correct, the failure happened before the score gate.

The full timeline, from CloudWatch and the receipt row:

| Delivery | Time (UTC) | `attempts` after | Outcome |
|---|---|---|---|
| 1 | `03:35:19` | 1 | 404, threw |
| 2 | `03:51:19` | 2 | 404, threw |
| 3 | `04:07:19` | 3 | 404, threw |
| 4 | `~04:23:19` | — | **moved to `ActivityIngestDLQ`; not delivered to the function** |

Exact 16-minute spacing, which is the visibility timeout doing what it was derived to do. DLQ
depth went `0 → 1` between the `04:22:43` and `04:23:40` polls. Received from the DLQ to confirm
identity: same `MessageId b4b88446-a2bd-431d-bd4b-993c1752e3f8`, same body,
`ApproximateReceiveCount 4`. **Then deleted** — leaving a smoke-test message in the DLQ would make
`0044`'s alarm, whose whole trigger is `ApproximateNumberOfMessagesVisible > 0`, fire on arrival
for a reason nobody would remember.

**Left behind deliberately.** The real activity's `Activity` row, its raw archive object and its
`DONE` receipt are all still there — a genuine run of the operator's, correctly imported, and the
archive cannot be deleted anyway (I-3). When `0043`'s Sync runs it will compute a different
`ingestKey` for the same activity and re-run the pipeline once: the archive PUT no-ops on the
content hash, and the `Activity` put lands on the same deterministic id (I-5) with identical bytes.
That is the idempotency the design promises, exercised by accident rather than by design, and it is
the reason no cleanup was needed.

**What is NOT proved live, and why.** Criteria 6 and 7 (the 401 and 429 rules) are covered by
`handler.test.ts` and `strava/client.test.ts` rather than in production: reproducing them would
mean deliberately revoking the operator's authorization, or hammering a shared rate limit until the
provider refuses. Both are the wrong kind of live test. The 401 path's storage half — a
`NEEDS_REAUTH` row stopping the retry — is `0033`'s and was verified there.
