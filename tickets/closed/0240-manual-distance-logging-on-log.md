---
id: 240
slug: manual-distance-logging-on-log
title: Manual distance logging on /log (treadmill / track) needs a distance set field
type: feature
priority: low
status: closed
size: m
capability: 10-add-workout
depends_on: []
blocked_by: []
source: agent
created: 2026-10-06T18:50:58Z
closed: 2026-10-07T16:02:53Z
---

## Description

Filed from 0068 under D-282. The 06 §6.3 wireframe and 0068's criterion 2 show a Vigil row, "treadmill / track", stepping ±0.5 km, from a `logMode: trace-manual` that does not exist. Vigil is `logMode: trace` with no `exercises`, and a `WorkoutSet` carries `reps` or `durationS`, never distance, so a hand-logged treadmill run has no shape to arrive in.

Needs a decision before code: whether a manual distance becomes a `WorkoutSet.distanceM` (a new SET_FIELDS kernel), or a manual `Activity.distanceM` with no sets (which D-281's dedupe exemption does not cover, since it keys on non-empty `sets`). Either way a registry row gains an `exercises` entry with `entry: distance`, and `STEP_BY_ENTRY` gains its step (0.5 km).

## Acceptance criteria

- [x] A decision (`D-xxx`) on the shape: a distance set field, or a set-less manual `Activity.distanceM`, with D-281's dedupe exemption revisited for the latter.
- [x] A registry row can declare a hand-loggable distance exercise, and `/log` renders it with no `.tsx` change.
      *Read as: a new distance exercise needs no `.tsx` change.* The operator chose an optional
      time on distance rows, which cost ONE `.tsx` addition keyed on `row.optionalTime` (the
      entry kind), never on an exercise. Every later distance exercise is a YAML row.
- [x] The stepper's distance step (0.5 km) comes from `STEP_BY_ENTRY`, not a per-skill branch.
- [x] A manual distance log scores through the unchanged `processActivity` and reveals no ground.

## Notes

Not urgent: the operator's runs arrive through the adapters, and a treadmill run is rare.

## Resolution

**Decisions (D-286), all taken by the operator on 2026-10-07 in one round, plus a follow-up.**
- **Shape: a distance set.** `WorkoutSet.distanceM`, in whole metres, is a contract amendment.
  The manual adapter adds the sets' distances into `Activity.distanceM`, so Vigil's unchanged
  `distanceKm` measure scores the log. It is not a scoring kernel.
- **Kind: declared on the exercise.** `RuleExercise.kind` is optional and defaults to
  `strength`. The server stamps it onto the archived entry.
- **Time: distance plus an optional time** (`durationS` → `elapsedS`).
- **Versioning: rules v3 plus a no-op replay.**
- **Dedupe: D-281 unchanged.** I first recommended narrowing the exemption. On reading
  `isSameActivity` I found the narrowing would almost never match, because the click time
  differs from a synced run's start time. Worse, a no-time distance log would be judged a
  duplicate of a pushup log within five minutes, which is D-281's original bug in reverse. I
  went back to the operator, who chose to keep D-281.

**What I found that the ticket did not mention.**
- The manual adapter and the optimistic award both hard-coded `kind: "strength"`.
- `exercises[]` had no validation at all.
- `/log` filtered rows on `logMode`, so Vigil (`logMode: trace`) could never show a row.

**Files.**
- **Rules.** `rules/xp-rules-v3.yaml`, plus the generated `.json` and `xp-rules.bundled.ts`. It is
  v2 plus Vigil's `treadmill` exercise (`entry: distance`, `kind: run`, quickValues `[5, 3, 10]`).
- **Schema and validator.** `src/rules/schema.ts` adds the `distance` entry and `kind`.
  `src/rules/validate.ts` adds `validateExercises`:
  - the entry agrees with the measure;
  - the kind is admitted by `match.kinds`, with a missing kind treated as `strength`;
  - exercise ids are unique across the ruleset.
- **Domain and API.** `src/domain/activity.ts`, `docs/contracts/ingestion-contract.md`, and
  `amplify/data/resource.ts` (`WorkoutSet` and `LogWorkoutSet` gain `distanceM`).
- **Entry boundary,** `lib/log/workout-entry.ts`. New: `EntryField`, `OPTIONAL_FIELDS_BY_ENTRY`,
  `exerciseOf`, `exerciseKind`. `parseWorkoutEntry` stamps `kind`, and `entryActivityFields`
  returns `kind`, `elapsedS` and `distanceM`.
- **Adapter and optimistic award.** `src/adapters/manual/adapter.ts` reads `kind`; a missing kind
  is `strength`, an unknown one gets a 400. `lib/log/optimistic.ts` uses the registry's kind and
  the distance.
- **Rows,** `lib/log/rows.ts`. `STEP_BY_ENTRY.distance = 0.5`, plus `DECIMALS_BY_ENTRY` and
  `SET_SCALE_BY_ENTRY`. Rows now come from every declared exercise (the `logMode` filter is
  gone), with km format/parse and `parseTime`/`formatTime`.
- **UI.** `app/log/log-row.tsx` adds the optional time input; `app/log/log-page.tsx` passes
  `durationS` through.
- **Docs.** `docs/06-ui-ux.md` §6.3's step row and `docs/decisions/DECISIONS.md` D-286.

**Tests.**
- `lib/log/log-workout.test.ts`: 7 new tests, with the real manual adapter and `processActivity`
  under v3:
  - a traceless `run` with `distanceM: 5000` and `elapsedS: 1800`;
  - Vigil + Constitution at Vigil's rate;
  - no cell, blob or generation;
  - the time is optional;
  - no dedupe read;
  - a time on pushups is refused;
  - a client-sent `kind` is overwritten.
- `src/rules/validate.test.ts`: 6 new tests, including that the shipped v3 is valid.
- `src/adapters/manual/adapter.test.ts`: 4 new tests, including that a pre-D-286 archive is
  still strength.
- `lib/log/rows.test.ts` now runs against v3 with distance cases.
- Suite: 159 files, 2842 passed; lint, typecheck, check scripts and `build-rules-json --check`
  all clean.

**Deployed and replayed.** Amplify job 315 (`ca8a09b`) SUCCEEDED. Then
`replay-xp.ts --to 3 --confirm`: 73 rows deleted and rewritten, 1 floor row survived, no new
floors, generation 133. Every skill is unchanged:
- cartography 15,985
- constitution 1,584
- might 80
- wayfaring 4,675

Total Level 58, 22,324 XP, all rows now on `rulesVersionLastComputed: 3`.

## Operator validation

On `/log` in the desktop browser: the distance row reads like the others, and a 5.0 km log lands in the row's confirmation.

### Smoke test: agent, 2026-10-07, `devault`, live

- **Before the replay,** the live `logWorkout` refused `treadmill` with `UNKNOWN_EXERCISE`, as
  expected: the ledger was on v2.
- **After the replay,** all calls were made as the owner and all were refused before any write:
  - `treadmill` with `{distanceM: 5000, durationS: 1800}` and a bad timezone → `BAD_TIMEZONE`.
    The exercise is now known, and the time is accepted beside a distance.
  - `treadmill` with `reps` → `BAD_SET … measured in distanceM`.
  - `pushup` with `durationS` → `BAD_SET … measured in reps`. The time companion is allowed on
    distance only.
- **Live AppSync** `LogWorkoutSetInput` has `distanceM: Int`.
- **The ingest worker bundles v3.** A re-ingest of `ab00f078…` through SQS logged
  `outcome: persisted`. The ingest commit is conditioned on `ledgerRulesVersion`, now 3, so a
  worker without v3 would have refused it. Your next Strava sync is safe.
- **Not done live:** an accepted distance log. It would award real XP that can never be
  removed, so the operator makes the first one. `log-workout.test.ts` proves the accepted path.

### For the operator: perceptual — verified 2026-10-07

**Done by the operator, desktop browser, `/log`:** "All 3 validation steps are good for the vigil input." The row reads like the others, ± steps 0.5 km, and the confirmation reads right.

The check as written:

**Desktop browser, `/log`.** The Vigil row ("treadmill / track") now appears **first**, because
the registry orders it there (`displayOrder` 15, before Might's 30). Check that:
- it reads like the other rows, with the number shown as `5.0 km` and a small "Time (optional)"
  field under it;
- ± steps by 0.5 km;
- pressing LOG shows the gold confirmation "VIGIL 5.0 km treadmill / track · Vigil +500 → L…".

**Press ⟲ Undo within 8 s** unless you actually ran it. Undo cancels before anything leaves the
browser (D-282), so the check costs no XP.

