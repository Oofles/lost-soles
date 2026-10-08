import type { CustomRenderMethodInput } from "maplibre-gl"
import { gridDisk, latLngToCell } from "h3-js"
import { afterEach, describe, expect, it, vi } from "vitest"

import { cellToBig } from "@/src/domain/explored-blob"
import { RES, segmentsToCells, traceToCells, traceToSegments } from "@/src/domain/fog"
import type { Trace } from "@/src/domain/activity"
import type { RouteTraceGeometry } from "@/lib/runs/wire"

import { fakeGl } from "./__fixtures__/fake-gl"
import { ExploredSet } from "./explored-set"
import {
  ARC_ALWAYS,
  ARC_OUT_OFFSET,
  FALLOFF_INNER,
  INSTANCE_FLOATS as F,
  REVEAL_RAMP,
  revealWeight,
  STUB_PRELUDE,
} from "./mask"
import { FogMaskLayer } from "./mask-layer"
import { postRunCells, preRunCells, revealCellsForRoute, type RevealCell } from "./reveal"
import { ARC_QUANTUM, tagReveal } from "./reveal-tag"
import { packRouteCorridor } from "./route-corridor"
import {
  FogViewportController,
  type ControllerHost,
  type ControllerMap,
} from "./viewport-controller"
import { ZoomBucketStore } from "./zoom-buckets"

/**
 * Ticket `0079`. The reveal seam, end to end on the CPU: the real domain cells, the real zoom
 * buckets, the real cull, the real tagger — and the shader's weight function in its JS twin. The
 * PIXEL half of criteria 2 and 3 (zero-tolerance `readPixels` diffs) is `tools/fog-harness`'s;
 * this file proves the stream those pixels are drawn from.
 *
 * Point Nemo, per D-199.
 */
const NEMO = { lat: -48.876, lng: -123.393 }
/** ~73 km per degree of longitude at this latitude: 0.0137 degrees is a kilometre east. */
const KM_LNG = 1 / (111.32 * Math.cos((NEMO.lat * Math.PI) / 180))

function line(fromKm: number, toKm: number, northM = 0, step = 0.05): [number, number][] {
  const out: [number, number][] = []
  const n = Math.round(Math.abs(toKm - fromKm) / step)
  for (let i = 0; i <= n; i++) {
    const km = fromKm + ((toKm - fromKm) * i) / n
    out.push([NEMO.lng + km * KM_LNG, NEMO.lat + northM / 110_540])
  }
  return out
}

const EAST: RouteTraceGeometry = { type: "MultiLineString", coordinates: [line(0, 2)] }
/** Out 2 km, back 2 km on the same street, 10 m north. */
const OUT_AND_BACK: RouteTraceGeometry = {
  type: "MultiLineString",
  coordinates: [[...line(0, 2), ...line(2, 0, 10).slice(1)]],
}

/** Ascending and UNIQUE, as `ExploredSet` requires — the run overlaps the earlier ground. */
const sorted = (cells: Iterable<string>) =>
  BigUint64Array.from([...new Set(cells)].map(cellToBig).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)))

/** Ground already explored before the run: a disc west of the route's start, overlapping it. */
const EARLIER = gridDisk(latLngToCell(NEMO.lat, NEMO.lng - 0.3 * KM_LNG, RES), 12)

/* ─── The shader's arithmetic, on the CPU ──────────────────────────────────────── */

/** What one pass draws at `p`: every instance with weight > 0, as `x, y, r, fraction x weight`. */
function drawn(tagged: Float32Array, p: number): number[][] {
  const out: number[][] = []
  for (let i = 0; i < tagged.length; i += F) {
    const w = revealWeight(tagged[i + 4]!, p)
    if (w <= 0) continue
    out.push([tagged[i]!, tagged[i + 1]!, tagged[i + 2]!, Math.fround(tagged[i + 3]! * w)])
  }
  return out
}

