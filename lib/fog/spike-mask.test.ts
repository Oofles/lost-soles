import { describe, expect, it } from "vitest"

import {
  DISC_COVERAGE,
  formatVerdict,
  judgeProbe,
  overallVerdict,
  PROBE_HIGH,
  PROBE_LOW,
  quantise,
  restoreOk,
  type ProbeReading,
  type RestoreCheck,
  type SpikeVerdict,
} from "./spike-mask"

/**
 * THROWAWAY, with ticket `0118`. What is tested here is the JUDGEMENT, not the GL:
 * `judgeProbe` turns a histogram into a go/no-go, and getting that wrong means the
 * spike reports a pass against a driver that does not honour `MAX` — the one outcome
 * this ticket exists to make impossible. The GL itself is proved by
 * `tools/spike-harness`, which runs the real context on SwiftShader.
 */

const LOW = quantise(PROBE_LOW)
const HIGH = quantise(PROBE_HIGH)

function reading(histogram: Array<{ value: number; count: number }>): ProbeReading {
  return {
    readPath: "RGBA/UNSIGNED_BYTE",
    maxByte: histogram.reduce((m, h) => Math.max(m, h.value), 0),
    histogram,
  }
}

describe("the coverage values", () => {
  /**
   * THE TEST THAT PROTECTS THE WHOLE SPIKE FROM BEING UNABLE TO FAIL. `R8` clamps, so
   * at coverage 1.0 an additive blend and `MAX` produce the same byte and the probe
   * would pass against a broken driver. If someone "fixes" the discs to white to match
   * the ticket's wording, this fails and says why.
   */
  it("keeps a summed overlap representable, so a sum is distinguishable from a max", () => {
    expect(PROBE_LOW + PROBE_HIGH).toBeLessThan(1)
    expect(DISC_COVERAGE * 2).toBeLessThan(1)
  })

  it("lands on distinct R8 bytes", () => {
    expect(LOW).toBe(89)
    expect(HIGH).toBe(140)
    expect(quantise(PROBE_LOW + PROBE_HIGH)).toBe(230)
  })
})

describe("judgeProbe", () => {
  it("reads MAX when the high disc kept more pixels than the low one", () => {
    // MAX: the high disc keeps all of itself, the low disc loses the overlap.
    const { verdict } = judgeProbe(reading([{ value: HIGH, count: 54058 }, { value: LOW, count: 32890 }]))
    expect(verdict).toBe("max")
  })

  /**
   * THE SILENT FAILURE, and the reason the verdict is decided on counts. Same two
   * values, same maximum byte, opposite areas — a driver ignoring the blend equation
   * entirely, so the second draw simply overwrote the overlap.
   */
  it("reads OVERWRITE when the same two values arrive with the areas the other way round", () => {
    const { verdict } = judgeProbe(reading([{ value: HIGH, count: 32922 }, { value: LOW, count: 54026 }]))
    expect(verdict).toBe("overwrite")
  })

  it("reads SUM when coverage above the high value is present", () => {
    const { verdict } = judgeProbe(
      reading([{ value: HIGH, count: 32922 }, { value: LOW, count: 32890 }, { value: 230, count: 21136 }]),
    )
    expect(verdict).toBe("sum")
  })

  /**
   * Observed, not hypothetical: SwiftShader produced 229 where the arithmetic says 230.
   * Float → unorm8 is round-to-nearest and 0.90 × 255 is exactly 229.5, so a driver may
   * land either side. Without the ±1 tolerance the harness reported a sum as `unclear`.
   */
  it("tolerates ±1 on the summed value, because a .5 tie may round either way", () => {
    expect(judgeProbe(reading([{ value: HIGH, count: 10 }, { value: LOW, count: 10 }, { value: 229, count: 5 }])).verdict).toBe("sum")
  })

  it("reads SUM from a stray bright pixel even with no value near the exact sum", () => {
    expect(judgeProbe(reading([{ value: HIGH, count: 10 }, { value: LOW, count: 10 }, { value: 200, count: 3 }])).verdict).toBe("sum")
  })

  it("refuses to guess when the mask is empty", () => {
    expect(judgeProbe(reading([])).verdict).toBe("nothing-drawn")
  })

  it("refuses to guess when only one of the two discs reached the mask", () => {
    expect(judgeProbe(reading([{ value: HIGH, count: 400 }])).verdict).toBe("unclear")
  })

  it("carries the counts into the detail, so a NO-GO can be argued with", () => {
    const { detail } = judgeProbe(reading([{ value: HIGH, count: 7 }, { value: LOW, count: 9 }]))
    expect(detail).toContain(`high(${HIGH})=7`)
    expect(detail).toContain(`low(${LOW})=9`)
  })
})

