---
id: 44
slug: ingest-failure-visibility
title: Failure handling and DLQ visibility — a failed job must be visible somewhere a human looks
type: feature
priority: high
status: closed
size: m
capability: 06-ingest-pipeline
depends_on: [42, 43]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
started: 2026-09-07T20:27:27Z
closed: 2026-09-07T22:03:13Z
---

## Description

`09-roadmap.md` §2.3 admits the milestone ships with "no error surface — a failed import fails into
CloudWatch, and the user finds out because the map did not change." That is acceptable for
*styling* and unacceptable for *silence*. This ticket buys the minimum that stops a failed import
from being invisible: one alarm and one honest line in the Sync result.

Three surfaces, in increasing order of cost:

1. **A CloudWatch alarm on `ApproximateNumberOfMessagesVisible > 0` on the DLQ**, notifying the
   operator's email via SNS. `01-architecture.md` §4 is explicit that this is the only alarm this
   app needs. Nothing else earns an alarm at one user.
2. **Structured failure logging** — every terminal failure logs one JSON line with `userId`,
   `source`, `externalId`, `activityId`, `attempts`, the error class, and whether the raw archive
   succeeded. That last field is the one that tells you whether the run is recoverable by redrive
   or needs a refetch from Strava.
3. **A `FAILED` receipt status**, so the Sync action can report "1 activity failed to import" on
   the next press instead of reporting nothing. This is the human-visible half and it costs a
   conditional update plus a query.

Explicitly out of scope: a retry UI, an error detail page, notifications. The operator's recovery
path at this milestone is "redrive the DLQ message from the SQS console", and that is fine
because the operator is the user.

## Acceptance criteria

- [x] SNS topic + email subscription + CloudWatch alarm on DLQ `ApproximateNumberOfMessagesVisible > 0`.
      A test message to the queue produces an email. — verified 2026-09-07: two test messages, both
      `OK → ALARM` in ~3.5 min, SNS action succeeded against the confirmed subscription.
- [x] Terminal failures write `status = "FAILED"` on the receipt with the attempt count and an
      error class string (not a raw stack trace).
- [x] Every terminal failure emits one structured JSON log line with the fields listed above.
- [x] The Sync action reports outstanding `FAILED` receipts for the user in its result line.
      — query proven live against the deployed index; sentence and wiring proven by tests. Not
      pressed on a phone against a real failure; see `0178`.
- [x] A revoked Strava authorization surfaces as a distinct "reconnect Strava" state, not as a
      generic failure and not as a retry storm.
- [x] Redriving a DLQ message re-imports the activity exactly once and clears the `FAILED` state.
      — the clearing half proven live against the deployed table; the exactly-once half rests on
      the four idempotency layers `0040`/`0041` already test. No real redrive yet; see `0178`.
- [x] A runbook section in `docs/capabilities/06-ingest-pipeline.md` states, in order, how to
      diagnose and redrive a failed import.

## Notes

The "did the archive succeed?" field is load-bearing. If raw landed, the failure is replayable
forever from S3 (D-101). If it did not, the only copy is still on Strava's servers, and that is a
different urgency.

Do not add alarms on Lambda errors or duration. At 3–5 runs a week that is noise, and an alarm
nobody reads is worse than no alarm (`09-roadmap.md` §8.6, the Habitica risk turned inward).

**2026-09-07, from `0042`.** Two findings from building the worker, both landing on criteria 2 and 6.

1. **Nothing writes `FAILED` today, and it is not an oversight in `0042` — it is the fixed order.**
   Every terminal source-side failure (a revoked authorization, a 4xx) happens BEFORE the score
   gate, so the worker holds no claim when it fails, and `markFailed` is guarded on `PROCESSING`
   and would no-op. Only a persist failure happens after the claim, and that one is genuinely
   transient — marking it would forfeit the retry. So `markFailed` (built in `0040`) currently has
   no caller anywhere. Whatever writes `FAILED` has to be this ticket's, and it has to decide
   deliberately WHICH failures are terminal rather than marking all of them.

2. **A `FAILED` receipt cannot be cleared by a redrive alone**, which criterion 6 asks for. The
   stale-reclaim clause in `claimForScoring` matches `PROCESSING` only — deliberately, per `0040`
   — so a redriven message finds `FAILED`, loses the claim, and returns to the DLQ. Criterion 6
   needs an explicit clear-on-redrive step, not just the redrive.

**2026-09-07, built but NOT closed.** All seven criteria are implemented and deployed
(`91b80cd`, `6c7c3fd`; Amplify job 124 SUCCEED). Three are ticked on evidence recorded below.
**Four are not, and none of them is a code gap** — each needs the operator's inbox, phone or
Strava account, which is the D-181 line.