/** A steady-state stream in the same shape: all four geometry floats, arc dropped. */
function steady(stream: Float32Array): number[][] {
  const out: number[][] = []
  for (let i = 0; i < stream.length; i += F) {
    expect(stream[i + 4]).toBe(ARC_ALWAYS)
    out.push([stream[i]!, stream[i + 1]!, stream[i + 2]!, stream[i + 3]!])
  }
  return out
}

const asMultiset = (rows: number[][]) => rows.map((r) => r.join(",")).sort()

/** The mask value at a mercator point: §4.2's falloff, unioned by `MAX`. */
function coverageAt(rows: number[][], x: number, y: number): number {
  let best = 0
  for (const [cx, cy, r, f] of rows) {
    const d = Math.hypot(x - cx!, y - cy!) / r!
    if (d > 1) continue
    const t = Math.min(1, Math.max(0, (d - FALLOFF_INNER) / (1 - FALLOFF_INNER)))
    const c = (1 - t * t * (3 - 2 * t)) * f!
    if (c > best) best = c
  }
  return best
}

/* ─── A camera, for the real controller ────────────────────────────────────────── */

const xOf = (lng: number) => lng / 360 + 0.5
const yOf = (lat: number) =>
  0.5 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / (2 * Math.PI)
const lngOf = (x: number) => (x - 0.5) * 360
const latOf = (y: number) => (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI

/** A 1280x800 viewport — the desktop browser (D-227) — centred on `centre`. */
function camera(zoom: number, centre = { lat: NEMO.lat, lng: NEMO.lng + KM_LNG }): ControllerMap {
  const perPx = 1 / (512 * 2 ** zoom)
  const x = xOf(centre.lng)
  const y = yOf(centre.lat)
  return {
    getZoom: () => zoom,
    getBounds: () => ({
      getWest: () => lngOf(x - 640 * perPx),
      getEast: () => lngOf(x + 640 * perPx),
      getNorth: () => latOf(y - 400 * perPx),
      getSouth: () => latOf(y + 400 * perPx),
    }),
    on: () => {},
    off: () => {},
    triggerRepaint: () => {},
  }
}

const host: ControllerHost = {
  now: () => 0,
  setTimeout: () => 0,
  clearTimeout: () => {},
  requestIdle: () => () => {},
}

/** One cull of `cells` through the shipped controller. Returns a copy — the view is reused. */
function cull(map: ControllerMap, cells: BigUint64Array): Float32Array {
  let got = new Float32Array(0)
  const controller = new FogViewportController({
    map,
    store: new ZoomBucketStore(ExploredSet.fromCells(cells, 1)),
    host,
    onInstances: (instances) => (got = instances.slice()),
  })
  controller.start()
  controller.stop()
  return got
}

/** The reveal's cull — both stores, one box — and the tagged merge, exactly as the layer builds it. */
function revealStream(
  map: ControllerMap,
  persisted: BigUint64Array,
  reveal: RevealCell[],
): { tagged: Float32Array; post: Float32Array; pre: Float32Array } {
  let post = new Float32Array(0)
  let pre: Float32Array | null = null
  const store = new ZoomBucketStore(ExploredSet.fromCells(persisted, 1))
  const controller = new FogViewportController({
    map,
    store,
    host,
    onInstances: (instances, _r, _res, _fromData, preStream) => {
      post = instances.slice()
      pre = preStream ? preStream.slice() : null
    },
  })
  controller.start()
  const postCells = postRunCells(persisted, reveal)
  controller.setReveal({
    pre: new ZoomBucketStore(ExploredSet.fromCells(preRunCells(persisted, reveal), 1)),
    post: postCells === persisted ? store : new ZoomBucketStore(ExploredSet.fromCells(postCells, 1)),
  })
  controller.stop()
  expect(pre).not.toBeNull()
  return { tagged: tagReveal(post, pre!, reveal), post, pre: pre! }
}

/* ─── The reveal set ───────────────────────────────────────────────────────────── */

describe("the reveal set — computed from the route the page holds", () => {
  it("is exactly the domain's own cells for those segments", () => {
    const reveal = revealCellsForRoute(EAST)
    const segments = EAST.coordinates.map((part) => part.map(([lng, lat]) => ({ lat: lat!, lng: lng! })))
    expect(new Set(reveal.map((r) => r.cell))).toEqual(segmentsToCells(segments))
    expect(reveal.length).toBeGreaterThan(50)
  })

  it("splitting traceToCells changed nothing: steps 4-5 over the sanitised segments are the same set", () => {
    const t0 = Date.UTC(2026, 9, 1)
    const trace = {
      points: line(0, 2, 0, 0.01).map(([lng, lat], i) => ({ lat, lng, t: t0 + i * 4000 })),
      gaps: [],
    } as unknown as Trace
    expect(segmentsToCells(traceToSegments(trace).segments)).toEqual(new Set(traceToCells(trace)))
  })

  it("orders cells by distance along the route, quantised, sorted", () => {
    const reveal = revealCellsForRoute(EAST)
    for (let i = 1; i < reveal.length; i++) expect(reveal[i]!.arc).toBeGreaterThanOrEqual(reveal[i - 1]!.arc)
    for (const r of reveal) {
      expect(r.arc % ARC_QUANTUM).toBe(0)
      expect(r.arc).toBeGreaterThanOrEqual(0)
      expect(r.arc).toBeLessThanOrEqual(1)
    }
    // West-to-east: a cell's arc tracks its longitude, to within a cell's reach of the line.
    const first = reveal[0]!
    const last = reveal.at(-1)!
    expect(first.x).toBeLessThan(last.x)
    expect(first.arc).toBeLessThan(0.05)
    expect(last.arc).toBeGreaterThan(0.95)
  })

  /**
   * On an out-and-back the start of the street is passed twice. Its fog burns back on the way OUT —
   * the first pass — not when the lantern comes home, or the run's first minute would stay fogged
   * behind a light that has already walked past it.
   */
  it("clears ground on the FIRST pass of an out-and-back", () => {
    const reveal = revealCellsForRoute(OUT_AND_BACK)
    // Within 50 m of where the run set off — inside the OUT leg's 65 m reach for certain.
    const metres = (r: RevealCell) =>
      Math.hypot((lngOf(r.x) - NEMO.lng) / KM_LNG, (latOf(r.y) - NEMO.lat) * 110.54) * 1000
    const nearStart = reveal.filter((r) => metres(r) < 50)
    expect(nearStart.length).toBeGreaterThan(0)
    for (const r of nearStart) expect(r.arc).toBeLessThan(0.1)
    const turn = reveal.filter((r) => Math.abs(lngOf(r.x) - (NEMO.lng + 2 * KM_LNG)) < 0.05 * KM_LNG)
    for (const r of turn) expect(r.arc).toBeGreaterThan(0.4)
  })

  it("is empty for no route, an empty one, and a one-point part", () => {
    expect(revealCellsForRoute(null)).toEqual([])
    expect(revealCellsForRoute({ type: "MultiLineString", coordinates: [] })).toEqual([])
    expect(revealCellsForRoute({ type: "MultiLineString", coordinates: [[[NEMO.lng, NEMO.lat]]] })).toEqual([])
  })

  it("pre and post are the persisted set without and with the run, and post IS persisted when it holds them", () => {
    const reveal = revealCellsForRoute(EAST)
    const withRun = sorted([...EARLIER, ...reveal.map((r) => r.cell)])
    const without = sorted(EARLIER.filter((c) => !reveal.some((r) => r.cell === c)))

    expect(postRunCells(withRun, reveal)).toBe(withRun) // the /run/:id case: nothing re-derived
    expect(preRunCells(withRun, reveal)).toEqual(without)
    expect(postRunCells(without, reveal)).toEqual(withRun) // the pre-sync case: merged, sorted
  })
})

/* ─── Criteria 2, 3, 4, 8 — the stream ─────────────────────────────────────────── */

describe.each([
  ["running zoom, res 11", 15],
  ["coarse bucket", 11.5],
])("the reveal stream at a %s", (_label, zoom) => {
  const reveal = revealCellsForRoute(EAST)
  const runCells = reveal.map((r) => r.cell)
  const map = camera(zoom)

  describe.each([
    ["cells already persisted (/run/:id)", sorted([...EARLIER, ...runCells])],
    ["cells not yet persisted (pre-sync)", sorted(EARLIER.filter((c) => !runCells.includes(c)))],
  ])("with the run's %s", (_case, persisted) => {
    const { tagged } = revealStream(map, persisted, reveal)
    const steadyPost = steady(cull(map, postRunCells(persisted, reveal)))
    const steadyPre = steady(cull(map, preRunCells(persisted, reveal)))

    it("draws, at p = 1, exactly the steady-state post-run stream — same instances, same order", () => {
      expect(drawn(tagged, 1)).toEqual(steadyPost)
      // And the upload starts with the same instance, so `uploadInstances` takes the same origin.
      expect(Array.from(tagged.subarray(0, 4))).toEqual(steadyPost[0])
    })

    it("draws, at p = 0, exactly the steady-state pre-run stream", () => {
      expect(asMultiset(drawn(tagged, 0))).toEqual(asMultiset(steadyPre))
    })

    it("actually animates something — the two ends differ", () => {
      expect(asMultiset(steadyPost)).not.toEqual(asMultiset(steadyPre))
    })

    /**
     * Criterion 4, at the level the operator can see: the MASK, sampled every ~5 m along the route
     * and across it. Stronger than "no cell is unrevealed" — it also catches a pre-only instance (a
     * coarse fraction, an elided bridge) switching off before its replacement has fully arrived.
     *
     * NOT STRICTLY MONOTONE, AND THAT IS THE STEADY-STATE RENDERER'S, NOT THE REVEAL'S. D-238 elides
     * a bridge once both endpoints have six revealed neighbours, and a run landing beside explored
     * ground does exactly that to the cells along its edge. Where H3 cells are larger than average —
     * Point Nemo's res-11 cells reach 31.1 m circumradius against the 28.7 m average — the three-cell
     * vertex then falls from 1.0 to ~0.58 in the steady state itself. `p = 1` must equal the steady
     * state (criterion 2), so the reveal cannot avoid that drop; it can only refuse to add one of its
     * own. So the assertion is: coverage never falls below `min(previous, steady post-run)`. Filed
     * against `08` as its own ticket (`0252`).
     */
    it("never lowers coverage as progress rises, beyond the steady state's own post-run value", () => {
      const samples: Array<[number, number]> = []
      for (const [lng, lat] of line(-0.1, 2.1, 0, 0.01)) {
        for (const north of [-60, -30, 0, 30, 60]) {
          samples.push([xOf(lng!), yOf(lat! + north / 110_540)])
        }
      }
      const settled = samples.map(([x, y]) => coverageAt(steadyPost, x, y))
      let previous = samples.map(() => 0)
      let drops = 0
      for (let step = 0; step <= 64; step++) {
        const rows = drawn(tagged, step / 64)
        const now = samples.map(([x, y]) => coverageAt(rows, x, y))
        for (let i = 0; i < now.length; i++) {
          if (now[i]! < Math.min(previous[i]!, settled[i]!) - 1e-9) drops++
        }
        previous = now
      }
      expect(drops).toBe(0)
    }, 30_000)
  })
})

describe("one cell, once revealed, stays revealed — criterion 4", () => {
  it("holds for every arc and every pair p < p'", () => {
    for (let arc = 0; arc <= 1; arc += 1 / 64) {
      let was = 0
      for (let p = 0; p <= 1.0000001; p += 1 / 256) {
        const w = revealWeight(arc, p)
        expect(w).toBeGreaterThanOrEqual(was)
        was = w
      }
      expect(revealWeight(arc, 1)).toBe(1)
      expect(revealWeight(arc, 0)).toBe(0)
      // The out-switch for the same arc is the exact complement at the moment the ramp completes.
      expect(revealWeight(ARC_OUT_OFFSET + arc, 0)).toBe(1)
      expect(revealWeight(ARC_OUT_OFFSET + arc, 1)).toBe(0)
    }
    expect(revealWeight(ARC_ALWAYS, 0)).toBe(1)
  })

  it("softens in over the ramp rather than popping", () => {
    const arc = 0.5
    const start = arc * (1 - REVEAL_RAMP)
    expect(revealWeight(arc, start)).toBe(0)
    expect(revealWeight(arc, start + REVEAL_RAMP / 2)).toBeCloseTo(0.5, 6)
    expect(revealWeight(arc, start + REVEAL_RAMP)).toBe(1)
  })
})

/* ─── Criterion 8 — culling still applies ──────────────────────────────────────── */

describe("zoom bucketing and viewport culling still apply — criterion 8", () => {
  it("a run partly offscreen does not splat its offscreen cells", () => {
    const reveal = revealCellsForRoute(EAST)
    const persisted = sorted([...EARLIER, ...reveal.map((r) => r.cell)])
    // z17 on the route's START: the screen is ~0.5 km wide, so the east end of a 2 km run is off it.
    const map = camera(17, NEMO)
    const { tagged } = revealStream(map, persisted, reveal)

    const bounds = map.getBounds()
    const pad = 0.2 * (xOf(bounds.getEast()) - xOf(bounds.getWest()))
    const maxX = xOf(bounds.getEast()) + pad
    for (let i = 0; i < tagged.length; i += F) {
      expect(tagged[i]! - tagged[i + 2]!).toBeLessThanOrEqual(maxX)
    }
    const eastEnd = reveal.filter((r) => r.x > maxX + 2e-6) // ~50 m clear of the padded edge
    expect(eastEnd.length).toBeGreaterThan(10)
    // None of those cells' discs is in the stream.
    for (const r of eastEnd) {
      for (let i = 0; i < tagged.length; i += F) {
        expect(tagged[i] === Math.fround(r.x) && tagged[i + 1] === Math.fround(r.y)).toBe(false)
      }
    }
  })
})

/* ─── The corridor ─────────────────────────────────────────────────────────────── */

describe("0057's corridor during a reveal", () => {
  it("is post-only: each disc fades in at its own position along the route", () => {
    const corridor = packRouteCorridor(EAST)
    const reveal = revealCellsForRoute(EAST)
    const tagged = tagReveal(new Float32Array(0), new Float32Array(0), reveal, corridor)
    expect(tagged.length).toBe(corridor.count * F)
    for (let i = 0; i < corridor.count; i++) {
      const arc = tagged[i * F + 4]!
      expect(arc).toBeGreaterThanOrEqual(0)
      expect(arc).toBeLessThanOrEqual(1)
      if (i > 0) expect(arc).toBeGreaterThanOrEqual(tagged[(i - 1) * F + 4]!)
    }
    expect(drawn(tagged, 0)).toHaveLength(0)
    expect(drawn(tagged, 1)).toHaveLength(corridor.count)
  })
})

/* ─── Criteria 1 and 5 — the layer ─────────────────────────────────────────────── */

function renderInput(): CustomRenderMethodInput {
  const m = new Float32Array(16)
  m[0] = 1
  m[5] = 1
  m[10] = 1
  m[15] = 1
  return {
    shaderData: { variantName: "mercator", vertexShaderPrelude: STUB_PRELUDE, define: "" },
    defaultProjectionData: {
      mainMatrix: m,
      tileMercatorCoords: [0, 0, 1, 1],
      clippingPlane: [0, 0, 0, 0],
      projectionTransition: 0,
      fallbackMatrix: new Float32Array(16),
      clipAntimeridian: false,
    },
  } as unknown as CustomRenderMethodInput
}

describe("the layer — criterion 1", () => {
  const reveal = revealCellsForRoute(EAST)
  const persisted = sorted([...EARLIER, ...reveal.map((r) => r.cell)])
  const { post, pre } = revealStream(camera(15), persisted, reveal)

  it("a scrub is a uniform write: no upload, no FBO or buffer allocation, one redraw per change", () => {
    const fake = fakeGl()
    const layer = new FogMaskLayer({ onRebuild: () => {} })
    layer.setInstances(post, RES, { pre })
    layer.setReveal(reveal, 0)
    layer.prerender(fake.gl, renderInput())
    const uploads = fake.uploads.length // the quad, then the instances
    const allocations = () =>
      ["bufferData", "bufferSubData", "texImage2D", "createFramebuffer", "createBuffer"].map(
        (name) => fake.of(name).length,
      )
    const before = allocations()
    const draws = fake.of("drawArraysInstanced").length

    for (let i = 1; i <= 60; i++) {
      layer.setRevealProgress(i / 60)
      layer.prerender(fake.gl, renderInput())
    }

    expect(allocations()).toEqual(before)
    expect(fake.uploads).toHaveLength(uploads)
    expect(fake.of("drawArraysInstanced").length).toBe(draws + 60)
    const reveals = fake.of("uniform1f").filter((c) => (c.args[0] as { tag?: string })?.tag === "u_reveal")
    expect(reveals.at(-1)!.args[1]).toBe(1)
    expect(reveals.at(-31)!.args[1]).toBeCloseTo(0.5, 6)
    // A still camera and an unchanged progress is still no pass at all (§6.3's ~0 ms row).
    layer.prerender(fake.gl, renderInput())
    expect(fake.of("drawArraysInstanced").length).toBe(draws + 60)
  })

  it("draws the steady state, at u_reveal = 1, until the pre-run stream arrives", () => {
    const fake = fakeGl()
    const layer = new FogMaskLayer({ onRebuild: () => {} })
    layer.setInstances(post, RES)
    layer.setReveal(reveal, 0)
    layer.prerender(fake.gl, renderInput())
    expect(Array.from(fake.uploads.at(-1)!.filter((_, i) => i % F === 4))).toEqual(
      new Array(post.length / F).fill(ARC_ALWAYS),
    )
    const reveals = fake.of("uniform1f").filter((c) => (c.args[0] as { tag?: string })?.tag === "u_reveal")
    expect(reveals.at(-1)!.args[1]).toBe(1)
  })

  it("restores the steady stream when the reveal ends", () => {
    const fake = fakeGl()
    const layer = new FogMaskLayer({ onRebuild: () => {} })
    layer.setInstances(post, RES, { pre })
    layer.setReveal(reveal, 0.3)
    layer.prerender(fake.gl, renderInput())
    layer.setReveal(null)
    layer.setInstances(post, RES)
    layer.prerender(fake.gl, renderInput())
    const last = fake.uploads.at(-1)!
    expect(last.length).toBe(post.length)
    expect(Array.from(last.filter((_, i) => i % F === 4)).every((a) => a === ARC_ALWAYS)).toBe(true)
    expect(layer.stats().reveal).toBeNull()
  })
})

describe("no network — criterion 5", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("computes, culls, tags and draws a reveal with fetch removed entirely", () => {
    const fetch = vi.fn(() => {
      throw new Error("network disabled")
    })
    vi.stubGlobal("fetch", fetch)
    vi.stubGlobal("XMLHttpRequest", undefined)

    const reveal = revealCellsForRoute(EAST)
    const persisted = sorted([...EARLIER, ...reveal.map((r) => r.cell)])
    const { post, pre } = revealStream(camera(15), persisted, reveal)
    const fake = fakeGl()
    const layer = new FogMaskLayer({ onRebuild: () => {} })
    layer.setInstances(post, RES, { pre })
    layer.setReveal(reveal, 0)
    for (let i = 0; i <= 10; i++) {
      layer.setRevealProgress(i / 10)
      layer.prerender(fake.gl, renderInput())
    }

    expect(fetch).not.toHaveBeenCalled()
    expect(layer.stats().reveal).toMatchObject({ cells: reveal.length, progress: 1 })
    expect(layer.stats().reveal!.postOnly).toBeGreaterThan(0)
  })
})
