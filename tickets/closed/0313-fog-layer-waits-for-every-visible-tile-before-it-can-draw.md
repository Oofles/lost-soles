---
id: 313
slug: fog-layer-waits-for-every-visible-tile-before-it-can-draw
title: Fog layer waits for every visible tile before it can draw
type: bug
priority: med
status: closed
size: s
capability: 08-map-and-fog-renderer
depends_on: []
blocked_by: []
source: agent
created: 2026-10-23T02:39:32Z
started: 2026-11-05T05:29:03Z
closed: 2026-11-05T05:36:56Z
---

## Description

06-ui-ux.md §4.8 says the fog never waits on tiles. But useFogMask adds the fog layer only after MapLibre's load event, and load fires only once every visible tile has arrived or failed. On a slow connection the fog therefore cannot draw until the basemap has finished loading. Offline, tile requests fail fast, so it does not bite there. Found by the 0113 agent (wave 18.2). Not fixed there: it is renderer work, and it touches D-333's hold.

## Acceptance criteria

- [x] The fog layer is added as soon as the style is ready and the explored set is known. It does not
      wait for tiles, so on a throttled connection the fog draws before the basemap tiles finish.
- [x] A test with tile requests that never resolve asserts that the fog layer is still added.
- [x] D-333's hold (pending, and keeping the last frame) and D-439's paint gate still behave as
      recorded. If moving the layer changes when the gate opens, say so in the Resolution.

## Steps to reproduce

1. Open `/` with warm IndexedDB and DevTools throttling set to Slow 3G (or in a test, delay the
   tile responses).
2. Watch when the fog appears relative to the basemap tiles.

## Expected vs actual

**Expected:** the fog draws from the cached explored set right away, over flat background where tiles are missing (06 §4.8).

**Actual:** the fog appears only after MapLibre's `load`, which waits for every visible tile to arrive or fail.

## Notes

Reported by the `0113` agent and not verified in a browser yet; confirm `load`'s timing against the MapLibre version in use before changing anything.

## Operator validation

Covered by a test with delayed tiles. Perceptual check only if the fix changes how the fog arrives on `/`.

D-123 trigger checked? none.

## Resolution

**Confirmed before changing anything,** against MapLibre 6.6.0 as installed. `map.loaded()` needs
`Style.loaded()`, which returns false while any tile manager has a tile still loading, and `load`
fires on the first render where `map.loaded()` holds. So `load` waited for every visible tile, and
the fog, handed the map by `instance.once("load")`, waited with it.

**The fix: two readiness signals in `components/map/map-shell.tsx`.**
- `styled`, set on `style.load` (the style has been parsed, before any tile). It now drives
  `useFogMask`, `useLatestRun` (the route line and the corridor, with D-333's hold unchanged
  inside it), the mode swap and its frame, the trace web, landmarks, the first-load camera and the
  region jump, `MapControls`, `MaskHud` and `PerfOverlay`. None of these needs more than a ready
  style. Moving the camera with them matters: had the fog moved alone, it would draw at the
  default camera and then jump when the camera framed the latest run on `load`.
- `loaded`, still set on `load`, for exactly two consumers:
  - **D-439's paint gate** (`load` plus two frames), which is about the first visually complete
    paint. **The gate opens at the same moment as before; D-439 needs no change.** The fog's
    network revalidation still waits for tiles (or the 10 s ceiling). The fog draws the cached
    set as soon as the style is ready.
  - **`onStage`'s `ready`**, which starts beat 1 on `/run/:id`. On a slow link, moving it would
    play the post-run reveal over an empty background, a change to capability 12's moment that
    this ticket does not own. So the post-run beat still waits for tiles, as before. The fog
    layer under it now exists earlier, with its reveal installed at 0.
- Both are cleared in `teardown`. Both are `once`, so a mode swap's `setStyle` re-fires neither.
  The style JSON loads a frame after construction (`loadJSON` defers to `frameAsync`), so the
  listeners, attached right after `new Map`, cannot miss `style.load`.

**Tests.**
- `tools/fog-harness/tile-wait-harness.js` + `run-tile-wait.mjs` (new, listed in the harness
  README) run a real Map with the shipped style and `FogMaskLayer` in headless Chromium. A
  stand-in `pmtiles` protocol answers the TileJSON and holds every `z/x/y` request open. The
  hang case asserts that `style.load` fires, the fog layer added on it composites, tiles are
  outstanding, and `load` has not fired after 5 s. The control case answers tiles and asserts
  that `load` does fire, so "load never fired" can't just be a harness blind to `load`.
  Output: `hang: style.load 24 ms · load never · 9 tile requests held · fog composites 8 after
  5000 ms` / `control: style.load 13 ms · load 71 ms · 9 tiles answered`.
- `components/map/map-shell-build.test.ts`: a source tripwire that pins the wiring (fog and latest
  run on `styled`; paint gate and `onStage` on `loaded`; both cleared on teardown). The vitest
  environment is `node` and runs no effects, so the shell itself can't be driven; this is the
  same trade the file's `0278` test makes.
- `components/map/use-latest-run.test.ts`: the existing hook-order tripwire looked for the string
  `useFogMask(loaded` and now looks for `useFogMask(styled`.
- Full suite 4811 passed, `tsc` and `eslint` clean.

**What went wrong.** The first harness ran over `file://` with `--dump-dom`, like `run-mode-swap`.
There MapLibre's module worker cannot start, so no tile was ever requested and `load` fired at
196 ms. The harness's own guard ("no tile request was ever held open") failed it, rather than
letting it pass on nothing. It now follows `tune.mjs`'s setup: the worker as a blob, a throwaway
local server, real time, and DevTools-protocol polling. A second problem was that the workdir's
exit-time `rmSync` raced Chromium writing its profile (ENOTEMPTY), so the runner now waits for
Chromium to exit.

## Operator validation

Covered by the tile-wait harness (headless Chromium, real MapLibre 6.6.0, shipped style and fog
layer) and the suite, as the ticket said. No perceptual check is needed: on a normal connection
nothing visible changes, since `style.load` and `load` arrive tens of milliseconds apart (13 vs
71 ms in the control). On a slow link the fog now appears over the flat background before the
tiles, which is §4.8's stated intent, not a judgement call.