*Decisions taken this session, both with the operator:* **D-209** (a `FAILED` receipt is
reclaimable at the score gate, superseding `0040`'s exclusion — the exclusion made a DLQ redrive a
silent no-op, and `maxReceiveCount` was always what bounded retries) and **D-210** (terminal =
dead credentials on the first delivery, anything else on the last delivery the queue allows, never
a claim another invocation holds).

*What was built.* `markFailed` → `recordFailure`, guarded `<> DONE` rather than `= PROCESSING`,
writing four fields together — one of them a sparse `failedUserId` backing a new `failedByUser`
GSI, so "what is broken for this user?" is a Query over a normally-empty index. `claimForScoring`
gains `FAILED` to its condition and `REMOVE`s the four fields on claim. `ProcessDeps.onPhase` is a
new observer (not an error wrapper — the handler matches two error types with `instanceof` and a
wrapper would break both) so the handler can report `rawArchived`. `MAX_RECEIVE_COUNT` is restated
in the handler and `process-activity-stack.test.ts` asserts it equals the queue's redrive policy.

*What went wrong.* The first push failed the Amplify build on `check-boundaries.mjs`: a test I
added named the vendor in a display-name stub (D-100). It reached CI because I ran the check
locally but read only the last three lines of its output — the D-121.1 footer prints on both the
pass and the fail path. The backend had already deployed by then; only the frontend gate failed.

*Smoke tests run (agent, `AWS_PROFILE=devault`, account 286588821906, us-east-1).*

- The real `recordFailure` / `listFailedReceipts` / `claimForScoring` against the **deployed**
  `LostSolesIngestReceipt`: 15/15 assertions pass. A `QUEUED` receipt is marked `FAILED` with
  `errorClass`, `rawArchived` and `failedUserId`; the `failedByUser` GSI returns it with
  `errorClass` projected; `claimForScoring` then reclaims it, leaves it `PROCESSING`, and all four
  failure fields are gone from both the row and the index. Synthetic row cleaned up.
