import { latLngToCell } from "h3-js"
import { describe, expect, it } from "vitest"

import { RES } from "@/src/domain/fog"
import { metresBetween } from "@/src/domain/geo"
import type { RouteTraceGeometry } from "@/lib/runs/wire"

import { ExploredSet } from "./explored-set"
import { discRadiusM, mercatorX, mercatorY } from "./instances"
import { INSTANCE_FLOATS } from "./mask"
import {
  MAX_CORRIDOR_DISCS,
  corridorStepM,
  packCorridorForCollection,
  packRouteCorridor,
} from "./route-corridor"

/**
 * THE OPTIMISTIC CORRIDOR. Ticket `0057`, criteria 5, 6 and 8. `05-fog-of-war.md` §4.4.
 *
 * POINT NEMO THROUGHOUT (`08-security-privacy.md` §7.2, D-199) — the same synthetic origin every
 * other fog test uses, so no fixture in this repo is a map of where the operator actually lives.
 * The latitude is load-bearing rather than decorative: `metresToMercator` divides by `cos(lat)`,
 * so a test written at the equator would pass with the correction deleted.
 */
const NEMO = { lat: -48.876, lng: -123.393 }

/** Metres per degree of latitude on this project's sphere, near enough for laying out a fixture. */
const M_PER_DEG_LAT = 111_195

/** A straight north-going line of `metres`, as one `MultiLineString` part. */
function straight(metres: number, from = NEMO): [number, number][] {
  return [
    [from.lng, from.lat],
    [from.lng, from.lat + metres / M_PER_DEG_LAT],
  ]
}

const geometry = (...parts: [number, number][][]): RouteTraceGeometry => ({
  type: "MultiLineString",
  coordinates: parts,
})

/** The disc centres a pack describes, back in lng/lat, so assertions can be made in metres. */
function centres(instances: Float32Array): Array<{ lng: number; lat: number }> {
  const out: Array<{ lng: number; lat: number }> = []
  for (let i = 0; i < instances.length; i += INSTANCE_FLOATS) {
    const x = instances[i]!
    const y = instances[i + 1]!
    out.push({
      lng: (x - 0.5) * 360,
      lat: (Math.atan(Math.exp((0.5 - y) * 2 * Math.PI)) * 360) / Math.PI - 90,
    })
  }
  return out
}

describe("corridorStepM", () => {
  /**
   * D-232's number, arrived at from the other direction. Adjacent res-10 centres are 131.4 m
   * apart (§2.1's table); the corridor halves that, which is one bridge disc's worth. Asserted
   * against h3's own table rather than against 65.7, so an h3 upgrade moves both together.
   */
  it("is half the res-10 centre spacing", () => {
    expect(corridorStepM(10)).toBeGreaterThan(65)
    expect(corridorStepM(10)).toBeLessThan(66)
    // Coarser buckets scale with the cells they sit beside, which is what `0058` will need.
    expect(corridorStepM(6)).toBeGreaterThan(corridorStepM(10))
  })
})

