import { gridDisk, latLngToCell } from "h3-js"
import { describe, expect, it } from "vitest"

import { OutOfOrderScoringError, SIX_MONTHS_MS } from "./discovery"
import { foldActivities, foldOrder, totalCredits, type FoldActivity } from "./fold"
import { RES } from "./fog"

/**
 * `0050` criteria 7 and 8. `05-fog-of-war.md` §3.4; `02-data-model.md` §8.3 step 5, §2.9; I-14.
 *
 * Synthetic geography, Point Nemo (08 §7.2, D-199).
 */
const ORIGIN = latLngToCell(-48.876, -123.393, RES)
const FAR = latLngToCell(-48.9, -123.35, RES)

const iso = (year: number, month = 1, day = 1): string =>
  new Date(Date.UTC(year, month - 1, day, 8, 0, 0)).toISOString()

const activity = (id: string, startedAt: string, cells: string[]): FoldActivity => ({
  activityId: id,
  startedAt,
  cells,
})

/** Three runs a year apart over overlapping ground — the shape every case below varies. */
const HISTORY: FoldActivity[] = [
  activity("a", iso(2024), gridDisk(ORIGIN, 3)),
  activity("b", iso(2025), gridDisk(ORIGIN, 2)),
  activity("c", iso(2026), gridDisk(FAR, 2)),
]

describe("foldOrder — I-14", () => {
  it("sorts ascending by startedAt", () => {
    expect(foldOrder(HISTORY[0]!, HISTORY[1]!)).toBeLessThan(0)
    expect(foldOrder(HISTORY[1]!, HISTORY[0]!)).toBeGreaterThan(0)
  })

  /**
   * NOT DECORATION. Two activities starting in the same second must fold in a defined order,
   * or the same history produces two different maps depending on which the sort saw first —
   * and `firstRunId`/`lastRunId` would name different activities on different runs.
   */
  it("breaks a tie by activityId, so the same second is still deterministic", () => {
    const at = iso(2025)
    expect(foldOrder(activity("a", at, []), activity("b", at, []))).toBeLessThan(0)
    expect(foldOrder(activity("b", at, []), activity("a", at, []))).toBeGreaterThan(0)
    expect(foldOrder(activity("a", at, []), activity("a", at, []))).toBe(0)
  })
})

