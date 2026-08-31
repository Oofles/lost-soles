---
id: 59
slug: perf-harness-and-first-usable
title: Perf harness against the §6.4 budget on a real mid-range Android phone — FIRST USABLE
type: feature
priority: high
status: open
size: m
capability: 08-map-and-fog-renderer
depends_on: [43, 51, 57, 58]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
---

## Description

**This is the last ticket before the app becomes usable.** When it closes, the operator opens
`soles.devaultsecurity.com` on their Android phone, signs in, taps Sync, and watches the streets
they actually ran come out of the fog. Everything in Phases 0 and 1 exists to reach this point.

Two jobs.

**1. The measurement harness.** None of the performance design is true until measured, and the
instrumentation is small — build it with the layer, not after (`05-fog-of-war.md` §6.4):

1. `visibleInstanceCount` per mask rebuild, histogrammed per zoom. *Assertion: ≤ 6,000 always.*
2. GPU pass timings via `EXT_disjoint_timer_query_webgl2`, mask and composite separately.
   *Budget: mask < 1 ms, composite < 2 ms.* The extension is not universal — guard it and fall back
   to frame time.
3. Frame time p50/p95 from rAF deltas along a **scripted** camera path — a fixed pan/zoom sequence
   replayed identically on every build, so numbers are comparable across commits. *Target:
   p95 < 16.7 ms.*
4. Main-thread cull time via `performance.mark`/`measure`. *Budget: < 2 ms; ~0 ms inside the padded
   region.*
5. Bucket-derivation time per resolution, and cache hit rate.
6. Long tasks via `PerformanceObserver({entryTypes:['longtask']})` during the scripted path.
   *Assertion: zero attributable to the fog layer during pan.*
7. Peak JS heap with a synthetic 500k-cell dataset. *Assertion: low tens of MB.*

Synthetic fixtures at **50k / 150k / 500k** cells, generated once and checked in. Real data will not
reach 500k for years, and by then the assumption is untested unless it is tested now. Run the
scripted path on a **real mid-range Android device** — desktop numbers here are worthless.

**Kill criteria, decided in advance.** If p95 exceeds 16.7 ms at 150k cells on the target phone, the
levers in order are (a) mask scale to 0.35×, (b) animation to 20 fps, (c) fBm to 2 octaves. Only if
all three fail do we reach for precomputed raster tiles. Note that fixes (a)–(c) and the culling
levers reach backwards into 0055/0056/0058 — that is expected and is why this ticket is last.

**2. The milestone gate.** `08` is not done until a real run imports and real territory is revealed,
*and* the budget is met on the actual phone, measured, not assumed. **If it is not met, do not
proceed to Phase 2 on a renderer that stutters.**

## Acceptance criteria

- [ ] All seven instruments above exist behind a debug flag and print a single summary table.
- [ ] Synthetic 50k / 150k / 500k cell fixtures are checked in with the generator.
- [ ] The scripted camera path is deterministic and replayable, and its results are recorded in
      `docs/capabilities/08-map-and-fog-renderer.md` with the device model and browser version.
- [ ] `visibleInstanceCount` ≤ 6,000 at every zoom at all three dataset sizes.
- [ ] Mask < 1 ms, composite < 2 ms, frame p95 < 16.7 ms at 150k cells on the target phone.
- [ ] Zero fog-attributable long tasks during the scripted pan.
- [ ] Peak JS heap in the low tens of MB at 500k cells.
- [ ] ★ End-to-end: a real Strava run is imported via Sync and its territory is visible on the phone,
      correctly positioned over the streets actually run.
- [ ] Any lever pulled from the kill-criteria list is recorded in the capability doc with its
      measured before/after, so the tuning history is not lost.
- [ ] `09-roadmap.md` §9.5's "the product, on the actual device" checks are run and their results
      recorded.

## Notes

What is deliberately missing at this point, so nobody files it as a defect (`09-roadmap.md` §2.3):
no XP, no levels, no skills; no `/log` page; **no post-run moment** — no lantern, no fog burning
back, no tally, no level-up cards, the map just *is* revealed the next time you look; no webhook
(Sync is a manual tap and D-013 is knowingly violated until capability `14`); no second map mode and
no cold-territory channel; no `/dev/tickets` UI, chronicle, settings or run detail; no
notifications; stock Protomaps basemap rather than the parchment fork; raw Amplify sign-in; one
hand-made user; and a failed import that surfaces only through the DLQ alarm from 0044.

What is explicitly **not** compromised even here: `activity:read_all` and the full `latlng` stream;
raw archived to S3 before normalize; deterministic `activityId` and the receipt ledger; no Strava
type outside `src/adapters/strava/`; and cells carrying timestamps rather than a presence bit.

If the custom layer defeats the schedule entirely, the defined retreat is a GeoJSON-polygon fog
layer in plain MapLibre — ugly, faceted, honest, and it reaches the milestone. It is **not** the
design, it must be recorded as debt with a replacement ticket, and it is a *schedule* retreat rather
than a design change. Take it only against missing the milestone outright.

## Operator validation

This is the USE step, and for this project it means going for a run.

1. Go for a real run — ideally one that includes at least one street you have never run before.
   Upload it to Strava as normal.
2. On the 6.8in Android phone, outdoors, in daylight: open `soles.devaultsecurity.com`, sign in, tap
   **Sync**, wait, reload the map.
3. **The streets you actually ran are revealed, and the ones you did not are not.** Zoom to 17 and
   trace your route by eye against the corridor — it must follow the roads you remember, roughly one
   street wide.
4. At zoom 14, in sunlight: street names inside revealed territory are readable; the fog edge does
   not shimmer while you pan; names outside are hidden.
5. Pan and pinch continuously for a full minute while walking. No stutter, no dropped frames you can
   feel, no heat build-up that makes the phone uncomfortable.
6. Lock the phone, wait two minutes, unlock and return to the tab. The map is still there and did not
   burn battery while hidden.
7. Show it to someone who does not know the project and see whether they can tell, unprompted, which
   streets you have run. If they cannot, legibility (D-051) has failed regardless of what the frame
   timings say.
