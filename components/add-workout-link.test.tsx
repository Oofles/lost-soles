import { readFileSync } from "node:fs"
import { join } from "node:path"

import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { AddWorkoutLink } from "./add-workout-link"

/**
 * Ticket 0068 criterion 3, D-061: the home screen gains EXACTLY ONE affordance, and no
 * per-exercise buttons. "A diff of the home screen shows zero new controls per workout type" is
 * mechanical: the home screen reads nothing from the registry, so it cannot grow with it.
 */
const ROOT = join(import.meta.dirname, "..")
const home = readFileSync(join(ROOT, "app/page.tsx"), "utf8")
const link = readFileSync(join(ROOT, "components/add-workout-link.tsx"), "utf8")

describe("the home screen's Add workout affordance (0068, D-061)", () => {
  it("is one link to /log, labelled Add workout", () => {
    const html = renderToStaticMarkup(<AddWorkoutLink />)
    expect(html.match(/<a /g)).toHaveLength(1)
    expect(html).toContain('href="/log"')
    expect(html).toContain(">Add workout<")
  })

  it("appears on / exactly once", () => {
    expect(home.match(/<AddWorkoutLink\s*\/>/g)).toHaveLength(1)
  })

  it("and neither it nor / reads the registry, so a new workout type adds zero controls here", () => {
    for (const src of [home, link]) {
      expect(src).not.toMatch(/xp-rules|BUNDLED_RULES|logRows|exercises/)
      // No deep link to a single exercise — that would be a per-exercise button by another name.
      expect(src).not.toMatch(/\/log[?#/]/)
    }
  })
})
