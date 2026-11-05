import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { MOTION_MS, easeStandard } from "./motion"

describe("06 §8.7 motion scale (0280)", () => {
  it("has exactly the five durations, and tokens.css agrees with every one", () => {
    expect(Object.values(MOTION_MS)).toEqual([120, 200, 320, 400, 1400])
    const css = readFileSync("app/tokens.css", "utf8")
    for (const [name, ms] of Object.entries(MOTION_MS)) expect(css).toContain(`--motion-${name}: ${ms}ms;`)
    expect(css).toContain("--ease-standard: cubic-bezier(0.2, 0, 0, 1);")
  })

  it("eases on cubic-bezier(0.2, 0, 0, 1): pinned ends, monotone, front-loaded", () => {
    expect(easeStandard(0)).toBe(0)
    expect(easeStandard(1)).toBe(1)
    let prev = 0
    for (let i = 1; i <= 100; i++) {
      const y = easeStandard(i / 100)
      expect(y).toBeGreaterThanOrEqual(prev)
      prev = y
    }
    // Decelerating: well past halfway by the midpoint.
    expect(easeStandard(0.5)).toBeGreaterThan(0.8)
  })
})
