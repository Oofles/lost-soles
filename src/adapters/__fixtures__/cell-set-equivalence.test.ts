import { gridDisk, latLngToCell, type H3Index } from "h3-js"
import { describe, expect, it } from "vitest"

import { RES } from "@/src/domain/fog"

import {
  assertEquivalentCellSets,
  compareCellSets,
  MAX_CELL_SET_DIVERGENCE,
} from "./cell-set-equivalence"

/**
 * THE HARNESS'S OWN TEETH. Ticket `0155`.
 *
 * `0155`'s Notes name the failure mode this file exists to prevent: *"the tolerance is the part
 * most likely to be got wrong in a way that makes the test useless. A tolerance wide enough to
 * never fail is a test that has been deleted without anyone noticing."*
 *
 * The driver in the primary adapter's directory shows the harness passing on real fixtures.
 * This shows it FAILING — on a divergence too large, and on a divergence too SHAPED, which is
 * the one a percentage alone would let through.
 *
 * Synthetic geography, Point Nemo (08 §7.2, D-199). No adapter is named here: the harness is
 * source-agnostic and so is its test, which is why this file survives a migration that deletes
 * the driver.
 */
const NEMO = { lat: -48.876, lng: -123.393 }

/** A long line of res-10 cells, ~200 of them, stepping north at roughly cell spacing. */
function lineOfCells(count: number): H3Index[] {
  const seen: H3Index[] = []
  const set = new Set<H3Index>()
  for (let i = 0; seen.length < count && i < count * 20; i++) {
    const cell = latLngToCell(NEMO.lat + i * 0.0003, NEMO.lng, RES)
    if (set.has(cell)) continue
    set.add(cell)
    seen.push(cell)
  }
  return seen
}

const LINE = lineOfCells(200)
const setOf = (cells: readonly H3Index[]) => new Set(cells)

describe("compareCellSets", () => {
  it("reports zero divergence and nothing isolated for identical sets", () => {
    const result = compareCellSets(setOf(LINE), setOf(LINE))
    expect(result.divergence).toBe(0)
    expect(result.onlyA).toEqual([])
    expect(result.isolated).toEqual([])
    expect(result.intersection.size).toBe(LINE.length)
  })

  it("reports 1 for disjoint sets", () => {
    const elsewhere = gridDisk(latLngToCell(-48.5, -123.0, RES), 3)
    expect(compareCellSets(setOf(LINE), setOf(elsewhere)).divergence).toBe(1)
  })

  it("treats two empty sets as equal rather than dividing by zero", () => {
    const result = compareCellSets(new Set(), new Set())
    expect(result.divergence).toBe(0)
    expect(result.isolated).toEqual([])
  })
})

describe("what the tolerance ABSORBS — rounding at a cell edge", () => {
  /**
   * A fix within a metre of a boundary lands either side of it and the disc it qualifies
   * shifts by one cell. Such a cell is by construction ADJACENT to the agreed set — it is the
   * neighbour of ground both adapters kept.
   */
  it("passes when a boundary cell differs, and reports it as not isolated", () => {
    const neighbour = gridDisk(LINE[100]!, 1).find((c) => !LINE.includes(c))!
    const result = assertEquivalentCellSets(
      setOf(LINE),
      setOf([...LINE, neighbour]),
      { a: "a", b: "b" },
    )
    expect(result.onlyB).toEqual([neighbour])
    expect(result.isolated).toEqual([])
    expect(result.divergence).toBeLessThan(MAX_CELL_SET_DIVERGENCE)
  })

  it("passes at a divergence just inside the tolerance", () => {
    // 3 of 203 ≈ 1.48%, under 2%, and every one of them adjacent to the agreed set.
    const extra = [3, 100, 180].map((i) => gridDisk(LINE[i]!, 1).find((c) => !LINE.includes(c))!)
    expect(() =>
      assertEquivalentCellSets(setOf(LINE), setOf([...LINE, ...extra]), { a: "a", b: "b" }),
    ).not.toThrow()
  })
})

