---
id: 288
slug: a-forged-delete-can-pre-empt-a-genuine-one-for-90-days
title: A forged delete can pre-empt a genuine one for 90 days
type: bug
priority: low
status: open
size: s
capability: 14-webhook-and-automatic-sync
depends_on: []
blocked_by: []
source: agent
created: 2026-10-18T13:09:34Z
started: 2026-10-18T23:16:23Z
---

## Description

D-355 keys a webhook delete as `sha256(strava:<owner>:<object>:delete)`, with no `event_time`.
A **forged** delete of a live activity is confirmed with Strava, logged `forged-or-stale`, and
writes nothing to T3. But it still closes that delete receipt `DONE`. A **genuine** delete of the
same activity within the receipt's 90-day TTL (T8) is then dropped as a duplicate at the gate.

The same happens if Strava ever sends a delete before its own API answers 404 for the activity.

The only effect is that the run stays visible: no XP or cell is touched either way. The
reconciliation sweep (`0095`) lists activities that exist, so it never notices a deletion.

## Steps to reproduce

1. POST a `delete` for a live activity of ours to the webhook (a forgery: Strava never sent it).
2. The worker confirms with Strava (200), logs `forged-or-stale`, and closes the receipt `DONE`.
3. Delete the activity on Strava. Strava sends the genuine `delete`.

## Expected vs actual

- **Expected:** the genuine delete tombstones the activity.
- **Actual:** it hashes to the same `ingestKey`, meets the `DONE` receipt, and is dropped as
  `duplicate` for up to 90 days. The run stays visible.

## Acceptance criteria

- [x] After a `forged-or-stale` retract, a later genuine delete of the same activity tombstones it.
- [x] Strava's own redeliveries of one genuine delete still cost one receipt and one confirmation
      each at most, and cannot tombstone twice.
- [x] The fix stays inside the webhook's grants (`PutItem` on the receipt gate, plus `UpdateItem`
      on `rate#*` keys only).

## Notes

Filed at the merge of capability 14's wave, from `0282`'s report. Two shapes were proposed:
- free the delete key (delete the receipt, or mark it re-claimable) in the worker after
  `forged-or-stale`;
- add `event_time` to the delete key. Q3 declined this when `0282` was built.

Choose with the operator; a forged `event_time` costs only a confirmation call, metered by
D-349's delete budget.

## Operator validation

None expected. Smoke test: a forged delete of a live activity, then a synthetic delete of a
non-existent id under the same key path, against the deployed URL.

## Resolution

**Operator Q1 (2026-10-18), relayed by the orchestrator:** free the delete key in the worker after
`forged-or-stale`, by marking the receipt re-claimable. The webhook gate re-claims only that
status. The key keeps D-355's shape, `sha256(strava:<owner>:<object>:delete)` with no
`event_time`; Q3 stands. Proposed as **D-360**, which extends D-355 and replaces its "Known limit"
sentence.

**What changed**

- `src/pipeline/ingest-receipt.ts`: `ReceiptStatus` gains `RECLAIMABLE`. `acceptIngest` takes an
  optional third argument, `{ reopenReclaimable }`. When it is set, the gate's `PutItem` condition
  is `attribute_not_exists(ingestKey) OR #status = :reclaimable`, and the fresh row replaces the old
  one whole (`QUEUED`, `attempts: 0`, a new 90-day TTL). Without it, the condition is unchanged.
  New `releaseRetractReceipt`: `SET status = RECLAIMABLE` with the zeros, `REMOVE` the failure
  fields, conditional on `attribute_exists(ingestKey) AND status <> DONE`. Losing that condition is
  a normal outcome, not an error.
- `src/pipeline/retract.ts`: `present` → `releaseRetractReceipt`. Every other outcome still goes
  to `closeRetractReceipt` (`DONE`): `tombstoned`, `already-tombstoned` and `no-activity`.
- `amplify/functions/ingest-webhook/handler.ts`: `forwardRetract` passes
  `{ reopenReclaimable: true }`. The create, update and disconnect paths do not.
- Tests: `src/pipeline/retract.test.ts` (the stateful fake understands the new expressions, plus
  six 0288 cases), `src/pipeline/ingest-receipt.test.ts` (the expressions sent, condition loss,
  fault propagation), `amplify/functions/ingest-webhook/handler.test.ts` (a delete's put re-opens
  and a create's does not), `amplify/functions/ingest-webhook/aspects-e2e.test.ts` (the ticket's
  reproduction steps end to end: forged → `forged-or-stale`, genuine → `tombstoned`, two further
  redeliveries → no message).
- Docs, amended rather than left describing the old behaviour: `docs/02-data-model.md` T8
  `status` row, `docs/03-integrations.md` §2.3 Deletions, `docs/08-security-privacy.md` §4.1. D-355's
  "Known limit" sentence in DECISIONS.md is the orchestrator's to supersede with D-360.

**Why it is safe**

- *Redeliveries of a genuine delete dedupe.* Once the activity is tombstoned the receipt is `DONE`.
  The gate re-opens only `RECLAIMABLE`, so every later delivery is `duplicate`, costing one
  conditional write and no confirmation call. The tombstone write is conditional anyway.
- *A redelivery during processing.* While the worker holds the key (`QUEUED`, or `PROCESSING`,
  which retracts never set), a delivery is still `duplicate`. Only `RECLAIMABLE` re-opens.
- *A late `present` against a finished `gone`.* Two messages for one key can both be in flight
  only after a re-claim. Say the older one's confirmation answered `present` before the run was
  deleted, and it writes after the newer one tombstoned and closed `DONE`. The `status <> DONE`
  condition makes its release a no-op, so the key is not re-opened.
- *Repeated forgeries* each re-claim, so each costs one `GET /activities/{id}`. D-349's delete
  budget meters them at 4 an hour per user, in front of the gate.
- *Grants.* Webhook: the same conditional `PutItem` (no new action; the condition only names
  `status`). Worker: the `UpdateItem` it already holds on `LostSolesIngestReceipt`
  (`amplify/backend.ts`, `ingestReceiptTable.grant(processActivityLambda, …UpdateItem)`). No
  infrastructure change.

**Residual limit (not new, now narrower).** A genuine delete that arrives while a forged delete of
the same activity is still `QUEUED` is dropped as a duplicate, and the webhook answers 200, so
Strava does not retry it. The same applies to a genuine delete that Strava sends before its own API
answers 404: the receipt becomes `RECLAIMABLE`, but nothing redelivers. In both cases the run stays
visible and no XP or cell is touched, as before. Closing that gap would need the worker to retry a
`present` later, or a sweep that notices deletions. Neither was asked for.

**Verification:** guard scripts from `amplify.yml`, `npm run typecheck`, `npm run lint`,
`npx vitest run` and `npm run build`. All were green in the worktree.
