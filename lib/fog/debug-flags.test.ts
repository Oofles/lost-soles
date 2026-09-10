import { describe, expect, it } from "vitest"

import {
  decodeDebugEnabled,
  fogFlags,
  hudEnabled,
  maskDebugEnabled,
  noiseDebugEnabled,
} from "./debug-flags"

/**
 * THE REGRESSION THIS FILE EXISTS FOR, stated plainly so it is not undone by a later tidy-up:
 * `0054` put its decode readout on `?fog=debug` and `0055` put its mask blit on `?fog=mask`.
 * Same parameter, so each silently switched the other off — and the readout prints `cells 0`,
 * which is the whole answer to "why is the mask empty". The one URL used to look at the mask was
 * the one URL that hid the instrument explaining it.
 */
describe("fogFlags", () => {
  it("reads a single flag", () => {
    expect([...fogFlags("?fog=mask")]).toEqual(["mask"])
    expect([...fogFlags("?fog=debug")]).toEqual(["debug"])
  })

  it("composes them, which is the point", () => {
    expect(maskDebugEnabled("?fog=mask,debug")).toBe(true)
    expect(decodeDebugEnabled("?fog=mask,debug")).toBe(true)
    expect(maskDebugEnabled("?fog=debug,mask")).toBe(true)
    expect(decodeDebugEnabled("?fog=debug,mask")).toBe(true)
  })

  it("still honours each flag alone, so 0054's URL is unchanged", () => {
    expect(decodeDebugEnabled("?fog=debug")).toBe(true)
    expect(maskDebugEnabled("?fog=debug")).toBe(false)
    expect(maskDebugEnabled("?fog=mask")).toBe(true)
    expect(decodeDebugEnabled("?fog=mask")).toBe(false)
  })

  it("tolerates whitespace, case and empty entries rather than failing silently", () => {
    expect(maskDebugEnabled("?fog=  MASK , debug ,")).toBe(true)
    expect(decodeDebugEnabled("?fog=  MASK , debug ,")).toBe(true)
  })

  it("is off with no parameter, an empty one, or an unknown flag", () => {
    for (const search of ["", "?", "?fog=", "?fog=on", "?foggy=mask", "?a=1"]) {
      expect(maskDebugEnabled(search)).toBe(false)
      expect(decodeDebugEnabled(search)).toBe(false)
    }
  })

  it("is off with no parameter, an empty one, or an unknown flag — 0056's flags too", () => {
    for (const search of ["", "?", "?fog=", "?fog=on", "?foggy=noise", "?a=1"]) {
      expect(noiseDebugEnabled(search)).toBe(false)
      expect(hudEnabled(search)).toBe(false)
    }
  })
})

describe("0056's ?fog=noise", () => {
  it("leaves the composite running, unlike ?fog=mask", () => {
    expect(noiseDebugEnabled("?fog=noise")).toBe(true)
    expect(maskDebugEnabled("?fog=noise")).toBe(false)
  })

  /** Both debug views want 0055's cell count, so both bring the HUD up. */
  it("brings the HUD up, and so does ?fog=mask", () => {
    expect(hudEnabled("?fog=noise")).toBe(true)
    expect(hudEnabled("?fog=mask")).toBe(true)
    expect(hudEnabled("?fog=debug")).toBe(false)
  })

  it("composes with the other two", () => {
    expect(noiseDebugEnabled("?fog=noise,debug")).toBe(true)
    expect(decodeDebugEnabled("?fog=noise,debug")).toBe(true)
  })
})
