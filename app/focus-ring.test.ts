import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

/**
 * 06 §9.4 — *"every focusable element has a visible 2px `--text-primary` focus ring"* (D-467).
 *
 * The ring was once defined only inside five components, and every other control fell back to the
 * browser default; the capability 18 re-audit found it. The floor is one global rule in
 * `tokens.css`, which `app/layout.tsx` imports, so this reads it at the source. Whether the ring
 * READS on the page is the operator's eye (D-229).
 */

const ROOT = join(import.meta.dirname, "..")
const css = readFileSync(join(ROOT, "app/tokens.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "")

describe("the global focus ring (06 §9.4)", () => {
  it("tokens.css gives every :focus-visible element a 2px --text-primary outline", () => {
    const rule = css.match(/(^|\n)\s*:focus-visible\s*\{([^}]*)\}/)
    expect(rule, "no global :focus-visible rule in app/tokens.css").not.toBeNull()
    expect(rule![2]).toMatch(/outline:\s*2px solid var\(--text-primary\)/)
  })

  it("the map canvas is covered, inset because it fills its pane", () => {
    expect(css).toMatch(/\.maplibregl-canvas:focus-visible\s*\{[^}]*outline-offset:\s*-2px/)
  })

  it("the root layout imports tokens.css, so the rule reaches every route", () => {
    expect(readFileSync(join(ROOT, "app/layout.tsx"), "utf8")).toMatch(/import "\.\/tokens\.css"/)
  })
})