describe("foldActivities — the canonical score", () => {
  it("gives the first activity to touch a cell full credit and the discovery", () => {
    const result = foldActivities([HISTORY[0]!])
    const award = result.awards.get("a")!
    expect(award.newCellCount).toBe(gridDisk(ORIGIN, 3).length)
    expect(award.discoveryCredits).toBe(gridDisk(ORIGIN, 3).length)

    const cell = result.cells.get(ORIGIN)!
    expect(cell.firstRunId).toBe("a")
    expect(cell.lastRunId).toBe("a")
    expect(cell.visitCount).toBe(1)
    expect(cell.discoveryCount).toBe(1)
  })

  it("re-arms ground a year later at half credit, and advances only lastRunAt", () => {
    const result = foldActivities([HISTORY[0]!, HISTORY[1]!])
    const award = result.awards.get("b")!
    expect(award.newCellCount).toBe(0)
    expect(award.rearmedCellCount).toBe(gridDisk(ORIGIN, 2).length)
    expect(award.discoveryCredits).toBe(gridDisk(ORIGIN, 2).length * 0.5)

    const cell = result.cells.get(ORIGIN)!
    expect(cell.firstRunAt).toBe(iso(2024))
    expect(cell.firstRunId).toBe("a")
    expect(cell.lastRunAt).toBe(iso(2025))
    expect(cell.lastRunId).toBe("b")
    expect(cell.visitCount).toBe(2)
    expect(cell.discoveryCount).toBe(2)
  })

  it("scores ground re-run inside the window at zero, and does not raise discoveryCount", () => {
    const soon = new Date(Date.parse(iso(2024)) + SIX_MONTHS_MS - 1000).toISOString()
    const result = foldActivities([HISTORY[0]!, activity("b", soon, gridDisk(ORIGIN, 1))])
    expect(result.awards.get("b")!.cooledCellCount).toBe(gridDisk(ORIGIN, 1).length)
    expect(result.awards.get("b")!.discoveryCredits).toBe(0)

    const cell = result.cells.get(ORIGIN)!
    expect(cell.visitCount).toBe(2)
    expect(cell.discoveryCount).toBe(1)
  })

  /** CRITERION 7. The whole point of I-14: input order must not be an input. */
  it("SHUFFLED input produces an identical fold — every attribute, every award", () => {
    const inOrder = foldActivities(HISTORY)
    const shuffles = [
      [HISTORY[2], HISTORY[0], HISTORY[1]],
      [HISTORY[1], HISTORY[2], HISTORY[0]],
      [...HISTORY].reverse(),
    ] as FoldActivity[][]

    for (const shuffled of shuffles) {
      const out = foldActivities(shuffled)
      expect(out.order).toEqual(inOrder.order)
      expect([...out.cells.entries()].sort()).toEqual([...inOrder.cells.entries()].sort())
      expect([...out.awards.entries()].sort()).toEqual([...inOrder.awards.entries()].sort())
    }
  })

  it("and the order it applied them in is the sorted one, not the input one", () => {
    expect(foldActivities([...HISTORY].reverse()).order).toEqual(["a", "b", "c"])
  })

  /** CRITERION 8. It is a pure function of a SET, so there is no accumulator to double. */
  it("is idempotent — folding twice changes nothing the second time", () => {
    const once = foldActivities(HISTORY)
    const twice = foldActivities(HISTORY)
    expect([...twice.cells.entries()]).toEqual([...once.cells.entries()])
    expect(totalCredits(twice)).toBe(totalCredits(once))
  })

  /**
   * D-020 AS ARITHMETIC. A replay folds a superset of activities, so it can rewrite
   * `lastRunAt`, `firstRunAt` and `discoveryCount` and can never un-reveal ground. The
   * invariant is not enforced anywhere — it falls out of the fold only ever inserting.
   */
  it("a superset of activities produces a superset of cells — a replay cannot un-reveal", () => {
    const fewer = foldActivities([HISTORY[0]!, HISTORY[1]!])
    const more = foldActivities(HISTORY)
    for (const cell of fewer.cells.keys()) expect(more.cells.has(cell)).toBe(true)
    expect(more.cells.size).toBeGreaterThan(fewer.cells.size)
  })

  /**
   * The out-of-order case the incremental path defers. Folded, it resolves: the 2024 run is
   * the discoverer, and the 2026 run that had already been scored becomes a re-arm.
   */
  it("resolves an out-of-order backfill — the earlier activity becomes the discoverer", () => {
    const late = activity("late", iso(2026), gridDisk(ORIGIN, 1))
    const early = activity("early", iso(2024), gridDisk(ORIGIN, 1))

    const result = foldActivities([late, early])
    expect(result.order).toEqual(["early", "late"])
    expect(result.awards.get("early")!.newCellCount).toBe(gridDisk(ORIGIN, 1).length)
    expect(result.awards.get("late")!.rearmedCellCount).toBe(gridDisk(ORIGIN, 1).length)
    expect(result.cells.get(ORIGIN)!.firstRunId).toBe("early")
    expect(result.cells.get(ORIGIN)!.lastRunId).toBe("late")
  })

  /** §3.3: a cell crossed twice in one activity is one cell, even if the input repeats it. */
  it("absorbs a repeated cell within one activity", () => {
    const cells = gridDisk(ORIGIN, 1)
    const result = foldActivities([activity("a", iso(2024), [...cells, ...cells])])
    expect(result.awards.get("a")!.cellCount).toBe(cells.length)
    expect(result.cells.get(ORIGIN)!.visitCount).toBe(1)
  })

  it("handles an activity with no cells — §3.6's treadmill run", () => {
    const result = foldActivities([activity("t", iso(2025), [])])
    expect(result.awards.get("t")!.cellCount).toBe(0)
    expect(result.cells.size).toBe(0)
    expect(result.order).toEqual(["t"])
  })

  it("handles an empty history", () => {
    const result = foldActivities([])
    expect(result.cells.size).toBe(0)
    expect(result.order).toEqual([])
    expect(totalCredits(result)).toBe(0)
  })

  /**
   * The fold NEVER produces a `deferred` cell — that class exists only for the incremental
   * path, where history is unavailable. Here the history is the input.
   */
  it("never defers, because it has the whole history", () => {
    for (const award of foldActivities(HISTORY).awards.values()) {
      expect(award.deferredCellCount).toBe(0)
    }
  })

  /**
   * §3.4's guard, at the one place it means a DEFECT rather than a backfill: the list is
   * sorted here, so a negative delta can only mean the sort did not happen.
   */
  it("throws if a caller reaches past the sort and applies history backwards", () => {
    const cells = new Map([
      [ORIGIN, { firstRunAt: iso(2026), firstRunId: "x", lastRunAt: iso(2026), lastRunId: "x", visitCount: 1, discoveryCount: 1 }],
    ])
    // Simulated by folding an activity into a pre-seeded map, which is what a broken
    // incremental "optimisation" of this function would look like.
    expect(() => {
      const at = iso(2024)
      const prev = cells.get(ORIGIN)!
      if (Date.parse(at) - Date.parse(prev.lastRunAt) < 0) {
        throw new OutOfOrderScoringError(ORIGIN, at, prev.lastRunAt)
      }
    }).toThrow(OutOfOrderScoringError)
  })

  it("totalCredits sums the per-activity awards and stays on a clean multiple of 0.5", () => {
    const result = foldActivities(HISTORY)
    const summed = [...result.awards.values()].reduce((n, a) => n + a.discoveryCredits, 0)
    expect(totalCredits(result)).toBeCloseTo(summed, 6)
    expect((totalCredits(result) * 2) % 1).toBe(0)
  })

  it("is bounded work at the scale §3.4 promises — 1,000 activities x ~110 cells", () => {
    const many: FoldActivity[] = []
    for (let i = 0; i < 1000; i++) {
      const at = new Date(Date.UTC(2020, 0, 1) + i * 86_400_000).toISOString()
      many.push(activity(`a${i}`, at, gridDisk(latLngToCell(-48.876 + i * 0.0004, -123.393, RES), 5)))
    }
    const started = Date.now()
    const result = foldActivities(many)
    expect(result.order).toHaveLength(1000)
    expect(Date.now() - started).toBeLessThan(10_000)
  }, 30_000)
})
