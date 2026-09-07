# 06-ingest-pipeline

> **Stub, generated during backlog validation.** The authoritative design is the
> `#### \`06-ingest-pipeline\`` section of [`../09-roadmap.md`](../09-roadmap.md). This file is where the
> DESIGN step's output belongs, and where [`AUDIT.md`](AUDIT.md) results are appended at close.

## Tickets (6)

- `0039` — pipeline/archive.ts — write the raw source payload to S3 before normalize runs
- `0040` — IngestReceipt idempotency ledger with deterministic activityId
- `0041` — pipeline/persist.ts — write the Activity row inside the ingest transaction
- `0042` — process-activity Lambda, SQS queue and DLQ via the CDK escape hatch
- `0043` — Manual Sync action — listSince, then enqueue
- `0044` — Failure handling and DLQ visibility — a failed job must be visible somewhere a human looks

## Runbook — a failed import

**When this fires you have received one email**, subject `ALARM: "Lost Soles — an activity failed
to import"`. It means a message reached the ingest dead letter queue: an activity failed three
delivery attempts and is **not on the map**. The map does not re-fog (D-020), so this does not
resolve itself and pressing Sync will not fix it — Sync will report the failure, not repair it.

Every command below uses `AWS_PROFILE=devault`, account `286588821906`, `us-east-1`.

### 1. Find out what broke

The worker writes exactly one line per terminal failure, tagged `"event":"ingest-failed"`. Read the
most recent ones:

```
aws logs filter-log-events \
  --log-group-name /aws/lambda/<process-activity function name> \
  --filter-pattern '"ingest-failed"' \
  --start-time $(( ($(date +%s) - 86400) * 1000 )) \
  --query 'events[].message' --output text
```

The fields that matter, in the order you will use them:

| Field | What it tells you |
|---|---|
| `errorClass` | What actually failed. Never a message or a stack — a class name only (O-005). |
| `rawArchived` | **Read this second.** See step 2. |
| `ingestKey` | The receipt's primary key, and the id you match against a DLQ message body. |
| `externalId` | The activity on the source. |
| `attempts` / `receiveCount` | Deliveries counted by the receipt, and by SQS for this recovery. |
| `phase` | How far it got: `credentials`, `fetch`, `archive`, `normalize`, `gate`, `persist`. |

### 2. Decide the urgency from `rawArchived`

- **`rawArchived: true`** — the raw bytes are in S3 under `raw/`. The failure is replayable
  forever from the archive (D-101) and nothing is at risk. Fix at leisure.
- **`rawArchived: false`** — nothing was written. **The only copy of this run is still on the
  source's servers**, and if it is deleted there the run is gone permanently from a map that
  cannot re-fog. Treat this as the urgent case.

### 3. Fix the cause

`errorClass` names it:

- `SourceNeedsReauthError` / `SourceNotConnectedError` — the connection is dead and no redrive will
  help until it is repaired. **Reconnect on `/settings` first.** The Sync screen is already saying
  *"Reconnect … in Settings"* for the same reason.
- `SourceRateLimitedError` — should not reach the DLQ; a 429 is delayed and retried. If it did, the
  source refused three times across the retry window. Wait for the window and redrive.
- Anything else — a bug or an outage. Read the line's `phase` for where.

### 4. Redrive

From the SQS console: open **ActivityIngestDLQ** → **Start DLQ redrive** → redrive to the source
queue. The messages return to `ActivityIngestQueue` with their receive count reset.

**A redrive alone is enough.** The score gate reclaims a `FAILED` receipt and clears its failure
fields in the same conditional update (D-209) — there is no separate clear step, and there was no
way to add one, because a console redrive offers no hook to run it from.

### 5. Confirm

Press **Sync** in the app. The failure sentence disappears from the result line once the receipt
is no longer `FAILED`, and the run's territory appears on the map.

To check without the phone:

```
aws dynamodb get-item --table-name LostSolesIngestReceipt \
  --key '{"ingestKey":{"S":"<ingestKey>"}}' \
  --query 'Item.{status:status.S,errorClass:errorClass.S,attempts:attempts.N}'
```

`status: DONE` and no `errorClass` is the finished state. `status: FAILED` with a **newer**
`failedAt` means the redrive ran and failed again — go back to step 1.

### What NOT to do

- **Do not add a second alarm.** `01-architecture.md` §4 says the DLQ alarm is the only one this
  app needs, and `09-roadmap.md` §8.6 is why: at 3–5 runs a week an alarm on Lambda errors or
  duration fires on cold starts until the sender is filtered, taking the DLQ alarm with it.
- **Do not delete a DLQ message to make the alarm stop.** The alarm is the only record that the
  activity is missing, and deleting the message is the one action that cannot be undone.


## Design notes

_Filled in at the DESIGN step, before TICKET-WRITE._

## Audit

_Appended by `/tickets audit` at close. See [`AUDIT.md`](AUDIT.md)._

## Reflection

_Filled in at the REFLECT step, after USE._

