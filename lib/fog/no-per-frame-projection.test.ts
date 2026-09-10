import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

/**
 * CRITERION 7 — *"Projection uses `shaderData.vertexShaderPrelude`; no `map.project()` in any
 * per-frame path (grep test)."* `05-fog-of-war.md` §4.2, §6.1, §6.2.
 *
 * ─── WHY A GREP AND NOT A BENCHMARK ─────────────────────────────────────────
 *
 * §6.2 names per-frame JS projection *"the largest single cost in the whole system, and the one
 * thing that would break the 60 fps claim"*, and §6.3 budgets **~0 ms of CPU per frame** with the
 * camera still. That budget is not something a test can defend by measuring — a benchmark on this
 * machine says nothing about a mid-range phone, which is `0059`'s job. What CAN be defended here is
 * the structural property the budget rests on: the frame path cannot reach a projection function at
 * all, because it does not import one.
 *
 * The failure this prevents is specific and it is the one §4.6 records against the Canvas2D
 * approach: *"re-projects every vertex with `map.project()` in JS every frame"*. That is not a bug
 * anyone writes deliberately. It is what happens when a later ticket needs a screen coordinate
 * inside `prerender` and reaches for the obvious API, in a file where nothing says not to.
 *
 * ─── SCOPED TO THE FRAME PATH, NOT THE RENDERER ─────────────────────────────
 *
 * `instances.ts` calls `cellToLatLng` and projects to mercator — that is the whole point of it, once
 * per bucket. A repo-wide ban would fire on the correct code and a gate with false positives is a
 * gate that gets deleted (the lesson `check-boundaries.mjs` and `check-fixture-geography.mjs` both
 * record). So the rule is: these two modules, which are the only ones MapLibre calls per frame,
 * import nothing that can project and mention nothing that can.
 */

const FRAME_PATH = ["mask.ts", "mask-layer.ts"]

/**
 * `.project(` catches `map.project`, `this.map.project` and `transform.project` alike. The h3
 * boundary functions are named because they are the OTHER way a per-frame projection arrives:
 * §6.1's rule is *"Never call `cellToBoundary` or `map.project()` per frame"*, and `cellToBoundary`
 * at 6,000 cells allocates 36,000 coordinate pairs a frame.
 */
const FORBIDDEN: Array<{ pattern: RegExp; why: string }> = [
  {
    pattern: /\.project\s*\(/,
    why: "map.project() in JS, per frame — §4.6's recorded failure of the Canvas2D approach",
  },
  {
    pattern: /\bcellToBoundary\b/,
    why: "§6.1: never call cellToBoundary per frame — 6,000 cells is 36,000 coordinate pairs",
  },
  {
    pattern: /\bcellToLatLng\b/,
    why: "projection belongs in instances.ts, once per bucket (criterion 5)",
  },
  {
    pattern: /from\s+["']h3-js["']/,
    why: "the frame path must not be able to reach h3 at all, not merely choose not to",
  },
]

function read(file: string): string {
  return readFileSync(join(process.cwd(), "lib", "fog", file), "utf8")
}

/**
 * Strip comments before matching. This file's own subject matter has to be explainable in the
 * modules it guards — `mask.ts`'s header cites §6.1's rule by name — and a guard that forbids
 * writing down why it exists is a guard whose reasoning gets deleted first.
 */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
}

describe("the per-frame path projects nothing in JS", () => {
  for (const file of FRAME_PATH) {
    for (const { pattern, why } of FORBIDDEN) {
      it(`${file} contains no ${pattern.source} — ${why}`, () => {
        expect(code(read(file))).not.toMatch(pattern)
      })
    }
  }

  /**
   * The positive half. A ban on the alternatives proves nothing on its own — a shader that
   * hard-coded its own matrix would pass every assertion above and still lose globe and terrain
   * support, silently, by rendering the fog in the wrong place under a projection nobody tests.
   */
  it("takes its projection from MapLibre's prelude instead", () => {
    const source = read("mask.ts")
    expect(source).toContain("vertexShaderPrelude")
    expect(source).toContain("projectTile(a_center + a_quad * a_radius)")
    expect(read("mask-layer.ts")).toContain("shaderData")
  })

  /**
   * NON-VACUOUS. Every check in this repo carries one of these, because a grep that scans the wrong
   * path passes for the same reason a clean one does. If the reader ever stops seeing the file,
   * this fails and the rest of the suite becomes meaningless in silence.
   */
  it("is reading real files with real content", () => {
    for (const file of FRAME_PATH) {
      expect(read(file).length).toBeGreaterThan(1_000)
    }
    // And it FIRES: the guarded pattern is present in the module that is allowed to project.
    expect(code(read("instances.ts"))).toMatch(/\bcellToLatLng\b/)
  })
})
