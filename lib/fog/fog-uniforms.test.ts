import { describe, expect, it } from "vitest"

import { CELL_BIAS, TIME_WRAP_S } from "./composite"
import {
  ADVENTURE,
  ATLAS,
  FBM_LACUNARITY,
  FBM_OCTAVES,
  FOG_FPS,
  FOG_MODES,
  lerpPalette,
  MAX_OPACITY_CEILING,
  NOISE_AMP_CEILING,
  NOISE_DRIFT_1,
  NOISE_DRIFT_2,
  NOISE_FIELD_2_FREQ,
  NOISE_ORIGIN_MODULUS,
  NOISE_PX,
  OCTAVE_JITTER,
  REVEAL_HI,
  RIM_BAND_R,
  RIM_THIN,
  V1,
} from "./fog-uniforms"
import { SEAM_FLOOR } from "./mask"

describe("V1 — what ships, as 0119 tuned it", () => {
  it("is 0119's approved values, value for value", () => {
    expect(V1.fogDeep).toEqual([0.035, 0.045, 0.075])
    expect(V1.fogEdge).toEqual([0.27, 0.29, 0.35])
    expect(V1.maxOpacity).toBe(0.9)
    expect(V1.noiseAmp).toBe(0.25)
    // The rim is 0210's, not 0119's: 0119's 0.30 of the old glow could not be seen.
    expect(V1.rimGlow).toEqual([1, 0.78, 0.4])
    expect(V1.rimAmt).toBe(0.9)
  })

  /**
   * §4.3: *"`u_maxOpacity` must never reach 1.0."* Fully opaque fog reads as a hole punched in the
   * map rather than as weather, and the 6% that gets through is a direct contribution to D-051 —
   * even unexplored ground keeps a ghost of its street grid.
   */
  it("never lets the fog reach full opacity", () => {
    for (const palette of [V1, ATLAS, ADVENTURE]) {
      expect(palette.maxOpacity).toBeLessThan(1)
      expect(palette.maxOpacity).toBeGreaterThan(0)
    }
  })

  /**
   * `0119` was told to tune WITHIN §5.2's original ranges; a value outside them is a design change.
   * `rimAmt` left that range on purpose in `0210`, which redesigned the rim: §5.2's range is now 0..1.
   */
  it("stays inside §5.2's original atlas..adventure range on every scalar but the rim", () => {
    expect(V1.noiseAmp).toBeGreaterThanOrEqual(ATLAS.noiseAmp)
    expect(V1.noiseAmp).toBeLessThanOrEqual(NOISE_AMP_CEILING)
    expect(V1.maxOpacity).toBeGreaterThanOrEqual(ATLAS.maxOpacity)
    expect(V1.maxOpacity).toBeLessThanOrEqual(MAX_OPACITY_CEILING)
  })
})

/**
 * `0098` criterion 4 — the amended §5.2 table, as a snapshot. Atlas is §5.2's column verbatim;
 * adventure is `0119`'s tuning (operator, `0098` Q2). A change to either is a change to this table.
 */
describe("FOG_MODES — the one constant map of per-mode uniforms (0098)", () => {
  it("matches 05 §5.2's table, value for value", () => {
    expect(FOG_MODES).toEqual({
      atlas: {
        fogDeep: [0.1, 0.11, 0.14],
        fogEdge: [0.3, 0.32, 0.36],
        rimGlow: [1, 0.78, 0.4],
        maxOpacity: 0.55,
        noiseAmp: 0.1,
        rimAmt: 0.9,
        animated: false,
      },
      adventure: {
        fogDeep: [0.035, 0.045, 0.075],
        fogEdge: [0.27, 0.29, 0.35],
        rimGlow: [1, 0.78, 0.4],
        maxOpacity: 0.9,
        noiseAmp: 0.25,
        rimAmt: 0.9,
        animated: true,
      },
    })
    expect(FOG_MODES.atlas).toBe(ATLAS)
    expect(FOG_MODES.adventure).toBe(ADVENTURE)
    expect(V1).toBe(ADVENTURE)
  })

  /** Criterion 5. §4.3: never 1.0; §5.3: adventure is capped at 0.94. */
  it("never lets u_maxOpacity exceed 0.94 in any mode", () => {
    expect(MAX_OPACITY_CEILING).toBe(0.94)
    for (const palette of Object.values(FOG_MODES)) {
      expect(palette.maxOpacity).toBeLessThanOrEqual(MAX_OPACITY_CEILING)
    }
  })

  /** …nor at any point of a cross-fade between them, which is a convex combination. */
  it("never exceeds 0.94 anywhere along a cross-fade either", () => {
    for (let i = 0; i <= 20; i++) {
      expect(lerpPalette(ATLAS, ADVENTURE, i / 20).maxOpacity).toBeLessThanOrEqual(MAX_OPACITY_CEILING)
    }
  })

  it("keeps every mode's noise inside the amplitude SEAM_FLOOR was measured for", () => {
    for (const palette of Object.values(FOG_MODES)) expect(palette.noiseAmp).toBeLessThanOrEqual(NOISE_AMP_CEILING)
  })

  it("interpolates every scalar and channel by the same t", () => {
    const mid = lerpPalette(ATLAS, ADVENTURE, 0.25)
    const at = (a: number, b: number, v: number) => (v - a) / (b - a)
    expect(at(ATLAS.maxOpacity, ADVENTURE.maxOpacity, mid.maxOpacity)).toBeCloseTo(0.25, 12)
    expect(at(ATLAS.noiseAmp, ADVENTURE.noiseAmp, mid.noiseAmp)).toBeCloseTo(0.25, 12)
    // 0210: both modes share the rim, so there is nothing to interpolate; it must stay put.
    expect(mid.rimAmt).toBe(ADVENTURE.rimAmt)
    expect(at(ATLAS.fogDeep[2], ADVENTURE.fogDeep[2], mid.fogDeep[2])).toBeCloseTo(0.25, 12)
    expect(lerpPalette(ATLAS, ADVENTURE, 1)).toEqual(ADVENTURE)
    expect(lerpPalette(ATLAS, ADVENTURE, 0)).toEqual(ATLAS)
  })

  /**
   * `0210`: the operator chose the lit-mist rim on one set of values shown in both modes, so the modes
   * share it. A per-mode rim is a new decision, not a tuning change.
   */
  it("gives both modes the same rim, and a strength inside 0..1", () => {
    expect(ATLAS.rimGlow).toEqual(ADVENTURE.rimGlow)
    expect(ATLAS.rimAmt).toBe(ADVENTURE.rimAmt)
    for (const palette of Object.values(FOG_MODES)) {
      expect(palette.rimAmt).toBeGreaterThan(0)
      expect(palette.rimAmt).toBeLessThanOrEqual(1)
    }
  })

  /**
   * `0210`: the thinning can only lower alpha. At full strength the fog keeps a positive share of its
   * alpha, so the band never punches a hole, and lit never exceeds 1, so alpha never goes negative.
   */
  it("thins the fog in the lit band without ever removing it", () => {
    expect(RIM_THIN).toBeGreaterThan(0)
    expect(1 - 1 * RIM_THIN).toBeGreaterThan(0)
    expect(RIM_BAND_R).toBeGreaterThan(0)
  })
})

