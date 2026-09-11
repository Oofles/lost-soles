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
started: 2026-09-11T13:28:53Z
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

- [x] All seven instruments above exist behind a debug flag and print a single summary table.
- [x] Synthetic 50k / 150k / 500k cell fixtures are checked in with the generator.
- [ ] (operator) The scripted camera path is deterministic and replayable, and its results are
      recorded in `docs/capabilities/08-map-and-fog-renderer.md` with the device model and browser
      version. *Deterministic and replayable is proved by `camera-path.test.ts` and the desktop
      baseline is recorded; the row naming a **device model** is the operator's to supply.*
- [ ] `visibleInstanceCount` ≤ 6,000 at every zoom at all three dataset sizes.
      **MEASURED AND FAILED: 10,394 at z13.5, identical at all three sizes. Ticket `0201`.**
- [ ] (operator) Mask < 1 ms, composite < 2 ms, frame p95 < 16.7 ms at 150k cells on the target
      phone. *`EXT_disjoint_timer_query_webgl2` is absent on Chrome for Android, so the per-pass
      split is a desktop reading and p95 is the phone's — the summary table says which is which.*
- [ ] (operator) Zero fog-attributable long tasks during the scripted pan.
- [ ] Peak JS heap in the low tens of MB at 500k cells.
      **MEASURED AND FAILED: 90.3 MB over baseline at 500k, 73.7 MB at 150k; 50k passes at 32.8 MB.
      Ticket `0203`.**
- [ ] (operator) ★ End-to-end: a Strava run is imported via Sync and its territory is visible on the
      phone, correctly positioned over the streets actually run.
      *Amended 2026-09-11: **an archived activity re-synced**, not a run performed for this ticket.
      D-229 (2026-09-09) postdates this ticket and forbids asking the operator to run for test data;
      a past activity is the same real trace through the same real adapter, pipeline and Sync tap,
      and the operator recognises the streets either way. Operator agreed before any code was
      written. See D-239.*
- [ ] Any lever pulled from the kill-criteria list is recorded in the capability doc with its
      measured before/after, so the tuning history is not lost.
