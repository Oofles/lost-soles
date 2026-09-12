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
- [x] The scripted camera path is deterministic and replayable, and its results are recorded in
      `docs/capabilities/08-map-and-fog-renderer.md` with the device model and browser version.
      *`camera-path.test.ts` replays it and asserts the two runs visit identical states. The recorded
      baseline names `HeadlessChrome/152.0.0.0` and `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device
      (Subzero)), SwiftShader driver)` on the development machine. **Amended by D-240**: the row was
      to name a phone; there is no phone run.*
- [x] `visibleInstanceCount` ≤ 6,000 at every zoom at all three dataset sizes.
      *Failed at 10,394 (z13.5); `0201` fixed the zoom table's bounds. Re-measured 2026-09-11:
      **5,273 peak at z14.0, identical at 50k / 150k / 500k**, and the cross-dataset canary passes —
      from z13 up the count does not grow with dataset size.*
- [x] (operator) Mask < 1 ms, composite < 2 ms, ~~frame p95 < 16.7 ms~~ **frame p50 ≤ 17 ms with
      under 1% of frames dropped (D-241)** at 150k cells ~~on the target phone~~ **on the desktop
      browser (D-240)**.
      — verified 2026-09-11: on the operator's desktop (Chrome 151, RTX 3070 via ANGLE/D3D11,
      1902×901) — **mask 0.474 ms mean / 2.777 ms max; composite 0.862 ms mean / 2.322 ms max;
      pan-across p50 16.70, 0 dropped of 238; pan-z17 p50 16.60, 0 dropped of 119.**
      *`p95 < 16.7 ms` was unmeasurable — rAF fires once per refresh, so on a 60 Hz display an
      on-time frame's delta IS 16.7 ms and the budget was the floor rather than a ceiling. D-241
      restates it. `EXT_disjoint_timer_query_webgl2` exists in desktop Chrome and nowhere else this
      project can run, so the desktop is the only surface that could ever answer the first two.*
- [x] (operator) Zero fog-attributable long tasks during the scripted pan.
      — verified 2026-09-11: on the operator's desktop, **0 during the pan phases** (12 outside them,
      in load and zoom, which §6.4 does not assert on).
      *It was expected to fail — up to 20 ms of derivation ran inside a single pan cull. It did not,
      because a 20 ms block is under the 50 ms `longtask` threshold. `0202` removed it anyway and
      the operator confirmed by eye that the pan has no felt hitch.*
- [ ] Peak JS heap in the low tens of MB at 500k cells.
      **MEASURED AND STILL FAILING: 97.0 MB over baseline at 500k, 76.9 MB at 150k; 50k passes.
      Ticket `0203`.** *This is the only budget in §6.4 that is still missed. `ExploredSet` keeps a
      `Set<string>` of every cell id beside the `BigUint64Array`; §6.3 already names the exit and
      `explored-set.ts`'s `has()` already points at it. 50k — roughly where the operator is — passes
      comfortably, so it bites from about year one rather than today.*
- [ ] (operator) ★ End-to-end: a Strava run is imported via Sync and its territory is visible ~~on
      the phone~~ **on the desktop browser (D-240)**, correctly positioned over the streets actually
      run.
      *Amended 2026-09-11: **an archived activity re-synced**, not a run performed for this ticket.
      D-229 (2026-09-09) postdates this ticket and forbids asking the operator to run for test data;
      a past activity is the same real trace through the same real adapter, pipeline and Sync tap,
      and the operator recognises the streets either way. Operator agreed before any code was
      written. See D-239.*
      *Amended again, later the same day, after checking production rather than assuming it: **the
      import has already happened eleven times** — 759 cells from nine outings, all verified to
      decode to Nocatee — so there is nothing left to re-sync and no import to stage. The watermark
      and the receipt ledger both make a re-sync a correct no-op. **What remains is only the
      perceptual half**, which was always the only half that was the operator's. See §B.*
