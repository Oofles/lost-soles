---
id: 69
slug: manual-adapter
title: The manual adapter — src/adapters/manual/ behind the ingestion contract
type: feature
priority: high
status: open
size: m
capability: 10-add-workout
depends_on: [26, 70]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
started: 2026-10-03T05:53:23Z
---

## Description

**D-100: ingestion is source-agnostic.** Everything that produces an `Activity` does so behind
one normalized contract, and in-app logging is not an exception to that — it is another adapter.
`src/adapters/manual/` sits beside `src/adapters/strava/` and implements the same interface, so
the scoring pipeline cannot tell the difference and no manual-logging special case leaks into it.

What makes it distinct is only what it *omits*: **a manual workout has no `Trace`**.
`hasTrace: false`, `traceRef: null`, `cellCount: 0`. That single fact carries all the downstream
behaviour with no additional flags — no trace ⇒ no H3 projection ⇒ no `ExploredCell` write ⇒ no
generation bump ⇒ no Cartography award (**I-27**: *"zero discovery credit / no map reveal" is
expressed by no field at all*). Do not add a `grantsDiscovery: false`.

The client's entry point is a **`logWorkout` mutation** that runs the **same server-side
pipeline** as any other ingest — this is the one carve-out in I-20, and it exists precisely so
the client still cannot write XP. The client submits *what was done*, never *what it is worth*.

**Strength work is never ingested from Strava** (D-060), even if Strava later exposes something
that looks like it. This adapter is the only path.

Idempotency: the client supplies an idempotency key with each submission; the same key
re-delivered writes nothing new and returns the original result, so the background-sync queue in
0068 can retry freely.

## Acceptance criteria

- [x] `src/adapters/manual/` implements the same adapter interface as the Strava adapter, with
      no additions to that interface and no `manual`-shaped branch in the pipeline.
- [x] The adapter emits an `Activity` with `hasTrace: false`, `traceRef: null` and
      ~~`cellCount: 0`~~ no `trace`, so the pipeline's award is `NO_CELLS` (cell count 0);
      the row shape is otherwise identical to a traced activity. *(Amended 2026-10-03:
      `Activity` has no `cellCount` field — the count lives on the award and the receipt, and
      I-27 says it is expressed by no field at all.)*
