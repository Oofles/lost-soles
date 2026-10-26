import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

import { describe, expect, it } from "vitest"

/**
 * TICKET `0112` — §9.6's standing rule, **no auto-switch** (06 §9.1, D-253): *"the app must never
 * change map mode by itself."* Checked by absence, as the ticket's notes ask. Here, inside
 * `components/map/`, because naming the mode outside the renderer and the toggle is what
 * `check-mode-boundary.mjs` exists to refuse.
 */

const ROOT = join(import.meta.dirname, "..", "..")

function sources(dirs: string[]): { file: string; src: string }[] {
  const out: { file: string; src: string }[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) walk(path)
      else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push({ file: relative(ROOT, path), src: readFileSync(path, "utf8") })
    }
  }
  for (const d of dirs) walk(join(ROOT, d))
  return out
}

describe("§9.6 — no auto-switch (0112)", () => {
  it("the saved mode is changed by the toggle's two rows and `M`, and by nothing else", () => {
    const writers = sources(["app", "components", "lib"])
      .filter(({ src }) => /mapModeStore\(\)\??\.(set|toggle)\(/.test(src))
      .map((f) => f.file)
    expect(writers).toEqual(["components/map/mode-toggle.tsx"])
  })

  it("the mode store and the toggle read no OS theme, no clock and no sensor", () => {
    for (const file of ["lib/map-mode.ts", "components/map/use-map-mode.ts", "components/map/mode-toggle.tsx"]) {
      const src = readFileSync(join(ROOT, file), "utf8")
      expect(src, file).not.toMatch(/prefers-color-scheme|matchMedia|getHours|AmbientLightSensor|DeviceLight|new Date\(|Date\.now/)
    }
  })
})