- [x] Any lever pulled from the kill-criteria list is recorded in the capability doc with its
      measured before/after, so the tuning history is not lost.
      ***No lever was pulled.** The mask scale is still 0.5×, the animation still runs at its
      original rate, and fBm still has its original octave count. The frame budget was met without
      any of them — what was actually wrong was the zoom table (`0201`), derivation on the frame path
      (`0202`) and a buffer outliving its viewport (`0207`), none of which §6.4 anticipated. That is
      worth recording precisely because the kill criteria were the prepared answer and turned out not
      to be the needed one.*
- [ ] (operator) `09-roadmap.md` §9.5's "the product, on the actual device" checks are run and their
      results recorded. *Two of its six rows are out of scope at this milestone and are recorded as
      such rather than ticked: the post-run sequence does not exist (this ticket's own Notes say so)
      and D-148's gold/chrome rules belong to capability `13`. §9.5's preamble says "the user's own
      Android phone (D-124), not a simulator" — **D-240 moves that to the desktop browser** and §9.5
      needs the same amendment when `09-roadmap.md` is next touched.*

## Notes

### 2026-09-11 (later) — seven of ten criteria met; three remain

`0201`, `0202` and `0207` are closed and the operator has confirmed both perceptual checks. Where
§6.4 now stands, measured on the operator's desktop (Chrome 151, RTX 3070, 1902×901) and on the
headless harness at the 400×800 reference viewport:

| item | result | |
|---|---|---|
| 1 `visibleInstanceCount` | 5,273 peak at z14.0, identical at 50k / 150k / 500k | **PASS** |
| 2 GPU mask / composite | 0.474 ms / 0.862 ms mean | **PASS** |
| 3 frame, pan phases | p50 16.70, **0 dropped** of 238 and of 119 | **PASS** (D-241) |
| 4 cull, net of derivation | 0.20 ms max; 0 culls inside the padded region | **PASS** |
| 5 bucket derivation + hit rate | recorded; ~78% | — |
| 6 long tasks during pan | 0 | **PASS** |
| 7 peak JS heap | 97.0 MB at 500k, 76.9 MB at 150k | **FAIL — `0203`** |

**No kill-criteria lever was pulled.** The mask scale, the animation rate and the fBm octave count are
all unchanged. §6.4 prepared three levers for a frame-time problem and the frame time was never the
problem: a wrong zoom band, derivation on the frame path, and a buffer outliving its viewport were,
and §6.4 anticipated none of them.

**What is left, and none of it is a number:**

1. **Criterion 7 — heap.** The one budget still missed. `0203` is filed with the fix already named.
   Whether it blocks this milestone is the operator's call: 50k passes comfortably and 150k is
   roughly year one.
2. **Criterion 8 — the ★ end-to-end.** Re-sync an archived activity and look at the map. Not done.
3. **Criterion 10 — §9.5's table** on the desktop browser. Not done.

---

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

**Amended twice. Read D-239 and D-240 before this section.**

- **D-239** — the `★` criterion is satisfied by **re-syncing an archived activity**, not by going for
  a run. D-229 postdates this ticket and forbids the latter.
- **D-240** — **there is no phone run.** The operator declined it and the reasoning is recorded there:
  D-227 already made the desktop the viewing surface, and the actual device is a Pixel 10 Pro rather
  than the mid-range Android §6.3's budget is written for, so a phone reading would have measured the
  wrong end of the range. D-230's ANGLE risk is accepted into ordinary use.

**Everything reachable without a browser has already been run by the agent** and is recorded in
`docs/capabilities/08-map-and-fog-renderer.md`: the instruments against a real MapLibre Map
(`run-perf.mjs`), the React against a fake one (`run-overlay.mjs`), 79 unit tests, and the fixtures
round-tripped through the shipped writer and reader.

**What is left is one short desktop session**, and it is the one combination nothing above covers:
the real map, real basemap tiles, the real fog and the real overlay in one page.

### A. `?fog=perf` on the desktop browser — one URL

`soles.devaultsecurity.com/?fog=perf:here` → **Run scripted path** → wait → **Copy**.

`here` regenerates 151,201 synthetic cells around wherever the map already is, so the fog sits over
real tiles. The panel says `SYNTHETIC — NOT this account's territory` throughout; that ground is not
yours and nothing is written anywhere.

It takes ~12 s if all is well. If it takes longer the panel now says so itself — it shows the phase,
the step count, the elapsed clock, and a warning when a single step has taken more than 8 s. There is
a **Cancel** button, and cancelling still produces the table over whatever ran.

**This section is already done — recorded 2026-09-11, and kept here as the reproduction recipe.**
When it was written it warned to expect three FAILs; `0201` and `0202` have since been fixed and
verified, so **item 7 (heap, `0203`) is the only FAIL left**. Item 3's `p95 < 16.7 ms` was not a
budget that could be met or missed — D-241 restates it — so the row that decided capability `08`
turned out to be readable only after the restatement.

Optionally also `?fog=perf:here:500k` for the year-five volume. Skip it if the 150k run is slow.

### B. The fog on real ground — the judgement half

**Nothing needs re-syncing, and this section used to say otherwise.** Checked against production on
2026-09-11 (the smoke test below): the import half of the `★` criterion has already happened
**eleven times**, most recently that morning, each through the real adapter, the real pipeline and
the real Sync tap. There is no archived activity waiting to come in, and pressing Sync will
correctly report that.

Two gates make a re-sync a guaranteed no-op, and both are working as designed. The **watermark**
sits at 2026-09-09T01:06Z and `listSince` starts there, so nothing older is even listed; and
`needsEnqueue` reads the **receipt ledger**, so a re-listed activity that is already `DONE` counts
as `alreadyKnown` and is never enqueued. Demonstrating an import would have meant rewinding the
watermark — spending provider quota to permanently reveal ground on a map that by D-020 can never
re-fog, to re-prove the half that is already proved.

That leaves the half no smoke test can reach: **whether the fog is over the streets you actually
ran.** I can prove the cells decode to Nocatee; only you can say they trace the roads.

1. `soles.devaultsecurity.com`, sign in, tap **Sync** once.
   **"Nothing new" is the expected and correct answer** — see above. Tap it anyway: the access token
   expired at 2026-09-11T02:30Z and `0094`'s scheduled refresher does not exist yet, so this press
   is what proves the on-demand refresh path still works from a cold token. If it instead asks you
   to reconnect, that is a real finding and the map half can still go ahead without it.
2. Zoom to **17** over the revealed ground and trace a route by eye. It should follow roads you
   remember, roughly one street wide — nine distinct outings are in there, the largest 322 cells
   over a 1.45 km radius from 2026-08-30.
3. At zoom **14**: street names inside revealed territory are readable, names outside are hidden,
   and the fog edge does not shimmer while you pan. (D-051 — legibility beats atmosphere, and it is
   a direction rather than a trade-off.)
4. Pan and pinch for a minute. `0202` and `0207` both landed after the last time anyone looked at
   real ground, so this is the first sight of the fog with derivation off the frame path and z17
   drawing a buffer built for z17. The hitch `0202` predicted should be gone.
5. `prefers-reduced-motion` renders the fog static and stops the rAF loop.

#### Smoke test — where the territory actually is (agent, 2026-09-11)

Every row of `LostSolesExploredCell` decoded through `h3-js` and reported by cluster. **781 rows =
759 res-11 run cells + 21 `AGG#6/7/8` coverage aggregates + 1 `GEN` generation row**, all accounted
for. The run cells fall between **30.112–30.140 N and −81.430 to −81.360 W** — Nocatee — in nine
clusters of 0.14–1.45 km radius, one per imported activity, each matching its receipt's
`newCellCount` exactly.

That proves the geography and the volume. It cannot prove the *shape*, which is why step 2 exists:
cells in the right square kilometre still say nothing about whether they follow the road.

*A first pass at this check reported a 6,950 km spread and a centroid in the Atlantic. The fault was
the check, not the data — it called `cellToLatLng` on the `GEN` row's sort key, which is the literal
string `GEN` rather than an H3 index, and h3-js returns a nonsense coordinate instead of throwing.
Recorded because the failure is silent and this table will be scanned again.*

### C. §9.5's table — what is in scope at this milestone

Record rather than tick. **Two of its six rows are out of scope**: the post-run sequence does not
exist and D-148's gold/chrome rules are capability `13`. §9.5's own preamble still says "the user's
own Android phone"; D-240 supersedes that and the doc needs the amendment when it is next touched.
