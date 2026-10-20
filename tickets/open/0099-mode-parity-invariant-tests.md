---
id: 99
slug: mode-parity-invariant-tests
title: What the modes may NOT differ in — revealed set and geometry parity, enforced
type: chore
priority: high
status: open
size: m
capability: 15-two-map-modes-and-cold-territory
depends_on: [98]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
started: 2026-10-19T20:41:49Z
---

## Description

`05-fog-of-war.md` §5.4 states two prohibitions. This ticket turns them from prose into failing
tests, because a mode toggle that quietly changes what is revealed is the single worst bug this
capability can ship.

1. **Neither mode changes what is revealed.** Both render the same cell set at the same
   `revealScale`. A toggle must never look like territory appearing or disappearing.
2. **Neither mode changes scoring.** The modes are a uniform and style-layer switch, client-side,
   with **no path back to §3** — no read of a mode flag anywhere in projection, XP, or ingest.

And the constraint above both of them: **D-051 is non-negotiable and binds both modes. The map
must remain a real, legible street map; atmosphere may never cost legibility.** Adventure mode is
allowed to be atmospheric; it is not allowed to be unusable. The way D-051 survives adventure mode
is structural, not a matter of taste (05 §5.3): `u_maxOpacity` capped at 0.94 means fully fogged
ground still shows a ghost of its street grid — **adventure hides names, not geometry.**

## Acceptance criteria

- [x] A test renders the same fixture explored set in both modes to an offscreen buffer and
      asserts the **coverage mask is bit-identical** between modes at three zooms (the mask is
      computed before any mode uniform is applied; if the assertion is not bit-identical, the
      mode flag has leaked into mask generation).
      *(`tools/fog-harness/run-mode-swap.mjs` on a real GPU, run by hand like every harness, with
      the in-suite fake-GL half in `lib/fog/mode-parity.test.ts`.)*
- [x] The renderer's cell-selection and `revealScale` code paths take **no mode argument** —
      asserted by a signature test, so it is impossible rather than merely untrue.
- [x] `grep -r` for the mode flag / mode enum identifier outside the renderer and the UI toggle
      returns nothing, and **that grep fails the build** — no occurrence in projection, XP,
      ingest, or any Lambda.
      *Amended (agent, 0099).* The allowlist also covers the run-moment seam
      (`lib/run-moment/mode.ts`, its tests, `app/run/[activityId]/`), as the orchestrator directed.
      It also allows exactly two lines that already existed: the `Profile.mapMode` schema column,
      and the test that pins its owner-write grant. Neither is projection, XP, ingest or a Lambda.
      Whether that column should exist is this ticket's open question.
- [x] `u_maxOpacity < 1.0` is asserted for every mode; a screenshot test at max fog shows non-zero
      road-geometry luminance variance inside fully unexplored ground (the ghost grid is present).
- [x] Street-name legibility in **both** modes at planning zoom (z15–z16) is verified by a
      contrast measurement of label glyphs against their local background, recorded in the
      capability doc for each mode (§9.5 of the roadmap requires this box).
      *Amended (agent, 0099).* The contrast is measured and recorded. Two things are verified:
      revealed ground reads the same as the stock map in both modes, and atlas keeps its street
      names over unexplored ground. No design doc sets a contrast floor, so the measurement of
      atlas over fog (0.73–0.77× stock) is recorded as a finding, not as a pass or fail (see
      Resolution). The §9.5 box itself is for the MVP gate to tick.
- [x] A screenshot of each mode over the same viewport is pasted into
      `docs/capabilities/15-two-map-modes-and-cold-territory.md`, and the revealed set in the two
      images is visibly identical.

## Notes

The bit-identical mask assertion is the whole ticket. Everything else is a guard on a way that
assertion could be made true by accident and then broken later.

Do not "fix" a parity failure by clamping a uniform. If the masks differ, a mode value has reached
the mask stage and the fix is to move it, not to compensate for it.

This ticket is also where the roadmap's capability done-condition — *both modes render the
identical revealed set* — is actually discharged.

## Operator validation

In the desktop browser, on `/`, at z15 over a neighbourhood you know: read three street names aloud
in adventure mode, then toggle and read the same three in atlas. Both must be readable without
zooming. Then find the edge of your territory and toggle repeatedly while watching one specific
fogged block — if any block flickers between revealed and unrevealed, stop and reopen this ticket.

