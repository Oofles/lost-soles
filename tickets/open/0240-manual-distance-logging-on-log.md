---
id: 240
slug: manual-distance-logging-on-log
title: Manual distance logging on /log (treadmill / track) needs a distance set field
type: feature
priority: low
status: open
size: m
capability: 10-add-workout
depends_on: []
blocked_by: []
source: agent
created: 2026-10-06T18:50:58Z
---

## Description

Filed from 0068 under D-282. The 06 §6.3 wireframe and 0068's criterion 2 show a Vigil row, "treadmill / track", stepping ±0.5 km, from a `logMode: trace-manual` that does not exist. Vigil is `logMode: trace` with no `exercises`, and a `WorkoutSet` carries `reps` or `durationS`, never distance, so a hand-logged treadmill run has no shape to arrive in.

Needs a decision before code: whether a manual distance becomes a `WorkoutSet.distanceM` (a new SET_FIELDS kernel), or a manual `Activity.distanceM` with no sets (which D-281's dedupe exemption does not cover, since it keys on non-empty `sets`). Either way a registry row gains an `exercises` entry with `entry: distance`, and `STEP_BY_ENTRY` gains its step (0.5 km).

## Acceptance criteria

- [ ] A decision (`D-xxx`) on the shape: a distance set field, or a set-less manual `Activity.distanceM`, with D-281's dedupe exemption revisited for the latter.
- [ ] A registry row can declare a hand-loggable distance exercise, and `/log` renders it with no `.tsx` change.
- [ ] The stepper's distance step (0.5 km) comes from `STEP_BY_ENTRY`, not a per-skill branch.
- [ ] A manual distance log scores through the unchanged `processActivity` and reveals no ground.

## Notes

Not urgent: the operator's runs arrive through the adapters, and a treadmill run is rare.

## Operator validation

On `/log` in the desktop browser: the distance row reads like the others, and a 5.0 km log lands in the row's confirmation.
