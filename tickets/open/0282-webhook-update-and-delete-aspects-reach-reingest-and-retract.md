---
id: 282
slug: webhook-update-and-delete-aspects-reach-reingest-and-retract
title: Webhook update and delete aspects reach reingest and retract
type: feature
priority: med
status: open
size: m
capability: 14-webhook-and-automatic-sync
depends_on: []
blocked_by: []
source: agent
created: 2026-10-16T14:52:18Z
started: 2026-10-18T12:44:03Z
---

## Description

`0091`'s webhook classifies `aspect_type` and acts only on `create`. An `update` (a title, kind or
privacy edit, or a cropped trace) and a `delete` are answered 200 and dropped. No open ticket owns
them, so a source-side edit or deletion reaches nothing until the reconciliation sweep (`0095`)
or a manual `reingest`.

The contract already has the commands: `IngestCommand`'s `reingest` and `retract` (D-187). This
ticket turns those two aspects into them, through the same `accept()` and receipt path, and
decides what `retract` does downstream. By D-020 and D-135, a deletion can tombstone an
activity, but it can never un-reveal its cells or lower XP.

## Acceptance criteria

- [x] An `update` event becomes a `reingest` command keyed so a redelivery is one receipt, and the
      worker re-fetches and re-archives the activity. D-278 governs XP: the first version's XP and
      award stand.
- [x] A `delete` event becomes a `retract` command. The activity is tombstoned (`02` §4.7). Its cells
      stay revealed (D-020) and no XP is removed (D-135).
- [x] Both stay inside the webhook's two grants (`0091` criterion 7). Any lookup happens in
      `process-activity`.
- [x] Tests cover each aspect end to end through the webhook handler and the worker.

## Notes

Filed by `0091` (wave 1 of capability `14`, 2026-10-16). Builds on `0091`'s `accept.ts` classifier
and `0093`'s validation. Check `0093` first: if its deauthorization work already shapes the
command routing, sequence this after it.

## Operator validation

None expected. Smoke test: post a synthetic `update` and `delete` for a real activity id to the
Function URL and read the receipt, the T3 row and the logs.

## Resolution

*(Agent, wave of 2026-10-18. The first pass stopped on five design questions (D-152). The operator
accepted all five recommendations. The answers are recorded as D-NEW-a and D-NEW-b in the wave
report, for the orchestrator to number. The docs below still say "D-NEW-a/b" and need the real
numbers substituted.)*

**What an `update` does (D-NEW-b, operator Q2 = A).** `accept()` turns an activity `update` into
`{kind:"reingest", job}`. The job inside is an ordinary `command:"ingest"` job, not `"reingest"`.
In this codebase `IngestJob.command:"reingest"` is `0192`'s operator replay from the archive: it
would never see the edit, and it re-claims a `DONE` receipt, which no stranger should be able to
trigger. The job uses its own key, `sha256(strava:<owner>:<object>:update:<event_time>)`. Strava's
redelivery of one edit is one receipt, two edits are two, and the key never collides with the
create/sweep key. An update without a positive integer `event_time` is dropped as
`missing-event-time`. The webhook needed no new branch: `reingest` already took the counter, the
receipt and the send. The worker runs the normal fetch path: re-fetch, re-archive (the archive is
content-addressed, so the original bytes stay), then persist. `persistWithLedger` already keeps the
first version's XP (`alreadyScored`) and discovery award (`readStoredAward`), so D-278 holds as
built. `meta.aspectType` widened to `"create" | "update"` (provenance only; nothing reads it). The
D-343 `IngestJob` key set is unchanged and pinned by a test. `meta.revision` is not bumped, so the
edited activity is still revision 1. Nothing reads revisions today, and neither the ticket nor the
answers asked for it.

**What a `delete` does (D-NEW-a, operator Q1 = A, Q3, Q4).**
- *Contract.* `IngestCommand.retract` gains `userId` and `ingestKey` (in `types.ts` and
  `ingestion-contract.md` §3). The endpoint meters a retract per user and gates it through the
  receipt, and only the adapter knows the user and the key formula. Q3 approved `userId`;
  `ingestKey` follows from "the same `accept()` and receipt path", because the source-agnostic
  handler cannot mint a Strava key. The delete key is `sha256(strava:<owner>:<object>:delete)`,
  with no `event_time`.
