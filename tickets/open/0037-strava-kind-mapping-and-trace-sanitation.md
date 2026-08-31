---
id: 37
slug: strava-kind-mapping-and-trace-sanitation
title: Activity-kind mapping on sport_type, indoor/no-GPS handling, and trace sanitation
type: feature
priority: high
status: open
size: m
capability: 05-strava-adapter
depends_on: [29, 36]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
---

## Description

The three remaining pieces of `03-integrations.md` §2.6, all inside `normalize`.

**1 — Always branch on `sport_type`, never on `type`.** Every activity carries both: `type` is the
legacy enum (37 values, deprecated) and `sport_type` the current one (56 values). `type` is
**lossy** — a `TrailRun` appears as plain `Run` in `type`, and 19 modern sport types collapse to
the single value `Workout`.

| Strava `sport_type` | `ActivityKind` | Trace expected? | Note |
|---|---|---|---|
| `Run`, `TrailRun` | `run` | yes | `TrailRun` is invisible in `type` |
| `VirtualRun` | `run` | **no** | Zwift / Peloton / footpod — distance and XP, zero fog |
| `Walk` | `walk` | yes | see policy note |
| `Hike` | `hike` | yes | see policy note |
| `Workout`, `WeightTraining`, `Crossfit`, `HighIntensityIntervalTraining` | *(ignored)* | no | strength is not ingested from Strava |
| everything else (`Ride`, `Swim`, `Yoga`, …) | *(ignored)* | — | archived to S3, not ingested |

**Unknown `sport_type` values must not crash the adapter.** Strava adds sport types. Default to
"ignored", log the raw string in `sourceTypeRaw`, and **archive the payload anyway**. A new sport
type is a backlog ticket, not a page.

**The adapter maps to `ActivityKind`, never to a skill.** `Activity` carries `kind`, not `skill`
(contract conflict 7). Which skill a walk trains is decided by the 0029 matcher reading the 0028
`match` blocks. The Walk/Hike policy call — that they reveal fog and earn Wayfaring XP, because
D-012's motivator is novelty of *place* and ground covered on foot is ground explored — is
therefore expressed as `kinds: [run, walk, hike]` in **YAML**, and reversing it is a one-line
change in `rules/`, not in the adapter.

**2 — Indoor / no-GPS is a normal, frequent outcome and must not be an error path.**
Signals, in the order you meet them: `manual: true` (empty/absent `summary_polyline`, streams 404);
`trainer: true`; `sport_type: "VirtualRun"`; and the nastiest, a watch-recorded indoor run that has
`time`, `distance`, `heartrate` and `cadence` streams and **no `latlng` key at all** — with no flag
on the summary object, so you find out when the response comes back.

```
1. manual === true OR summary_polyline empty/absent → skip the stream call entirely.
2. Otherwise fetch. Then:
   - 404                        → hasTrace = false, traceRef = null.  Not an error.
   - 200 without a `latlng` key → hasTrace = false, traceRef = null.  Not an error.
   - 200 with `latlng`          → build the Trace.
3. Either way, write the Activity.
```

**Check for the *presence* of the `latlng` key before indexing into it.**
`streams.latlng.data[0]` on a treadmill run is the crash you will ship if you skip this.

**A no-GPS run must fall to Vigil *by the matcher*, not by a branch.** The adapter sets
`hasTrace: false`; the matcher's `requiresTrace` clause does the rest. If this ticket introduces
any line resembling `hasTrace ? "wayfaring" : "vigil"`, D-141 has been broken at the last
possible moment.

**3 — Trace sanitation.** A run through a tunnel or an urban canyon produces `latlng` points that
jump hundreds of metres. **Filter on implausible point-to-point speed before projecting to H3.**
One bad fix paints a revealed corridor across the city, and **D-020 makes it permanent.**

- Reject a point whose implied speed from the **previous accepted** point exceeds ~8 m/s for a run
  (~29 km/h — comfortably above any human running pace, below GPS jump magnitudes). Drop the
  point, keep the previous, continue.
- **Do not interpolate across the gap.** A straight line through a dropout also reveals ground
  that may not have been run. Break the trace into segments and project each independently.
- Log rejection counts per activity. A sudden rise means a hardware or firmware change worth
  knowing about.

## Acceptance criteria

- [ ] The mapping reads `sport_type`; a grep asserts the legacy `type` field is never branched on.
- [ ] A `TrailRun` fixture maps to `kind: "run"` and is not downgraded to a plain run's handling.
- [ ] `VirtualRun` maps to `kind: "run"` with `hasTrace: false`.
- [ ] `Walk` maps to `walk` and `Hike` to `hike`; neither maps to `run`.
- [ ] Strength-shaped types (`WeightTraining`, `Crossfit`, `HIIT`, `Workout`) are archived and
      **ignored** — no `Activity` row enters the ledger.
- [ ] An **unknown** `sport_type` produces no throw: the activity is ignored, the raw string is
      preserved verbatim in `sourceTypeRaw`, and the payload is still archived.
- [ ] `sourceTypeRaw` is never branched on outside `src/adapters/strava/`.
- [ ] The adapter emits **no skill id anywhere** — the 0028/0030 skill-name grep stays green, and
      review confirms no `hasTrace ? ... : ...` skill selection exists.
- [ ] A treadmill fixture with **no `latlng` key** normalizes to `hasTrace: false`,
      `traceRef: null`, without throwing; a test asserts key-presence is checked before indexing.
- [ ] A streams **404** produces the same result and is **not** logged as an error.
- [ ] A `manual: true` fixture issues zero stream calls (call count asserted).
- [ ] An end-to-end test through the 0029 matcher: the no-GPS run selects **`vigil`**, the same run
      with a trace selects **`wayfaring`**, and neither result comes from a branch in the adapter.
- [ ] A trace containing a single 400 m jump between consecutive 1 Hz samples drops exactly the
      offending point, keeps both neighbours, and **does not interpolate** across it.
- [ ] The sanitizer produces **segments**, and a `gaps` entry marks the break so the renderer
      cannot draw a corridor across it.
- [ ] The speed gate is a named constant with its units and its justification in a comment.
- [ ] Rejection counts are recorded per activity and are visible in logs.

## Notes

The Walk/Hike policy is **flagged** in §2.6 as a policy call the operator may disagree with. Because
selection lives in YAML (D-141), disagreeing later is one edit to Wayfaring's `match.kinds` — that
is exactly the property capability `04` was built to buy, and this ticket is where it first pays.

Strength work is not ingested from Strava because **D-060 is forced, not chosen**: Strava has no
concept of reps, sets or exercise detail anywhere in the API. Parsing `"Pushups 3x20"` out of a
title is the kind of fragile heuristic that produces silent wrong data in a permanent, append-only
ledger. Might, Fortitude and Endurance are fed only by in-app manual entry.

Manual Strava activities are treated exactly as treadmill runs: a real `Activity` with
`hasTrace: false` and a raw archive key. They are the user's own record of a run that happened;
they earn XP. They simply cannot reveal ground, because there is no evidence of which ground.

## Operator validation

**Device: the operator's Android phone, on the activity list and (once capability `08` lands) the
map.** Do a treadmill or track run recorded by the watch with no GPS, sync it, and confirm: it
appears as an activity, it earns XP, and the map reveals **nothing** — no stray hexagon, no cell at
the gym. Then do an outdoor run through a known signal-loss stretch (a tunnel or a built-up
street), sync it, and look at the rendered route: there must be a **break**, not a straight line
across the buildings. That straight line is the permanent scar D-020 makes unfixable, so look
carefully.
