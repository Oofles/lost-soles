import { readFileSync } from "node:fs"
import { join } from "node:path"

import type { CustomRenderMethodInput } from "maplibre-gl"
import { cellToChildren, gridDisk, latLngToCell } from "h3-js"
import { describe, expect, it } from "vitest"

import { cellToBig } from "@/src/domain/explored-blob"
import { RES } from "@/src/domain/fog"

import { fakeGl } from "./__fixtures__/fake-gl"
import {
  coldFragmentSource,
  coldPixel,
  labSaturation,
  labToSrgb,
  srgbToLab,
} from "./composite"
import { ExploredSet } from "./explored-set"
import {
  ADVENTURE,
  ATLAS,
  COLD_DAYS_PER_MONTH,
  COLD_DESATURATE,
  COLD_WASH_MAX,
  COLD_WASH_RGB,
  coldClip,
  coldWashOpacity,
  FOG_MODES,
  lerpPalette,
  type Rgb,
} from "./fog-uniforms"
import { packBucket } from "./instances"
import { LastRunDays, todayDay } from "./last-run"
import {
  COLD_AGE_SPAN_DAYS,
  DAY_INDEX,
  DAY_UNKNOWN,
  discWarmth,
  INSTANCE_FLOATS,
  MASK_FRAGMENT_SOURCE,
  maskVertexSource,
  STUB_PRELUDE,
} from "./mask"
import { FogMaskLayer, oldestDay } from "./mask-layer"
import { ZoomBucketStore } from "./zoom-buckets"

/**
 * TICKET 0100 — COLD TERRITORY, ATLAS ONLY, ON A DIFFERENT PERCEPTUAL CHANNEL.
 * `06-ui-ux.md` §4.6, D-133, D-147, D-120.
 *
 * The rendered claims — a measurable cool/saturation delta in atlas, zero in adventure, no cold pixel
 * at coverage <= 0.75 — are proved on a real GPU by `tools/fog-harness/run.mjs` (K1–K4) and inside a
 * real MapLibre frame by `run-mode-swap.mjs`. This file holds the arithmetic those renders are
 * checked against, and the gates a fake GL can see.
 */

const months = (m: number) => m * COLD_DAYS_PER_MONTH

describe("the ramp (criterion 3, 4)", () => {
  /** 06 §4.6's chart, tabled: 0 at <= 4, rising at 5, 0.10 at 6, near the asymptote at 9, 0.18 at 24. */
  const TABLE: [number, number][] = [
    [4, 0],
    [5, 0.033],
    [6, 0.1],
    [9, 0.179],
    [24, 0.18],
  ]

  it.each(TABLE)("at %d months is %d, ±0.01", (m, want) => {
    expect(Math.abs(coldWashOpacity(months(m)) - want)).toBeLessThanOrEqual(0.01)
  })

  it("is exactly 0 up to month 4, and never above the 0.18 asymptote", () => {
    for (const d of [-30, 0, 1, 60, months(3.99), months(4)]) expect(coldWashOpacity(d)).toBe(0)
    for (let d = 0; d < 365 * 10; d += 7) expect(coldWashOpacity(d)).toBeLessThanOrEqual(COLD_WASH_MAX)
    expect(COLD_WASH_MAX).toBe(0.18)
  })

  it("is continuous with a finite derivative everywhere — no step at the 6-month line", () => {
    const h = 1e-3
    let worst = 0
    for (let d = 0; d <= months(30); d += 0.25) {
      const slope = Math.abs(coldWashOpacity(d + h) - coldWashOpacity(d)) / h
      worst = Math.max(worst, slope)
    }
    // Steepest is ~0.0037/day — a step anywhere would show as ~0.1/1e-3 = 100.
    expect(worst).toBeLessThan(0.01)
    const six = months(6)
    expect(Math.abs(coldWashOpacity(six + h) - coldWashOpacity(six - h))).toBeLessThan(1e-5)
  })

  it("is the curve the shader computes, through the mask's 8-bit warmth", () => {
    // The composite turns warmth back into an age; the round trip loses at most a 1/255 step.
    for (const m of [4.5, 5, 6, 9, 11]) {
      const warmth = Math.round(discWarmth(0, months(m)) * 255) / 255
      const age = (1 - warmth) * COLD_AGE_SPAN_DAYS
      expect(Math.abs(coldWashOpacity(age) - coldWashOpacity(months(m)))).toBeLessThan(0.002)
    }
    const source = coldFragmentSource()
    expect(source).toContain("float coldness(float warmth)")
    expect(source).toContain("1.0 - exp(-x * x)")
  })
})

