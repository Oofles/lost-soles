---
id: 101
slug: map-controls-and-run-inspection
title: Map controls, gestures, and inspecting a past run over the fog
type: feature
priority: med
status: closed
size: m
capability: 15-two-map-modes-and-cold-territory
depends_on: [98, 90]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
started: 2026-10-19T20:41:49Z
closed: 2026-10-20T12:46:49Z
---

## Description

The full gesture and control set for the map screen (`06-ui-ux.md` §4.4) and the run-inspection
interaction (§4.5).

Input, per D-253 (mouse and keyboard; supersedes §4.4's touch table):

| Input | Does |
|---|---|
| Drag | Pan, inertia on, rubber-band at bounds |
| Wheel / trackpad pinch | Zoom anchored at the cursor, z10 → z18 |
| Double-click | Zoom in one step, anchored at the cursor |
| Arrow keys / `+` `−` | Pan / zoom one step |
| Toggle control (top-left) or its shortcut | Toggle atlas / adventure (0098) |
| Click on a route line | Inspect that run, 24 px hit slop |
| **Click on empty map** | **Nothing — deliberate** |
| Click `⌖` | Recentre on the last run's end point, z14 |
| Click the fit-territory control (small, next to `⌖`) | Fit the whole territory in view |
| Drag the plinth handle up | Chronicle sheet |

~~Two-finger tap → zoom out one step~~ and the wet-screen multi-contact rule are dropped *(D-253)*.

**Rotation and tilt are disabled; bearing locked north-up, pitch locked to 0.** A rotated street
map with no compass is a map you cannot navigate by, and a compass is a control that exists only
to undo an accident. Tilt buys nothing without 3D buildings and costs label legibility at the
horizon. D-051 decides both.

**Zoom bounds z10–z18**, both rubber-banding rather than hard-stopping. Below z10 the fog's zoom
bucketing coarsens territory into a smear that misrepresents what has been explored; above z18 the
basemap has nothing left to show.

**Clicking empty map does nothing, on purpose.** A cell inspector ("you last ran here 211 days
ago") is a stats organ that turns the map into a database browser. The one piece of that
information that helps a decision is rediscoverability, and 0100 shows it as colour instead of
hiding it behind a click.

**Three route layers, all above the fog** (05 §4.4): the accumulated trace web, the selected run,
and the live corridor. On `/` the trace web is always drawn and the last run is selected; on
`/run/:id` the web dims to 0.18 beneath the selected run. Route colour is fixed — warm cream core
`#fff2d0` with an amber `#ffb347` glow — because it is the one combination that survives both
parchment and near-black fog. Pure white blows out on parchment; pure red disappears into it.

Inspecting: click within 24 px of a line. One match → highlight immediately and show a one-line
chip (date · distance · new cells) clicking through to `/run/:id`. Multiple matches → a
disambiguation card anchored above the click point, flipping below near the top edge, ~~48 px~~
32 px rows *(amended at build, operator Q3: D-313 sets 32 px for ordinary rows and postdates this
ticket)*, five rows then scrolls, never a full sheet.

## Acceptance criteria

- [x] Every row of the §4.4 table is implemented and covered by an interaction test, including
      "click on empty map does nothing" asserted as no navigation, no sheet, no state change.
      *(The repo's vitest runs in `node` with no DOM, so these are pure and fake-map tests plus a
      real-Map harness, as `0098` and `0285` did. The plinth drag-handle row is gone with the handle
      (D-313, §4.4), and the toggle row is `0098`'s, already tested in `lib/map-mode.test.ts`.)*
- [x] `map.getBearing() === 0` and `getPitch() === 0` after right-drag / Ctrl-drag (MapLibre's
      dragRotate and pitch handlers); rotation and tilt handlers are disabled at the map options
      level, not swallowed in a listener.
- [x] Zoom clamps to [10, 18] with rubber-band overshoot that settles back; a test asserts the
      settled zoom is within bounds after an over-zoom in both directions.
- [x] Click within 24 px of exactly one route line selects it and shows the one-line chip; click
      with three lines within 24 px shows the card with three ~~48 px~~ 32 px rows in
      date-descending order. *(Amended at build, operator Q3: 32 px per D-313.)*
- [x] The card flips to below the click point when the click is within its own height of the top
      edge.
- [x] Route layers render above the fog in both modes, with the tabled per-mode opacities; on
      `/run/:id` the trace web is at 0.18. *(Amended at build, operator Q1 = A, Q2 = B. "Above the
      fog in both modes" covers the **selected run**, which is topmost in both. The trace web sits
      above the fog in atlas only (D-368) and below it in adventure (D-299/D-307). The "tabled
      opacities" are what shipped, and 06 §4.5's table is rewritten to match: the glow is 0.35 in
      adventure and 0 in atlas (`0098` Q4), the core is unchanged, and the web is D-299's
      k × wear in both. "At 0.18" is a proportional dim, k = 0.18 / 0.28, so a path run once reads
      0.18.)*
- [x] Route colours are the fixed cream/amber pair, read from one constant, not per-mode palette.

## Notes

~~The long-press is doing double duty (mode toggle on empty map, nothing on a route line). Resolve
by hit-testing the route layers first: a long-press that begins on a route line within 24dp is a
press on that line and must not toggle modes, or planning users will flip modes by accident every
time they hesitate over a route.~~ *(Superseded by D-253: the mode toggle is a control, not a map
gesture, so there is no double duty.)*

~~`06-ui-ux.md` §9.6 requires multi-contact taps to be treated as pans (wet screen). That
interaction rule belongs to 0112 but it interacts with the two-finger tap for zoom-out — implement
two-finger tap with a tight time and movement threshold so a wet palm reads as a pan.~~ *(D-253:
two-finger tap and the wet-screen multi-contact rule are dropped.)*

- **Amended by D-313 (0187, 2026-10-15).** No hover card on a route line: hover changes the cursor only, a click shows the card (`06` §4.5). Fit-to-territory and `⌖` are positioned on the map pane, never under the rail.

## Operator validation

In the desktop browser, on `/`: pan, wheel-zoom, double-click, use the keyboard, hit `⌖` and the
fit-territory control (confirm the whole territory fits). Try to rotate or tilt (right-drag,
Ctrl-drag) — it must not budge. Click where several runs overlap: the card appears above the
cursor with all three dates readable; repeat at the top edge and confirm it flips below.

**Result (operator, 2026-10-20, desktop browser, `/` and `/run/:id` on the deployed site, build 419):** all checks good.
Pan, wheel, double-click and keys work; right-drag and Ctrl-drag do not rotate or tilt; the `⤢`/`⌖` stack reads
and clears the attribution; the overlap card reads above the cursor at 32 px rows and flips below at the top
edge; a single-line click visibly moves the selection; on `/run/:id` the dimmed web (k ≈ 0.64) sits beneath the
selected run; fit framing the region in view (D-388) felt right.
**Agent smoke (2026-10-19, deployed site):** signed out, `/api/runs/summary?ids=x` returned 404. A throwaway Cognito
user (`smoke-0101-…`) signed in through the real Authenticator in headless Chromium, and all 11 checks passed:
400 for no ids, empty ids, `a,../b` and 26 ids; `own,foreign,unknown` returned 200 `no-store, private` with only the
own seeded run (date, distanceM 8400, newCellCount 21); unknown alone returned `{"runs":[]}`. Cleanup confirmed:
both seeded T3 rows deleted, user `UserNotFoundException`, no S3 objects, 0 rows for the sub in all six tables,
Activity back to 116. `run-map-controls.mjs` printed MAP CONTROLS HARNESS PASS: bearing and pitch stayed 0 under
right-drag and Ctrl-drag, zoom settled 18.5→18 and 9.5→10, glow was 0.35 in adventure and 0 in atlas, web k 0.643.

## Resolution

Built after a D-152 stop. The operator answered four questions on 2026-10-19:
- **Q1 = A:** the trace web stays as shipped, and 06 §4.5's table is rewritten to match.
- **Q2 = B:** the run page dims the web proportionally, with k = 0.18 / 0.28.
- **Q3:** card rows are 32 px, per D-313.
- **Q4 = A:** a new `GET /api/runs/summary?ids=…` serves the facts.

The smaller choices were agreed as proposed: the rubber band runs 9.5–18.5, fit-to-territory frames the trace-web box, rows click through to `/run/:id`, and the tests are pure and fake-map.

One placement differs from the "side by side" that was agreed. 06 §2.2 rows 6 and 8 put fit directly *above* `⌖` on the right edge, so they are built stacked. See below for the fit fallback.

### How it works

- **Input model, `lib/map-controls.ts` (new).**
  - `MAP_INPUT_OPTIONS` is spread into `new Map(...)` in `components/map/map-shell.tsx`. Rotation and tilt are off at the options level: `dragRotate: false`, `pitchWithRotate: false`, `touchPitch: false`, `rollEnabled: false`, `minPitch`/`maxPitch: 0`.
  - MapLibre has no option for two rotations: Shift+arrows, and a touchpad's two-finger twist. `lockOrientation` turns each off through its own handler's `disableRotation()`. That is the handler itself, not a listener.
  - Drag-pan with inertia, wheel and pinch zoom at the cursor, double-click zoom and the keyboard are MapLibre's own handlers. They are named `true` in the options so that a change of default cannot silently remove one.
  - The Map is always built north-up and flat. A stored camera's bearing, `?at=`'s and the first-load jump no longer carry a bearing.
- **The rubber band.**
  - `minZoom`/`maxZoom` are 9.5 and 18.5, so a gesture overshoots by half a level.
  - On `moveend`, `settleZoom` clamps into [10, 18] and the map eases back in 250 ms (0 under reduced motion).
  - The settle's own `moveend` stores the camera, so an out-of-range zoom is never written.
- **`⌖` and fit, `components/map/map-controls.tsx` (new), mounted by `MapShell` on home only.**
  - At ≥1024 px they are two 40 px buttons on the pane's right edge, with fit 8 px above `⌖` and `⌖`'s bottom 36 px up so the attribution stays clear (§2.2 rows 6 and 8).
  - Below 1024 px they stack under jump-to, because the plinth card's height varies (06 §2.2 amended).
  - `recentre` eases to the last run's end point at z14.
  - `fitTerritory` frames the box of every trace-web point with 12% padding, never past z18.
  - When that box needs a zoom below z10, the floor wins and fit frames the D-381 region in view, or the nearest region (`territoryTarget`). The operator's runs span states, so "the whole territory" cannot fit above z10. Recorded as D-388.
- **Inspection, `lib/route-inspect.ts` (new, pure).**
  - Hit-testing uses the web's per-run inputs, plus the latest run when the web lacks it. The drawn web draws each stretch of ground once (D-299), so its features belong to no single run.
  - A click's box of ±24 px, in degrees, rejects whole runs and segments before anything is projected. Bearing is locked, so the box is axis-aligned.
  - `inspect` is the one transition function. An empty click with nothing open returns the *same object*: that identity is "no state change". An empty click, `Esc`, or a dismiss closes what is open.
  - One hit gives a chip and that run's line becomes the selected run: `MapShell` sets the `runs` source's data, after `useLatestRun`'s effect. Several hits give a card with "N runs pass here" and 32 px rows, newest first, five rows then it scrolls.
  - `placeBox` puts the chip or card above the click and flips it below within its own height of the top edge. It stays 8 px off the sides and is anchored on the ground, so a pan carries it.
  - Hover only sets the canvas cursor to `pointer` within 24 px, throttled to one test per frame.
- **The facts endpoint: `GET /api/runs/summary?ids=a,b` (`app/api/runs/summary/route.ts` and `runFacts` in `lib/runs/server.ts`).**
  - The uid comes from the session only. A signed-out caller gets the middleware's 404.
  - `parseSummaryIds` dedupes and caps the list at 25, each id matching `[A-Za-z0-9_-]{1,128}`. Anything else is a 400.
  - Each id is one base-table `Query`, the SSR role's existing grant, with no new IAM.
  - A row that is not the caller's is left out exactly as a missing one is, so the route is no oracle for which ids exist.
  - The body is `no-store, private`. There are no S3 reads.
  - `fetchRunFacts` asks in chunks of 25.
  - Row text is `Fri 28 Aug · 8.40 km · 21 new`, with the year only when it is not this year. Until the facts land, a row shows the date alone.
- **The run page's dimmed web, `lib/trace-web/layer.ts`.**
  - A settled k is held per map: `setTraceK` and `traceK`, with `RUN_PAGE_TRACE_K` = 0.18 / `WEAR[0]`.
  - `useTraceWeb(map, k)` sets it, passing `RUN_PAGE_TRACE_K` on `/run/:id` and 1 on `/`.
  - The steady layer is added at k, or at 0 while a beat holds it.
  - `installWebBeat` cross-fades both halves *within* k. Its `remove()` restores k, not 1.
  - Beat 1's no-new-ground ink (`installTraceInk`) still inks at `WEAR_MAX` and fades out as the dimmed web fades in. It is left as it was.

### Docs

- 06 §4.5: the route-layer table is rewritten to what shipped, plus the dim and the row text and endpoint.
- 06 §4.4: rows for the rubber band and the fit fallback.
- 06 §2.2: controls below 1024 px.
- `tools/fog-harness/README.md`: documents the new harness.

### Tests

- `lib/map-controls.test.ts`: the options, `lockOrientation`, `settleZoom` in both directions, `⌖`, fit and the region fallback, and a source tripwire that `MapShell` builds with the options, north-up and flat.
- `lib/route-inspect.test.ts`:
  - a 24 px single hit, and a three-hit card date-descending;
  - segment distance;
  - the latest run before the web carries it;
  - empty click returns the identical state, and a source check that the click handler navigates and opens nothing;
  - dismissal, 32 px rows, five-row cap, row text, and the flip at exactly its own height.
- `lib/runs/run-facts.test.ts`: rows from the shipped `activityItem`, ownership, tombstoned rows, and `parseSummaryIds`.
- `app/api/runs/summary/route.test.ts`: the session uid, a signed-out 404, the query-string uid ignored, a 400 with no read, the cache header, and GET only.
- `lib/trace-web/layer.test.ts`: the proportional k, the beat within k, `remove()` restoring k, and a mid-beat steady layer at 0.
- `tools/fog-harness/run-map-controls.mjs` (new): a real Map with real DOM events.
  - Right-drag and Ctrl-drag leave bearing and pitch at 0, while the same events rotate a control Map on defaults.
  - The wheel peaks at z18.5 and z9.5 and settles at 18 and 10.
  - In both variants the route is topmost above the fog, the glow is 0.35 / 0, the core is unchanged, and the web is at k = 0.643.
  - Stable 5 of 5 runs. With `dragRotate: true` and `maxPitch: 60` it fails 3 checks.
- `run-mode-swap.mjs` still passes.

### Not done

- There are no pan bounds. "Rubber-band at bounds" is read as the zoom bounds, because the plan defines no pan bounds.
- Inspection is home only. The run page has its own selected run and sequence.
