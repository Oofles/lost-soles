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
started: 2026-09-11T02:35:41Z
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

- [x] `resForZoom(z)` implements the table exactly; **res 11** is never exceeded.
      — **amended.** The table in the Description is res-10-canonical and predates D-237; extending it
      rather than rewriting it would have put the 102 m brush back at the browsing zooms. D-238 has the
      new table and the arithmetic. `res 10 is never exceeded` → `RES`, read from
      `src/domain/fog.ts` rather than a literal so the next resolution change moves it.
- [x] Buckets are derived lazily, cached per resolution, and re-derived only on bucket-index change,
      debounced ~250 ms — asserted by a spy across a continuous zoom gesture.
- [x] Cells within a bucket are sorted by ~~res-6 parent~~ **their `groupResFor(res)` ancestor** with a
      contiguous index range per parent. — **amended**: the grouping is `res - 4` clamped to
      `RES_PARENT` (res 7 for the res-11 bucket), because D-237 made a res-6 group hold 16,807 children
      rather than the 2,401 §6.2's reasoning was built on. It coincides with `RES_PARENT` again once
      `0198` lands. No sort is needed: an ancestor is a prefix of a cell's id, so the decoded array is
      already grouped — asserted on a 43k fixture at three grouping resolutions.
- [x] Two-level cull is implemented; a 150k-cell fixture shows a compare count in the low hundreds
      for step 1, asserted by instrumentation. — **90 groups**, keeping 6, on a 151,201-cell fixture.
- [x] `visibleInstanceCount` **≤ 6,000 at every zoom, at every dataset size** (50k / 150k / 500k
      fixtures), **on a 400×800 CSS px viewport**. This is the canary: if it tracks total stored cells,
      culling is broken. — **amended**: the criterion named no viewport and the number is meaningless
      without one; see D-238. Measured peak **5,271 at z14**, identical at all three sizes from z13 up.
      The desktop figure (~21,000 at 1440×900) is recorded rather than capped.
- [x] Viewport is padded ~20%; a pan entirely inside the padded region triggers zero VBO uploads.
- [x] `maskDirty` and `bufferDirty` are separate flags with separate triggers.
- [x] Hiding the layer detaches handlers and cancels the rAF loop; a test asserts zero work while
      hidden.
- [x] `applyDelta`'s touched-parent invalidation rebuilds only those parents' slices, not the bucket.
      — the *index* is rebuilt whole (3.2 ms at 150k, no projection in it) because a delta shifts every
      slice index; the *geometry*, which is the expensive part, is rebuilt only for the touched parents'
      groups and their neighbours. See the Resolution for why the neighbours are in that set.
- [x] Coarse buckets carry `fraction` per parent ~~from `explored-agg.json`~~ **derived in the browser
      from the cell array** and feed 0055's `a_fraction`. — **amended, and this was not a shortcut**:
      nothing in the browser can read `explored-agg.json` — no route, no transport method, no cache
      path — and it covers res 6/7/8 while the table needs 4–10. The count is the run length of a
      parent's children in an array the client is already walking, so it is the same arithmetic as
      `src/domain/explored-agg.ts` over the same bytes the fog is drawn from. D-238 records it.
- [x] Main-thread cull time measured under 2 ms, and ~0 ms for pans inside the padded region.
      — **0.18 ms** warm on a 150k fixture; a pan inside the padded region runs no cull at all.
- [ ] **(operator)** The zoom ladder reads as one material on the desktop browser over ground the
      operator recognises: a continuous z17→z4→z17 gesture with no flicker, no blank, no boundary that
      announces itself; sparse ground at z10–12 a dim wash rather than a uniform slab; z14 still the
      res-11 fog approved in `0194`. — **added by this ticket, not in the original set.** Eleven
      machine-checkable criteria cannot answer whether seven coarse buckets look like the same fog,
      and nobody has ever seen this app render anything but res 11 at one zoom. See
      `## Operator validation` for the four checks.

## Notes

If the 30–80 ms `cellToParent` pass ever shows as a visible hitch on a zoom-out, move bucket
derivation to a Web Worker. Not needed at MVP volumes; noted so it is not a surprise.

Sending all cells to the GPU without bucketing falls over past ~100k — massive overdraw at low zoom
and VRAM churn. It is on the do-not-retry list for the same reason one-draw-call-per-cell is.

## Resolution

