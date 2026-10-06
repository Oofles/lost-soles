import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import SIGILS from "@/rules/sigils.json"
import { BUNDLED_RULES } from "@/rules/xp-rules.bundled"
import type { RuleSet } from "@/src/rules/schema"

import { FALLBACK_SEAL, Sigil, sigilPaths } from "./sigil"

/** Ticket 0073, `06-ui-ux.md` §8.6. The sigil set is data; this checks the data is drawable. */

const PATH_DATA = /^[MLHVCSQTAZmlhvcsqtaz0-9 .,-]+$/

describe("rules/sigils.json", () => {
  it("draws every enabled skill in every bundled ruleset", () => {
    for (const [v, raw] of Object.entries(BUNDLED_RULES)) {
      for (const s of (raw as RuleSet).skills.filter((s) => s.enabled)) {
        expect(Object.hasOwn(SIGILS.sigils, s.id), `v${v}: ${s.id} has no sigil`).toBe(true)
      }
    }
  })

  it("holds only SVG path data", () => {
    for (const [id, paths] of Object.entries(SIGILS.sigils)) {
      expect(paths.length, id).toBeGreaterThan(0)
      for (const d of paths) expect(d, id).toMatch(PATH_DATA)
    }
  })
})

describe("<Sigil>", () => {
  it("is a monoline, unfilled, currentColor mark hidden from assistive technology", () => {
    const [id] = Object.keys(SIGILS.sigils)
    const html = renderToStaticMarkup(<Sigil skillId={id!} />)
    expect(html).toContain('fill="none"')
    expect(html).toContain('stroke="currentColor"')
    expect(html).toContain('stroke-width="1.5"')
    expect(html).toContain('aria-hidden="true"')
  })

  it("degrades to the fallback seal for a skill with no sigil, rather than failing", () => {
    expect(sigilPaths("a-skill-nobody-has-drawn")).toBe(FALLBACK_SEAL)
    expect(renderToStaticMarkup(<Sigil skillId="a-skill-nobody-has-drawn" />)).toContain(FALLBACK_SEAL[0])
    expect(sigilPaths("toString")).toBe(FALLBACK_SEAL)
  })
})
