---
id: 98
slug: atlas-adventure-toggle
title: The atlas / adventure toggle — uniforms, style variants, 320 ms cross-fade
type: feature
priority: high
status: closed
size: m
capability: 15-two-map-modes-and-cold-territory
depends_on: [97, 59]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
started: 2026-10-19T15:53:10Z
closed: 2026-10-19T20:37:39Z
---

## Description

Implement the D-052 two-mode toggle: **atlas** (high legibility, for deciding where to run
tomorrow) and **adventure** (full atmosphere, for looking at what you have done).

Mechanically the toggle is a **shader-uniform swap plus a style-variant swap, entirely
client-side**, with no path back to scoring (05 §5.4). Values are fixed by 05 §5.2 and are not a
palette opinion:

| | Atlas | Adventure |
|---|---|---|
| `u_maxOpacity` | 0.55 | ~~0.94~~ 0.90 (never above 0.94, never 1.0) |
| `u_noiseAmp` | 0.10 | ~~0.30~~ 0.25 |
| `u_time` | frozen ~~at 0~~ where it stood (noise animation off, D-375) | 30 fps drift |
| `u_rimAmt` | 0.08 | 0.30 |
| `u_fogDeep` / `u_fogEdge` | (0.10,0.11,0.14) / (0.30,0.32,0.36) | (0.035,0.045,0.075) / ~~(0.22,0.24,0.30)~~ (0.27,0.29,0.35) |
| Mask FBO scale | ~~0.75×~~ 0.5× | 0.5× |

*Amended 2026-10-19 (operator, D-152 answers Q2/Q3): adventure is `0119`'s tuned rendering, the
look that shipped before the toggle, not §5.2's original sketch; both modes draw the mask at 0.5×,
because a resolution cannot be cross-faded and changing it moves the edge (05 §5.4).*
| Route polyline | thin, precise, above everything | cream core + amber glow (06 §4.5) |

**Transition: a uniform 320 ms cross-fade, and the camera does not move.** Centre, zoom, bearing
and pitch are byte-identical before and after the toggle. ~~The two renders are cross-faded over
320 ms with a single shared easing curve — every uniform, every layer, one timeline — so nothing
in the frame appears to arrive before anything else.~~ *(Amended 2026-10-19, operator Q1 = B,
D-374.)* Every fog uniform and the route glow cross-fade over 320 ms on one shared easing curve.
The basemap variant swaps with a diffed `setStyle` at the start of the fade: atlas's labels and
road-fill copies sit on the other side of the fog (D-368), and an opacity animation cannot move a
layer across another, so the road copies appear in one frame and labels change on MapLibre's own
symbol fade. A staggered fade reads as territory changing, which 0099 forbids outright.

Entry point is **a visible toggle control, top-left (as 0086 sketches), plus a keyboard shortcut**
(D-253). Proposed shortcut: `M` — a proposal, adjust it if it collides with MapLibre's keyboard
handler (which owns the arrows and `+`/`−`). ~~Long-press (350 ms) anywhere on the map, with a
haptic tick (06 §4.4).~~ *(D-253)* Default
is **adventure** — it is the product's identity. State persists in `localStorage`: it is a
per-device viewing preference, not user data, and it is not synced. ~~The first time the user opens
a route-planning surface, the app suggests atlas once.~~ *(Dropped, operator
2026-10-19, D-378: no route-planning surface exists, and the toggle is now a visible control.)*

Under `prefers-reduced-motion` or battery saver, adventure falls back to atlas's **static** fog
while keeping adventure's colours (05 §5.2 last row), and the rAF loop stops — that is a §9 MVP
definition-of-done box, checked again in 0112.

## Acceptance criteria

- [x] The visible top-left toggle control and the keyboard shortcut each toggle modes; a plain
      click on the map does nothing (06 §4.4, "click on empty map does nothing"). *(Restated by
      D-253, 0215 — was: long-press 350 ms with one haptic tick.)*
- [x] A test asserts `map.getCenter()`, `getZoom()`, `getBearing()` and `getPitch()` are exactly
      equal before and after a toggle, at three different zoom levels. *(A real `Map` needs WebGL,
      so this is `tools/fog-harness/run-mode-swap.mjs` in headless Chromium — `Object.is` on all
      five numbers across 12 swaps at z12, z15.25, z17.75. `lib/basemap-swap.test.ts` adds the CI
      half: the swap calls no camera method.)*