**`05` §6 was written against res 10 and `08` now renders res 11**, so four of this ticket's own
numbers were stale before work started. They were put to the operator as one round of questions before
any code was written, and all four recommendations were accepted. **D-238** records the amendments;
the criteria above carry them individually.

### The four things the ticket had wrong

1. **The zoom table.** Appending res 11 to §6.1's table — the obvious amendment — leaves res 10 at
   z14–16, which is the browsing band, and the 102 m brush there is exactly the zig-zag `0194` was
   taken to remove. Rewritten from the rule the table is actually derived from (a cell ≈ 15 CSS px,
   each resolution 1.4 zoom levels), so res 11 owns z14 up.
2. **The 6,000-instance ceiling was arithmetically unreachable at res 11** with D-232's bridges, and
   the criterion named no viewport. Both fixed; see 5 below and D-238.
3. **`explored-agg.json` cannot be read from the browser at all**, so criterion 10 was unbuildable as
   written. The fraction is computed from the cell array instead — cheaper, exact, covers all seven
   coarse buckets rather than three, and cannot disagree with the blob.
4. **The res-6 grouping** was §6.2's *"third payoff of one decision"*, and that decision's arithmetic
   was 2,401 children. D-237 made it 16,807.

### What was built

| | |
|---|---|
| `lib/fog/zoom-buckets.ts` | the table, `resForZoom`, `groupResFor`, the group index, per-group geometry, delta invalidation |
| `lib/fog/cull.ts` | the two-level cull, the padded box, the mercator conversion |
| `lib/fog/viewport-controller.ts` | when to cull and when not to: the padded region, the debounce, the hidden switch |
| `lib/fog/instances.ts` | interior-bridge elision; `member`/`fractionOf` callbacks so a group can bridge across its own boundary |
| `lib/fog/mask-layer.ts` | `setInstances`, `maskDirty`, `setHidden` |
| `components/map/use-fog-mask.ts` | the store, the controller, and the one visibility subscription all three share |
| `tools/fog-harness/cull-harness.js`, `run-cull.mjs` | the whole path inside a real MapLibre Map |

### Three findings that were not in the plan

**The bridge pass is the expensive thing at scale, and §6.1's 30–80 ms budget does not include it.**
Measured at 500k res-11 cells: `gridDisk` over every cell is **1,543 ms** — five seconds on a phone —
against 256 ms for the `cellToParent` dedupe and 214 ms for the projection. §6.1's *"derive a bucket
lazily, once"* is not enough on its own, because the bucket being derived is mostly cells that will
never be on screen. So the laziness goes one level deeper: only the group **index** is built up front,
and it is *not* an O(n) pass — an ancestor is a prefix of a cell's id, so the array `0054` decodes is
already grouped and the runs are found by galloping binary search. **151,201 cells into 90 groups in
3.2 ms.** Ids, fractions, projection and bridges are derived per group on first sight, ~10 ms each.
That is the same principle as the cull, applied to derivation.

**H3's hierarchy is not geometrically nested, and the first margin was 30× too small.** A group's bbox
comes from `cellToBoundary(groupId)`, and the first implementation padded it by four disc radii (155 m)
on the assumption that a child straddles its parent's boundary by about half a cell. Measured, a
child's centre can be **184 m outside** — up to ~0.13 × the parent's edge length, at three latitudes.
Caught by a test that asserted containment rather than by looking at the map, which matters: the
symptom would have been fog missing at a group seam, appearing and disappearing as you pan, and it
would have been blamed on the shader. Padding is now half the group's edge length plus two disc radii,
and the estimate is replaced by the exact bbox of the group's discs the moment they exist.

**A camera rebuild was clearing `0057`'s optimistic corridor.** `0055` only ever rebuilt the instance
buffer on a data change, so criterion 5's *"cleared on the next bucket rebuild"* and "cleared when the
cells arrive" were the same sentence. They are not once a pan can rebuild the buffer: the optimistic
reveal would vanish the moment the operator moved the map, during exactly the few seconds it exists to
cover. `setInstances` now takes `supersedesRoute`, and the controller sets it only on a data refresh —
so `0057`'s criterion is preserved as what it meant rather than as what it said.

**A delta must invalidate a touched group's NEIGHBOURS too.** `instances.ts` gives each adjacent pair's
bridge to the lower id's group, so a new cell in group A can own a bridge that group B emits. Without
the neighbour expansion, B keeps cached geometry that is missing a bridge to ground that is now
revealed — a one-disc pinch at a group boundary, permanent until something else invalidated B. Found
while writing the invalidation test, not by it.