describe("the clip rule (criterion 2)", () => {
  it("is smoothstep(0.0, 0.25, coverage - 0.75), in the shader, on the WARPED coverage", () => {
    const source = coldFragmentSource()
    expect(source).toContain("float clip = smoothstep(0.0, 0.25, coverage - 0.75);")
    // D-372: the clip reads the mask at maskUv, the point the composite's edge warp moved.
    expect(source).toContain("vec4 m = texture(u_mask, maskUv);")
    expect(source).toContain("float coverage = m.r;")
    expect(source).toContain("maskUv += (groundToPx * (w * u_warp.x)) * pxUv;")
    expect(source).toMatch(/if \(clip <= 0\.0 \|\| u_coldWash <= 0\.0\) discard;/)
  })

  it("is exactly 0 wherever coverage <= 0.75, and 1 at full coverage", () => {
    for (let c = 0; c <= 0.75; c += 0.01) expect(coldClip(c)).toBe(0)
    expect(coldClip(0.75)).toBe(0)
    expect(coldClip(1)).toBe(1)
    expect(coldClip(0.8)).toBeGreaterThan(0)
  })
})

describe("the colour (criterion 5)", () => {
  it("is --cold-wash, the token app/tokens.css declares", () => {
    const tokens = readFileSync(join(__dirname, "../../app/tokens.css"), "utf8")
    const hex = /--cold-wash:\s*#([0-9a-f]{6})/i.exec(tokens)![1]!
    const rgb = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16))
    expect(COLD_WASH_RGB.map((c) => Math.round(c * 255))).toEqual(rgb)
    expect(rgb).toEqual([0x7e, 0x93, 0xad])
  })

  it("shifts CIELAB chroma by -18% at the asymptote, keeping L*", () => {
    const park: Rgb = [0.78, 0.87, 0.66]
    const [l, a, b] = srgbToLab(park)
    const shifted = srgbToLab(labToSrgb([l, a * (1 - COLD_DESATURATE), b * (1 - COLD_DESATURATE)]))
    expect(shifted[0]).toBeCloseTo(l, 1)
    expect(Math.hypot(shifted[1], shifted[2]) / Math.hypot(a, b)).toBeCloseTo(0.82, 2)
  })

  it("is the shift, then a multiply of --cold-wash at the ramp's opacity", () => {
    const grey: Rgb = [0.6, 0.6, 0.6] // no chroma, so the shift is a no-op and the multiply is exact
    const out = coldPixel(grey, COLD_WASH_RGB, 1)
    for (let c = 0; c < 3; c++) {
      expect(out[c]).toBeCloseTo(0.6 * (1 - COLD_WASH_MAX + COLD_WASH_RGB[c]! * COLD_WASH_MAX), 3)
    }
    expect(coldPixel(grey, COLD_WASH_RGB, 0)).toEqual(grey.map((v) => expect.closeTo(v, 4)))
    // Cooler, and less saturated, on coloured ground.
    const park: Rgb = [0.78, 0.87, 0.66]
    const cold = coldPixel(park, COLD_WASH_RGB, 1)
    expect(labSaturation(cold)).toBeLessThan(labSaturation(park))
    expect(cold[2] / cold[0]).toBeGreaterThan(park[2] / park[0])
  })

  it("has no stipple, hatch, outline or per-cell border: main() has no lattice, period or step", () => {
    const main = coldFragmentSource().split("void main() {")[1]!
    // The edge warp is shared verbatim with the composite and is excluded; everything after it is
    // the wash. A pattern needs a period (fract/mod/floor) or a hard threshold (step) on position.
    const wash = main.split("vec4 m = texture(u_mask, maskUv);")[1]!
    expect(wash).not.toMatch(/\b(fract|mod|floor|step)\s*\(/)
    // Nothing on screen depends on which cell a pixel belongs to: no instance data reaches this pass.
    expect(coldFragmentSource()).not.toMatch(/\ba_(day|center|radius|fraction|arc)\b/)
  })
})

