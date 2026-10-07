---
id: 244
slug: change-kind-from-run-page
title: The operator can change an activity's kind from the run page
type: feature
priority: med
status: closed
size: s
capability: 10-add-workout
depends_on: [243]
blocked_by: []
source: agent
created: 2026-10-07T11:43:43Z
started: 2026-10-07T14:16:25Z
closed: 2026-10-07T14:40:19Z
---

## Description

The UI half of `0171`, split out on 2026-10-07 (D-284). It builds on `0243`.

The operator can change an activity's kind from the single-run page (`app/run/[activityId]`).
The ticket originally named an "activity list", but that does not exist: `app/chronicle` is
still a stub.

## Acceptance criteria

- [x] An owner-only custom mutation (`setActivityKind`) backed by a Lambda, on the `logWorkout`
      pattern: the user comes from `identity.sub`, never from an argument. It calls `0243`'s
      entry point. An SDL test pins its auth.
- [x] The run page shows the activity's kind and, if it has been overridden, the derived kind
      it replaced ("was Walk").
- [x] The run page has a control to change the kind. Its choices are the kinds the rules know,
      read from data, with no `switch` on a kind (D-031).
- [x] After a change the page reports the XP result in plain words: what was added to which
      skill, or that nothing changed because XP never goes down (D-135).

## Notes

- *(from `0243`, 2026-10-07)* Show "was X" only when `kindOverride` is non-null **and**
  `kind != derivedKind`. An override set back to the derived kind leaves a non-null mirror: the
  2026-09-07 run (`ab00f078…`) has one, from `0243`'s smoke test. Rows written before `0243` lack
  `derivedKind`, so read it as `derivedKind ?? kind`. The backend is
  `rescoreKind` (`src/pipeline/kind-rescore.ts`); its result has `xp: null` when no skill gained.

- Keep the control secondary. Changing a kind is a rare correction, not a primary action on
  the page (D-051: legibility first).

## Resolution

**Built as proposed, with one deviation from the ticket's premise.** `app/run/[activityId]` was
still `0016`'s stub: the real run page is `0078` (capability 12, gated behind this capability's
audit). The operator agreed (2026-10-07) to mount a self-contained `<ActivityKind>` under the stub
rather than block on `0078`. A dated note on `0078` tells it to place the block in the persistent
end state.

**Backend (criterion 1).**
- `amplify/functions/set-activity-kind/{resource,handler}.ts`: `logWorkout`'s pattern. The user is
  `identity.sub` plus `isOwner`, and `rescoreKind` refuses an activity that is not that user's.
  `UnknownKindError` → `REFUSED:UNKNOWN_KIND`. `ReplayInProgressError` → `BUSY:`. `toResult`
  flattens the per-skill maps into `gained` / `retained` lists for the SDL.
- `amplify/data/resource.ts`: the `setActivityKind(activityId, kind)` mutation, with the
  `SetActivityKindResult` / `SetActivityKindXp` types and `allow.authenticated()`.
- `amplify/backend.ts`: explicit grants with no wildcard actions.
  - Activity: Get and Update.
  - Ledger: Put and Delete, plus Query on `byActivity`. Delete is needed because D-142 removes
    the activity's non-floor rows; it is conditioned `isFloor = false` at the table.
  - SkillState: Update and Query. Profile: Update, Get and ConditionCheck.
  - ExploredCell: Update and BatchGet, the worker's exact set.
  - S3: `raw/*` Put and Get, ListBucket on `raw/*` and `users/*`, `users/*` Put and Get, and
    delta expiry.
  - It has no SQS, SSM, SourceAccount or receipt access.
- **Tests.** `amplify/set-activity-kind-mutation.test.ts` pins the SDL: the arguments are exactly
  `activityId, kind`, the auth is `allow: private`, and the role's only deletes are on the ledger
  and `users/*/deltas/*`, never ExploredCell or `raw/`. `handler.test.ts` covers the owner refusal
  and `toResult`.

**UI (criteria 2–4).**
- `lib/run-kind/kind.ts` is pure. `wasKind` follows `0243`'s note (an override AND
  `kind != derivedKind ?? kind`). `kindChoices` is `knownKinds` over the user's ruleset, sorted.
  `kindChangeLine` produces the plain-words result: `+N Skill XP`, "No XP changed: … XP never
  goes down", and names any retained floor.
