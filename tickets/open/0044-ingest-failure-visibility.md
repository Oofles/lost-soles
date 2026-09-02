---
id: 44
slug: ingest-failure-visibility
title: Failure handling and DLQ visibility — a failed job must be visible somewhere a human looks
type: feature
priority: high
status: open
size: m
capability: 06-ingest-pipeline
depends_on: [42, 43]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
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

- [ ] SNS topic + email subscription + CloudWatch alarm on DLQ `ApproximateNumberOfMessagesVisible > 0`.
      A test message to the queue produces an email.
- [ ] Terminal failures write `status = "FAILED"` on the receipt with the attempt count and an
      error class string (not a raw stack trace).
- [ ] Every terminal failure emits one structured JSON log line with the fields listed above.
- [ ] The Sync action reports outstanding `FAILED` receipts for the user in its result line.
- [ ] A revoked Strava authorization surfaces as a distinct "reconnect Strava" state, not as a
      generic failure and not as a retry storm.
- [ ] Redriving a DLQ message re-imports the activity exactly once and clears the `FAILED` state.
- [ ] A runbook section in `docs/capabilities/06-ingest-pipeline.md` states, in order, how to
      diagnose and redrive a failed import.

## Notes

The "did the archive succeed?" field is load-bearing. If raw landed, the failure is replayable
forever from S3 (D-101). If it did not, the only copy is still on Strava's servers, and that is a
different urgency.

Do not add alarms on Lambda errors or duration. At 3–5 runs a week that is noise, and an alarm
nobody reads is worse than no alarm (`09-roadmap.md` §8.6, the Habitica risk turned inward).

## Operator validation

> **D-181 — most of what follows is the AGENT's to run, not the operator's.**
> Swept 2026-09-02 (ticket `0147`). This ticket's capability has no screen of its own. Before asking
> the operator for any step below, check whether AWS credentials (`AWS_PROFILE=devault`), `curl`, or
> a script can answer it — if so it is a **smoke test**, and what it proved is recorded here at
> close *instead of* the instruction. Keep only what genuinely needs a human eye, a phone, or a real
> run. The text below is the original author's intent, kept as context for **what** to verify — not
> as a list of chores for the operator.

1. Break the pipeline deliberately (bad Strava base URL) and press Sync on the phone.
2. Within ~5 minutes an email arrives from the DLQ alarm. Read it on the phone — the subject alone
   must tell you which app it is about.
3. Press Sync again in the app. The result line reads that an activity failed, not "nothing new".
4. Fix the URL, redrive from the SQS console, press Sync. The failed state clears and the map
   gains the run's territory.