### What went wrong

**The zoom table was drafted one level too coarse and the arithmetic was presented to the operator
that way.** MapLibre's world is 512 CSS px square at z0, so its scale at zoom z matches a 256-px tile
scheme's at z+1 — and the `156543.03 · cos(lat) / 2^z` metres-per-pixel figure is the 256-px one. The
first derivation used it, which put res 11's band at z15 and up and left res 10 at z14: the very
defect the amendment existed to prevent, arrived at by arithmetic rather than by choice. Caught before
any code was written, corrected in the table, and written into §6.1 and D-238 so it is not redrafted
wrong. The operator was told *"res 11 owns z≥15"* and what shipped is z≥14.

**The cull harness cannot read pixels, and an hour went into finding that out.** `readPixels` on the
default framebuffer after `map.redraw()` returns all zeroes under headless SwiftShader, with and
without `preserveDrawingBuffer`. The check was replaced with a stronger one for what this ticket
actually changed — that a survivor disc covers the camera position, and that survivors lie inside the
padded box MapLibre's own bounds produced — which names the number that would be wrong where a
luminance comparison would only say "something is off". Recorded in the harness README.

**`?fog=mask`'s greyscale blit and `0056`'s composite both survived untouched**, but one existing test
had to change its meaning rather than its numbers: *"uploads once per bucket, not once per frame"* also
asserted five draw calls for five frames. With `maskDirty` that is one, which is the point of the
flag — so the draw-call half moved into its own `describe` and the upload half stayed where it was.
The res-10 literals in `instances.test.ts`, `route-corridor.test.ts` and `mask-layer.test.ts` are now
read off `RES`.

### Drift from `0194`, fixed here

`0194` amended `05` §2.1 and §9.4 for D-237 and missed four places that still asserted res 10, two of
them as instructions:

- the **standing correction at the top of the document**, which told the reader to read "res 10"
  wherever R3 and R4 say res 11 — now inverted by D-237, and the most actively misleading of the four;
- **Appendix A invariant 4**, *"Cells are res 10, never mixed"*, in the section headed *invariants an
  implementer must not violate*;
- invariant 10's render radius, still 102 m;
- §2.1's `uncompactCells(arr, 10)` and its *"the escape hatch is real … if res 10 ever proves too
  coarse"*, which describes as hypothetical a migration that has already happened.

Fixed rather than filed, because they are one line each, they are in the section this ticket is
implementing, and a wrong hard constraint is worse than a wrong comment.

### Left deliberately undone

- **The optimistic corridor (`0057`) stays at `RES` rather than following the bucket**, though
  `route-corridor.ts` anticipated `0058` passing it a resolution. The corridor exists for the seconds
  between a sync completing and the cell write coming back, which is looked at on the run you have just
  done, at a running zoom — where the bucket *is* `RES`. Following the bucket would mean repacking
  inside `FogMaskLayer`, and that is the one module forbidden from importing h3 at all
  (`no-per-frame-projection.test.ts`). Its default was res 10 and is now `RES`; the reasoning is in
  the file.
- **`0059` still owns the measurement.** Everything here is asserted against fixtures on a laptop and
  the numbers are printed with that caveat. GPU pass timings, frame-time p95, long tasks and peak heap
  are `0059`'s, on the phone.
- **The HUD does not surface the cull's numbers.** `mask-hud.tsx` shows `visibleInstanceCount`, which
  is now the culled count and is the number that matters; `groupsTested`/`groupsKept`/`ms` are on
  `FogViewportController.stats()` for `0059` to sample rather than being new chrome.

## Operator validation

### ★ WHAT NEEDS A HUMAN — on the desktop browser (D-227) ★

The ticket as filed asked for four phone tasks against loaded synthetic fixtures. That is what D-229
narrowed `## Operator validation` to exclude: the phone belongs to `0059`, and constructing a
150k-cell fixture in the browser is not something to ask a person to do. What is left is the part two
competent people could disagree about by looking at it, over ground the operator recognises:

1. **Zoom out from z17 to z4 in one continuous gesture, then back in.** The fog must stay the same
   *material* the whole way — it should thicken and simplify, never flicker, never blink out at a
   boundary, and never go momentarily blank. If any zoom shows no fog at all, that is the bucket ladder
   failing and this ticket is not done.
