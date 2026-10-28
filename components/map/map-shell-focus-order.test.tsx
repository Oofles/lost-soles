import { readFileSync } from "node:fs"

import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { MapShell } from "./map-shell"

/**
 * Ticket `0323`. `06` §2.2's home focus order ends `⚙` → jump-to → the map → fit → `⌖`, and DOM
 * order is focus order. `⚙` is the plinth's, not MapShell's.
 *
 * Effects do not run under `renderToStaticMarkup` (the vitest environment is `node`), so the first
 * paint is all that renders: the map container and the disabled fit and `⌖`, but not jump-to, which
 * needs a loaded map and two regions before it draws anything. So the map → fit → `⌖` order is
 * asserted on the rendered markup, and jump-to's place before the map on the source, the same
 * tripwire trade `map-shell-build.test.ts` makes.
 */

/** Asserts each index exists and they ascend. */
function expectAscending(at: number[]): void {
  for (const i of at) expect(i).toBeGreaterThan(-1)
  expect([...at].sort((a, b) => a - b)).toEqual(at)
}

describe("home map focus order (06 §2.2)", () => {
  it("renders the map container, then fit, then `⌖`", () => {
    const html = renderToStaticMarkup(<MapShell home={null} paneClassName="home-pane" />)
    expectAscending([
      html.indexOf('data-testid="map-shell"'),
      html.indexOf('aria-label="Fit the whole territory"'),
      html.indexOf('aria-label="Recentre on the last run"'),
    ])
  })

  it("places jump-to before the map container, and the controls after it", () => {
    const shell = readFileSync(new URL("./map-shell.tsx", import.meta.url), "utf8")
    const jsx = shell.slice(shell.lastIndexOf("  return (\n    <>"))
    expectAscending([jsx.indexOf("<RegionJump\n"), jsx.indexOf('data-testid="map-shell"'), jsx.indexOf("<MapControls map=")])
  })
})