- *Webhook (POST path only).* `forwardRetract` runs the general budget (D-349), then a new
  `delete` bucket (`DELETES_PER_HOUR = 4`, `rate#<src>#<uid>#delete#<hour>`, still under `rate#`,
  so the `LeadingKeys` condition holds). Then `acceptIngest` on the delete key, then one
  `RetractMessage` `{command:"retract", source, userId, externalId, ingestKey, enqueuedAt}`
  (`src/pipeline/retract-message.ts`, beside D-348's `DisconnectMessage`). The log carries the
  `ingestKey` for a retract too. No new webhook grant.
- *Worker.* `handleRecord` checks `isRetractMessage` right after `isDisconnectMessage`, before the
  body is read as a job. `src/pipeline/retract.ts` runs in this order:
  1. `recordDelivery`. A message that never passed the gate throws here, before any provider call.
  2. `confirmRetracted`.
  3. `tombstoneActivity`, only on `gone`.
  4. `closeRetractReceipt`, which sets `DONE` with zero XP and zero cells on every outcome.

  A 429 is delayed like a job's (rule 3), and any other throw redelivers.
- *Confirmation.* There is a new **mandatory** `SourceAdapter.confirmRetracted(externalId, creds)
  → "gone" | "present"`. It is mandatory, not optional, so the pinned test "`refreshCredentials`
  is the ONLY optional member" keeps holding. The Strava version does one `GET /activities/{id}`:
  200 → `present`; a 404 carrying the rate-limit headers → `gone`; a 404 without them, a 5xx or a
  429 → throw. Manual answers `present`, so a retract naming a manual workout is refused. The
  fixture adapter throws.
- *Tombstone.* `tombstoneActivity` is one `UpdateItem` that sets `status = TOMBSTONED` and
  `updatedAt`. It is conditional on the row existing, belonging to the message's user, and not
  already being tombstoned. On a failed condition, one consistent read reports `already-tombstoned`
  or `no-activity`. Nothing else is written: no ledger, cells, `lastRunAt`, blob, route or trace
  web (02 §4.7, D-020, D-135). A test compares the whole fake store to prove it.
- *Sticky tombstone (Q4).* `readStoredActivity` is the same consistent `GetItem` with `#status`
  added to the projection (`readStoredAward` now delegates to it). `persistWithLedger` passes the
  stored status to `persistActivity`. A `TOMBSTONED` row is written back as `TOMBSTONED`. An
  `ACTIVE` write is conditional (`attribute_not_exists(id) OR #status <> :tombstoned`), so a
  deletion confirmed between the read and the commit cancels the transaction instead of being
  overwritten. It is thrown like any other item-0 failure, and the redelivery re-reads the
  tombstone. I tried an in-loop retry first, but it broke `0062`'s "item 0 fails at once"
  criterion, so the retry is left to SQS.
- *IAM.* The worker gains `dynamodb:UpdateItem` on T3, which the old `backend.ts` comment predicted
  ("it will need its own grant"). It still has no `DeleteItem`. The pinned
  `xp-ledger-tables.test.ts` T3 set is updated with the reason.

**Docs corrected (Q4, Q2).**
- `03` §1.3 said a retract removes the activity from XP totals and recomputes each cell's
  `lastRunAt` from the surviving activities. The first contradicts D-135 and the second D-020.
  It now follows `02` §4.7.
- `03` §2.3's update bullets, including the title-only shortcut, are replaced by "every update
  re-fetches". The deletion paragraph now describes the confirmation.
- `08` §4.1 gets an as-built note that a delete is confirmed like a deauthorization.
- Contract §3 now covers `confirmRetracted`, the retract fields, and the difference between a
  `reingest` command and a `reingest` job.

**Not done, by instruction (Q5).** No reader filters `TOMBSTONED`, so a tombstoned run still shows
in the runs list and the Chronicle until a follow-up ticket lands.

**A known limit, reported rather than solved.** The delete key has no `event_time`. A forged
delete for a live activity therefore closes that key's receipt `DONE` (`forged-or-stale`), and a
genuine deletion of the same activity within the receipt's 90-day TTL is then a `duplicate` at the
gate and is dropped. The harm is that the run stays visible, with no data lost. The same applies if
Strava ever sends a delete before its own API answers 404 for that activity.

**Files.**
- Contract: `src/adapters/types.ts`, `docs/contracts/ingestion-contract.md`.
- Strava adapter: `src/adapters/strava/accept.ts`, `src/adapters/strava/adapter.ts`.
- Other adapters: `src/adapters/manual/adapter.ts`, `src/adapters/__fixtures__/gpx-adapter.ts`.
- Pipeline:
  - New: `src/pipeline/retract-message.ts`, `src/pipeline/retract.ts`.
  - Changed: `src/pipeline/persist.ts`, `src/pipeline/xp-ledger.ts`, `src/pipeline/ingest-receipt.ts`.
- Webhook: `amplify/functions/ingest-webhook/handler.ts`, `amplify/functions/ingest-webhook/owner-rate.ts`.
- Worker: `amplify/functions/process-activity/handler.ts`.
- IAM: `amplify/backend.ts`.
- Docs: `docs/03-integrations.md`, `docs/08-security-privacy.md`.
- Tests:
  - Adapters: `src/adapters/strava/accept.test.ts`, `src/adapters/strava/adapter.test.ts`,
    `src/adapters/adapter-interface.types.test.ts`, `src/adapters/normalize-purity.test.ts`.
  - Pipeline: `src/pipeline/retract.test.ts` (new), `src/pipeline/process-activity.test.ts`,
    `src/pipeline/xp-ledger.test.ts`.
  - Lambdas: `amplify/functions/ingest-webhook/handler.test.ts`,
    `amplify/functions/ingest-webhook/aspects-e2e.test.ts` (new, webhook → shared receipt store →
    worker), `amplify/functions/process-activity/handler.test.ts`.
  - IAM: `amplify/xp-ledger-tables.test.ts`.

