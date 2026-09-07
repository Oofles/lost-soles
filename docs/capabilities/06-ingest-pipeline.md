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

Six tickets built the path from "Strava has a run" to "a row exists", plus a seventh that made a
failure on that path visible and an eighth that fixed a key nobody was using yet. What is worth
carrying forward is mostly about **the difference between a thing being built and a thing being
in force.**

**Three times this capability, a document asserted an enforcement that did not exist.** I-22's
evidence column said GSI2 "is queried at pipeline step 3 before any write" and that a CI fixture
asserted one activity and one award; neither was true, and neither had ever been true — the
lookup is not written (`0179`). `markFailed` shipped in `0040` guarded on `PROCESSING` and could
never have had a caller, because every terminal failure happens before the score gate (`0044`).
`09-roadmap.md` §2.3 still described a milestone with "no error surface" hours after one was
built. None of these were caught by a test, because **a test can only fail on code that runs**,
and the common shape of all three is code or prose describing a path nothing takes yet. The audit
is the only mechanism that looks at those, which is the strongest argument for D-153 this project
has produced so far.

**The bugs that mattered were at boundaries, and both were found by sweeping rather than
sampling.** `0169` existed because `03-integrations.md` §2.7 hashed *buckets* and called them
tolerances, so two recordings of one run 20 m apart landed either side of a 50 m edge and became
two activities. Fixing it, the first version of the replacement probe reintroduced the identical
class of bug — an edge test written `>` where it had to be `>=`, missing a duplicate stored
exactly the tolerance away. A test that checked a handful of hand-picked points would have passed;
the one that swept a whole window at 15-second steps caught it in seconds. **Where a rule has an
edge, sample the edge exhaustively or do not claim to have tested it.**

**Two deliberate decisions were reversed, and both had been made carefully.** `0040` excluded
`FAILED` from the score gate on the reasoning that a recorded failure is a decision rather than a
crash — correct about visibility, wrong about locking, because it made a DLQ redrive a silent
no-op and the redrive is the operator's only recovery path (D-209). §2.7's composite key was
chosen to be coarse enough for two devices to agree — but buckets are not tolerances, and no
bucket size fixes that (D-211). In both cases the original reasoning was sound and the *shape*
was wrong, which is why both were superseded visibly with the old argument quoted rather than
edited away. A decision register that only ever grows agreement is not recording anything.

**D-181 landed mid-capability and the seam shows.** `0039`, `0040` and `0041` carry Operator
validation sections that are instruction lists with no recorded result; the verification they
describe was genuinely done and is written up in their `## Resolution` instead. `0042` onward
records results in the right place. Nothing is missing, but three tickets read as though nobody
checked, which is exactly the impression D-181 exists to prevent — worth knowing when reading
this capability's closed tickets later.

**What was deferred honestly rather than quietly.** `0044` shipped with three criteria proven only
at the unit level: the alarm is verified live, but nothing has confirmed that its email subject
reads well on a phone or that the Sync line says the right thing at the moment it matters,
because manufacturing a failed import costs two deploys or a Strava re-authorization. `0178` is
deferred against the next real failure, with a re-check that exits non-zero while it waits. The
first version of that re-check exited 0 on both paths and the tool reported a WAITING verdict as
`PASSES` — a deferred ticket whose re-check lies is worse than no re-check, because the whole
point of the status is that someone reads the verdict before resuming.

**The one thing to do differently next time:** run the full check suite after editing a *document*,
not only after editing code. The contract in `docs/contracts/ingestion-contract.md` is asserted
byte-identical to `src/domain/activity.ts`, so a comment added to the doc broke the build — caught
by the audit's own mechanical half rather than before the commit.