- `lib/run-kind/transport.ts` holds `Activity.get` (owner-read) and the mutation.
- `app/run/[activityId]/activity-kind.tsx` is the block. A quiet underlined "Change" opens a
  select, Save and Cancel (D-051: secondary). Labels raise the kind's first letter; nothing
  switches on a kind (D-031).
- 12 tests in `lib/run-kind/kind.test.ts`. One proves a kind added only as a data row appears
  as a choice.

**Refactors made on the way.**
- `knownKinds` moved to `src/rules/known-kinds.ts`, so the browser can import it without the S3
  SDK. `kind-override.ts` re-exports it.
- The trace loader in `tools/kind-override/override-kind.ts` moved to
  `src/pipeline/archived-trace.ts`, so the tool and the Lambda share one reading of the archive.

**What went wrong, and a guard I changed.**
- `scripts/check-fog-hot-path.mjs` (I-7) failed the first full run. It refuses any line naming
  `dynamodb:DeleteItem` in a file that also names T6, and `backend.ts` names T6. I added one
  exemption: a line starting `xpLedgerTable.grant(`. I added two self-test cases: that grant
  passes, and the same grant on `exploredCellTable` still fires. The role-level absence of any
  delete on T6 is asserted by the synth test above. I flagged this to the operator rather than
  folding it in silently.
- Two allowlist tests that enumerate the API surface needed updating for the second custom
  mutation: `log-workout-mutation.test.ts` ("only custom mutation") and
  `source-account-store.test.ts`'s model allowlist, which now carries a paragraph saying what
  `setActivityKind` is.

Suite: 159 files, 2814 passed. Lint, typecheck and every `scripts/check-*.mjs` are clean. No new
D-xxx: this implements D-284 and D-285 as written.

## Operator validation

**Desktop browser, single-run page.** Open an activity that the agent has re-ingested, change
its kind, and check:

- it displays as the corrected kind with "was X";
- the XP message reads right.

The agent proves by smoke test, not by waiting for a real sync, that the override survives
re-ingest: it replays the archived activity through the ingest path after the change.

### Smoke test: agent, 2026-10-07, `devault`, after Amplify job 311 (`2747abe`) SUCCEEDED

1. **Live SDL.** AppSync `nog4xy2l7baqlhghpndh2565qe` serves
   `setActivityKind(activityId: String!, kind: String!): SetActivityKindResult!`.
2. **The deployed Lambda refuses before any write.**
   - No identity → `REFUSED:NOT_OWNER`.
   - Sub `not-the-owner` → `REFUSED:NOT_OWNER`.
   - The owner with `swim` → `REFUSED:UNKNOWN_KIND … Known: hike, other, ride, run, strength,
     walk`. This proves the bundle, the env vars, and the IAM read of SkillState and Profile
     through `rulesForUser`.
3. **Live apply, moving no XP** (`0243`'s variant), on the real `ab00f078…` (Strava
   20076758956). Run → walk returned `applied`, `gained: []`, `retained: []`, "no skill would
   gain". That exercises the `raw/` PUT, the T3 update and the Profile `ConditionCheck` grants
   for real. The ledger rows for the activity were identical before and after: constitution 17,
   wayfaring 52.
4. **The override survives re-ingest.** `replay-activities.ts --external 20076758956 --confirm`
   went through SQS to the real worker, which logged `outcome: persisted` and
   `alreadyScored: true`. T3 then read `kind: walk`, `derivedKind: run`, and
   `kindOverride.setBy: setActivityKind:<owner sub>`.
5. **Reverted** to `run` through the Lambda: `applied`, no XP, ledger unchanged. The row is
   `kind: run` with a non-null mirror, so the page correctly shows no "was". The `raw/` objects
   stay for good, as I-3 requires.

**Not exercised live:** the path where XP is gained or retained, and the cell-reveal path.
Neither is reachable without permanently moving XP on the real account.
`kind-rescore.test.ts` remains their proof, as it was for `0243`.

### For the operator: perceptual, still to do

Not yet looked at by anyone. **Desktop browser** →
`/run/ab00f0785a584d8704e81055a828103301dff427ed63e230cca3831f9d48b2d3`. Below the stub it should
read **"Run · Change"**. Click Change, pick **Walk**, Save. Check that:
- the line becomes **"Walk (was Run)"**;
- the message reads **"Now Walk. No XP changed: no skill earns more from it as a walk, and XP
  never goes down."**;
- the control feels secondary, not like a primary action.

Changing it back to Run afterwards is harmless and moves no XP.

