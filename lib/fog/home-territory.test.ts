import { readFileSync } from "node:fs"

import { gridDisk, latLngToCell } from "h3-js"
import { describe, expect, it } from "vitest"

import { cellToBig } from "@/src/domain/explored-blob"
import { RES } from "@/src/domain/fog"

import { ExploredSet } from "./explored-set"
import { homeTerritory } from "./home-territory"

/**
 * TICKET `0087` — WHAT `/` DRAWS FOG OVER (`06` §2.4). SYNTHETIC GEOGRAPHY, POINT NEMO (D-199).
 */
const ORIGIN = latLngToCell(-48.876, -123.393, RES)
const RING = gridDisk(ORIGIN, 2)
const sorted = (cells: readonly string[]) =>
  new BigUint64Array(cells.map(cellToBig).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)))
const setOf = (cells: readonly string[]) => ExploredSet.fromCells(sorted(cells), 5)

describe("no territory, no fog (criterion 2)", () => {
  it("nothing loaded and nothing ever imported are both null — no layer, not an empty one", () => {
    expect(homeTerritory(null, [])).toBeNull()
    expect(homeTerritory(ExploredSet.fromCells(new BigUint64Array(0), 0), [])).toBeNull()
  })

  it("the unseen FIRST run is a zero-cell mask too: held back, nothing is left, so no fog", () => {
    expect(homeTerritory(setOf(RING), RING)).toBeNull()
  })

  it("the hook creates no FogMaskLayer when home has no territory", () => {
    const hook = readFileSync(new URL("../../components/map/use-fog-mask.ts", import.meta.url), "utf8")
    const guard = hook.indexOf("if (!map || disabled || fogless)")
    expect(guard).toBeGreaterThan(-1)
    expect(guard).toBeLessThan(hook.indexOf("new FogMaskLayer("))
    expect(hook).toContain("const fogless = home !== null && set === null")
  })
})

describe("an unseen run is held back (criterion 5)", () => {
  it("draws the territory as of before the run: its new cells are left out", () => {
    const before = RING.slice(0, 10)
    const fresh = RING.slice(10)
    const shown = homeTerritory(setOf(RING), fresh)!
    expect([...shown.cells]).toEqual([...sorted(before)])
  })

  it("holds nothing back for a seen run, and keeps the set's identity so in-place deltas still reach the buckets", () => {
    const set = setOf(RING)
    expect(homeTerritory(set, [])).toBe(set)
  })

  it("a hold naming cells the set does not have yet changes nothing", () => {
    const set = setOf(RING.slice(0, 5))
    expect(homeTerritory(set, gridDisk(latLngToCell(-50, -120, RES), 1))).toBe(set)
  })
})
