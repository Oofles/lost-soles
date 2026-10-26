import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

import { describe, expect, it } from "vitest"

/**
 * TICKET `0112` — a §9.6 row that passes by something NOT existing (06 §9.6, the ticket's notes:
 * *"check for their absence deliberately; nobody notices a modal that was never built"*).
 *
 * The others are held elsewhere: token expired and three weeks away in
 * `components/plinth/plinth.test.tsx` and `lib/plinth/model.test.ts`, no auto-switch in
 * `components/map/no-auto-switch.test.ts`, and slow and no connection in `0113`'s tests.
 */

const ROOT = join(import.meta.dirname, "..")

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

describe("§9.6 — the watch or phone died mid-run: nothing (N6, D-110)", () => {
  it("there is no recording screen, no Start Run and no live map", () => {
    for (const rel of ["app/record/page.tsx", "app/track/page.tsx", "app/live/page.tsx", "app/run/page.tsx", "app/run/new/page.tsx"]) {
      expect(existsSync(join(ROOT, rel)), rel).toBe(false)
    }
    for (const { file, src } of sources(["app", "components"])) {
      expect(src, file).not.toMatch(/watchPosition|getCurrentPosition|Start (a )?run|Stop run|Resume run/i)
    }
  })
})
