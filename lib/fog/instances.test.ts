import { cellToLatLng, getHexagonEdgeLengthAvg, gridDisk, latLngToCell } from "h3-js"
import { describe, expect, it } from "vitest"

import { cellToBig } from "@/src/domain/explored-blob"
import { RES } from "@/src/domain/fog"

import {
  EARTH_CIRCUMFERENCE_M,
  CANONICAL_CIRCUMRADIUS_M,
  blobCellsToIds,
  discRadiusM,
  mercatorX,
  mercatorY,
  metresToMercator,
  packBucket,
} from "./instances"
import { INSTANCE_FLOATS, REVEAL_SCALE } from "./mask"

/**
 * Ticket `0055`, criteria 5 and 8. `05-fog-of-war.md` §2.1, §4.1, §6.1.
 *
 * POINT NEMO THROUGHOUT — 48°52.6'S 123°23.6'W, the oceanic pole of inaccessibility. D-199 and
 * `08-security-privacy.md` §7.2: this repository is public and a committed coordinate near where
 * the operator runs is the leak `scripts/check-fixture-geography.mjs` exists to prevent. A latitude
 * far from the equator is also the better test — the `cos(lat)` correction in `metresToMercator` is
 * invisible at 0° and a third of the answer at -49°.
 */
const NEMO = { lat: -48.876, lng: -123.393 }

describe("§2.1's geometry", () => {
  /**
   * The design states 28.7 m at res 11; h3-js says 28.664. Asserted rather than assumed so that an
   * h3 upgrade which changes the average-edge-length table becomes a failing test instead of a fog
   * that quietly renders at the wrong radius — the drift D-153's audits exist to catch, caught
   * earlier. Read off `RES` rather than a literal 11, so D-237's successor moves it too.
   */
  it("agrees with h3-js on the canonical circumradius", () => {
    expect(getHexagonEdgeLengthAvg(RES, "m")).toBeCloseTo(CANONICAL_CIRCUMRADIUS_M, 1)
  })

  it("uses the spherical earth this project uses everywhere else, not WGS84 equatorial", () => {
    // `src/domain/geo.ts`'s EARTH_RADIUS_M. The equatorial figure is 6_378_137 and using it here
    // would be a 0.11% error: too small to see, too large to accept (§2.3).
    expect(EARTH_CIRCUMFERENCE_M).toBeCloseTo(2 * Math.PI * 6_371_008.8, 3)
  })

  it("scales the disc radius with the bucket's resolution", () => {
    expect(discRadiusM(10)).toBeCloseTo(REVEAL_SCALE * 75.864, 2)
    // Coarse buckets are the same material, just larger — `0058` renders them the same way.
    expect(discRadiusM(8)).toBeGreaterThan(discRadiusM(9))
    expect(discRadiusM(8) / discRadiusM(9)).toBeCloseTo(
      getHexagonEdgeLengthAvg(8, "m") / getHexagonEdgeLengthAvg(9, "m"),
      6,
    )
  })
})

describe("web mercator", () => {
  it("maps the origin to the centre of the 0..1 square", () => {
    expect(mercatorX(0)).toBeCloseTo(0.5, 12)
    expect(mercatorY(0)).toBeCloseTo(0.5, 12)
  })

  it("maps the antimeridian and the mercator latitude limits to the unit square's edges", () => {
    expect(mercatorX(-180)).toBeCloseTo(0, 12)
    expect(mercatorX(180)).toBeCloseTo(1, 12)
    expect(mercatorY(85.0511287798066)).toBeCloseTo(0, 9)
    expect(mercatorY(-85.0511287798066)).toBeCloseTo(1, 9)
  })

  /**
   * The `cos(lat)` is the whole content of `metresToMercator`, and this is the assertion that would
   * fail if it were dropped: at Point Nemo one metre is 1.52x as many mercator units as at the
   * equator, because mercator stretches ground toward the poles.
   */
  it("costs more mercator units per metre away from the equator", () => {
    const atEquator = metresToMercator(1000, 0)
    const atNemo = metresToMercator(1000, NEMO.lat)
    expect(atNemo / atEquator).toBeCloseTo(1 / Math.cos((NEMO.lat * Math.PI) / 180), 9)
    expect(atNemo).toBeGreaterThan(atEquator)
  })

  it("round-trips a known ground distance through the projection", () => {
    // One degree of longitude at the equator is circumference/360 metres, and 1/360 of mercator x.
    const oneDegreeM = EARTH_CIRCUMFERENCE_M / 360
    expect(metresToMercator(oneDegreeM, 0)).toBeCloseTo(1 / 360, 12)
    expect(mercatorX(1) - mercatorX(0)).toBeCloseTo(1 / 360, 12)
  })
})