const RESTORED: RestoreCheck = {
  blendEquationRGB: "FUNC_ADD",
  blendEquationAlpha: "FUNC_ADD",
  framebufferUnbound: true,
  viewport: "0,0,1280,800",
  viewportRestored: true,
}

const PASSING: SpikeVerdict = {
  capabilities: {
    renderer: "Adreno (TM) 619",
    vendor: "Qualcomm",
    glVersion: "WebGL 2.0",
    shadingLanguage: "WebGL GLSL ES 3.00",
    colorBufferHalfFloat: true,
    colorBufferFloat: false,
    r8Framebuffer: "FRAMEBUFFER_COMPLETE",
    maxTextureSize: 8192,
  },
  instances: 471,
  maskSize: "640×400",
  probe: { verdict: "max", detail: "max(a, b) honoured" },
  readPath: "RGBA/UNSIGNED_BYTE",
  restore: RESTORED,
  glError: "NO_ERROR",
  shaderError: null,
  userAgent: "Mozilla/5.0 (Linux; Android 14)",
  devicePixelRatio: 2.625,
  frameMs: 16.4,
}

describe("restoreOk", () => {
  it("accepts a fully restored context", () => {
    expect(restoreOk(RESTORED)).toBe(true)
  })

  it.each([
    ["a left-over MAX equation", { blendEquationRGB: "MAX" }],
    ["a left-over MAX on alpha only", { blendEquationAlpha: "MAX" }],
    ["the mask framebuffer still bound", { framebufferUnbound: false }],
    ["the half-res viewport still set", { viewportRestored: false }],
  ])("rejects %s", (_why, patch) => {
    expect(restoreOk({ ...RESTORED, ...patch })).toBe(false)
  })
})

describe("the verdict", () => {
  it("is GO when the probe reads max, R8 is renderable and the state came back", () => {
    expect(overallVerdict(PASSING)).toBe("GO")
    expect(formatVerdict(PASSING).split("\n")[0]).toBe("GO")
  })

  it.each([
    ["an unrenderable R8 framebuffer", { capabilities: { ...PASSING.capabilities!, r8Framebuffer: "FRAMEBUFFER_UNSUPPORTED" } }],
    ["a probe that read overwrite", { probe: { verdict: "overwrite" as const, detail: "ignored" } }],
    ["a probe that read sum", { probe: { verdict: "sum" as const, detail: "summed" } }],
    ["a shader that did not build", { shaderError: "vertex shader: no such function projectTile" }],
    ["leaked GL state", { restore: { ...RESTORED, framebufferUnbound: false } }],
    ["a GL error", { glError: "INVALID_OPERATION" }],
    ["no probe at all", { probe: null }],
  ])("is NO-GO on %s", (_why, patch) => {
    const verdict = { ...PASSING, ...patch }
    expect(overallVerdict(verdict)).toBe("NO-GO")
    expect(formatVerdict(verdict).split("\n")[0]).toMatch(/^NO-GO/)
  })

  /**
   * Frame time is reported and never gates. `0059` owns the §6.4 budget against a real
   * phone with the real cell count; a spike drawing 471 flat discs must not pre-empt it.
   */
  it("does not turn a slow frame into a NO-GO, but does say so", () => {
    const slow = { ...PASSING, frameMs: 180 }
    expect(overallVerdict(slow)).toBe("GO")
    expect(formatVerdict(slow)).toContain("⚠ slow")
  })

  it("names the device and the browser, which criterion 7 requires", () => {
    const text = formatVerdict(PASSING)
    expect(text).toContain("Adreno (TM) 619")
    expect(text).toContain("Android 14")
    expect(text).toContain("FRAMEBUFFER_COMPLETE")
  })

  it("survives a verdict with nothing in it yet", () => {
    const empty: SpikeVerdict = {
      capabilities: null, instances: 0, maskSize: "—", probe: null, readPath: null,
      restore: null, glError: null, shaderError: null, userAgent: "", devicePixelRatio: 1, frameMs: null,
    }
    expect(overallVerdict(empty)).toBe("NO-GO")
    expect(() => formatVerdict(empty)).not.toThrow()
  })
})
