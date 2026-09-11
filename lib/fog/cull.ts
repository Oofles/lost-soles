import { INSTANCE_FLOATS } from "./mask"

/**
 * TWO-LEVEL VIEWPORT CULLING. Ticket `0058`. `05-fog-of-war.md` §6.2, §6.4.
 *
 * ─── WHY NOT THE OBVIOUS LOOP ───────────────────────────────────────────────
 *
 * R4's sketch culls by looping every cell in the bucket against the padded viewport: four float
 * compares each. §6.2 does the arithmetic and rejects it — at 150k cells that is 600,000 compares
 * **per mask rebuild**, the mask rebuilds every frame during a pan, and on a mid-range phone it is
 * 1–3 ms of main-thread JS in the frame path: *"the largest single cost in the whole system, and the
 * one thing that would break the 60 fps claim."*
 *
 * So the cull is two levels, over the grouping `zoom-buckets.ts` already built:
 *
 *   1. cull GROUPS against the padded viewport      a few hundred compares
 *   2. cull the surviving groups' discs             only what could be on screen
 *   3. write the survivors into the instance array
 *   4. `gl.bufferData`  (the caller's job — see `mask-layer.ts`)
 *
 * A group is ~5 km across at res 7 and ~36 km² at res 6; at running zooms the viewport intersects a
 * handful of them, so step 1 discards essentially the whole dataset in a few hundred comparisons.
 * That is the difference between a cull that grows with the database and one that grows with the
 * screen.
 *
 * ─── AND WHY THE OUTPUT IS A VIEW, NOT AN ARRAY ─────────────────────────────
 *
 * The survivors are written into a scratch buffer that the caller keeps and hands back. A pan that
 * leaves the padded region rebuilds ~4,000 instances; allocating 64 KB per rebuild would hand the GC
 * a steady drip of garbage during exactly the interaction §6.4 item 6 asserts has no long tasks. The
 * returned `instances` is a `subarray` view of that buffer, valid until the next cull.
 *
 * NOTHING HERE PROJECTS ANYTHING. Every number it compares was computed once per group in
 * `zoom-buckets.ts`; this file imports no h3 and no MapLibre, which is what lets it be exercised
 * against four hand-written bounds instead of a map.
 */

