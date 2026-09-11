import { describe, expect, it, vi } from "vitest"

import type { CullableBucket, MercatorBox } from "./cull"
import { prefetchSlice, PREFETCH_PAD, PREFETCH_SLICE_MS } from "./prefetch"

/**
 * Ticket `0202`. `05-fog-of-war.md` §6.3.
 *
 * The bucket is a fake with hand-written bounds, the same technique `cull.test.ts` uses — because
 * what is under test is the WALK and the TIME SLICE, neither of which needs h3 or an `ExploredSet`.
 * A `derive` spy is the only way to assert the thing that matters: which groups were materialised,
 * and how many times.
 */
function fakeBucket(bounds: Array<[number, number, number, number]>, costMs = 0) {
  const derived: number[] = []
  const cache = new Map<number, Float32Array>()
  let clock = 0
  const flat = new Float64Array(bounds.length * 4)
  bounds.forEach((b, i) => flat.set(b, i * 4))

  const bucket: CullableBucket = {
    res: 11,
    groupCount: bounds.length,
    groupBounds: flat,
    discsFor: vi.fn((g: number) => {
      // Idempotent and cached, exactly like the real one — a warm group must cost nothing.
      const hit = cache.get(g)
      if (hit) return hit
      derived.push(g)
      clock += costMs
      const made = Float32Array.from([0, 0, 1, 1])
      cache.set(g, made)
      return made
    }),
  }
  return { bucket, derived, now: () => clock }
}

const BOX: MercatorBox = { minX: 0, minY: 0, maxX: 1, maxY: 1 }

describe("which groups it walks", () => {
  it("materialises the ones intersecting the box and skips the rest", () => {
    const { bucket, derived } = fakeBucket([
      [0.1, 0.1, 0.2, 0.2], // inside
      [5.0, 5.0, 6.0, 6.0], // far away
      [0.9, 0.9, 1.5, 1.5], // straddles the edge — still needed
      [-2.0, 0.1, -1.0, 0.2], // west of the box
    ])
    const progress = prefetchSlice(bucket, BOX, 0, 1000)
    expect(derived).toEqual([0, 2])
    expect(progress.done).toBe(true)
  })

  it("costs nothing for a group that is already warm", () => {
    const { bucket, derived } = fakeBucket([[0.1, 0.1, 0.2, 0.2]])
    prefetchSlice(bucket, BOX, 0, 1000)
    prefetchSlice(bucket, BOX, 0, 1000)
    // Walked twice, derived once — which is what makes it safe to re-walk on every rebuild.
    expect(derived).toEqual([0])
    expect(bucket.discsFor).toHaveBeenCalledTimes(2)
  })

  it("reports nothing to do as done, with no derivations", () => {
    const { bucket, derived } = fakeBucket([[5, 5, 6, 6]])
    const progress = prefetchSlice(bucket, BOX, 0, 1000)
    expect(derived).toEqual([])
    expect(progress).toMatchObject({ derived: 0, done: true })
  })
})

describe("the time slice", () => {
  const many = (n: number): Array<[number, number, number, number]> =>
    Array.from({ length: n }, () => [0.1, 0.1, 0.2, 0.2] as [number, number, number, number])

  it("stops at the budget and says where to resume", () => {
    const { bucket, derived, now } = fakeBucket(many(20), 3)
    const first = prefetchSlice(bucket, BOX, 0, 4, now)
    // 3 ms each against a 4 ms budget: two groups, then the check trips.
    expect(derived).toHaveLength(2)
    expect(first.done).toBe(false)

    const second = prefetchSlice(bucket, BOX, first.next, 4, now)
    expect(derived).toHaveLength(4)
    expect(second.next).toBeGreaterThan(first.next)
  })

  it("finishes the region across enough slices, and each one resumes where the last stopped", () => {
    const { bucket, derived, now } = fakeBucket(many(11), 3)
    let at = 0
    let slices = 0
    for (;;) {
      const progress = prefetchSlice(bucket, BOX, at, 4, now)
      at = progress.next
      slices++
      if (progress.done) break
      expect(slices).toBeLessThan(50)
    }
    expect(derived).toHaveLength(11)
    // No group derived twice, which is what `next` is for.
    expect(new Set(derived).size).toBe(11)
    expect(slices).toBeGreaterThan(1)
  })

  /**
   * A group costs 10-90 ms and the budget is 4 ms, so a budget checked BEFORE the work would do
   * nothing on every slice and the region would never warm. Overrunning by one group is the correct
   * trade and is the only reason this makes progress at all.
   */
  it("always derives at least one group, even when the budget is already blown", () => {
    const { bucket, derived, now } = fakeBucket(many(5), 100)
    const progress = prefetchSlice(bucket, BOX, 0, 0, now)
    expect(derived).toHaveLength(1)
    expect(progress.done).toBe(false)
  })
})

describe("the constants", () => {
  it("prefetches a wider region than §6.2 pads, or it would warm nothing new", () => {
    expect(PREFETCH_PAD).toBeGreaterThan(0.2)
  })

  it("keeps a slice well under a frame, since it runs in idle time", () => {
    expect(PREFETCH_SLICE_MS).toBeLessThan(16.7 / 2)
  })
})
