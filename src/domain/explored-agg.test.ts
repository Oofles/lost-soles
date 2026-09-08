import { cellToParent, gridDisk, latLngToCell } from "h3-js"
import { describe, expect, it } from "vitest"

import { AGG_RESOLUTIONS, computeAgg, totalChildren, touchedParents } from "./explored-agg"
import { bigToCell, cellToBig } from "./explored-blob"
import { RES } from "./fog"

/** Synthetic geography, Point Nemo (08 §7.2, D-199). */
const ORIGIN = latLngToCell(-48.876, -123.393, RES)
const sortBig = (cells: readonly string[]): bigint[] =>
  cells.map(cellToBig).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))

describe("totalChildren", () => {
  it("is 7^(10-res) — the constant 02 T6 fixes", () => {
    expect(totalChildren(6)).toBe(2401)
    expect(totalChildren(7)).toBe(343)
    expect(totalChildren(8)).toBe(49)
  })
})

describe("computeAgg", () => {
  const cells = sortBig(gridDisk(ORIGIN, 30))

  /**
   * CRITERION 3, and the brute force is the point: `computeAgg` rolls res-7 up from res-8
   * and res-6 up from res-7 to avoid 3 × 150,000 H3 calls. That optimisation is only sound
   * because `cellToParent` is transitive, and this asserts the transitivity rather than
   * assuming it — one independent `cellToParent(cell, res)` per cell per level.
   */
  it("fractions match a brute-force count over the cell set", () => {
    const agg = computeAgg(cells, 1)

    for (const res of AGG_RESOLUTIONS) {
      const brute = new Map<string, number>()
      for (const cell of cells) {
        const parent = cellToParent(bigToCell(cell), res)
        brute.set(parent, (brute.get(parent) ?? 0) + 1)
      }

      const level = agg.levels[String(res)]!
      expect(Object.keys(level).sort()).toEqual([...brute.keys()].sort())
      for (const [parent, count] of brute) {
        expect(level[parent]!.exploredChildren).toBe(count)
        expect(level[parent]!.totalChildren).toBe(totalChildren(res))
        expect(level[parent]!.fraction).toBeCloseTo(count / totalChildren(res), 6)
      }
    }
  })

  it("every level accounts for every cell exactly once", () => {
    const agg = computeAgg(cells, 1)
    for (const res of AGG_RESOLUTIONS) {
      const summed = Object.values(agg.levels[String(res)]!).reduce(
        (n, e) => n + e.exploredChildren,
        0,
      )
      expect(summed).toBe(cells.length)
    }
  })

  it("never reports a fraction above 1 — the denominator is a real ceiling", () => {
    // A res-6 parent holds at most 2,401 res-10 children. A disc big enough to fill one
    // would break the claim if `totalChildren` were wrong.
    const agg = computeAgg(sortBig(gridDisk(ORIGIN, 60)), 1)
    for (const res of AGG_RESOLUTIONS) {
      for (const entry of Object.values(agg.levels[String(res)]!)) {
        expect(entry.fraction).toBeLessThanOrEqual(1)
        expect(entry.exploredChildren).toBeLessThanOrEqual(entry.totalChildren)
      }
    }
  })

  it("carries its generation and res in the body, not only in the filename", () => {
    const agg = computeAgg(cells, 412)
    expect(agg.generation).toBe(412)
    expect(agg.res).toBe(RES)
  })

  /**
   * Byte-stability is what lets `explored-rebuild.test.ts` compare an AP-17 aggregate to an
   * incremental one with `toEqual` on the serialised form rather than on a parsed object.
   */
  it("serialises identically for the same set regardless of input order", () => {
    const shuffled = [...cells].reverse()
    expect(JSON.stringify(computeAgg(shuffled, 1))).toBe(JSON.stringify(computeAgg(cells, 1)))
  })

  /**
   * `05` §7.2 calls this object *"a few KB"* and fetches it at app load beside the set. The
   * measured figure at R3's five-year pessimistic size is 279 KB uncompressed and **12.8 KB
   * gzipped**, which is what actually ships (`explored-blob-store.test.ts` measures that
   * half, where `node:zlib` already belongs). So §7.2's "a few KB" is right about the wire
   * and wrong about the object, and it was left as written: the number that matters is the
   * one that crosses the network, and 12.8 KB beside a 450 KB set is noise.
   *
   * 85 res-6 parents for a 152,551-cell disc sits inside `02` T6's own partition math —
   * *"~20-60 in a home metro after five years, ~100-200 including travel"* — which is the
   * more load-bearing claim, because it is what bounds AP-17's query count.
   */
  it("stays small beside the set it accompanies, at R3's five-year size", () => {
    const agg = computeAgg(sortBig(gridDisk(ORIGIN, 225)), 1)
    const bytes = Buffer.byteLength(JSON.stringify(agg))
    expect(bytes).toBeLessThan(400_000)
    expect(Object.keys(agg.levels["6"]!).length).toBeLessThan(200)
    // res-8 is the level with the most parents, and the one the opacity ramp uses closest in.
    expect(Object.keys(agg.levels["8"]!).length).toBeGreaterThan(
      Object.keys(agg.levels["6"]!).length,
    )
  })

  it("handles the empty set", () => {
    const agg = computeAgg([], 1)
    for (const res of AGG_RESOLUTIONS) expect(agg.levels[String(res)]).toEqual({})
  })
})

describe("touchedParents", () => {
  it("gives one to two res-6 parents for a run-sized cell set — 02 T6's partition math", () => {
    const run = gridDisk(ORIGIN, 6)
    const parents = touchedParents(run)
    expect(parents.get(6)!.size).toBeLessThanOrEqual(2)
    expect(parents.get(6)!.size).toBeGreaterThan(0)
  })

  it("returns every level, and each parent is the ancestor of at least one input cell", () => {
    const run = gridDisk(ORIGIN, 4)
    const parents = touchedParents(run)
    for (const res of AGG_RESOLUTIONS) {
      for (const parent of parents.get(res)!) {
        expect(run.some((c) => cellToParent(c, res) === parent)).toBe(true)
      }
    }
  })
})
