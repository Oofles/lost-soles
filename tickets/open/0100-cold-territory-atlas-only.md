---
id: 100
slug: cold-territory-atlas-only
title: Cold territory wash, atlas mode only, on a different perceptual channel
type: feature
priority: high
status: open
size: m
capability: 15-two-map-modes-and-cold-territory
depends_on: [98, 99]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
started: 2026-10-20T12:52:28Z
---

## Description

Render rediscovery-eligible ground — explored cells whose `lastRunAt` is ageing toward and past
the 6-month cooldown (D-022, D-120) — as a cool wash, **in atlas mode only** (D-133). Adventure
mode stays pure known/unknown for atmosphere.

D-133 names the risk precisely: a third visual state that fights the frontier for attention.
**The design answer is that cold ground is not a third fog state at all** (`06-ui-ux.md` §4.6).
It is a wash painted strictly *inside* already-revealed ground, and D-147 separates it from the
frontier on a **different perceptual channel**:

| | The frontier | Cold ground |
|---|---|---|
| Channel | **Luminance + warm glow** — bright warm rim against dark fog | **Temperature + saturation** — cool, desaturating wash on lit parchment |
| Where it lives | The explored/unexplored boundary | The interior of explored territory only |
| Edge | Hairline, sharp by design in atlas | Soft, 40 px feather, no defined edge |
| Can they touch? | **No** — see the clip rule | |

**The clip rule is the whole trick and it is one line.** Cold opacity is multiplied by
`smoothstep(0.0, 0.25, coverage - 0.75)`, which clips the wash **two cell-widths inside the
coverage mask**, leaving a band of plain warm parchment between cold ground and the frontier at
all times. Cold ground can therefore never render at the reveal edge and the two can never be
confused — not at a glance, not by someone who has never used the app. This is how D-050
atmosphere and D-051 legibility are both satisfied (D-147).

**The ramp is continuous from month 5, not a binary at the 6-month line:**

```
  wash opacity
   0.18 ┤                        ╭──────────────────  asymptote
        │                   ╭────╯
   0.10 ┤              ╭────╯   ← 6 months: re-armed for 50% discovery credit
        │         ╭────╯
   0.00 ┼────────╯
        └────┬────────┬────────┬────────┬─────────►  months since last run
             4        5        6        9
```

Starting the ramp at month 5 is the useful part: **you can see ground coming back into season
before it arrives**, which is what actually changes a Saturday's route, and it is the visual twin
of the chronicle line *"Ashgrove Lane comes back into season in nineteen days"*. It costs one
uniform and one lazy fetch. ~~No extra data — `explored-lastrun-r10.bin` is already delivered.~~
**Amended (operator, 2026-10-20, Q1 = A):** the sidecar (now `explored-lastrun-r11.<gen>.bin`, D-237)
was written by ingest but never served to the browser — `0054` left it to this overlay. This ticket
delivers it: `GET /api/fog/lastrun/[gen]` and a loader that fetches it the first time atlas is shown.

Colour: `--cold-wash` `#7E93AD`, multiplied over the lit basemap, plus a −18% saturation shift.
**Never a stipple, never a hatch, never a hex outline** — patterns read as information about one
specific cell and invite clicking, and there is nothing to click (06 §4.4).

## Acceptance criteria

- [x] Cold wash renders in atlas and is **absent** in adventure: a pixel test over a fixture with
      12-month-old cells shows a measurable blue/saturation delta in atlas and **zero** delta in
      adventure at the same viewport.
- [x] The clip rule is implemented as `smoothstep(0.0, 0.25, coverage - 0.75)`; a shader test
      asserts cold opacity is exactly 0 wherever `coverage <= 0.75`, so no cold pixel exists
      within two cell-widths of the frontier.