describe("what it must NOT absorb", () => {
  /**
   * The measured case from `cell-set-equivalence.ts`'s table: re-projecting the real run at
   * 4 decimal places (11 m — beyond any plausible GPX) moved 10.2% of the union. Represented
   * here as a proportional number of adjacent cells, so the assertion is about the TOLERANCE
   * rather than about H3.
   */
  it("FAILS when too much of the union differs, even though every cell is adjacent", () => {
    const extra = LINE.slice(0, 20).map((c) => gridDisk(c, 1).find((n) => !LINE.includes(n))!)
    const unique = [...new Set(extra)]
    expect(unique.length).toBeGreaterThan(10)

    expect(() =>
      assertEquivalentCellSets(setOf(LINE), setOf([...LINE, ...unique]), { a: "a", b: "b" }),
    ).toThrow(/of the union differs, over the 2.00% tolerance/)
  })

  /**
   * THE ONE A PERCENTAGE ALONE WOULD LET THROUGH, and the reason `isolated` exists.
   *
   * Losing the last 200 m of a 6 km run is three cells of forty-five — under 7%, and on a
   * longer run far less. It is not rounding: it is a DROPPED SEGMENT, and it is permanent
   * wrong ground on a map that never re-fogs.
   */
  it("FAILS on a dropped segment even when it is well inside the tolerance", () => {
    const truncated = LINE.slice(0, LINE.length - 3)
    const result = compareCellSets(setOf(LINE), setOf(truncated))

    // 3 of 200 = 1.5%, comfortably under the 2% tolerance…
    expect(result.divergence).toBeLessThan(MAX_CELL_SET_DIVERGENCE)
    // …and it fails anyway, because the far end of the missing run touches nothing agreed.
    expect(result.isolated.length).toBeGreaterThan(0)
    expect(() =>
      assertEquivalentCellSets(setOf(LINE), setOf(truncated), { a: "a", b: "b" }),
    ).toThrow(/touch nothing both adapters agreed on/)
  })

  /**
   * Both reasons at once, and the message says both. A detached blob is over the tolerance AND
   * isolated; reporting only whichever was checked first would hide half the finding.
   */
  it("FAILS on a detached region, and names BOTH reasons", () => {
    const elsewhere = gridDisk(latLngToCell(-48.5, -123.0, RES), 1)
    try {
      assertEquivalentCellSets(setOf(LINE), setOf([...LINE, ...elsewhere]), { a: "a", b: "b" })
      throw new Error("expected a throw")
    } catch (e) {
      const m = (e as Error).message
      expect(m).toContain("touch nothing both adapters agreed on")
      expect(m).toContain("over the 2.00% tolerance")
      // Isolation first: no tolerance makes a detached region acceptable.
      expect(m.indexOf("touch nothing")).toBeLessThan(m.indexOf("over the 2.00%"))
    }
  })
})

describe("the failure message", () => {
  const message = (): string => {
    try {
      assertEquivalentCellSets(
        setOf(LINE),
        setOf(LINE.slice(0, LINE.length - 3)),
        { a: "primary", b: "candidate" },
      )
      throw new Error("expected a throw")
    } catch (e) {
      return (e as Error).message
    }
  }

  /** CRITERION 6, verbatim: it names all three and says what an unequal set means. */
  it("names D-020, D-100 and D-121.1", () => {
    const m = message()
    expect(m).toContain("D-020")
    expect(m).toContain("D-100")
    expect(m).toContain("D-121.1")
  })

  it("says, in one line, that this is permanent wrong ground on a map that cannot re-fog", () => {
    expect(message()).toContain(
      "wrong ground written permanently into a map with no undo",
    )
  })

  it("names both adapters and shows the cells, so it is actionable at 2am", () => {
    const m = message()
    expect(m).toContain("primary")
    expect(m).toContain("candidate")
    expect(m).toMatch(/only in primary: [0-9a-f]{15}/)
  })

  /** `0155`'s Notes, made part of the artefact rather than left in the ticket. */
  it("tells the reader not to widen the tolerance to make it pass", () => {
    expect(message()).toContain("Do not widen the tolerance")
  })
})