describe("packBucket — criterion 5's layout", () => {
  const origin = latLngToCell(NEMO.lat, NEMO.lng, RES)

  it("writes centre, radius and fraction in that order, four floats per instance", () => {
    const { instances, count, res } = packBucket([origin])
    expect(res).toBe(RES)
    expect(count).toBe(1)
    expect(instances).toHaveLength(INSTANCE_FLOATS)

    const [lat, lng] = cellToLatLng(origin)
    expect(instances[0]).toBeCloseTo(mercatorX(lng), 6)
    expect(instances[1]).toBeCloseTo(mercatorY(lat), 6)
    // A ratio, not an absolute difference: two mercator values near 0.16 whose difference is ~1e-6
    // cancel most of a float32's significand, and an absolute tolerance there is meaningless. 0118
    // lost a test run to exactly that.
    expect(instances[2]! / metresToMercator(discRadiusM(RES), lat)).toBeCloseTo(1, 5)
    expect(instances[3]).toBe(1)
  })

  it("defaults every stored cell to fraction 1.0", () => {
    // §1.1: a stored res-10 cell is explored, entirely. The canonical bucket needs no aggregate.
    const { instances } = packBucket(gridDisk(origin, 2))
    for (let i = 3; i < instances.length; i += INSTANCE_FLOATS) expect(instances[i]).toBe(1)
  })

  /**
   * CRITERION 8, the packing half. §6.1: *"a parent cell you've run 20% of is a dim glow, not a
   * solid block. Without this, zooming out turns a sparse city into a solid slab."* The rendering
   * half — that 0.2 actually reads as 20% of the coverage — is `tools/fog-harness`, because only a
   * GPU can answer it.
   */
  it("carries a coarse bucket's explored fraction through to the instance", () => {
    const parents = gridDisk(latLngToCell(NEMO.lat, NEMO.lng, 6), 1)
    const fractions = new Map(parents.map((p, i) => [p, i / parents.length]))
    const { instances, res } = packBucket(parents, { res: 6, fractionOf: (c) => fractions.get(c) })

    expect(res).toBe(6)
    parents.forEach((p, i) => {
      expect(instances[i * INSTANCE_FLOATS + 3]).toBeCloseTo(fractions.get(p)!, 6)
    })
    // And the coarse disc is far larger than a canonical one — the same 1.35 scale, a bigger cell.
    expect(instances[2]!).toBeGreaterThan(packBucket([origin]).instances[2]!)
  })

  it("clamps a fraction that is out of range rather than trusting it", () => {
    const cells = gridDisk(origin, 1).slice(0, 2)
    const out = new Map([
      [cells[0]!, 4],
      [cells[1]!, -1],
    ])
    const { instances } = packBucket(cells, { fractionOf: (c) => out.get(c) })
    // Above 1 a coarse cell would out-write a fully explored one under MAX; below 0 it vanishes.
    expect(instances[3]).toBe(1)
    expect(instances[INSTANCE_FLOATS + 3]).toBe(0)
  })

  it("packs an empty bucket without inventing an instance", () => {
    const { instances, count } = packBucket([])
    expect(count).toBe(0)
    expect(instances).toHaveLength(0)
  })

  /**
   * §6.1's rule, as an arithmetic fact rather than a promise: every projection this renderer does
   * happens once per cell, here. `no-per-frame-projection.test.ts` is the other half — it proves
   * nothing on the frame path can reach `cellToLatLng` at all.
   */
  it("projects each cell exactly once, and each bridge without projecting at all", () => {
    const cells = gridDisk(origin, 3)
    const { count, cells: n, bridges } = packBucket(cells)
    expect(n).toBe(cells.length)
    expect(n).toBe(37) // 3k^2 + 3k + 1 at k = 3
    // Bridges are midpoints of two already-projected centres — no `cellToLatLng`, no mercator call.
    expect(count).toBe(n + bridges)
    expect(bridges).toBeGreaterThan(0)
  })
})