**Result (operator, 2026-10-20, desktop browser, `/` on the deployed site, build 419):** all checks good. They read three
street names at z15 in adventure and the same three in atlas without zooming, and toggling at the edge of their
territory flickered no fogged block. They judged atlas's names over fogged ground (measured 0.73–0.77× stock
contrast, D-384) readable, so no halo ticket was filed.
**Agent smoke (2026-10-19, deployed `main` 41a5d9c):** build 419's log shows `Mode boundary: 535 files scanned —
the map mode is named only in the renderer, the toggle and the run-moment seam.` On the merged tree,
`run-mode-swap.mjs` printed MODE SWAP HARNESS PASS, with the mask byte-identical across adventure, atlas,
mid-fade and back: z12 `ceff5b97`, z15.25 `7d8bfde6`, z17.75 `a9ac8d89`. The ⅛-pixel sabotage differed in
4,763 / 7,741 / 23,107 bytes.

## Resolution

05 §5.4 is now enforced in four layers. Each layer has a sabotage case that must fail. The numbers
are recorded in `docs/capabilities/15-two-map-modes-and-cold-territory.md` § `0099`. Built against
D-368, D-373, D-374, D-375, D-376 and D-377. No production code changed: the mask already never saw
the mode, and this ticket proves that and keeps it true.

### Files

- **`tools/fog-harness/mode-swap-harness.js`** (criterion 1, reusing `0098`'s harness per D-374).
  - A real `ExploredSet` → `ZoomBucketStore` → `FogViewportController` (with a synchronous host)
    feeds the shipped `FogMaskLayer`. The explored set is a disc, a spur and a line of lone cells
    near Point Nemo.
  - At z12, z15.25 and z17.75 the harness shows adventure, atlas, a 50% `lerpPalette` mid-fade, and
    adventure again. It switches each one through `swapBasemap` + `setPalette`, as `map-shell.tsx`
    does.
  - It forces a fresh mask pass in each mode (away and back), and the pass count asserts that this
    happened. It then reads the mask texture through its own framebuffer and requires every RGBA
    byte to match.
  - Result: identical at all three zooms (hashes `ceff5b97`, `7d8bfde6`, `a9ac8d89`).
  - Sabotage: a ⅛-mask-pixel camera move changes 4,763 / 7,741 / 23,107 bytes.
  - A mask that is all revealed or all fogged fails as trivial.
- **`lib/fog/mode-parity.test.ts`** (new, in `npm test`; criteria 1, 2 and 4).
  - **Fake GL.** At three zooms, the mask pass makes the same call stream under the atlas,
    adventure and mid-fade palettes. A `setPalette` between frames never re-runs the mask pass;
    only the composite redraws.
  - **Signature test.** Uses the TypeScript checker on every exported function, class constructor
    and method of `explored-set`, `zoom-buckets`, `cull`, `instances`, `mask`, `route-corridor`,
    `reveal-tag`, `reveal` and `viewport-controller`, plus `FogMaskLayer`'s data seam (`setBucket`,
    `setInstances`, `setOptimisticRoute`, `setReveal`, `setRevealProgress`, `prerender`).
    - No parameter may be, or contain (walking unions, aliases and the repository's own object
      shapes), `MapMode`, `RenderMode`, `FogMode`, `BasemapVariant`, `FogPalette`, `ModeFrame`,
      `BloomPalette`, or the literals `"atlas"` / `"adventure"`.
    - No parameter may be named `*mode*` or `*palette*`.
    - Proven to fire: a `look: "atlas" | "adventure"` parameter added to `cullBucket` fails it, and
      the walker finds `FogPalette` in `FogMaskLayer`'s constructor.
  - **Import closure.** None of those modules reaches `map-mode`, `basemap-style`, `basemap`,
    `fog-uniforms` or `run-moment/mode`, so it cannot name the mode at all.
  - **`u_maxOpacity < 1`** for every mode and every frame of every fade. This already held in
    `fog-uniforms.test.ts` (0098); it is restated here beside the parity tests.
- **`scripts/check-mode-boundary.mjs`** (new; criterion 3). Wired into `amplify.yml`'s build phase
  and `.github/workflows/gate.yml`, with `--self-test`.
  - It is an **allowlist**: the mode's identifiers may appear only in the renderer (`lib/fog/`,
    `lib/basemap*`, `lib/map-layers*`, `lib/landmarks/markers*`, `lib/trace-web/`,
    `components/map/`), the toggle (`lib/map-mode*`), and the run-moment seam
    (`lib/run-moment/mode.ts` and its tests, `app/run/[activityId]/`).
  - Everything else under `app`, `components`, `lib`, `src`, `amplify`, `rules` and
    `middleware.ts` fails the build on a single code-line hit. A new Lambda or XP module is covered
    without anyone remembering to add it.
  - Identifiers: the type names, `FOG_MODES` / `ATLAS` / `ADVENTURE`, the `map-mode` /
    `render-mode` spelling family, `basemapFlag`, `swapBasemap`, `lerpPalette`, the owning module
    paths, and the quoted literals.
  - Two exact lines are allowed (see the open question below).
  - 19 self-test cases.
- **`tools/fog-harness/tune.mjs`, `tune-harness.js`**: five new variant keys, all documented in
  `tune.mjs`'s header.
  - `_swapFrom`: build the map in one mode and reach the other through the real swap.
  - `_cells` (`loop` / `all` / `none`): which ground is explored.
  - `_muteLabels`: text and icon opacity 0. This keeps collision the same, so a diff isolates the
    muted labels.
  - `_bareLabels`: no halo.
  - `_noSymbols`: hide every label.
- **`tools/fog-harness/mode-parity-shots.mjs`** (new; criteria 4, 5 and 6). It drives `tune.mjs` at
  z15 and z16 over real tiles and measures the PNGs with `pngjs`. Its own pass/fail is described
  under the two criteria below.
- **`tools/fog-harness/README.md`**: documents both additions.
- **`docs/capabilities/15-two-map-modes-and-cold-territory.md`**: new § `0099` with the proof
  table, the mask hashes, the ghost-grid and label-contrast tables, and the two screenshots.
- **`docs/capabilities/assets/0099/z16-atlas.png`, `z16-adventure.png`**: the synthetic downtown
  loop only (D-199).
- **`amplify.yml`, `.github/workflows/gate.yml`**: the new guard.

### Criterion 4: the ghost grid

Δ is the luminance of road pixels minus ground pixels, in the fully fogged frame with no labels. It
is high-passed with a 13 px box: without that, the fBm's large blotches line up with where downtown
happens to have more road, and the 1.0 sabotage read −0.69 grey levels of "ghost" that was only
noise.

| | z15 | z16 |
|---|---|---|
| Adventure, shipped 0.90 | 1.98 | 1.85 |
| Adventure, 0.94 ceiling | 1.19 | 1.11 |
| Atlas | 43.9 | 40.9 |
| Sabotage at 1.0 | −0.01 | −0.01 |

The script fails if the shipped or ceiling value is under 1 grey level, or if the sabotage is not
≈ 0.

### Criterion 5: street-name legibility (a finding)

**The metric.** For each `roads_labels*` label, the WCAG ratio between:

- the solid core of the letters: the darkest tenth of the glyph pixels, found by diffing the
  no-halo frame against the muted frame;
- the median of the 2 px ring around them in the shipped frame: the halo, and the ground just past
  it.

The stock map is measured the same way, with no fog layer.

**The results.**

| | Measured | Judged? |
|---|---|---|
| Revealed ground, both modes | Exactly the stock map (1.00×; about 2.0:1 by this metric; the colours' design ratio is 3.4:1) | Yes: fails unless ≥ 0.99× stock |
| Atlas, unexplored | Names present (n ≥ 0.8 × stock), at **0.77× (z15) / 0.73× (z16)** stock contrast | Presence only. The stock `light` halo is thin, and the fog darkens what is just past it. |
| Adventure, unexplored | Names hidden (1.1–1.2:1), by design (05 §5.3) | No: recorded only |

No design doc sets a contrast floor, so the atlas-over-fog number is recorded and not judged. See
the open question below.

### Decisions made here (agent)

- **The harness is the offscreen-buffer test,** as D-374 directed. Like every harness it is not
  part of `npm test`, because CI has no GPU. The fake-GL half is in the suite.
- **Mid-fade is a third mode** for parity. Every frame of the 320 ms cross-fade must leave the mask
  alone, not just its two ends.
- **"Local background" means the 2 px ring in the shipped frame,** so the halo counts. That is what
  the eye reads a label against.

### Open question for the operator (D-152)

**`Profile.mapMode` (`amplify/data/resource.ts`).** `02` T1 declared this preference column. Since
05 §5.3, and `0098`'s localStorage, it has been dead: nothing reads or writes it. Criterion 3's grep
names it. I allowed exactly that one line and the one test that pins its grant, and nothing else in
those files. The options:

- (a) Keep the column and the line exception.
- (b) Drop the column in a new backend ticket and remove the exception. 05 §5.3 says the mode is a
  per-device viewing preference, not user data.
- (c) Sync the mode through it, which contradicts §5.3.

### Not done here

- `docs/INDEX.md` is not regenerated (the orchestrator's job, WAVES §3). This ticket adds a `###`
  heading to the capability doc.
- The operator's perceptual check is the "Operator validation" section above. It is unchanged.