2. **At z10–12 over Nocatee, does sparse ground read as a dim wash and dense ground as solid?** This is
   the coarse-bucket `fraction` doing its job (§6.1: *"without this, zooming out turns a sparse city
   into a solid slab"*). A uniform slab at those zooms is the failure.
3. **Pan in small steps at z15 for half a minute.** The fog must stay glued to the ground — no lag, no
   sliding, no edge creeping in from the side of the screen. This is the padded region: the buffer is
   not being rebuilt for most of those pans, and if the padding is wrong it shows up as fog arriving
   late at the leading edge.
4. **Does z14 still look right?** This is the zoom the res band moved to, and the one D-238's
   arithmetic was re-derived for. It should read as the res-11 fog the operator approved in `0194`,
   not as the res-10 brush.

### Verified here, not routed to the operator (D-181/D-229)

- **The full gate set, by exit code** — not by reading a tail. **1,987 tests** across 109 files pass;
  eleven guard scripts (`check-boundaries`, `check-fog-render-boundary`, `check-fog-hot-path`,
  `check-fixture-geography`, `check-design-tokens`, `check-no-deckgl`, `check-adapter-deletion`,
  `check-bundle-leak`, `check-home-not-in-client`, `check-auth-posture`, `check-skills`) all exit 0;
  `tsc --noEmit` 0; `eslint . --max-warnings 0` 0; `npm run build` 0. The generated `public/maplibre`
  was removed first, per `0188`/`0190`.
- **The whole path inside a real MapLibre Map**, headless Chromium on SwiftShader —
  `node tools/fog-harness/run-cull.mjs`, **CULL HARNESS PASS**, exit 0. The real `ZoomBucketStore` and
  `FogViewportController` attached to real `move`/`zoom` events over 4,921 real res-11 cells:

  ```
  geometry    2 discs cover the camera, 299/2155 wholly outside the padded box (whole-group copies)
  bounds      maplibre gave x 0.157204..0.157280  y 0.656030..0.656077
  path        z17:162  z16:560  z15:2155  z14:5217  z13:1039  z12:219  z11:60
              z10:60   z9:19    z8:6      z7:6      z6:3      z5:1
  derivations 8 bucket indexes, 25 group geometries
  passes      16 mask passes, 16 composites, gl.getError 0x0, state restored
  ```

  The resolution at every zoom matched `ZOOM_TO_RES`, no bucket derived to zero instances, a pan inside
  the padded region rebuilt nothing and one that left it rebuilt exactly once. **The geometry check is
  the one that matters**: a flipped mercator y or a west/east swap produces instances — the counts would
  look right — and puts them on the wrong ground. It asserts a survivor disc actually covers the camera
  position at the centre of a 2 km explored disc.
- **`maskDirty` proved in MapLibre's own frame loop**, which is where it counts:
  `node tools/fog-harness/run-maplibre.mjs` reports **1 mask pass across 92 `prerender` calls** on a
  still camera, still MAPLIBRE HARNESS PASS, exit 0. Before this ticket that was 92 passes.
- **The canary, measured rather than asserted** (`lib/fog/cull.test.ts`), 400×800 CSS px, solid ground:

  ```
    50k (49,537 cells)   z5:1 z6:6  z8:22  z9:72  z11:303  z12:1159 z13:3062 z14:5271 z15:1383 z16:378 z17:111
   150k (151,201 cells)  z5:1 z6:12 z8:44  z9:158 z11:674  z12:1861 z13:3062 z14:5271 z15:1383 z16:378 z17:111
   500k (500,617 cells)  z5:6 z6:28 z8:101 z9:390 z11:1113 z12:1784 z13:3062 z14:5271 z15:1383 z16:378 z17:111
  ```

  Peak 5,271 of 6,000, and **identical across a 10× range of dataset size from z13 up**. The desktop
  figure is recorded alongside: 12,007 at z13, 20,812 at z14, 5,331 at z15 on 1440×900.
- **Step 1's compare count and the cull's wall clock**, printed by the same suite: 90 groups tested
  and 6 kept on a 151,201-cell fixture, 14,406 discs tested in step 2, **0.18 ms** for a warm cull.
- **Nothing is deployed yet.** This is a client-only change with no infrastructure and no API surface,
  so there is no AWS smoke test to run beyond the build; the deploy goes out with the commit and the
  four perception checks above are against that deploy.