/** A mercator-space axis-aligned box, 0..1 in both axes. */
export interface MercatorBox {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/**
 * What the cull needs of a bucket. `ZoomBucket` implements it; a test can implement it in six lines.
 */
export interface CullableBucket {
  readonly res: number
  readonly groupCount: number
  /** 4 floats per group — `minX, minY, maxX, maxY`, already padded for its cells' discs. */
  readonly groupBounds: Float64Array
  /** The group's packed instances. Materialised on first call, so only survivors pay for it. */
  discsFor(group: number): Float32Array
}

export interface CullResult {
  /** A view of `buffer`. `count * INSTANCE_FLOATS` long, valid until the next cull. */
  instances: Float32Array
  /** §6.4 item 1's `visibleInstanceCount`. */
  count: number
  /** The buffer the view is into — pass it back as `reuse` next time. */
  buffer: Float32Array
  /** Step 1's work: groups compared. Criterion 4 wants this in the low hundreds at 150k cells. */
  groupsTested: number
  /** How many survived step 1 and had their geometry materialised. */
  groupsKept: number
  /** Step 2's work: discs compared. */
  discsTested: number
  /** `performance.now()` around the whole thing. §6.4 item 4 budgets < 2 ms. */
  ms: number
}

export const EMPTY_CULL: CullResult = {
  instances: new Float32Array(0),
  count: 0,
  buffer: new Float32Array(0),
  groupsTested: 0,
  groupsKept: 0,
  discsTested: 0,
  ms: 0,
}

/**
 * §6.2's *"pad the viewport by ~20%"*.
 *
 * The padding is what makes a small pan free: the instance buffer is rebuilt only when the camera
 * leaves the region it was built for, so scrolling a few hundred metres costs **zero** CPU and one
 * instanced draw call against a buffer that is already resident. 20% of the viewport's own width, so
 * it scales with the zoom rather than being a distance on the ground.
 */
export const VIEWPORT_PAD = 0.2

export function padBox(box: MercatorBox, pad: number = VIEWPORT_PAD): MercatorBox {
  const dx = (box.maxX - box.minX) * pad
  const dy = (box.maxY - box.minY) * pad
  return {
    minX: box.minX - dx,
    minY: box.minY - dy,
    maxX: box.maxX + dx,
    maxY: box.maxY + dy,
  }
}

/** Is `inner` entirely inside `outer`? The question `bufferDirty` is answered by. */
export function boxContains(outer: MercatorBox, inner: MercatorBox): boolean {
  return (
    inner.minX >= outer.minX &&
    inner.minY >= outer.minY &&
    inner.maxX <= outer.maxX &&
    inner.maxY <= outer.maxY
  )
}

/**
 * A MapLibre `LngLatBounds` → a mercator box.
 *
 * ANTIMERIDIAN AND WHOLE-WORLD VIEWS FALL BACK TO NO X-CULLING, rather than to a box with `minX >
 * maxX` that would cull everything and blank the map. At z4 the viewport is most of the world and the
 * cull's value is in the group level anyway; a wrapped box is the one input that turns this function
 * into a correctness bug rather than a slow path, so it is handled here instead of in every caller.
 */
export function boxFromLngLat(
  west: number,
  south: number,
  east: number,
  north: number,
  project: (lng: number, lat: number) => { x: number; y: number },
): MercatorBox {
  const wraps = east < west || east - west >= 360
  const sw = project(west, south)
  const ne = project(east, north)
  return {
    minX: wraps ? -1 : Math.min(sw.x, ne.x),
    maxX: wraps ? 2 : Math.max(sw.x, ne.x),
    // Mercator y runs south-up: the northern edge is the smaller number.
    minY: Math.min(sw.y, ne.y),
    maxY: Math.max(sw.y, ne.y),
  }
}

/**
 * Steps 1 to 3. Returns a view of `reuse` (grown if it has to be), never a fresh allocation when the
 * existing one fits.
 *
 * A WHOLE SURVIVING GROUP IS COPIED IN ONE `set()` when every one of its discs is inside the box,
 * which is the common case for an interior group at a running zoom: the group's own bbox is inside
 * the viewport, so per-disc compares cannot reject anything and the fastest correct thing to do is
 * a bulk copy. The per-disc path runs only for groups that straddle the edge.
 */
export function cullBucket(
  bucket: CullableBucket,
  box: MercatorBox,
  reuse: Float32Array | null = null,
): CullResult {
  const started = performance.now()
  const bounds = bucket.groupBounds
  const groups = bucket.groupCount

  /** Step 1, and it is the whole point of the file: which groups can possibly be on screen. */
  const survivors: number[] = []
  for (let g = 0; g < groups; g++) {
    const at = g * 4
    if (bounds[at + 2]! < box.minX) continue
    if (bounds[at + 0]! > box.maxX) continue
    if (bounds[at + 3]! < box.minY) continue
    if (bounds[at + 1]! > box.maxY) continue
    survivors.push(g)
  }

  if (survivors.length === 0) {
    const buffer = reuse ?? new Float32Array(0)
    return {
      instances: buffer.subarray(0, 0),
      count: 0,
      buffer,
      groupsTested: groups,
      groupsKept: 0,
      discsTested: 0,
      ms: performance.now() - started,
    }
  }

  // Materialise first, so the output buffer can be sized once rather than grown mid-write.
  const packed = survivors.map((g) => bucket.discsFor(g))
  let capacity = 0
  for (const discs of packed) capacity += discs.length
  const buffer =
    reuse && reuse.length >= capacity ? reuse : new Float32Array(Math.max(capacity, 1024))

  let out = 0
  let discsTested = 0
  for (let s = 0; s < survivors.length; s++) {
    const discs = packed[s]!
    const at = survivors[s]! * 4
    const whollyInside =
      bounds[at + 0]! >= box.minX &&
      bounds[at + 1]! >= box.minY &&
      bounds[at + 2]! <= box.maxX &&
      bounds[at + 3]! <= box.maxY
    if (whollyInside) {
      buffer.set(discs, out)
      out += discs.length
      continue
    }
    /** Step 2. The disc's bbox is `centre ± radius` — four adds, cheaper than storing it. */
    for (let i = 0; i < discs.length; i += INSTANCE_FLOATS) {
      discsTested++
      const x = discs[i]!
      const y = discs[i + 1]!
      const r = discs[i + 2]!
      if (x + r < box.minX || x - r > box.maxX || y + r < box.minY || y - r > box.maxY) continue
      buffer[out + 0] = x
      buffer[out + 1] = y
      buffer[out + 2] = r
      buffer[out + 3] = discs[i + 3]!
      out += INSTANCE_FLOATS
    }
  }

  return {
    instances: buffer.subarray(0, out),
    count: out / INSTANCE_FLOATS,
    buffer,
    groupsTested: groups,
    groupsKept: survivors.length,
    discsTested,
    ms: performance.now() - started,
  }
}