/**
 * BRIDGE DISCS. **D-232**, and the reason is in `instances.ts`'s header: a run reveals a chain one
 * cell wide, and the union of discs at 121 m spacing has no coverage gap but a badly pinched
 * silhouette. `tools/fog-harness` measures the fix on a real GPU — a bare chain reads 0.50 of its
 * bulge at the waist, a bridged one reads 1.00.
 */
describe("bridge discs", () => {
  const origin = latLngToCell(NEMO.lat, NEMO.lng, RES)

  /** `gridDisk(c, 1)` includes `c` itself, so a neighbour is anything in it that is not `c`. */
  const neighboursOf = (c: string) => gridDisk(c, 1).filter((x) => x !== c)

  it("adds one disc per adjacent revealed pair, and each edge only once", () => {
    const pair = [origin, neighboursOf(origin)[0]!]
    const { cells, bridges } = packBucket(pair)
    expect(cells).toBe(2)
    // One edge, one bridge. The `neighbour <= cell` guard is what stops it being two.
    expect(bridges).toBe(1)

    // Three mutually adjacent cells form a triangle: three edges, three bridges, not six.
    const a = origin
    const b = neighboursOf(a)[0]!
    const c = neighboursOf(a).find((x) => neighboursOf(b).includes(x))!
    expect(packBucket([a, b, c]).bridges).toBe(3)
  })

  it("bridges only cells that are actually adjacent", () => {
    // Two cells four steps apart share no edge, so there is nothing to bridge.
    const far = gridDisk(origin, 4).filter((c) => !gridDisk(origin, 1).includes(c))
    const { cells, bridges } = packBucket([origin, far[0]!])
    expect(cells).toBe(2)
    expect(bridges).toBe(0)
  })

  it("puts the bridge at the midpoint, at the same radius", () => {
    const pair = [origin, neighboursOf(origin)[0]!]
    const { instances, cells } = packBucket(pair)
    const at = (i: number) => ({
      x: instances[i * INSTANCE_FLOATS]!,
      y: instances[i * INSTANCE_FLOATS + 1]!,
      r: instances[i * INSTANCE_FLOATS + 2]!,
    })
    const a = at(0)
    const b = at(1)
    const bridge = at(cells) // bridges follow the cells
    // Ratios, not absolute differences: these are float32 values near 0.157 whose difference is
    // ~1e-6, so an absolute tolerance measures the storage format rather than the arithmetic.
    expect(bridge.x / ((a.x + b.x) / 2)).toBeCloseTo(1, 7)
    expect(bridge.y / ((a.y + b.y) / 2)).toBeCloseTo(1, 7)
    expect(bridge.r / ((a.r + b.r) / 2)).toBeCloseTo(1, 6)
  })

  /**
   * `min`, not the average. Under `MAX` a bridge brighter than its dimmer endpoint would raise the
   * mask above what either cell earned — inventing coverage rather than filling a waist. A no-op at
   * the canonical resolution where everything is 1.0; it matters for `0058`'s coarse buckets.
   */
  it("takes the dimmer endpoint's fraction, never a brighter one", () => {
    const pair = [origin, neighboursOf(origin)[0]!]
    const dim = new Map([
      [pair[0]!, 0.2],
      [pair[1]!, 0.9],
    ])
    const { instances, cells } = packBucket(pair, { fractionOf: (c) => dim.get(c) })
    expect(instances[cells * INSTANCE_FLOATS + 3]).toBeCloseTo(0.2, 6)
  })

  it("can be turned off, so the bare cell field stays measurable", () => {
    const cells = gridDisk(origin, 2)
    const bare = packBucket(cells, { densify: false })
    expect(bare.bridges).toBe(0)
    expect(bare.count).toBe(cells.length)
    expect(packBucket(cells).bridges).toBeGreaterThan(0)
  })

  /**
   * §6.4 item 1 asserts `visibleInstanceCount <= 6,000`, and D-238 is the reason that assertion
   * survived D-237: bridges count toward it, and at res 11 a 4x multiplier on 7x the cells put a
   * fully-revealed phone viewport at ~14,700 instances.
   *
   * THE TWO SHAPES ARE MEASURED SEPARATELY BECAUSE THEY MUST BEHAVE DIFFERENTLY. A solid field has
   * almost no silhouette to fix and must collapse toward 1x; a corridor is the case D-232 was built
   * for and must keep essentially all of its bridges. A change that helped the first at the second's
   * expense would pass a single combined assertion and put the string of pearls back on screen.
   */
  it("collapses to ~1x on a solid field, because an interior edge has no waist to fill", () => {
    const solid = gridDisk(origin, 40)
    const { cells, bridges, count } = packBucket(solid)

    // 4,921 cells, 14,520 adjacent pairs, and all but 714 of them interior-to-interior.
    expect(cells).toBe(4921)
    expect(bridges).toBeLessThan(cells * 0.2)
    expect(count / cells).toBeLessThan(1.2)

    // The bare ceiling, for contrast, counted here rather than coaxed out of `packBucket`: 6
    // neighbours each and every edge once is 3 per cell, and that is what shipped before D-238.
    const set = new Set(solid)
    let edges = 0
    for (const c of solid) for (const n of gridDisk(c, 1)) if (n > c && set.has(n)) edges++
    expect(edges).toBeGreaterThan(cells * 2.5)
    expect(bridges / edges).toBeLessThan(0.1)
  })

  it("keeps a corridor's bridges, which is the case D-232 was built for", () => {
    // A one-cell-wide chain: every cell has two revealed neighbours, none is interior, nothing is
    // elided. This is the string of pearls, and it must still be bridged edge for edge.
    const chain: string[] = [origin]
    for (let i = 0; i < 40; i++) {
      const next = neighboursOf(chain[chain.length - 1]!).find((c) => !chain.includes(c))!
      chain.push(next)
    }
    const { cells, bridges } = packBucket(chain)
    expect(cells).toBe(41)
    // 40 adjacent pairs along the chain; a walk that doubles back can add a few more.
    expect(bridges).toBeGreaterThanOrEqual(40)
  })

  /**
   * `0058` packs one res-6/7 group at a time, so the cells it hands over are a SLICE of the revealed
   * set rather than all of it. Without `member` the last cell before a group boundary would find no
   * neighbour on the far side and the seam would show as a pinch in the silhouette — the exact
   * defect D-232 removed, reintroduced on a grid of its own.
   */
  it("bridges across the edge of the slice it was given, when told what else is revealed", () => {
    const higher = neighboursOf(origin).find((c) => c > origin)!
    const alone = packBucket([origin])
    expect(alone.bridges).toBe(0)

    const spanning = packBucket([origin], { member: (c) => c === origin || c === higher })
    expect(spanning.cells).toBe(1)
    expect(spanning.bridges).toBe(1)
    // The far endpoint is projected on demand, so the bridge lands at the true midpoint rather
    // than on top of the one cell this call was given.
    const both = packBucket([origin, higher])
    const x = (p: { instances: Float32Array }, i: number) => p.instances[i * INSTANCE_FLOATS]!
    expect(x(spanning, 1)).toBeCloseTo(x(both, 2), 6)
  })

  /**
   * WHICH SIDE OF A GROUP BOUNDARY EMITS THE BRIDGE, stated as a test because `0058` depends on it.
   *
   * `neighbour <= cell` makes the LOWER id's group the owner of every edge. Across a group boundary
   * that means one group emits a disc that lies partly outside its own bbox — which is why
   * `zoom-buckets.ts` pads each group's bounds — and the other emits nothing. Exactly once either
   * way, which is the property that matters: a duplicated bridge is invisible under `MAX` but counts
   * against §6.4's ceiling, and a missed one is a visible pinch.
   */
  it("gives each cross-slice edge to exactly one side, the lower id", () => {
    const lower = neighboursOf(origin).find((c) => c < origin)!
    const isPair = (c: string) => c === origin || c === lower
    expect(packBucket([origin], { member: isPair }).bridges).toBe(0)
    expect(packBucket([lower], { member: isPair }).bridges).toBe(1)
  })
})

describe("blobCellsToIds", () => {
  it("turns 0054's decoded array back into the ids packBucket takes", () => {
    const cells = gridDisk(latLngToCell(NEMO.lat, NEMO.lng, RES), 2)
    const blob = BigUint64Array.from(cells.map((c) => cellToBig(c)))
    expect(blobCellsToIds(blob)).toEqual(cells)
  })

  it("returns nothing for an empty set", () => {
    expect(blobCellsToIds(new BigUint64Array(0))).toEqual([])
  })
})