describe("SEAM_FLOOR — 0055's mask constant is derived from 0056's ramp", () => {
  /**
   * `mask.ts` set `FALLOFF_INNER` to clear a floor that comes from THIS pass: a neighbour seam has
   * to stay above the reveal ramp's top even at the noise's worst downward swing, or the seam
   * breathes in and out of the mist as the animation drifts (D-231).
   *
   * The derivation uses `NOISE_AMP_CEILING` (§5.2's original adventure 0.30), not the 0.25 that ships. That is the whole point
   * of asserting it here rather than trusting the comment: capability 15 raising the amplitude must
   * not silently invalidate a constant that was measured once on a real GPU and never re-measured.
   */
  it("equals REVEAL_HI plus the worst downward swing of the noise ceiling", () => {
    expect(SEAM_FLOOR).toBeCloseTo(REVEAL_HI + NOISE_AMP_CEILING / 2, 10)
  })

  it("leaves the shipped amplitude a margin rather than sitting on the threshold", () => {
    expect(REVEAL_HI + V1.noiseAmp / 2).toBeLessThan(SEAM_FLOOR)
  })
})

describe("the noise lattice stays inside float32's exact-integer range (D-233)", () => {
  /**
   * The shader adds the lattice origin to a floor in a `float`, which is exact only to 2^24. Every
   * number in this product is a constant one edit away from being raised, so the headroom is
   * asserted rather than argued in a comment.
   */
  it("origin x the largest octave multiplier stays under 2^24", () => {
    const largestMultiplier = NOISE_FIELD_2_FREQ * FBM_LACUNARITY ** (FBM_OCTAVES - 1)
    expect(NOISE_ORIGIN_MODULUS * largestMultiplier).toBeLessThan(2 ** 24)
  })

  it("the origin scheme requires integer frequencies, and both of them are integers", () => {
    expect(Number.isInteger(FBM_LACUNARITY)).toBe(true)
    expect(Number.isInteger(NOISE_FIELD_2_FREQ)).toBe(true)
    expect(OCTAVE_JITTER.every(Number.isInteger)).toBe(true)
    expect(Number.isInteger(Math.log2(NOISE_ORIGIN_MODULUS))).toBe(true)
  })

  /**
   * The animation drift is the only term in the shader's local coordinate that grows without a
   * bound of its own, and `CELL_BIAS` is what keeps the lattice index non-negative. A day of drift
   * at the fastest field, through the largest octave, must still clear it.
   */
  it("a full TIME_WRAP_S of drift cannot push the lattice index past CELL_BIAS", () => {
    const fastest = Math.max(...NOISE_DRIFT_1.map(Math.abs), ...NOISE_DRIFT_2.map(Math.abs))
    const largestMultiplier = NOISE_FIELD_2_FREQ * FBM_LACUNARITY ** (FBM_OCTAVES - 1)
    expect(TIME_WRAP_S * fastest * largestMultiplier).toBeLessThan(CELL_BIAS)
  })
})

describe("the noise scale and the frame cap", () => {
  /**
   * §4.3: *"The noise scale must not match the parchment grain. Parchment grain is fine (~2-4 px),
   * mist noise is coarse (~150-300 px). Matching frequencies produces a beat pattern that looks
   * like video compression artefacts"* (R4 §6.6).
   */
  it("keeps the mist coarse and two orders of magnitude off the parchment grain", () => {
    expect(NOISE_PX).toBeGreaterThanOrEqual(150)
    expect(NOISE_PX).toBeLessThanOrEqual(300)
    expect(NOISE_PX / 4).toBeGreaterThan(10)
  })

  it("caps the animation at §4.5's 30 fps", () => {
    expect(FOG_FPS).toBe(30)
  })
})
