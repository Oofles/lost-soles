---
id: 58
slug: zoom-bucketing-and-viewport-culling
title: Zoom bucketing and two-level viewport culling
type: feature
priority: high
status: open
size: m
capability: 08-map-and-fog-renderer
depends_on: [54, 55]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
---

## Description

This is what makes year-five volume survive. R4's claim — 50k–500k stored cells at 60 fps — is
**not a property of the GPU**; it is a property of the CPU-side data pipeline in this ticket. Without
it the renderer works beautifully for a month and degrades invisibly for years.

The load-bearing insight: **on-screen cell count is bounded by screen area, not by database size.**
At ~8–30 CSS px per cell, a 400×800 viewport holds roughly 1,400 cells whether the account stores
50,000 or 500,000. Total stored cells affect transport and storage only.

**Zoom bucketing.** Map zoom selects a render resolution; res 10 is canonical (D-115) and therefore
the *finest* bucket, with coarser ones derived by `cellToParent`:

```js
const ZOOM_TO_RES = [
  { maxZoom:  4, res: 4 }, { maxZoom:  6, res: 5 },
  { maxZoom:  8, res: 6 }, { maxZoom: 10, res: 7 },
  { maxZoom: 12, res: 8 }, { maxZoom: 14, res: 9 },
  { maxZoom: Infinity, res: 10 },   // never finer
];
```

Derive a bucket **lazily, once, and cache it** — `_byRes: Map<res, {centers, radii, bounds}>`.
Building res 8 from 150k res-10 cells is one `cellToParent` pass plus a dedupe: 30–80 ms, once, off
the frame path. Re-derive only when the bucket **index** changes, debounced ~250 ms — not on every
zoom event. That debounce is the single lesson worth copying wholesale from Dawarich.

Precompute each cell's mercator centre, mercator radius and bbox once per bucket. Never call
`cellToBoundary` or `map.project()` per frame.

**Two-level culling.** The naive per-cell cull is 600k float compares per mask rebuild at 150k cells,
and the mask rebuilds every frame during a pan — 1–3 ms of main-thread JS in the frame path, the
single largest cost in the system and the one thing that would break the claim. Instead, use the
res-6 parent grouping that already exists in the T6 partition key and in `applyDelta`:

```
build once per bucket: parents: Map<res6Id,{lo,hi}> (cells sorted by parent, contiguous slices)
                       parentBounds: Float64Array (4 floats per parent)
per rebuild: 1. cull PARENTS against the padded viewport   (a few hundred compares)
             2. cull surviving parents' cells
             3. write survivors into the instance Float32Array
             4. gl.bufferData
```

A res-6 parent is ~36 km²; at z14–17 the viewport intersects 1–6 of them, so step 1 discards
essentially the whole dataset in a few hundred comparisons. This is the third payoff of one
decision.

**Pad the viewport ~20% and cache the instance buffer.** Separate `maskDirty` (any camera move —
cheap, one draw call) from `bufferDirty` (bucket change, padded-region exit, or new data). Small
pans then cost **zero** CPU. Skip everything when the layer is hidden: detach move handlers, cancel
the rAF loop.

## Acceptance criteria

- [ ] `resForZoom(z)` implements the table exactly; res 10 is never exceeded.
- [ ] Buckets are derived lazily, cached per resolution, and re-derived only on bucket-index change,
      debounced ~250 ms — asserted by a spy across a continuous zoom gesture.
- [ ] Cells within a bucket are sorted by res-6 parent with a contiguous index range per parent.
- [ ] Two-level cull is implemented; a 150k-cell fixture shows a compare count in the low hundreds
      for step 1, asserted by instrumentation.
- [ ] `visibleInstanceCount` **≤ 6,000 at every zoom, at every dataset size** (50k / 150k / 500k
      fixtures). This is the canary: if it tracks total stored cells, culling is broken.
- [ ] Viewport is padded ~20%; a pan entirely inside the padded region triggers zero VBO uploads.
- [ ] `maskDirty` and `bufferDirty` are separate flags with separate triggers.
- [ ] Hiding the layer detaches handlers and cancels the rAF loop; a test asserts zero work while
      hidden.
- [ ] `applyDelta`'s touched-parent invalidation rebuilds only those parents' slices, not the bucket.
- [ ] Coarse buckets carry `fraction` per parent from `explored-agg.json` and feed 0055's
      `a_fraction`.
- [ ] Main-thread cull time measured under 2 ms, and ~0 ms for pans inside the padded region.

## Notes

If the 30–80 ms `cellToParent` pass ever shows as a visible hitch on a zoom-out, move bucket
derivation to a Web Worker. Not needed at MVP volumes; noted so it is not a surprise.

Sending all cells to the GPU without bucketing falls over past ~100k — massive overdraw at low zoom
and VRAM churn. It is on the do-not-retry list for the same reason one-draw-call-per-cell is.

## Operator validation

1. On the 6.8in Android phone, load the 150k synthetic fixture. Zoom out from z17 to z4 in one
   continuous pinch. There must be **no hitch** at any bucket boundary and no moment where the fog
   disappears and reappears.
2. At z10 over your city, sparsely-run areas read as a dim wash and densely-run areas as solid — not
   a uniform slab.
3. Pan in small increments at z16 for 30 seconds. In remote DevTools' performance panel, there must
   be no long tasks attributable to the fog layer, and no `bufferData` calls for pans that stay
   inside the padded region.
4. Do step 1 again on the 500k fixture. The frame rate must not visibly differ from the 150k run —
   if it does, culling is tracking dataset size and this ticket is not done.
