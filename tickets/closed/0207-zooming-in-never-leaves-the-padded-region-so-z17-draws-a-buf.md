---
id: 207
slug: zooming-in-never-leaves-the-padded-region-so-z17-draws-a-buf
title: Zooming in never leaves the padded region, so z17 draws a buffer built for z13 — 30,031 instances where ~120 are needed
type: bug
priority: med
status: closed
size: s
capability: 08-map-and-fog-renderer
depends_on: []
blocked_by: []
source: agent
created: 2026-09-11T17:08:55Z
started: 2026-09-11T17:15:35Z
closed: 2026-09-11T17:34:29Z
---

## Description

`FogViewportController` rebuilds the instance buffer when the camera leaves the region it was built
for — §6.2's *"pad the viewport ~20% and rebuild only when the camera leaves the padded region"*.
The check is `boxContains(built, viewport)`, and it is **containment only, with no notion of scale**.

Zooming IN shrinks the viewport, so it never leaves. The buffer built several zoom levels out stays
resident and keeps being drawn.

From `0059`'s first desktop run, 1902x901, 151,201 cells, res 11 throughout:

```
  z13  res 11  max  59,511 at z13.50
  z14  res 11  max  30,041 at z14.00
  z15  res 11  max  30,031 at z15.90
  z16  res 11  max  30,031 at z16.90
  z17  res 11  max  30,031 at z17.00
```

z15, z16 and z17 are **byte-identical** because they are the same buffer. A z17 viewport covers 1/256
of the ground a z13 one does, so it needs roughly **120** instances and is being handed **30,031** —
about 250x more geometry than the screen can show.

The path through the code: `zoom-in` crosses its last band at z13 (res 10 -> 11), rebuilds there, and
then every further zoom level inwards is contained by that z13 padded box. Nothing rebuilds again
until the camera pans out of a box that is ~22 z17-viewports wide.

## Acceptance criteria

- [x] Zooming in by several levels rebuilds the buffer rather than keeping one sized for a much
      larger area.
- [x] `visibleInstanceCount` at z15-z17 reflects those viewports rather than repeating z13's number.
- [x] A small zoom change still does NOT rebuild — §6.2's whole point is that a pinch does not cost a
      cull per frame, and `viewport-controller.test.ts`'s zero-upload assertions must survive.
- [x] The debounce still collapses a fast pinch into two or three rebuilds (§6.1).
- [x] `tools/fog-harness/run-perf.mjs`'s `pan-z17` phase performs culls, which it cannot today.

## Steps to reproduce

1. `node tools/fog-harness/run-perf.mjs 150k`
2. Read the per-zoom histogram: z15, z16 and z17 carry the same number, and `pan-z17` shows `0 culls`
   over its camera events.

## Expected vs actual

**Expected:** the drawn instance count is bounded by what is on screen at the current zoom (D-238's
*"bounded by screen area, not by database size"*).

**Actual:** at z17 it is bounded by the screen area of **z13**, which is 256x larger.

## Notes

**This is a design gap, not a coding slip** — §6.2 says "leaves the padded region" and that is what
is implemented. The missing half is that a region can stop being appropriate by becoming far too
LARGE, not only by being exited. The natural fix is to add a scale check beside the containment one:
rebuild when the viewport's area falls below some fraction of the built region's. Pick the fraction
against §6.1's debounce so a pinch does not thrash — a factor of 4 (two zoom levels) is the obvious
starting point and costs at most one extra rebuild per two levels.

**How much it actually costs is unclear and should be measured before it is assumed to matter.** The
GPU pass is instanced and a desktop measured `mask 0.474 ms mean, composite 0.862 ms mean` WITH the
inflated counts, comfortably inside §6.3's 1 ms and 2 ms. So this may be wasted work that nothing
feels. What it definitely does is make `0201`'s ceiling harder to reason about, because a count
recorded at z15 is really a count from z13.

Related: `0201` (the band-bottom peak) and `0202` (derivation inside the cull). All three came out of
`0059`'s instrumentation and all three are about the same subsystem; worth doing as one session.

## Operator validation

None expected — this is an instance count in a debug readout, and the desktop GPU numbers say it is
currently invisible. If a fix changes what the fog looks like during a pinch, that becomes a
perception check on the desktop browser (D-227).

## Resolution

`boxTooLarge(built, viewport, scale)` in `cull.ts`, checked beside `boxContains` in the controller's
`#camera`. A buffer stops serving the viewport in **two** ways, not one: it can be left behind, which
is what §6.2 describes and what containment catches; or the viewport can shrink so far inside it that
it is sized for a different map, which zooming in does on every level and which containment can never
notice.

`MAX_BUILT_SCALE = 4` on the width ratio. A padded region is 1.4x its viewport by construction, so
this allows about **1.5 zoom levels** of zooming in before a rebuild — at most one extra cull per 1.5
levels, against a buffer that was covering up to 256x the ground on screen.

**Confirmed by the thing that exposed it.** `pan-z17` went from `0 culls / 13 camera events` to
`5 culls / 13`, and the histogram's byte-identical 30,031 at z15/z16/z17 is gone.

Width rather than area, because the two axes scale together under zoom and a single ratio is the
quantity a zoom level actually changes. A degenerate viewport — zero-width, or `NaN` from a map
mid-teardown — returns `false` rather than `true`: reading it as "too large" would mean a cull every
frame at the moment the map is least able to afford one.

**Files:** `lib/fog/cull.ts`, `lib/fog/viewport-controller.ts`, plus tests in both.

**Tests.** Five in `cull.test.ts` covering the freshly-padded case (must not fire), the 1.5-level
tolerance, the exact z13-buffer-at-z17 case from the real run, the degenerate viewport, and the
threshold being an argument so the trade is tunable without editing the caller. Two in
`viewport-controller.test.ts` prove a half-level zoom still costs no rebuild — §6.2's whole point —
and that zooming out still goes through containment as it always did.

## Operator validation

None required, and the reason is on the ticket: this is an instance count in a debug readout, and the
desktop GPU numbers were measured WITH the inflated counts and were comfortably inside §6.3's budget
(mask 0.474 ms, composite 0.862 ms). Nothing about what is drawn changes — the same ground is covered
either way, by fewer discs.

Smoke test: `node tools/fog-harness/run-perf.mjs 150k`, which now reports culls in `pan-z17` and a
per-zoom histogram whose z15-z17 entries differ from z13's.