describe("the mask carries lastRunAt per disc as warmth, never a presence bit (criterion 6)", () => {
  it("writes warmth to ALPHA from a_day and u_today, and coverage alone to RED", () => {
    const vs = maskVertexSource(STUB_PRELUDE, "")
    expect(vs).toContain("in float a_day;")
    expect(vs).toContain("uniform float u_today;")
    expect(MASK_FRAGMENT_SOURCE).toContain("fragColor = vec4(c, c * v_bloom, v_warmth)")
  })

  it("is 1 for today and unknown, falls linearly with age, and is 0 past the span", () => {
    expect(discWarmth(1000, 1000)).toBe(1)
    expect(discWarmth(DAY_UNKNOWN, 1000)).toBe(1)
    expect(discWarmth(500, -1)).toBe(1)
    expect(discWarmth(1000 - COLD_AGE_SPAN_DAYS / 2, 1000)).toBeCloseTo(0.5, 6)
    expect(discWarmth(0, 1000)).toBe(0)
  })

  it("has no presence-bit path: no boolean or 0/1 'cold' flag exists in the code", () => {
    const files = ["mask.ts", "mask-layer.ts", "zoom-buckets.ts", "instances.ts", "last-run.ts", "composite.ts"]
    for (const file of files) {
      const text = readFileSync(join(__dirname, file), "utf8")
      expect(text, file).not.toMatch(/\b(isCold|coldBit|presenceBit|cold:\s*boolean)\b/)
    }
  })
})

describe("packBucket carries the day (D-390 on an edge)", () => {
  const centre = latLngToCell(-48.876, -123.393, RES)
  const ring = gridDisk(centre, 1)

  it("writes each cell's day, and DAY_UNKNOWN without a dayOf", () => {
    const days = new Map(ring.map((c, i) => [c, 1000 + i]))
    const packed = packBucket(ring, { dayOf: (c) => days.get(c), densify: false })
    for (let i = 0; i < ring.length; i++) expect(packed.instances[i * INSTANCE_FLOATS + DAY_INDEX]).toBe(1000 + i)
    const bare = packBucket(ring, { densify: false })
    for (let i = 0; i < ring.length; i++) expect(bare.instances[i * INSTANCE_FLOATS + DAY_INDEX]).toBe(DAY_UNKNOWN)
  })

  it("gives a bridge its MORE RECENT endpoint's day, and unknown when either is unknown", () => {
    const [a, b] = [centre, ring.find((c) => c !== centre)!]
    const bridgeDay = (dayA: number | undefined, dayB: number | undefined) => {
      const days = new Map<string, number | undefined>([[a, dayA], [b, dayB]])
      const packed = packBucket([a, b], { dayOf: (c) => days.get(c) })
      expect(packed.bridges).toBe(1)
      return packed.instances[2 * INSTANCE_FLOATS + DAY_INDEX]
    }
    expect(bridgeDay(100, 900)).toBe(900)
    expect(bridgeDay(900, undefined)).toBe(DAY_UNKNOWN)
  })
})

describe("coarse buckets: the most recent child wins (D-390)", () => {
  const parent = latLngToCell(-48.876, -123.393, 9)
  const children = cellToChildren(parent, RES).map(cellToBig).sort((x, y) => (x < y ? -1 : 1))
  const set = ExploredSet.fromCells(BigUint64Array.from(children), 3)

  function parentDay(days: Uint16Array, cells = set.cells): number {
    const store = new ZoomBucketStore(ExploredSet.fromCells(cells, 3))
    store.setLastRun(new LastRunDays(set.cells, days, 3))
    const bucket = store.bucketFor(9)
    const discs = bucket.discsFor(0)
    return discs[DAY_INDEX]!
  }

  it("takes the max child day", () => {
    const days = new Uint16Array(children.length).fill(100)
    days[7] = 1500
    expect(parentDay(days)).toBe(1500)
  })

  it("is unknown — fresh — when any child is unknown (a mid-session delta's cell)", () => {
    const days = new Uint16Array(children.length).fill(100)
    // The sidecar was fetched before a delta added one more child; it is not in the sidecar.
    const withNew = BigUint64Array.from([...children.slice(0, -1)])
    const store = new ZoomBucketStore(ExploredSet.fromCells(BigUint64Array.from(children), 3))
    store.setLastRun(new LastRunDays(withNew, days.subarray(0, withNew.length), 3))
    expect(store.bucketFor(9).discsFor(0)[DAY_INDEX]).toBe(DAY_UNKNOWN)
  })

  it("drops cached geometry when the sidecar arrives, so the next cull re-packs with days", () => {
    const store = new ZoomBucketStore(set)
    const bucket = store.bucketFor(RES)
    const before = bucket.discsFor(0)
    expect(before[DAY_INDEX]).toBe(DAY_UNKNOWN)
    store.setLastRun(new LastRunDays(set.cells, new Uint16Array(children.length).fill(42), 3))
    expect(bucket.materialisedGroups).toBe(0)
    expect(bucket.discsFor(0)[DAY_INDEX]).toBe(42)
    expect(store.bucketFor(8).discsFor(0)[DAY_INDEX]).toBe(42) // a bucket built after it, too
  })
})