describe("packRouteCorridor — the shape of the corridor", () => {
  it("places discs no further apart than one step, along the whole line", () => {
    const pack = packRouteCorridor(geometry(straight(1000)))
    const points = centres(pack.instances)

    expect(points.length).toBeGreaterThan(15)
    for (let i = 1; i < points.length; i++) {
      // Within a metre of the step: the walk interpolates linearly in lng/lat while the distance
      // is measured on the sphere, and over 65 m those disagree far below the tolerance here.
      expect(metresBetween(points[i - 1]!, points[i]!)).toBeLessThanOrEqual(corridorStepM(10) + 1)
    }
  })

  it("covers the last vertex, so the end of a run is not left fogged", () => {
    const line = straight(1000)
    const pack = packRouteCorridor(geometry(line))
    const end = { lng: line[1]![0], lat: line[1]![1] }
    const nearest = Math.min(...centres(pack.instances).map((p) => metresBetween(p, end)))
    /**
     * NOT ZERO, AND THE RESIDUE IS THE INSTANCE BUFFER'S PRECISION rather than a walk that
     * stopped short. Instances are `Float32Array` — a 24-bit mantissa over a mercator coordinate
     * in 0..1 resolves to roughly 0.6 m of ground here, which is what this measures.
     *
     * Worth an assertion rather than a loosened one, because it is the number that says float32
     * is the right storage: the disc it positions is 102 m across, so the error is under 1% of
     * the feather it sits inside and could not be seen at any zoom the map offers.
     */
    expect(nearest).toBeLessThan(1)
  })

  it("spaces by distance along the route, not by how often the watch sampled", () => {
    // The same 1 km, as two vertices and as 201 five-metre ones. A per-fix disc would give 201.
    const dense: [number, number][] = []
    for (let i = 0; i <= 200; i++) dense.push([NEMO.lng, NEMO.lat + (i * 5) / M_PER_DEG_LAT])

    const sparse = packRouteCorridor(geometry(straight(1000)))
    const packed = packRouteCorridor(geometry(dense))
    expect(packed.count).toBe(sparse.count)
  })

  it("carries the remainder across vertices instead of restarting at each one", () => {
    // Eight 20 m legs — every leg is shorter than one step, so a walk that reset its accumulator per
    // leg would emit nothing between the endpoints.
    const legs: [number, number][] = []
    for (let i = 0; i <= 8; i++) legs.push([NEMO.lng, NEMO.lat + (i * 20) / M_PER_DEG_LAT])
    const pack = packRouteCorridor(geometry(legs))
    // Derived from the step rather than written down, so a resolution change moves it (D-237 moved
    // the step from 65.7 m to 24.8 m and this assertion was a literal 4).
    const step = corridorStepM(RES)
    expect(pack.count).toBe(Math.floor(160 / step) + 1 + 1)
  })

  it("gives every disc the render radius and full weight", () => {
    const pack = packRouteCorridor(geometry(straight(300)))
    for (let i = 0; i < pack.instances.length; i += INSTANCE_FLOATS) {
      // The radius is in mercator units at this latitude; compare against the same conversion
      // rather than a literal, which is what makes the cos(lat) correction visible here.
      const expected =
        discRadiusM(RES) / (2 * Math.PI * 6_371_008.8 * Math.cos((NEMO.lat * Math.PI) / 180))
      expect(pack.instances[i + 2]!).toBeCloseTo(expected, 9)
      expect(pack.instances[i + 3]!).toBe(1)
    }
  })

  it("is empty for nothing to draw", () => {
    expect(packRouteCorridor(null).count).toBe(0)
    expect(packRouteCorridor(geometry()).count).toBe(0)
    // A single-fix segment qualifies cells but is not a line — `segmentsToGeometry` drops these
    // and so does this, so a producer that stops doing so cannot put a zero-length line on screen.
    expect(packRouteCorridor(geometry([[NEMO.lng, NEMO.lat]])).count).toBe(0)
  })

  it("stops at the cap rather than blowing §6.4's instance budget", () => {
    // 400 km. At 65.7 m spacing that is ~6,000 discs, well past the cap.
    const pack = packRouteCorridor(geometry(straight(400_000)))
    expect(pack.truncated).toBe(true)
    expect(pack.count).toBe(MAX_CORRIDOR_DISCS)
  })
})

describe("a trace with a split — criterion 8", () => {
  /**
   * `0045` splits a trace at a teleport, and `0195` stores one `coordinates` entry per surviving
   * segment. The renderer must not bridge them: a chord across the gap is a claim the operator
   * ran ground they never saw, and on a map that never re-fogs it is permanent the moment the
   * server agrees.
   *
   * The gap here is 5 km, which no interpolation could plausibly step across by accident — the
   * assertion is about the ABSENCE of a walk between parts, so it wants an unambiguous hole.
   */
  const north = { lat: NEMO.lat + 5000 / M_PER_DEG_LAT, lng: NEMO.lng }
  const split = geometry(straight(500), straight(500, north))

  it("draws both segments", () => {
    const pack = packRouteCorridor(split)
    const points = centres(pack.instances)
    const inSouth = points.filter((p) => metresBetween(p, NEMO) < 1000)
    const inNorth = points.filter((p) => metresBetween(p, north) < 1000)
    expect(inSouth.length).toBeGreaterThan(5)
    expect(inNorth.length).toBeGreaterThan(5)
    expect(inSouth.length + inNorth.length).toBe(points.length)
  })

  it("puts no disc in the gap between them", () => {
    const midpoint = { lat: NEMO.lat + 2750 / M_PER_DEG_LAT, lng: NEMO.lng }
    const nearest = Math.min(
      ...centres(packRouteCorridor(split).instances).map((p) => metresBetween(p, midpoint)),
    )
    // The nearest disc to the middle of the hole is at the end of a segment, ~2.25 km away. A
    // chord would have put one within a step of the midpoint.
    expect(nearest).toBeGreaterThan(2000)
  })
})

