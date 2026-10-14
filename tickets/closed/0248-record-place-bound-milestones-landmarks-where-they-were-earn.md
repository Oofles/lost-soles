---
id: 248
slug: record-place-bound-milestones-landmarks-where-they-were-earn
title: Record place-bound milestones (landmarks) where they were earned
type: feature
priority: med
status: closed
size: m
capability: 12-post-run-moment
depends_on: []
blocked_by: []
source: agent
created: 2026-10-07T20:57:39Z
started: 2026-10-14T14:15:13Z
closed: 2026-10-14T14:41:52Z
---

## Description

`04` §4.3: *"Every milestone that can be a landmark should be a landmark."* A level-50 milestone
places a landmark (a cairn) where it was earned, and 99 places a shrine at the exact cell. `06`
§3.2 Beat 3 flies the level-up card into that cell. `06` §5.5's `ON THE MAP` lists them with
`→ fly to`.

**Nothing records where a milestone was earned.** `0082` animates the placement at the moment it
happens, but no table holds it afterwards. So `0074` shipped `ON THE MAP` against an always-empty
list (`NO_PLACES` in `app/skills/skill-sheet-route.tsx`, D-290), and every sheet omits the section.

Persist a place-bound milestone when it is crossed: skill, milestone level, the activity that
crossed it, and the cell (or coordinate) where the cumulative XP passed the threshold. Then feed
it to the sheet.

## Acceptance criteria

- [x] Crossing a place-bound milestone writes one durable, owner-scoped record: skill, level,
      activity, location. It is written once. Re-ingesting or replaying the same activity does not
      duplicate it, and a ruleset replay that moves the crossing does not delete it (D-020, D-135 —
      a landmark, like the map, never un-happens).
- [x] Which levels are place-bound is data, not a skill-id check (D-031). `04` §4.3 says 50 and 99.
- [x] The location is where the threshold was crossed along the trace, or the activity's end cell
      when the activity has no trace. Pick one rule, record it as a decision, and test it.
- [x] `app/skills/skill-sheet-route.tsx` reads these records instead of `NO_PLACES`. `ON THE MAP`
      appears for a skill that has one, and `→ fly to` lands the map on it.
- [x] Existing history is backfilled once. A skill already past 50 gets its landmark at the
      activity that crossed it.

## Notes

- Filed from `0074` (D-290). The sheet's side is built and tested against a fixture; this ticket
  is only the data.
- The home coordinate rules apply (`08` §7.2, D-199). A landmark is a real coordinate near home.
  It must never be committed in a fixture, and must be served only to the owner.

## Resolution

**What was built:** `645ec72`, plus one fix (`b601765`). The operator made three calls up front:
- a crossing with no location is **stored without one**;
- **first write wins**;
- drawing landmarks on the map is a **new ticket** (`0260`).

All of this is recorded as **D-301**.

- **Which levels.** `src/scoring/places.ts` holds `PLACE_LEVELS` (`{50: landmark, 99: shrine}`) and
  `placesCrossed(xpBefore, gained, curve)`. `0082`'s private `PLACES` table and its arc arithmetic
  in `lib/level-up/cards.ts` now come from here. The card and the record share one table and one
  `thresholdArc`, and a test asserts they agree.
- **The record.** A new Amplify model, `Landmark`, in `amplify/data/resource.ts`:
  - key `(userId, skillLevel = skillId#level)`, plus `skillId, level, place, activityId, earnedAt, lng?, lat?`;
  - owner-read only, with mutations and subscriptions disabled.
  - `backend.ts` gives `process-activity`, `log-workout` and `set-activity-kind` **`UpdateItem` only**
    on it, plus `LANDMARK_TABLE`.
- **The write.** `src/pipeline/landmarks.ts`:
  - `landmarksCrossed` judges crossings on the same `SkillState` pre-read the level SETs use.
  - `landmarkUpdateItem` sets every attribute with `if_not_exists` and has **no condition**. A
    condition would cancel the XP transaction on a re-cross; `if_not_exists` simply keeps the first
    write.
  - It runs **inside** the ledger transaction, ahead of the Profile totals, which stay last for
    `isReplayRefusal`. Written after the commit, a crash in between would lose the landmark for good.
  - Wired into `persistWithLedger` (ingest and `logWorkout`) through a new `route` argument: the
    geometry `traces` stores, or `null` with no trace. Also wired into `rescoreKind`, which fetches
    the route lazily, only when something was crossed.
- **The location rule (D-301).** The stored route is walked by the threshold's arc through
  `lanternPath`, the same function and the same geometry the `/run/:id` card flies along, so the
  cairn stands where the card landed. The ticket's end-cell option was rejected: it would put the
  landmark somewhere the card never went.