- [ ] (operator) `09-roadmap.md` §9.5's "the product, on the actual device" checks are run and their
      results recorded. *Two of its six rows are out of scope at this milestone and are recorded as
      such rather than ticked: the post-run sequence does not exist (this ticket's own Notes say so)
      and D-148's gold/chrome rules belong to capability `13`.*

## Notes

### 2026-09-11 — the harness landed; the device rows are what remain

Everything in job 1 is built, tested and deployed-ready; job 2 needs the phone. The desktop baseline,
the split between what each surface can measure, and the three findings are written up in
`docs/capabilities/08-map-and-fog-renderer.md` under *"The perf harness, and what its first run
found"*. Files: `lib/fog/perf/{synthetic,gpu-timer,collector,camera-path,report,dataset-source,harness}.ts`,
`components/map/perf-overlay.tsx`, `tools/fog-harness/{perf-harness.js,run-perf.mjs}`,
`public/fog-fixtures/*.bin`, plus hooks into `zoom-buckets.ts`, `viewport-controller.ts`,
`mask-layer.ts`, `debug-flags.ts`, `explored-provider.tsx`, `use-fog-mask.ts` and `map-shell.tsx`.

The React glue is proved too, in a browser: `tools/fog-harness/run-overlay.mjs` renders the real
provider and the real overlay against a fake MapLibre Map and drives the whole run. It found that the
`SYNTHETIC — NOT this account's territory` line rendered only while loading and vanished once the
dataset arrived — on `?fog=perf:here` that is synthetic ground over the operator's own neighbourhood
with nothing on screen saying so. Fixed; it is now always visible.

**Three findings, filed rather than folded in** — none is a regression, all three are the design
meeting measurement for the first time:

- `0201` — `ZOOM_TO_RES` gives res 11 from z13.0 rather than z14, so the instance peak is 10,394 at
  **z13.5** against §6.4's 6,000. Identical at 50k / 150k / 500k, so it is the zoom table and not the
  data. §6.4's recorded *"peak is 5,271 at z14"* reproduces exactly — it only ever sampled integer
  zooms, which is the argument for a scripted path over a spot check.
- `0202` — group geometry is derived inside `cullBucket`, on the frame path. The cull itself is
  0.1-0.4 ms and does its job; a single pan into new ground cost 19.6 ms of synchronous main-thread
  work. §6.3 budgets those on two separate rows and the code runs one inside the other.
- `0203` — peak heap is 73.7 MB at 150k and 90.3 MB at 500k, against §6.4's *"low tens"*. 50k passes.

**`0201` and `0203` mean two acceptance criteria are measured and failing.** They are left unticked
with the numbers written on them. They are not `0059`'s to fix: this ticket's kill criteria are about
frame time and its levers are the mask scale, the animation rate and the fBm octaves — none of which
touches a zoom band or a `Set`.

Also filed: `0204`, a false positive in `scripts/check-design-tokens.mjs`, which reads the TypeScript
private member `this.#acc()` as the CSS colour `#acc`.

**What the next session needs:** the three screenshots from section A and the phone's model. With
them, item 3 decides whether capability `08` is done and whether any kill-criteria lever gets pulled.

---

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

**Amended 2026-09-11.** Step 1 used to say *"go for a real run"*. **D-229 (2026-09-09) postdates this
ticket and forbids exactly that** — the app exists to encourage running, and running to service a
validation task inverts the whole point. An archived activity re-synced is the same real trace
through the same real adapter, the same pipeline and the same Sync tap; the streets are recognisable
either way. Operator agreed before any code was written (D-239).

**The phone is right here and is not a D-229 violation.** D-227 and D-230 both name `0059` by name as
the ticket that owns the real mid-range Android — D-230 parked the *"does Qualcomm/Mali ANGLE honour
`MIN`/`MAX` into an `R8` target"* question here deliberately. This is the one ticket in the project
whose subject is the phone. The operator re-confirmed it for this instance.

**Everything reachable without the device has already been run and is recorded in
`docs/capabilities/08-map-and-fog-renderer.md`.** What is below is only what a device answers.

### A. The numbers — three URLs, three screenshots

On the 6.8in Android phone, in Chrome. Each is: open, tap **Run scripted path**, wait ~12 seconds,
tap **Copy** (or screenshot the table).

1. `soles.devaultsecurity.com/?fog=perf:here` — the 150k disc regenerated around wherever the map
   already is, so the fog sits over **real basemap tiles**. This is the frame-time reading and the
   only one that answers §6.4 item 3.
2. `soles.devaultsecurity.com/?fog=perf:here:500k` — the same, at year-five volume.
3. `soles.devaultsecurity.com/?fog=perf:500k` — the checked-in fixture. It flies to 30°N 100°E where
   there is no basemap, which is expected and is why it is third: it answers the instance count and
   the heap, neither of which the basemap affects.

Also needed for the record, and both are printed at the top of the table: **the phone's model** and
the `renderer` line. D-230 wants the second one specifically.

**Expect item 1 and item 7 to say FAIL** — `0201` and `0203` are already filed for them and the
phone will reproduce what the desktop measured. The row that decides whether capability `08` is done
is **item 3, frame p95 < 16.7 ms**, on URL 1.

### B. The fog, on real ground — the judgement half

Re-sync an activity you remember, then look at the map. **No new run.**

1. Open `soles.devaultsecurity.com`, sign in, tap **Sync**, wait, reload the map.
2. **The streets in that activity are revealed and the ones around them are not.** At zoom 17, trace
   the route by eye — it must follow the roads you remember, roughly one street wide.
3. At zoom 14, in daylight: street names inside revealed territory are readable; the fog edge does
   not shimmer while you pan; names outside are hidden. (D-051 — legibility beats atmosphere, and it
   is not a trade-off.)
4. Pan and pinch continuously for a full minute. No stutter you can feel, and no heat build-up that
   makes the phone uncomfortable.
5. Lock the phone, wait two minutes, unlock and return to the tab. The map is still there and did not
   burn battery while hidden.
6. Show it to someone who does not know the project: can they tell, unprompted, which streets you
   have run? If they cannot, legibility has failed regardless of what the timings say.

### C. §9.5's table, on the desktop browser

Run on the desktop (D-227), not the phone, and record the result rather than ticking:
`prefers-reduced-motion` renders the fog static and stops the rAF loop; street names are legible in
both modes at planning zoom. **Two rows are out of scope at this milestone** — the post-run sequence
does not exist yet and D-148's gold/chrome rules are capability `13` — and are recorded as `n/a` with
that reason rather than as passes.