- The alarm, end to end. One test message to `ActivityIngestDLQ` at 20:52:20Z → alarm
  `OK → ALARM` at 20:56:02Z (~3.5 min, inside the ticket's "~5 minutes"), reason *"1 out of the
  last 1 datapoints [1.0] was greater than the threshold (0.0)"*. Alarm history records
  *"Successfully executed action arn:aws:sns:…IngestAlarms…"*. Message deleted; alarm back to `OK`
  at 20:59:38Z. **The email itself was not delivered, because the subscription is still
  `PendingConfirmation`** — see the operator list.
- 1079 unit tests, `tsc --noEmit`, `eslint --max-warnings 0`, and all five CI check scripts pass.

*Why criterion 3 is ticked without a production failure.* `handler.test.ts` asserts the JSON the
real handler writes to `console.error` — every field the runbook reads, that a class name is
logged and never an error message (a `Bearer …` in a message is asserted absent), and that a
non-terminal attempt is tagged differently so a Logs Insights filter on `ingest-failed` returns
only failures that stuck. No terminal failure has occurred in production yet; the first real one
is what the operator's step 1 below manufactures.

## Operator validation

> **D-181 — most of what follows is the AGENT's to run, not the operator's.**
> Swept 2026-09-02 (ticket `0147`). This ticket's capability has no screen of its own. Before asking
> the operator for any step below, check whether AWS credentials (`AWS_PROFILE=devault`), `curl`, or
> a script can answer it — if so it is a **smoke test**, and what it proved is recorded here at
> close *instead of* the instruction. Keep only what genuinely needs a human eye, a phone, or a real
> run. The text below is the original author's intent, kept as context for **what** to verify — not
> as a list of chores for the operator.

**Agent smoke tests are recorded in `## Notes` above.** What is left is what only the operator can
do, in this order — 0 needs doing first or nothing else works.

0. **Confirm the SNS subscription.** AWS has emailed `amazingbrandon@gmail.com` a
   *"AWS Notification - Subscription Confirmation"* for the topic ending `IngestAlarms…rxVBsadb5GCX`.
   Click the link. Until then the alarm fires correctly and **delivers nothing** — verified: it
   reached `ALARM` and executed the SNS action while the endpoint sat `PendingConfirmation`.
   → criterion 1's *"a test message to the queue produces an email"*.

1. **Read one.** Once confirmed, say so and the agent will re-send a test message to the DLQ.
   Read the email **on the phone** and judge the subject alone:
   `ALARM: "Lost Soles — an activity failed to import" in US East (N. Virginia)`. Does it tell you
   which app, without opening it? → criterion 1.

2. **Break the pipeline deliberately** (a bad Strava base URL) and press Sync on the phone. Let it
   fail its three deliveries into the DLQ. → sets up 3 and 4.

3. **Press Sync again.** The result line must read that an activity failed, not "nothing new".
   → criterion 4, and criterion 5 if the break was a revoked authorization rather than a bad URL —
   in which case it must read *"Reconnect … in Settings."*, not a generic failure.

4. **Fix the URL, redrive from the SQS console, press Sync.** The failure sentence disappears and
   the map gains the run's territory. The runbook in
   `docs/capabilities/06-ingest-pipeline.md` is the procedure; following it here is also how the
   runbook gets checked. → criterion 6.

## Resolution

**Shipped with three criteria proven at the unit level rather than end to end, at the operator's
explicit decision.** That is the most important sentence in this Resolution and it is first so
nobody later reads the ticked boxes as more than they are. What each box actually rests on is
annotated on the criterion itself.

### What was built

- **The alarm.** SNS topic, email subscription to the operator, and one CloudWatch alarm on the
  DLQ's `ApproximateNumberOfMessagesVisible > 0`, in `amplify/backend.ts`'s ingest stack. Named
  `Lost Soles — an activity failed to import`, because SNS renders an alarm as
  `ALARM: "<name>" in <region>` — the name *is* the subject line, which is the whole product
  surface here. `treatMissingData: NOT_BREACHING` is load-bearing rather than tidy: SQS publishes
  queue metrics only while a queue is polled, so a DLQ empty for a week emits nothing, and any
  other treatment either pins the alarm in `INSUFFICIENT_DATA` or emails about a healthy queue.
  Both end with the sender filtered, which is the failure `09-roadmap.md` §8.6 names.
- **`recordFailure`, replacing `markFailed`.** `0042`'s note was right that `markFailed` could
  never have had a caller: it was guarded `= PROCESSING`, and almost every terminal failure
  happens *before* the score gate with the receipt still `QUEUED`. The guard is inverted to
  `<> DONE` — `DONE` is excluded because it is the one status written inside the ingest
  transaction alongside the XP award, and overwriting it would make the ledger's commit record
  lie. It writes four fields together and returns the row as written, so the log line gets
  `attempts` without a second read.
- **A sparse `failedByUser` GSI.** `failedUserId` duplicates `userId` deliberately: an index keyed
  on `userId` would hold every receipt ever written. This one holds one entry per *outstanding*
  failure and is normally empty, so the cost of asking "is anything broken?" is a function of how
  much is currently broken rather than of how long the app has been used.
- **`ProcessDeps.onPhase`.** An observer, not an error wrapper. The obvious alternative — throwing
  an `IngestPhaseError` carrying the phase — breaks the handler's two `instanceof` matches on
  `SourceRateLimitedError` and `SourceNeedsReauthError`, which is how §4's failure rules are
  applied. Rewriting those to unwrap a cause would make two queue rules depend on this module
  never forgetting to wrap. The observer changes no error contract at all.
- **The structured line, the Sync sentence, and the runbook**, per criteria 3, 4 and 7.

### Decisions

**D-209 — a `FAILED` receipt is reclaimable at the score gate.** This reverses a `0040` decision
that was made deliberately and with a stated reason, so it is superseded visibly rather than
edited away. The reason `0040` gave — "a recorded failure is a decision and should be visible
rather than quietly retried forever" — was half right. The visibility half stands and is now
`recordFailure`. The *lock* half made a DLQ redrive a silent no-op: the redriven message resolved
credentials, fetched, archived, normalized, then lost the claim to the very `FAILED` status it had
been sent back to repair, and returned to the DLQ looking identical to the original failure. The
operator's only control would have reported success and changed nothing. Nothing is retried
forever because this table never bounded retries — `maxReceiveCount: 3` does, and it is untouched.
What the exclusion actually bounded was the ability to intervene.

**D-210 — which failures are terminal.** Dead credentials on the first delivery, because no retry
repairs them and waiting three deliveries costs ~48 minutes of visibility timeouts during which
the screen says nothing is wrong. Anything else only on the last delivery the queue allows,
because marking earlier would report a failure the queue is about to retry successfully. Never
`ReceiptNotClaimableError`: that means another invocation holds a live claim, and `recordFailure`
is guarded `<> DONE`, so marking there would stamp `FAILED` over a working import.

The delivery count comes from SQS's `ApproximateReceiveCount`, not the receipt's `attempts`.
`attempts` only ever increases, so a redriven message arrives at 3 and would be judged terminal
before trying anything — defeating D-209. `ApproximateReceiveCount` resets on a redrive, so it
answers the question actually being asked: how many chances are left for *this* recovery attempt.

### What went wrong

**The first push failed CI on my own boundary rule.** A test I added hard-coded the vendor name in
a display-name stub, which is exactly what `check-boundaries.mjs` scans `lib/` for (D-100). It
reached CI because I ran the check locally and read only the last three lines of its output — the
D-121.1 footer prints identically on the pass and the fail path. The backend stack had already
deployed by then, so only the frontend gate failed. Fixed in `6c7c3fd`; every subsequent run
checked the exit code instead of the footer.

**A criterion was ticked on weaker evidence than it looked.** Criterion 4's real gap was never the
query or the sentence — both were well covered — but the six lines of wiring in `syncNow` joining
them, which no test reached. `app/sync-action.test.ts` was added at close specifically for that:
the failure read happens *after* the sweep, it asks only about the signed-in user, and a broken
read cannot fail the press. That last one matters most — the activities are queued either way, and
losing a real import's confirmation to a broken report about a hypothetical failure would be the
wrong trade on the one surface that says whether the data arrived.

### The residual risk, stated plainly

Criteria 4, 5 and 6 describe things the **operator sees**, and none has been seen. Manufacturing a
failed import costs either two deploys of deliberately-broken code or revoking and re-authorizing
the Strava connection; the operator judged that excessive against a path covered by tests that has
never fired in anger, and shipped. `0178` is filed to walk the runbook on the **next real
failure**, when the cost is zero because the failure already happened. It explicitly forbids
staging one to close it.

The specific thing unproven is not the mechanism — the receipt write, the index and the alarm are
all verified against deployed infrastructure — but the **sentences a human reads**: whether the
alarm's subject identifies the app on a phone, and whether the Sync line says the right thing at
the moment it matters.

## Operator validation

**Step 0 (operator, 2026-09-07):** SNS email subscription to `amazingbrandon@gmail.com` confirmed.
Verified by the agent: the subscription now carries a real ARN
(`…IngestAlarms…:9bd597b3-53db-4fc5-91f2-413531e5c9f0`) instead of `PendingConfirmation`.

**Steps 1–4 were declined by the operator** — see *The residual risk* above and ticket `0178`.
Recording that as the honest outcome rather than leaving four boxes looking unexamined.

### Smoke tests (agent, `AWS_PROFILE=devault`, account `286588821906`, `us-east-1`)

**The alarm, twice, end to end.**

| | first (pre-confirmation) | second (post-confirmation) |
|---|---|---|
| test message to `ActivityIngestDLQ` | 20:52:20Z | 21:52:42Z |
| `OK → ALARM` | 20:56:02Z (~3.5 min) | 21:55:53Z (~3.2 min) |
| SNS action | *Successfully executed* | *Successfully executed* |
| delivered? | **no** — endpoint `PendingConfirmation` | yes — confirmed endpoint |
| message deleted, `ALARM → OK` | 20:59:38Z | — |

State reason on both: *"1 out of the last 1 datapoints [1.0] was greater than the threshold
(0.0)"*. The first run is worth keeping in the record because it demonstrates the failure mode
this alarm can have and nothing else would report: **it fires correctly and delivers nothing**
while the subscription is unconfirmed. Both synthetic messages were deleted; the DLQ is empty and
the alarm is `OK`.

**The receipt and the sparse index, against the deployed table.** The real `recordFailure`,
`listFailedReceipts` and `claimForScoring` run against `LostSolesIngestReceipt` via `tsx` —
15/15 assertions. A seeded `QUEUED` receipt is marked `FAILED` carrying `errorClass`,
`rawArchived` and `failedUserId`, with `attempts` preserved; the `failedByUser` GSI returns it
with `errorClass` projected; `claimForScoring` then reclaims it (D-209), leaves it `PROCESSING`,
and all four failure fields are gone from both the row and the index. Synthetic row deleted.

This is the test that proves criterion 6's clearing half and D-209 as a whole, against real
DynamoDB rather than a stub — an invalid `REMOVE` or condition would have been rejected by the
service.

**Deploy.** Amplify job 124, commit `6c7c3fd`, SUCCEED. `failedByUser` index `ACTIVE`.

**CI.** 1085 unit tests, `tsc --noEmit`, `eslint --max-warnings 0`, and all five check scripts —
`check-boundaries`, `check-design-tokens`, `check-fixture-geography`, `check-adapter-deletion`,
`check-skills` — pass, exit codes verified.
