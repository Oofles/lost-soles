import { describe, expect, it } from "vitest"

import { MAP_CONTROLS_CSS } from "./map-controls"

/** The declarations of the one rule whose selector is exactly `selector`. */
function rule(selector: string): string {
  const at = MAP_CONTROLS_CSS.indexOf(` ${selector} {`)
  expect(at, `no rule for ${selector}`).toBeGreaterThanOrEqual(0)
  const open = MAP_CONTROLS_CSS.indexOf("{", at)
  return MAP_CONTROLS_CSS.slice(open + 1, MAP_CONTROLS_CSS.indexOf("}", open))
}

// Ticket 0317: `⌖` is enlarged on its own span; the buttons and every other glyph keep their size.
describe("map control glyph sizes", () => {
  it("keeps every map control 40×40 with an 18px glyph (D-313)", () => {
    const button = rule(".map-control")
    expect(button).toContain("width: 40px")
    expect(button).toContain("height: 40px")
    expect(button).toContain("font-size: 18px")
  })

  it("enlarges only the recentre glyph", () => {
    expect(rule(".map-control .recentre-glyph")).toContain("font-size: 22px")
    expect(MAP_CONTROLS_CSS.match(/font-size/g)).toHaveLength(2)
  })
})