- **The read.**
  - `lib/skills/transport.ts` `fetchLandmarks` calls `Landmark.list` with `userId` and a
    `skillLevel` `beginsWith` condition.
  - `lib/skills/detail.ts` `placeMilestones` labels the rows `Cairn at Level 50` / `Shrine at Level 99`.
  - `skill-sheet-route.tsx` loads them in place of `NO_PLACES`. A failed read costs `ON THE MAP`,
    never the sheet.
  - `skill-sheet.tsx` shows `→ fly to` only for a located place; `onFly` now takes a located place.
  - `PlaceMilestone.lng/lat` became nullable.
- **The backfill.** `landmarksFromLedger` (pure) walks T4 in `seq` order. A crossing made by a floor
  or replay row names no activity and is not placed. `tools/landmarks/backfill-landmarks.ts` does the
  I/O: dry run by default, and it never prints a coordinate. It is also the repair after a replay,
  since the replay writes no landmarks.
- **Tests.**
  - `places.test.ts` (6) and `landmarks.test.ts` (4).
  - `xp-ledger.test.ts` (+6): one row in the crossing commit at the right arc; null location; no
    crossing, no row; redelivery; first write wins; the item shape and the totals staying last.
  - `kind-rescore.test.ts` (+2), `skill-sheet.test.tsx` (+1) and `detail.test.ts` (+1).
  - `xp-ledger-tables.test.ts`: no mutation, read resolvers present, and "Landmark: UpdateItem only".
  - The T7 model allowlist names `Landmark`.
- **Docs.** `02` §2.2/§2.11 (the model), `06` §5.5 (ON THE MAP is now real; labels; no street name
  without a geocoder), and the run-sequence comment, which now points at `0260`.

**What went wrong.**
- The backfill first hard-coded rulesets `[1, 2]`, copied from `override-kind.ts`. Against prod it
  refused: the ledger is on **v3**. It now reads `BUNDLED_RULES`, as the worker does. The same bug in
  `override-kind.ts` is filed as `0261`. It fails closed, so nothing was mis-scored.
- The first commit attempt was blocked by the fixture-geography hook because node was not on PATH.
- **No skill in prod is past 50** (highest: Cartography 23). So the backfill ran and found nothing,
  and no real landmark exists to look at. I did not fake one: XP cannot be removed (D-135), and a
  fake landmark row on a real skill would be a permanent wrong place under `if_not_exists`.
- The street name in §5.5's mockup (`— Beck Rd`) is not shown. It needs reverse geocoding, which
  nothing does. Recorded in `06` §5.5, not built.

**Ready now:** `0260` (draw them on the map) depends on this ticket.

## Operator validation

**Agent smoke tests, 2026-10-14, against prod (Amplify job 373, `645ec72`, SUCCEED):**
- `Landmark-nog4xy2l7baqlhghpndh2565qe-NONE` exists, keyed `userId` HASH and `skillLevel` RANGE.
- All three writer Lambdas carry `LANDMARK_TABLE`. Their inline IAM on the table is
  `dynamodb:UpdateItem` and nothing else.
- In the deployed AppSync schema (`get-introspection-schema`), `getLandmark` and `listLandmarks(…,
  skillLevel: ModelStringKeyConditionInput, userId: String)` exist, and no `Landmark` mutation or
  subscription does.
- **Write-once on real DynamoDB** (`tmp/0248/smoke-write-once.ts`, throwaway user
  `smoke-0248-not-a-user`, row deleted afterwards):
  - a transaction wrote a landmark with null `lng`/`lat`;
  - a second transaction re-crossing the same level with a different activity and a real
    coordinate **committed without cancelling**;
  - the row still read `activityId: act-first, lng: null`, so the first write and its null were kept.

  This is the half the fake cannot prove: DynamoDB keeps a NULL attribute under `if_not_exists`.
- **Backfill on the operator's account:** 81 ledger rows under v3, 0 place-bound crossings. Run with
  `--confirm`; the table holds 0 items, which is correct.

**Not yet possible: the perceptual check above.** No skill is past 50, so there is no `ON THE MAP`
row to look at. `→ fly to` uses the same `atHref` path that `0074`'s headless probe drove to the map,
and the markup tests cover listed with fly-to, listed without, and omitted. The operator's check
today is smaller: **`/skills/wayfaring` on desktop shows no `ON THE MAP` heading and no
`Landmark.list` error in the console.** That proves the authenticated read, the one call only a
Cognito session can make. The full look waits for the first real level 50; `0260`'s validation
covers the map half.

Planned at ticket-write: On **`/skills/<a skill past level 50>`** in the desktop browser: `ON THE MAP` lists its landmark.
`→ fly to` closes the sheet, and the map comes to rest on a place where that milestone could
plausibly have been earned.