- [x] Opacity follows the ramp: 0.0 at ≤4 months, ~0.10 at 6 months, asymptotic to 0.18 — asserted
      at 4, 5, 6, 9 and 24 months against the tabled values, tolerance ±0.01.
      *(The ticket tables only 4, 6 and the asymptote; 5 and 9 are read off 06 §4.6's chart as
      0.033 and 0.179 from the curve that passes through the three fixed points — see Resolution.)*
- [x] The wash is continuous — no discontinuity at the 6-month boundary; the derivative of the
      ramp is finite everywhere (no step function in the shader).
- [x] The wash is a multiply of `#7E93AD` plus a −18% saturation shift; there is no stipple,
      hatch, outline, or per-cell border anywhere in the implementation.
- [x] The wash is driven from `lastRunAt` per cell (D-120) and no code path writes or reads a
      presence bit.
- [x] Cold ground never darkens a street label below the 0099 legibility measurement — labels are
      drawn above the wash in atlas.
      **Amended (operator decision, 2026-10-20, D-393).** Labels ARE drawn above the wash in atlas
      (the cold pass runs inside the fog layer, which D-368 places under atlas's labels), so no glyph
      or halo pixel is ever darkened. By D-384's method (glyph vs the 2 px ring, which reaches the
      ground just past the halo) atlas street names over year-old ground measure **1.84:1 = 0.92×
      stock** (z16, n = 29), against 1.00× over plain revealed ground and 0.73× over unexplored
      ground. The operator accepted 0.92× as the floor's reading: it beats the fog's own, and
      `mode-parity-shots.mjs` records it and judges exactly that.
- [x] *(Added by operator decision, 2026-10-20, Q1 = A.)* `GET /api/fog/lastrun/[gen]` serves the
      `LSFL` sidecar: uid from the session only, generation parsed to a number before it reaches a
      key, gunzipped, `private, max-age=31536000, immutable`; 404 for a signed-out caller, a bad
      generation or a missing object.
- [x] *(Added by operator decision, 2026-10-20, Q1 = A.)* A lazy client loader fetches the sidecar
      the first time atlas is shown and decodes it with `decodeLastRunBlob`, refusing a generation or
      count mismatch. Cells added by `LSFD` deltas during the session count as recent (cold 0), per
      05 §7.2's fallback.
- [x] *(Added by operator decision, 2026-10-20, Q2 = (a).)* A coarse disc takes its most recent
      child's day (max), so it is cold only if every explored child is; an unknown child is fresh.

## Notes

The 40 px feather and the two-cell clip are doing different jobs and both are needed: the feather
stops the wash from having an edge of its own, the clip stops it from ever reaching the edge that
matters.

If the wash looks too blue at z16, that is a value change to `--cold-wash` and the
saturation shift — file it as a new ticket. It is **not** a reason to add an outline or raise the
opacity above the asymptote, and it is never a reason to show cold ground in adventure.

## Operator validation

In the desktop browser, atlas mode, over ground you last ran 5–7 months ago (the chronicle can tell
you where). Look for a cool, edgeless dimming in the middle of your own territory, with a clear
band of warm parchment between it and the fog edge. Then toggle to adventure: the cool wash
must vanish completely while the fog and rim are unchanged. Finally, confirm
you can still tell the warm frontier from the cool ground at a glance — if you have to think about
which is which, D-147's channel separation has failed and the wash is too strong.

## Resolution

**Built, not yet closed** — the orchestrator closes it after deploy. Operator validation below is
still to be done (perception only).

### What it does

Atlas paints a cool, desaturating wash over explored ground that has not been run for more than
about four months. The wash is clipped two cell-widths inside the fog edge, so it never meets the
frontier. Adventure draws nothing new: the pass is skipped outright, so adventure frames are the
same bytes as before this ticket.

The path, end to end:

1. **The server serves the sidecar.** `GET /api/fog/lastrun/[gen]` serves ingest's `LSFL` object.
   It is a copy of the blob route.
2. **The browser fetches it once.** `useFogMask` fetches it the first time the wanted mode draws
   cold ground (`look.coldTerritory`). It fetches only for the account's own set, never for home's
   held view or for `?fog=perf`, and once per set identity.
