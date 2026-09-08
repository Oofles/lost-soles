import { UpdateCommand } from "@aws-sdk/lib-dynamodb"
import { cellToParent } from "h3-js"
import { describe, expect, it } from "vitest"

import { awardOf, classifyCells, type CellRecord } from "@/src/domain/discovery"
import { RES_PARENT, traceToCells } from "@/src/domain/fog"
import type { GeoPoint, Trace } from "@/src/domain/activity"

import { writeCells } from "./explored-cells"

/**
 * `0050` CRITERION 1. `05-fog-of-war.md` §3.3, and it is explicit about why each of these
 * deserves a named test rather than a comment:
 *
 * > *"All of these are solved by one design decision — `traceToCells` returns a **`Set`** — but
 * > each deserves an explicit statement so nobody 'optimises' it away."*
 *
 * That is the whole point of this file. Every case below would pass today if `traceToCells`
 * returned a list and something downstream happened to de-duplicate; each test asserts the
 * OBSERVABLE consequence — cell count, credit, and `visitCount` — so the guarantee survives a
 * refactor of any single layer.
 *
 * Synthetic geography, Point Nemo (08 §7.2, D-199).
 */
const LAT = -48.876
const LNG = -123.393

/** A straight leg north, one point every ~28 m. Long enough to cross several res-10 cells. */
function leg(from: number, to: number, tStart: number): GeoPoint[] {
  const points: GeoPoint[] = []
  const steps = Math.round(Math.abs(to - from) / 0.00025)
  for (let i = 0; i <= steps; i++) {
    points.push({ lat: from + ((to - from) * i) / steps, lng: LNG, t: tStart + i * 10_000 })
  }
  return points
}

function traceOf(points: GeoPoint[]): Trace {
  const lats = points.map((p) => p.lat)
  const lngs = points.map((p) => p.lng)
  return {
    points,
    gaps: [],
    simplified: false,
    bbox: [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)],
    pointCount: points.length,
  }
}

/** An in-memory T6 that applies the two writes the module emits, so `visitCount` is real. */
function fakeTable(seed: Record<string, Record<string, unknown>> = {}) {
  const store: Record<string, Record<string, unknown>> = { ...seed }
  const ddb = {
    async send(command: UpdateCommand) {
      const input = command.input
      const id = `${String(input.Key!.pk)}|${String(input.Key!.sk)}`
      const item = store[id]
      const v = input.ExpressionAttributeValues as Record<string, string | number>

      if (String(input.UpdateExpression).startsWith("SET firstRunAt = if_not_exists")) {
        if (item && !(String(item.lastRunAt) < String(v[":at"]))) throw conditionalFailure()
        store[id] = {
          ...item,
          firstRunAt: item?.firstRunAt ?? v[":at"],
          lastRunAt: v[":at"],
          visitCount: (Number(item?.visitCount) || 0) + Number(v[":one"]),
          discoveryCount: (Number(item?.discoveryCount) || 0) + Number(v[":credit"]),
        }
        return {}
      }
      if (String(input.UpdateExpression).startsWith("SET firstRunAt = :at")) {
        if (!item || !(String(item.firstRunAt) > String(v[":at"]))) throw conditionalFailure()
        store[id] = { ...item, firstRunAt: v[":at"] }
        return {}
      }
      throw new Error(`unexpected expression: ${input.UpdateExpression}`)
    },
  }
  return {
    ddb,
    store,
    at: (cell: string) => store[`U#u-1|${cell}`.replace("|", `#C#${cellToParent(cell, RES_PARENT)}|`)],
  }
}

const conditionalFailure = () =>
  Object.assign(new Error("The conditional request failed"), {
    name: "ConditionalCheckFailedException",
  })

/** Project, classify against `known`, write. Returns everything the criteria ask about. */
async function score(trace: Trace, startedAt: string, table: ReturnType<typeof fakeTable>) {
  const cells = traceToCells(trace)
  const records = new Map<string, CellRecord>()
  for (const cell of cells) {
    const item = table.store[`U#u-1#C#${cellToParent(cell, RES_PARENT)}|${cell}`]
    if (item?.lastRunAt) records.set(cell, { lastRunAt: String(item.lastRunAt) })
  }
  const classified = classifyCells(cells, records, startedAt)
  const award = awardOf(classified)
  await writeCells(classified, { userId: "u-1", activityId: `a-${startedAt}`, startedAt }, {
    ddb: table.ddb,
    table: "T",
    concurrency: 1,
  })
  return { cells, award }
}

