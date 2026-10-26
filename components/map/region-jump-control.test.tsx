import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { listKey, RegionJumpControl, REGION_JUMP_CSS } from "./region-jump-control"

/** Ticket `0285`. The repo has no DOM test environment: keys are tested as data, the list rendered open. */

const REGIONS = [
  { id: "a", label: "Millbrook" },
  { id: "b", label: "Saltmarsh" },
  { id: "c", label: "48.9°S 123.4°W" },
]

describe("listKey — arrows, Enter and Esc in the open list (D-253)", () => {
  it("moves the highlight with the arrows, clamped at the ends, and Home/End jump", () => {
    expect(listKey("ArrowDown", 0, 3)).toEqual({ active: 1 })
    expect(listKey("ArrowDown", 2, 3)).toEqual({ active: 2 })
    expect(listKey("ArrowUp", 1, 3)).toEqual({ active: 0 })
    expect(listKey("ArrowUp", 0, 3)).toEqual({ active: 0 })
    expect(listKey("Home", 2, 3)).toEqual({ active: 0 })
    expect(listKey("End", 0, 3)).toEqual({ active: 2 })
  })

  it("chooses with Enter or Space, closes with Esc or Tab, and leaves other keys alone", () => {
    expect(listKey("Enter", 1, 3)).toEqual({ choose: 1 })
    expect(listKey(" ", 2, 3)).toEqual({ choose: 2 })
    expect(listKey("Escape", 1, 3)).toEqual({ close: "escape" })
    expect(listKey("Tab", 1, 3)).toEqual({ close: "tab" })
    expect(listKey("m", 1, 3)).toBeNull()
  })
})

describe("RegionJumpControl", () => {
  it("is closed by default: one labelled 40px button and no list", () => {
    const html = renderToStaticMarkup(<RegionJumpControl regions={REGIONS} onChoose={() => {}} />)
    expect(html).toContain('aria-label="Jump to a region"')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('aria-haspopup="listbox"')
    expect(html).not.toContain('role="listbox"')
    expect(REGION_JUMP_CSS).toMatch(/\.region-jump-button \{ width: 40px; height: 40px;/)
  })

  it("open, lists every region in the order given, the first highlighted", () => {
    const html = renderToStaticMarkup(<RegionJumpControl regions={REGIONS} onChoose={() => {}} defaultOpen />)
    expect(html).toContain('role="listbox"')
    expect(html).toContain('aria-expanded="true"')
    const labels = [...html.matchAll(/role="option"[^>]*>([^<]+)</g)].map((m) => m[1])
    expect(labels).toEqual(["Millbrook", "Saltmarsh", "48.9°S 123.4°W"])
    expect(html.match(/aria-selected="true"/g)).toHaveLength(1)
    expect(html).toMatch(/aria-selected="true"[^>]*data-region="a"/)
  })

  it("sits under the settings control on the pane's right edge, clear of the top-left mode toggle", () => {
    expect(REGION_JUMP_CSS).toContain("@media (min-width: 1024px) { .region-jump { top: 64px; right: 16px; } }")
    expect(REGION_JUMP_CSS).not.toMatch(/\.region-jump \{[^}]*left:/)
  })

  it("below 1024px sits in the top-right row, left of the settings control (0314)", () => {
    expect(REGION_JUMP_CSS).toContain(".region-jump { position: fixed; z-index: 1; top: 16px; right: 64px; }")
  })
})
