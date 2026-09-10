import { describe, expect, it } from "vitest"

import { CELL_BIAS, TIME_WRAP_S } from "./composite"
import {
  ADVENTURE,
  ATLAS,
  FBM_LACUNARITY,
  FBM_OCTAVES,
  FOG_FPS,
  NOISE_DRIFT_1,
  NOISE_DRIFT_2,
  NOISE_FIELD_2_FREQ,
  NOISE_ORIGIN_MODULUS,
  NOISE_PX,
  OCTAVE_JITTER,
  REVEAL_HI,
  V1,
} from "./fog-uniforms"
import { SEAM_FLOOR } from "./mask"

describe("V1 — what 0056 actually ships", () => {
  it("is the ticket's own table, value for value", () => {
    expect(V1.fogDeep).toEqual([0.035, 0.045, 0.075])
    expect(V1.fogEdge).toEqual([0.22, 0.24, 0.3])
    expect(V1.rimGlow).toEqual([0.85, 0.7, 0.42])
    expect(V1.maxOpacity).toBe(0.94)
    expect(V1.noiseAmp).toBe(0.1)
    expect(V1.rimAmt).toBe(0.08)
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

  it("takes adventure's colours and atlas's restraint, which is the hybrid the ticket asks for", () => {
    expect(V1.fogDeep).toEqual(ADVENTURE.fogDeep)
    expect(V1.maxOpacity).toEqual(ADVENTURE.maxOpacity)
    expect(V1.noiseAmp).toEqual(ATLAS.noiseAmp)
    expect(V1.rimAmt).toEqual(ATLAS.rimAmt)
  })
})

describe("the §5.2 pairs, recorded ahead of capability 15", () => {
  it("carries both columns of §5.2's table", () => {
    expect(ATLAS.maxOpacity).toBe(0.55)
    expect(ADVENTURE.maxOpacity).toBe(0.94)
    expect(ATLAS.noiseAmp).toBe(0.1)
    expect(ADVENTURE.noiseAmp).toBe(0.3)
    expect(ATLAS.rimAmt).toBe(0.08)
    expect(ADVENTURE.rimAmt).toBe(0.3)
    expect(ATLAS.animated).toBe(false)
    expect(ADVENTURE.animated).toBe(true)
  })

  /** §5.4: neither mode may change what is revealed. The rim colour is shared for §5.1's reason. */
  it("gives both modes the same warm rim, which is the basemap's own hue", () => {
    expect(ATLAS.rimGlow).toEqual(ADVENTURE.rimGlow)
  })
})

describe("SEAM_FLOOR — 0055's mask constant is derived from 0056's ramp", () => {
  /**
   * `mask.ts` set `FALLOFF_INNER` to clear a floor that comes from THIS pass: a neighbour seam has
   * to stay above the reveal ramp's top even at the noise's worst downward swing, or the seam
   * breathes in and out of the mist as the animation drifts (D-231).
   *
   * The derivation uses **adventure's** `noiseAmp`, not the 0.10 that ships. That is the whole point
   * of asserting it here rather than trusting the comment: capability 15 raising the amplitude must
   * not silently invalidate a constant that was measured once on a real GPU and never re-measured.
   */
  it("equals REVEAL_HI plus the worst downward swing of ADVENTURE's noise", () => {
    expect(SEAM_FLOOR).toBeCloseTo(REVEAL_HI + ADVENTURE.noiseAmp / 2, 10)
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