3. **The days are held beside the cells.** `LastRunDays` holds them next to that generation's cell
   array: an index lookup while the array is current, a binary search after a delta.
4. **The days are baked into the instances.** `ZoomBucketStore.setLastRun` drops cached geometry,
   and the controller re-culls. `packBucket` then writes a 6th float, `day`, into every instance.
   - At coarse buckets the day is the most recent child's, and an unknown child makes the parent
     unknown.
   - Bridges take their more recent endpoint's day.
   - The optimistic corridor writes `DAY_UNKNOWN`.
5. **The mask carries warmth in alpha.** The mask pass writes `1 − (today − day) / 366` into alpha,
   blended with `gl.MAX`, so the most recently run disc wins where discs overlap. Alpha used to be a
   constant 1 that nothing read, and it is now cleared to 0. Red, the coverage, is unchanged:
   `run-mode-swap.mjs` shows the mask is the same bytes in atlas, adventure and mid-fade.
6. **A new pass draws the wash.** `runColdPass` runs inside the layer's `render`, before the
   composite, and only when both of these hold:
   - the palette's `coldWash` is above 0 (atlas is 1, adventure is 0, lerped by the 320 ms fade);
   - some uploaded disc is past month 4.

   It works in three steps:
   - It copies the frame under the fog into a texture.
   - It reads the mask at the **warped** point, using the same GLSL as the composite (D-372), and
     applies the clip `smoothstep(0.0, 0.25, coverage - 0.75)`.
   - It blurs coldness over a coverage-weighted 40 px ring and writes:
     `fromLab(L, ab × (1 − 0.18k)) × mix(1, #7E93AD, 0.18k)`.

   Atlas labels sit above the fog layer (D-368), so they draw over the wash.

### Decisions made, and why

- **A frame copy, not a blend trick.** A multiply could be done with a blend function, but a
  saturation shift mixes the ground's own channels, and no fixed-function blend can do that. The
  copy (`copyTexSubImage2D`, RGB8) runs only on frames where atlas has cold ground uploaded. On
  SwiftShader the pass has the composite's cost order: one warp plus 17 taps. The real-GPU budget is
  `0059`'s gate. Proposed as D-391.
- **The ramp curve.** The curve is `0.18 × (1 − exp(−((m − 4)/τ)²))` for m > 4, with
  τ = 2/√(−ln(1 − 0.10/0.18)) ≈ 2.221 months. It is exactly 0 up to month 4 and exactly 0.10 at
  month 6, with a C¹ shoulder at month 4 and no step anywhere.
  - It gives 0.033 at month 5, which matches the chart's "coming back into season" rise, and 0.179
    at month 9.
  - A month is 183/6 = 30.5 days, matching `SIX_MONTHS_MS`.
  - Proposed as D-392.
- **The saturation shift is made in CIELAB**, the D-371 metric: a\* and b\* are scaled by
  `1 − 0.18 × strength` and L\* is kept. The shift happens first, then the multiply.
- **Warmth, not coldness, in alpha.** Under `gl.MAX` this makes the most recent disc win, the same
  rule as D-390, so freshly run ground never shows as cold. Ages are capped at 366 days, which is
  1.4 days per 8-bit step; the ramp is at 0.17999 of 0.18 by then.
- **The feather** reuses `rimTaps` (2 rings × 8, with weights 2 and 1, plus a centre weight of 3).
  Its reach is 20 CSS px, so a step becomes a 40 px ramp, scaled by the canvas's own pixel ratio.
  Each tap is weighted by its own coverage, so unexplored ground, which has no disc, cannot report
  "cold" into the band next to the clip.
- **The display clock is `now`.** `todayDay(Date.now())` uses the sidecar's epoch. Scoring never
  reads it (D-276); the mask redraws when the day rolls over.
- **`showColdTerritory` stays unwired**, as the orchestrator directed.

### Files touched