- [x] `source.source` is `manual`, drawn from the existing `SourceId` vocabulary.
- [x] A `logWorkout` mutation exists, is ~~`allow.owner()`~~ `allow.authenticated()` with the
      user taken from `identity.sub` and checked against the owner allowlist in the handler
      *(amended 2026-10-03, D-281: Amplify's owner rule applies to models only)*, and accepts
      only measured work — units, exercise id, an optional occurred-at, an idempotency key
      (plus an optional IANA `timezone`, D-281). It accepts **no XP field, no
      skill id, and no level field**; a CI assertion over the generated schema enforces this.
- [x] The mutation runs the same scoring pipeline as the webhook path — same
      `selectActivitySkills`, same rating, same ledger write, same transaction.
- [x] A logged workout writes **no** `ExploredCell` row and does **not** bump `generation`; a
      test asserts the map's generation is byte-identical before and after.
- [x] Re-submitting the same idempotency key writes zero new ledger rows and returns the
      original result.
- [x] `occurredAt` defaults to submission time but may be back-dated; scoring uses it, never
      wall clock, so a back-dated log replays identically.
- [x] No Strava type, and no manual-adapter type, appears outside its own directory (D-121's
      boundary rule, applied symmetrically).
- [x] A test logs one session through the mutation end-to-end and asserts Might, Fortitude and
      Constitution all move. *(One exercise per call, `0070`/D-281: the session is two calls,
      pushups then situps.)*

## Notes

**Cross-capability dependency added during backlog validation (2026-08-30):** 0026 provides adapters/types.ts and the registry the manual adapter registers with.


The adapter boundary is what makes D-103 true — the watch/device decision is not blocking —
and it is also what will make a future Health Connect or GPSLogger adapter a directory rather
than a refactor. Keeping the manual path inside the boundary rather than beside it is the whole
value.

An offline log that is flushed days later must score with its **original** `occurredAt`, which
matters for the D-120 six-month ground window on any future traceless distance skill.

## Resolution

**Built as designed, with three decisions the plan did not settle, all recorded in D-281.** The
operator decided them on 2026-10-03.

1. **Dedupe.** An activity that carries `sets` is never a cross-source duplicate.
   `isSameActivity` abstains on a missing distance, so two short logs within five minutes
   matched each other, and the second scored nothing. `findDuplicate` returns `null` before any
   read. It tests a property, not a source id.
2. **Timezone.** `WorkoutEntry` gains an optional IANA `timezone`, which `startedAtLocal` is
   computed from. When it is absent, the local time is UTC's wall clock.
3. **Auth.** The mutation is `allow.authenticated()`, because Amplify's owner rule applies to
   models only. The handler takes the user from `identity.sub` and checks `OWNER_USER_IDS`.
   Criteria 2, 4 and 10 were amended to match, with the reasons on each.

**Files**
- `src/adapters/manual/adapter.ts` (new) implements all four phases:
  - `accept` reads the validated entry plus the `x-authenticated-sub` header and returns one
    `ingest` job. The key is `sha256(manual:user:idempotencyKey)`; `externalId` is the
    idempotency key.
  - `fetchRaw` returns the accepted bytes from `job.meta`, with no network.
  - `normalize` is pure. It produces `kind: strength`, `hasTrace: false`, `traceRef: null`, no
    `trace` and `raw` set. `elapsedS` is the sum of `durationS`.
  - `listSince` yields nothing.

  The interface was not changed. `src/adapters/principal.ts` holds the header constant, so code
  that builds the request does not import the adapter directory.
- `src/adapters/registry.ts`: registered `manual`. The test that used `"manual"` as the example
  unbuilt source now uses `"health-connect"`.
- `lib/log/log-workout.ts` (new) is the mutation as a function, in this order:
  1. Resolve the registry with `rulesForUser`.
  2. Default `occurredAt` to now.
  3. Validate with `parseWorkoutEntry`.
  4. Run the adapter's `accept`.
  5. Run the accept gate (`acceptIngest`).
  6. Run the unchanged `processActivity`.

  It returns `{ logged, activityId, xpAwarded }`. Client errors throw `LogWorkoutRefused`.
- `amplify/functions/log-workout/` (new) is the Lambda. It runs in `resourceGroupName: "data"`
  to avoid a stack cycle, with 1024 MB and 30 s. Errors the client caused are prefixed
  `REFUSED:<code>:`, so `0068`'s queue can drop them instead of retrying.
- `amplify/data/resource.ts`: the `logWorkout` mutation plus the `LogWorkoutSet` and
  `LogWorkoutResult` custom types.
- `amplify/backend.ts`: the function's grants are explicit action lists and a strict subset of
  the worker's, plus receipt `PutItem` for the accept gate. There is no ExploredCell grant and
  no SQS, SSM or KMS access.
- `src/pipeline/dedupe.ts`: the sets exemption.
- `lib/log/workout-entry.ts`: `timezone`, `isIanaZone`, `BAD_TIMEZONE`. A `null` set field now
  counts as absent, because GraphQL sends unset input fields as `null`.
- `lib/auth/owner-ids.ts` (new): the allowlist moved out of `owner.ts`, which re-exports it, so
  the Lambda does not bundle `next/headers`.
- `app/sync-action.ts`: Sync now iterates `connectableSources()` instead of
  `registeredSources()`. Otherwise registering `manual` made every Sync press report "manual is
  not connected".
- Docs: D-281; the `02` §2.11 mutation signature; the I-22 row in `02`; the contract's `raw`
  comment, which said null only for manual and is wrong now that manual archives too.

**Tests**
- `src/adapters/manual/adapter.test.ts` (14): one block per phase, purity through
  `assertNormalizeIsPure`, back-dating, and DST in `localWallClock`.
- `lib/log/log-workout.test.ts` (10): runs the real adapter and the real `processActivity`
  against the pipeline rig. It covers:
  - pushups then situps moving might, fortitude and constitution;
  - D-281;
  - no cell write, no blob write and no generation call;
  - the accept gate running first;
  - re-submit returning the original award with no transaction;
  - the `occurredAt` default and back-dating;
  - refusals, and XP or skill arguments being dropped.
- `amplify/log-workout-mutation.test.ts` (8) checks the generated SDL. The arguments are exactly
  exercise, sets, `occurredAt`, idempotency key and timezone. No argument or set field matches
  xp, skill, level, award or cell. `logWorkout` is the only custom mutation, and it requires
  sign-in. It also checks the function's grants and that the Lambda has no VPC.
- Updated: `dedupe.test.ts` (+1), `workout-entry.test.ts` (+2 and the key-set type), the
  `source-account-store.test.ts` allowlist, `registry.test.ts`.
- Full suite: 2610 pass. Typecheck, lint, `check-boundaries` and `check-adapter-deletion`
  (now 2 adapters) are clean.

**What went wrong.** The first real-AWS smoke run failed in `recordDelivery` with
`ConditionalCheckFailedException`. `processActivity` assumes the accept gate (01 §4 step 3) has
already written a `QUEUED` receipt, which Sync does before it enqueues. `logWorkout` skipped
that step, and the rig-based unit test could not see it, because the rig's receipt fake always
has a row. Fixed by calling `acceptIngest` first and granting receipt `PutItem`. A test now
asserts the gate's conditional `PutItem` happens before `recordDelivery`. Without the smoke
test, this would have shipped as a mutation that failed on every call.

**Left for later, deliberately.** The client queue, retries and the `/log` UI are `0068`. A
retry that omits `occurredAt` archives a second raw object (harmless, and described in D-281),
so `0068` must send the instant of the click.

## Operator validation

*Planned at ticket-write:* On **`/log`** in the desktop browser with DevTools set to Offline: log 30 pushups. Go back online
and watch the **`/skills` panel** — Might must move within a few seconds, with no
prompt, no retry button and no error ever having appeared. Then open the **map on `/`** and
confirm **nothing was revealed**: no new territory, no generation flicker, no Cartography row in
the tally. A workout logged indoors must leave the map untouched.

**No perceptual check is possible in this ticket.** The check planned at ticket-write needs the
`/log` page, which is `0068`. It also needs a real log in the operator's account, and a smoke
test must not write one, because XP never decreases (D-135). The check moves to `0068`.

**Smoke 1: full pipeline against throwaway AWS (agent, 2026-10-03, `devault`, us-east-1).**
`tmp/0069/smoke.ts` cloned the five tables the path touches (Activity, XpLedgerEntry,
SkillState, Profile, LostSolesIngestReceipt) with their real key schemas and GSIs, and created a
throwaway bucket. It ran `logWorkout` with real DynamoDB and S3 clients. Every command naming a
real table or the cell table was refused, and the receipt table's hard-coded name was rewritten
to its clone. Afterwards it deleted everything.
- pushups ×30 → `logged: true`, 160 XP. situps ×40 → 160 XP. plank 120 s, back-dated to
  2026-09-20 → 240 XP. Pushups re-submitted with the same key → `logged: false`, the same
  `activityId`, 160 XP, no new rows. burpee → `LogWorkoutRefused UNKNOWN_EXERCISE`.
- There were 3 Activity rows: `kind strength`, `source manual`, `hasTrace false`,
  `traceRef null`, `raw` pointing at its `raw/<user>/manual/<key>/<sha>.json` object.
  `startedAtLocal` was `08:24:05` in America/Denver for `14:24Z`. The back-dated plank kept
  `2026-09-20T07:00:00Z`.
- `Profile.totalXp` was 560 (160 + 160 + 240). Three skill-state snapshots were written with
  generation 0. No cell-table command was issued.

**Smoke 2: the deployed Lambda (agent, 2026-10-03, after Amplify job `b650e4c` SUCCEED).**
`tmp/0069/deployed.ts` invoked `amplify-…-logworkoutlambda…` with synthetic AppSync events that
are refused before any write:
- no identity → `REFUSED:NOT_OWNER`;
- a non-owner sub → `REFUSED:NOT_OWNER`;
- the owner with `burpee` → `REFUSED:UNKNOWN_EXERCISE`. This proves the deployed bundle, the
  env vars, and the IAM read of the real SkillState and Profile tables through `rulesForUser`.
- the owner with `Mars/Olympus` → `REFUSED:BAD_TIMEZONE`.

The live AppSync introspection serves
`logWorkout(exerciseId, idempotencyKey, occurredAt, sets: [LogWorkoutSetInput!]!, timezone): LogWorkoutResult!`.
Amplify also added `@aws_iam` to it. An IAM caller has no `sub`, so the handler refuses it as
`NOT_OWNER`.