- [x] The cross-fade is 320 ms ± 16 ms, measured, and every ~~uniform and layer opacity~~ fog
      uniform and the route glow's opacity animates on the same timeline — asserted by sampling
      interpolation progress at t=160 ms across all animated values and requiring a single shared
      value. *(Amended 2026-10-19, operator Q1 = B: basemap layers swap with the style and fade on
      MapLibre's own symbol fade, D-374.)*
- [x] Every uniform in the §5.2 table takes exactly the tabled value in each mode; the values live
      in one exported constant map, asserted by a snapshot test against the table. *(Amended
      2026-10-19, operator Q2: the table is the amended one above — adventure = `0119`'s `V1`.)*
- [x] `u_maxOpacity` never exceeds 0.94 in any mode — a unit test on the constant map.
- [x] Mode survives a reload from `localStorage`; a fresh profile with no stored value gets
      adventure.
- [x] With `prefers-reduced-motion: reduce`, adventure renders static fog in adventure colours and
      the rAF loop is not scheduled (asserted by a spy on `requestAnimationFrame`).

## Notes

**2026-10-13, from `0083`:** the frontier line's click asks for atlas mode through
`requestRenderMode(FRONTIER_MODE)` in `lib/run-moment/mode.ts` — a no-op today, because there is one
rendering. Honour that request when the toggle lands: §3.2 beat 5 says the click recentres "in atlas
mode", and `0083` could only do the recentre.

~~There is no toggle button in the chrome in v1: the long-press is the affordance, and it is
discoverable because the app suggests it once. Adding a floating toggle button means adding
floating chrome, which D-148 requires to be opaque and which competes with the plinth.~~
*(Superseded by D-253: a long-press is undiscoverable with a mouse and unreachable from the
keyboard. The toggle control is chrome, so D-148's opacity rule applies to it.)*

The 320 ms figure is deliberately slower than a UI transition and deliberately faster than an
animation you wait for: long enough to read as one continuous surface changing character, short
enough that a planning user toggling twice does not feel taxed.

## Operator validation

In the desktop browser, on `/`, park the map over a frontier where explored ground meets fog with a
recognisable street feature crossing the boundary. Toggle, watching that feature.
Nothing may translate, scale or jump; the fog changes character in place. Toggle back and forth
five times quickly and confirm the map never drifts. Then enable the OS reduce-motion
setting and confirm the adventure fog stops moving but stays adventure-coloured.

**Result.** Operator, desktop browser, 2026-10-19 — **passed**: toggling with the control and `M` at a z16 frontier, the map does not move; the fog change reads as one change and the labels' own fade is acceptable; atlas labels, the 0.5 road grid and the trace web read over the fog; the control's look and top-left position are right; with OS reduce-motion, adventure's mist stops in its colours and the toggle is an instant cut. Local: `run-mode-swap.mjs` MODE SWAP HARNESS PASS on the merged tree (12 swaps, camera identical by `Object.is`).

Smoke test (orchestrator, after Amplify job 418, commit e5bdae0): `/` 200; `/api/runs/web` signed-out 404; the deployed chunks contain `lost-soles:map-mode`.

## Resolution

Built after a D-152 stop. The operator answered five questions on 2026-10-19:
- **Q1 = B:** the basemap swaps with a diffed `setStyle`, and the uniforms fade over 320 ms.
- **Q2:** adventure is `V1`.
- **Q3:** the mask is 0.5× in both modes.
- **Q4:** atlas fades the route glow to 0, and the core is unchanged.
- **Q5:** 0080's fade becomes 320 ms.

D-375 and D-376 were accepted; Q1 is recorded as D-374, Q2/Q3 as D-377, the frontier click and 320 ms as D-378.

### How it works

- **Mode state, `lib/map-mode.ts` (new).**
  - The saved mode lives in `localStorage` under `lost-soles:map-mode`. Every access is guarded.
  - `initialMapMode` resolves the mode in this order: `?basemap=` (D-370), then the saved mode, then adventure. `basemapFlag` was added to `lib/fog/debug-flags.ts` to support this.
  - A small store (`get`/`set`/`toggle`/`subscribe`) holds the mode. `components/map/use-map-mode.ts` reads it through `useSyncExternalStore`.
  - `ModeFrame` = the fog palette plus the route glow's opacity. `MODE_FRAMES` holds one per mode. `lerpFrame` moves every number by one `t`.
  - `startModeTransition` runs a 320 ms fade on CSS `ease-in-out`, with elapsed time measured from `now()` against rAF timestamps. Under reduced motion it is a synchronous hard cut that never calls rAF. A re-toggle mid-fade starts from the frame on screen.
  - `isModeShortcut` matches `M` with no modifier, never in a text field. MapLibre's keyboard handler owns only the arrows and `+`/`−`, so there is no collision.
- **Per-mode uniforms, `lib/fog/fog-uniforms.ts`.**
  - `ADVENTURE` now holds `0119`'s tuned values; `V1` is an alias of it.
  - `FOG_MODES` is the one exported constant map.
  - `MAX_OPACITY_CEILING` = 0.94.
  - `NOISE_AMP_CEILING` = 0.30. `SEAM_FLOOR`'s derivation now reads this ceiling instead of `ADVENTURE.noiseAmp`, so `mask.ts` is unchanged.
  - `lerpPalette` interpolates between two palettes.
  - Rim values are untouched (0210).
- **`lib/fog/mask-layer.ts`:** `setPalette()` and `palette()`. The composite reads the live palette.
- **`lib/fog/animation.ts`:** `setFrozen()` stops the loop and holds `u_time` where it stood (D-375). Reduced motion still means `u_time = 0`.
- **`lib/basemap.ts`:**
  - `carryAppLayers` is the `transformStyle` for the swap. It carries every non-basemap layer and source into the next style. App layers that sat below the first label (the trace web) go below the next variant's first label; the rest go on top, in their existing order.
  - `swapBasemap` = a diffed `setStyle`, then the fog is moved to `fogBeforeId`.
- **`lib/basemap-style.ts`:** atlas's labels get their own ids (`ATLAS_LABEL_PREFIX`, `atlas_label_*`).
  - Reason: MapLibre's style diff does not compare `metadata`.
  - Under a shared id, a label would keep atlas's above-fog tag after a swap to adventure, and `fogBeforeId` would put the fog under adventure's labels.
  - `lib/basemap-swap.test.ts` reproduces this: with the prefix removed, 5 of its 7 cases fail.
- **`components/map/map-shell.tsx`:**
  - New prop `mode?`; home leaves it unset and gets the saved mode.
  - The map is built in the wanted mode.
  - On a change: `swapBasemap`, then a 320 ms `startModeTransition` that applies the fog palette and the `run-glow` opacity each frame, with `triggerRepaint`.
  - The animator is frozen when a fade to atlas ends and unfrozen when a fade to adventure starts.
  - The glow is re-applied when the route arrives.
  - Nothing touches the camera.
- **`components/map/use-fog-mask.ts`:** new `look` argument. The palette is read when the layer is created; `animated` drives `setFrozen`.
- **`components/map/mode-toggle.tsx` (new), mounted in `components/plinth/home-screen.tsx`.**
  - Two rows, both labels always visible (`role="radiogroup"`).
  - Placement: top-left of the map pane, inset by the rail at ≥1024px.
  - Opaque, per D-148. Gold is the selected row's fill; its text is ink.
  - No row is selected until hydration.
  - In focus order it sits before `⚙` (§2.2).
- **Run page, `lib/run-moment/mode.ts`, `app/run/[activityId]/run-moment.tsx`, `run-sequence.tsx`.**
  - `runPageMode`: adventure while the sequence plays, then the saved mode (so `MapShell` cross-fades back, 06 §3.2), or atlas after a frontier click.
  - That frontier click honours `0083`'s request. It does not change the saved preference.
  - `MODE_CROSSFADE_MS` = 320.
  - `requestRenderMode` was removed in favour of page state.

### Docs

- 05 §5.2: the table now gives adventure's values as `V1`, the mask at 0.5× in both modes, and `u_time` frozen where it stood.
- 05 §4.3: the 0.90 note is updated.
- 06 §3.2: 300 → 320 ms.
- 06 §4.3 #3: "not a style swap" is amended, with the reason.
- 06 §4.3 table: 0.94 → 0.90.
- `tools/fog-harness/README.md`: documents the new harness.

### Tests

- `lib/map-mode.test.ts`: criteria 3, 6 and 7, the shortcut, and the freeze.
- `lib/fog/fog-uniforms.test.ts`: the `FOG_MODES` snapshot, the 0.94 ceiling (including along a fade) and the `SEAM_FLOOR` derivation.
- `lib/basemap-swap.test.ts`: runs MapLibre's own `diff` with its semantics over both directions, both build orders and five round trips.
  - Asserts no unimplemented command, so MapLibre never falls back to a full rebuild.
  - Asserts no app layer or source is removed, every D-368/D-307 slot holds, and the camera is untouched.
- `tools/fog-harness/run-mode-swap.mjs`: a real Map in headless Chromium.
  - 12 swaps at three zooms; camera `Object.is`-identical across every swap; fog still compositing; `gl.getError` 0.
  - With `carryAppLayers` disabled it reports 90 failures.
- `components/plinth/plinth.test.tsx`: `/` may now render the toggle, which must be opaque and come before the gear.
- `lib/run-moment/beat1.test.ts`: the 320 ms fade and `runPageMode`.

### Not done here

"Suggest atlas once on the first route-planning surface" was proposed as a follow-up, then dropped by the operator (D-378): the toggle is a visible control with a shortcut (D-253), and the planner (D-070) has no ticket. Whoever designs the planner decides its opening mode.
