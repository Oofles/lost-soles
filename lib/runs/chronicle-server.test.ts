import type { QueryCommand } from "@aws-sdk/lib-dynamodb"
import { describe, expect, it } from "vitest"

import { latLngToCell } from "h3-js"

import { chronicleFor, historyUpTo, namesFor } from "./chronicle-server"
import { EMPTY_COLLECTION, type RunSummary } from "./wire"

/** Ticket `0083` — beat 4's server half: the history read and the line it feeds. */

const SUMMARY: RunSummary = {
  activityId: "a-9",
  startedAt: "2026-08-28T11:00:00.000Z",
  startedAtLocal: "2026-08-28T07:00:00",
  name: null,
  kind: "run",
  distanceM: 5000,
  elapsedS: 1800,
  movingS: 1800,
  source: "manual",
  newCellCount: 0,
  rearmedCellCount: 0,
  cellCount: 140,
  route: EMPTY_COLLECTION,
  reveal: { new: [], rearmed: [] },
}

describe("historyUpTo", () => {
  it("pages to the end, bounded at the run's own start, and reads three attributes", async () => {
    const sent: QueryCommand[] = []
    const pages = [
      { Items: [{ id: "a-1", startedAt: "2026-08-01T00:00:00Z", distanceM: 4000, newCellCount: 12 }], LastEvaluatedKey: { k: 1 } },
      { Items: [{ id: "a-2", startedAt: "2026-08-02T00:00:00Z" }, { junk: true }] },
    ]
    const ddb = { send: async (c: QueryCommand) => (sent.push(c), pages[sent.length - 1]) }
    const out = await historyUpTo("u", SUMMARY.startedAt, { ddb, activityTable: "T3" })
    expect(out).toEqual([
      { activityId: "a-1", startedAt: "2026-08-01T00:00:00Z", distanceM: 4000, newCellCount: 12 },
      { activityId: "a-2", startedAt: "2026-08-02T00:00:00Z", distanceM: null, newCellCount: 0 },
    ])
    expect(sent).toHaveLength(2)
    expect(sent[0].input).toMatchObject({ IndexName: "byUserAndStart", ExpressionAttributeValues: { ":u": "u", ":s": SUMMARY.startedAt } })
    expect(sent[1].input.ExclusiveStartKey).toEqual({ k: 1 })
  })
})

describe("chronicleFor", () => {
  it("always returns a line from the shipped table, history or not", () => {
    expect(chronicleFor(SUMMARY, null).text.length).toBeGreaterThan(10)
    expect(chronicleFor(SUMMARY, []).set).toBe("no-new-ground")
  })

  it("is the same line on every read of the same run — a Relive does not rewrite it", () => {
    expect(chronicleFor(SUMMARY, [])).toEqual(chronicleFor(SUMMARY, []))
  })
})

describe("namesFor (0256)", () => {
  // Point Nemo (D-199): synthetic geography only.
  const A = latLngToCell(-48.876, -123.393, 10)
  const B = latLngToCell(-48.87, -123.393, 10)
  const C = latLngToCell(-48.88, -123.393, 10)
  const run: RunSummary = {
    ...SUMMARY,
    rearmedCellCount: 3,
    route: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "MultiLineString", coordinates: [[[-123.39, -48.87], [-123.391, -48.871]]] },
          properties: { activityId: "a-9", startedAt: SUMMARY.startedAt, name: null },
        },
      ],
    },
    reveal: {
      new: [],
      rearmed: [A, B, C],
      rearmedSince: { [A]: "2026-01-29T11:00:00.000Z", [B]: "2025-08-28T11:00:00.000Z" },
    },
  }
  const streets = new Map([[A, "Ashgrove Lane"], [B, "Ashgrove Lane"], [C, "Mill Road"]])
  const names = {
    place: async (p: { lat: number; lng: number }) => (p.lng === -123.39 ? "Millbrook" : null),
    street: async (p: { lat: number; lng: number }) => streets.get(latLngToCell(p.lat, p.lng, 10)) ?? null,
  }

  it("names the street from stored facts: the re-armed cells and their previous lastRunAt", async () => {
    const n = await namesFor(run, names)
    // C has no stored lastRunAt (a pre-0256 object would have none at all), so it is not counted.
    expect(n).toEqual({ place: "Millbrook", returned: { street: "Ashgrove Lane", gapDays: 211 }, rearmGapsDays: [211, 365] })
    const line = chronicleFor(run, [], n)
    expect(line.rowId).toBe("rearmed-returned-named")
    expect(line.text).toBe("You returned to Ashgrove Lane after two hundred and eleven days. It remembered you.")
  })

  it("selects the same line on every read of the same activity", async () => {
    expect(chronicleFor(run, [], await namesFor(run, names))).toEqual(chronicleFor(run, [], await namesFor(run, names)))
  })

  it("an object from before 0256 names nothing, and the line falls back as it did", async () => {
    const old = { ...run, reveal: { new: [], rearmed: [A, B, C] } }
    const n = await namesFor(old, names)
    expect(n.returned).toBeNull()
    expect(chronicleFor(old, [], n).rowId).not.toBe("rearmed-returned-named")
  })
})