const visitCountOf = (table: ReturnType<typeof fakeTable>, cell: string): number =>
  Number(table.store[`U#u-1#C#${cellToParent(cell, RES_PARENT)}|${cell}`]?.visitCount ?? 0)

const OUT = leg(LAT, LAT + 0.006, 0)

describe("§3.3 case 1 — a cell crossed twice in one activity scores once", () => {
  it("counts one cell, one credit and visitCount 1, not 2", async () => {
    // The same leg walked, then walked again inside the SAME activity.
    const doubled = traceOf([...OUT, ...leg(LAT + 0.006, LAT, OUT.length * 10_000)])
    const oneWay = traceOf(OUT)

    const table = fakeTable()
    const { cells, award } = await score(doubled, "2026-01-01T08:00:00.000Z", table)

    expect(cells.size).toBe(traceToCells(oneWay).size)
    expect(award.cellCount).toBe(cells.size)
    expect(award.newCellCount).toBe(cells.size)
    // THE ASSERTION THAT MATTERS: visits are per ACTIVITY, not per traversal.
    for (const cell of cells) expect(visitCountOf(table, cell)).toBe(1)
  })
})

describe("§3.3 case 2 — an out-and-back scores exactly its one-way version", () => {
  it("earns identical credit, because the return leg is already in the set", async () => {
    const outAndBack = traceOf([...OUT, ...leg(LAT + 0.006, LAT, OUT.length * 10_000)])

    const a = await score(traceOf(OUT), "2026-01-01T08:00:00.000Z", fakeTable())
    const b = await score(outAndBack, "2026-01-01T08:00:00.000Z", fakeTable())

    expect(b.cells.size).toBe(a.cells.size)
    expect(b.award.discoveryCredits).toBe(a.award.discoveryCredits)
    expect(b.award.newCellCount).toBe(a.award.newCellCount)
  })
})

describe("§3.3 case 3 — a figure-eight's crossing cell is one cell", () => {
  it("counts the crossing once and gives it visitCount 1", async () => {
    // Two loops meeting at the origin: north-and-back, then south-and-back.
    const north = [...leg(LAT, LAT + 0.004, 0), ...leg(LAT + 0.004, LAT, 400_000)]
    const south = [...leg(LAT, LAT - 0.004, 800_000), ...leg(LAT - 0.004, LAT, 1_200_000)]
    const table = fakeTable()
    const { cells, award } = await score(
      traceOf([...north, ...south]),
      "2026-01-01T08:00:00.000Z",
      table,
    )

    const crossing = traceToCells(traceOf([{ lat: LAT, lng: LNG, t: 0 }]))
    for (const cell of crossing) {
      expect(cells.has(cell)).toBe(true)
      expect(visitCountOf(table, cell)).toBe(1)
    }
    expect(award.cellCount).toBe(cells.size)
    expect([...cells]).toHaveLength(new Set(cells).size)
  })
})

describe("§3.3 case 4 — two activities on the same day score independently", () => {
  /**
   * *"The second run over the same ground finds `lastRunAt` set to a few hours ago and scores
   * ZERO (cooled). Correct per D-120 — the cooldown does not care that it is the same day."*
   */
  it("the second scores zero credit and raises visitCount to 2", async () => {
    const table = fakeTable()
    const morning = await score(traceOf(OUT), "2026-01-01T08:00:00.000Z", table)
    const evening = await score(traceOf(OUT), "2026-01-01T18:00:00.000Z", table)

    expect(morning.award.newCellCount).toBe(morning.cells.size)
    expect(morning.award.discoveryCredits).toBe(morning.cells.size)

    expect(evening.award.cellCount).toBe(morning.cells.size)
    expect(evening.award.newCellCount).toBe(0)
    expect(evening.award.cooledCellCount).toBe(morning.cells.size)
    expect(evening.award.discoveryCredits).toBe(0)

    for (const cell of evening.cells) expect(visitCountOf(table, cell)).toBe(2)
  })

  it("and discoveryCount stays at 1 — ran twice, discovered once", async () => {
    const table = fakeTable()
    await score(traceOf(OUT), "2026-01-01T08:00:00.000Z", table)
    await score(traceOf(OUT), "2026-01-01T18:00:00.000Z", table)
    for (const cell of traceToCells(traceOf(OUT))) {
      const item = table.store[`U#u-1#C#${cellToParent(cell, RES_PARENT)}|${cell}`]!
      expect(item.discoveryCount).toBe(1)
      expect(item.visitCount).toBe(2)
    }
  })
})