describe("the client never invents cells — criterion 6", () => {
  /**
   * The real path, over a real `ExploredSet`, asserting the set is BYTE-IDENTICAL afterwards.
   *
   * Written as a behavioural test rather than a grep because the failure it guards against is not
   * an import — it is somebody deciding, reasonably, that the corridor "should" also mark those
   * cells explored so the two agree. That would write ground the server never scored into a map
   * that can never re-fog (D-020), from a client that cannot be trusted to have the full trace.
   */
  it("leaves the explored Set and its BigUint64Array untouched", () => {
    const cells = BigUint64Array.from(
      [0, 1, 2].map((i) =>
        BigInt(`0x${latLngToCell(NEMO.lat + i * 0.01, NEMO.lng, 10)}`),
      ),
    )
    const set = ExploredSet.fromCells(cells, 7)
    const before = { size: set.size, generation: set.generation, bytes: Uint8Array.from(new Uint8Array(set.cells.buffer.slice(0))) }

    const pack = packRouteCorridor(geometry(straight(2000)))
    expect(pack.count).toBeGreaterThan(0)

    expect(set.size).toBe(before.size)
    expect(set.generation).toBe(before.generation)
    expect(new Uint8Array(set.cells.buffer)).toEqual(before.bytes)
  })

  it("produces no H3 id at all — the pack is floats and nothing else", () => {
    const pack = packRouteCorridor(geometry(straight(500)))
    expect(pack.instances).toBeInstanceOf(Float32Array)
    expect(pack.instances.length).toBe(pack.count * INSTANCE_FLOATS)
    // Every value is a finite number in mercator space; nothing here can be read as an id.
    for (const value of pack.instances) expect(Number.isFinite(value)).toBe(true)
  })
})

describe("packCorridorForCollection", () => {
  it("is empty for an empty collection — a new account draws no line and no corridor", () => {
    expect(packCorridorForCollection([]).count).toBe(0)
  })

  it("returns the single feature's own pack without copying it", () => {
    const g = geometry(straight(500))
    const one = packCorridorForCollection([{ geometry: g }])
    expect(one.count).toBe(packRouteCorridor(g).count)
  })

  it("concatenates several features end to end", () => {
    const a = geometry(straight(500))
    const b = geometry(straight(500, { lat: NEMO.lat + 0.2, lng: NEMO.lng }))
    const both = packCorridorForCollection([{ geometry: a }, { geometry: b }])
    expect(both.count).toBe(packRouteCorridor(a).count + packRouteCorridor(b).count)
    expect(both.instances.length).toBe(both.count * INSTANCE_FLOATS)
  })
})

describe("the mercator round trip these assertions depend on", () => {
  // `centres` inverts `mercatorX`/`mercatorY` by hand. If that inverse were wrong, every
  // distance assertion above would be measuring the wrong thing while still passing.
  //
  // Four decimal places, not six: the value goes through a `Float32Array` on the way, and that
  // is ~2e-6 degrees of loss — sub-metre, and the reason is spelled out at the endpoint test.
  it("recovers the point it started from", () => {
    const [back] = centres(Float32Array.from([mercatorX(NEMO.lng), mercatorY(NEMO.lat), 0, 1]))
    expect(back!.lng).toBeCloseTo(NEMO.lng, 4)
    expect(back!.lat).toBeCloseTo(NEMO.lat, 4)
  })
})