describe("the layer: atlas only, and only when cold ground is uploaded (criterion 1)", () => {
  const NOW = Date.parse("2026-10-20T12:00:00Z")
  const today = todayDay(NOW)
  const cells = gridDisk(latLngToCell(-48.876, -123.393, RES), 3)

  function frame(palette: typeof ATLAS, day: number): { copies: number; coldPasses: number } {
    const fake = fakeGl()
    const layer = new FogMaskLayer({ palette, now: () => NOW, onRebuild: () => {} })
    layer.setBucket(packBucket(cells, { dayOf: () => day }))
    const input = renderInput()
    layer.prerender(fake.gl, input)
    layer.render(fake.gl, input)
    return { copies: fake.of("copyTexSubImage2D").length, coldPasses: layer.stats().coldPasses }
  }

  it("runs the cold pass, copying the frame under the fog, in atlas over year-old ground", () => {
    expect(frame(ATLAS, today - 365)).toEqual({ copies: 1, coldPasses: 1 })
  })

  it("never runs it in adventure: no copy, no draw — the frame is what it always was", () => {
    expect(ADVENTURE.coldWash).toBe(0)
    expect(frame(ADVENTURE, today - 365)).toEqual({ copies: 0, coldPasses: 0 })
  })

  it("does not run it in atlas when nothing uploaded is old enough for the ramp", () => {
    expect(frame(ATLAS, today - 30)).toEqual({ copies: 0, coldPasses: 0 })
    expect(frame(ATLAS, DAY_UNKNOWN)).toEqual({ copies: 0, coldPasses: 0 })
  })

  it("rides the 320 ms mode fade: coldWash is a palette entry, 1 in atlas, 0 in adventure", () => {
    expect(FOG_MODES.atlas.coldWash).toBe(1)
    expect(lerpPalette(ATLAS, ADVENTURE, 0.25).coldWash).toBeCloseTo(0.75, 12)
    expect(lerpPalette(ADVENTURE, ATLAS, 0).coldWash).toBe(0)
    expect(frame(lerpPalette(ADVENTURE, ATLAS, 0.5), today - 365).coldPasses).toBe(1)
  })

  it("finds the oldest known day in an instance stream", () => {
    const f = new Float32Array(3 * INSTANCE_FLOATS)
    f[DAY_INDEX] = 900
    f[INSTANCE_FLOATS + DAY_INDEX] = DAY_UNKNOWN
    f[2 * INSTANCE_FLOATS + DAY_INDEX] = 400
    expect(oldestDay(f)).toBe(400)
    expect(oldestDay(new Float32Array(0))).toBe(Number.POSITIVE_INFINITY)
  })
})

function renderInput(): CustomRenderMethodInput {
  const s = 512 * 2 ** 14
  const m = new Float32Array(16)
  m[0] = (2 * s) / 800
  m[5] = (-2 * s) / 600
  m[10] = 1
  m[15] = 1
  m[12] = (-0.2739 * 2 * s) / 800
  m[13] = (0.3767 * 2 * s) / 600
  return {
    shaderData: { variantName: "mercator", vertexShaderPrelude: STUB_PRELUDE, define: "#define PROJECTION_MERCATOR" },
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