describe("§3.3 case 5 — a paused-and-resumed recording is ONE activity", () => {
  /**
   * *"Segment splitting (§2.2 step 3) keeps its geometry honest but does not split the
   * scoring."* The gap stops the projector drawing a corridor across the pause; it does not
   * make two activities, so `visitCount` is still 1 everywhere.
   */
  it("splits the geometry but not the scoring — visitCount 1, one award", async () => {
    const first = leg(LAT, LAT + 0.003, 0)
    /**
     * Resumed 40 minutes later, 400 m further north. The distance is deliberately SMALL: a
     * 2 km jump would be caught by §2.2's implausible-speed split regardless, so the test
     * would pass without the `gaps` field doing anything. At 400 m over 40 minutes the average
     * speed is a slow walk, so only the declared gap can stop the corridor (D-198).
     */
    const second = leg(LAT + 0.0066, LAT + 0.0096, 2_400_000)
    const paused: Trace = {
      ...traceOf([...first, ...second]),
      // `[startIdx, endIdx]` — the pair of point indices a corridor must not be drawn across.
      gaps: [[first.length - 1, first.length]],
    }

    const table = fakeTable()
    const { cells, award } = await score(paused, "2026-01-01T08:00:00.000Z", table)

    // The geometry is honest: no corridor across the 2 km pause.
    const bridged = traceToCells(traceOf([...first, ...second]))
    expect(cells.size).toBeLessThan(bridged.size)

    // The scoring is one activity: one award, and every cell visited once.
    expect(award.cellCount).toBe(cells.size)
    expect(award.newCellCount).toBe(cells.size)
    for (const cell of cells) expect(visitCountOf(table, cell)).toBe(1)
  })
})

describe("§3.3's closing rule — classify fully, THEN write", () => {
  /**
   * *"Do not update `lastRunAt` inside the classify loop — if you do, a cell would be re-read
   * as 'cooled' by a later iteration."* The consequence is not subtle: it would halve the
   * credit of exactly the long runs through new territory the game exists to reward, and
   * nothing would look wrong.
   */
  it("a long run through entirely new ground earns full credit on every cell", async () => {
    const long = traceOf(leg(LAT, LAT + 0.05, 0))
    const table = fakeTable()
    const { cells, award } = await score(long, "2026-01-01T08:00:00.000Z", table)

    // ~5.5 km north at res 10's 131 m spacing. Long enough that a classify-then-write bug
    // would show up as dozens of cells reading "cooled" against this run's own earlier cells.
    expect(cells.size).toBeGreaterThan(30)
    expect(award.newCellCount).toBe(cells.size)
    expect(award.cooledCellCount).toBe(0)
    expect(award.discoveryCredits).toBe(cells.size)
  })
})

describe("re-processing the same run is a no-op (criterion 4)", () => {
  /**
   * *"Re-processing the same run changes ZERO cells and ZERO timestamps and writes nothing."*
   * Cell writes are idempotent by construction — `min`, `max`, set-insert — which is what lets
   * a partial retry converge without a compensating transaction.
   */
  it("changes no timestamp and no count on a second identical pass", async () => {
    const table = fakeTable()
    await score(traceOf(OUT), "2026-01-01T08:00:00.000Z", table)
    const before = JSON.parse(JSON.stringify(table.store)) as Record<string, unknown>

    await score(traceOf(OUT), "2026-01-01T08:00:00.000Z", table)

    // Both conditions fail on the replay: `lastRunAt < :at` is false (equal), and
    // `firstRunAt > :at` is false (equal). Nothing is written at all.
    expect(table.store).toEqual(before)
  })
})