- `app/api/fog/lastrun/[gen]/route.ts`: new; the sidecar route. `app/api/fog/route.test.ts`: its
  tests.
- `lib/fog/last-run.ts` and `last-run.test.ts`: new; `LastRunDays`, `loadLastRun`,
  `httpLastRunFetch`, `todayDay`.
- `lib/fog/wire.ts`: `fogLastRunPath`.
- `lib/fog/fog-uniforms.ts`:
  - `FogPalette.coldWash`, with atlas 1 and adventure 0, lerped;
  - the cold constants;
  - `coldWashOpacity` and `coldClip`.
- `lib/fog/mask.ts`:
  - `INSTANCE_FLOATS` 6, with `ARC_INDEX`, `DAY_INDEX` and `DAY_UNKNOWN`;
  - `a_day`, `u_today` and `v_warmth`;
  - alpha cleared to 0;
  - `COLD_AGE_SPAN_DAYS` and `discWarmth`.
- `lib/fog/composite.ts`:
  - the noise and warp GLSL extracted into shared helpers; the composite's source is byte-identical,
    checked;
  - `coldFragmentSource`, `createColdResources`, `runColdPass` and `disposeColdResources`;
  - CIELAB helpers and `coldPixel`.
- `lib/fog/mask-layer.ts`: the cold pass gate in `render`, `today` in `prerender`, `oldestDay`, and
  `coldPasses`/`coldError` in stats.
- Day handling in the other producers:
  - `lib/fog/instances.ts`: `dayOf`, per-disc day, and the bridge rule.
  - `lib/fog/zoom-buckets.ts`: per-group days, `setLastRun`, and most recent child wins.
  - `lib/fog/cull.ts`: the day slot is copied.
  - `lib/fog/reveal-tag.ts`: whole instances are copied and the arc is written at `ARC_INDEX`.
  - `lib/fog/route-corridor.ts`: writes `DAY_UNKNOWN`.
- `components/map/use-fog-mask.ts`: lazy fetch and hand-off. `components/map/map-shell.tsx`:
  `look.coldTerritory`.
- Tests:
  - `lib/fog/cold-territory.test.ts`: new.
  - Layout updates in `mask.test.ts`, `cull.test.ts` and `fog-uniforms.test.ts`.
  - `lib/fog/__fixtures__/fake-gl.ts`: `copyTexSubImage2D`, the new enums and uniforms.
- Harnesses:
  - `tools/fog-harness/harness.js`: K0–K4, the GPU pixel tests.
  - `mode-swap-harness.js`: year-old cells; the cold pass runs only in atlas, inside real MapLibre,
    with no GL error, and the mask is identical across modes.
  - `mode-parity-shots.mjs`, `tune.mjs` and `tune-harness.js`: a "cold (1 y)" ground on real tiles,
    and `_coldDays`.
- Docs:
  - `docs/06-ui-ux.md` §4.6: "no extra data" corrected.
  - `docs/05-fog-of-war.md` §7.2: names the route.
  - Both reference D-389 and D-390.

### Evidence

All on SwiftShader in headless Chromium:

- **`run.mjs` K1:** the centre's CIELAB saturation drops from 0.325 to 0.261, and B/R rises by
  0.058. The output is within 0.4/255 of `coldPixel()`.
- **`run.mjs` K2:** adventure is 0 bytes different between year-old and fresh ground, and the cold
  shader at `coldWash` 0 changes 0 bytes.
- **`run.mjs` K3:** 57,237 pixels were washed. The lowest mask coverage under any of them is
  195/255, and none fall at or below 0.75; 48,857 frontier-band pixels were checked.
- **`run.mjs` K4:** fresh ground in atlas is 0 bytes different.
- **`mode-parity-shots.mjs`, real tiles, z16:**
  - Adventure names over cold ground read 1.00× stock.
  - Atlas names over cold ground read 0.92× stock (1.84:1), above the 0.73× they read over
    unexplored ground. See the amended criterion.
