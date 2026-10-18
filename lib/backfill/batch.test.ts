import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { isBackfilled, markOf, parseBackfillBatch, revealSeenKey, withBackfill, type BackfillBatch } from "./batch"

/** Ticket `0257`. The record's shape, and the two places it is folded into an answer. */

const STANDING = { generation: 1, cells: 2, activities: 3, skills: [{ skillId: "wayfaring", xp: 10 }], totalLevel: 1, totalXp: 10 }
const BATCH: BackfillBatch = {
  version: 1,
  batchId: "2026-10-16T15:10:03.786Z",
  window: { from: "2026-10-16T15:10:03.786Z", to: "2026-10-16T15:31:00.000Z" },
  writtenAt: "2026-10-17T00:00:00.000Z",
  imported: { count: 1, firstStartedAt: "2020-02-24T13:11:04.000Z", lastStartedAt: "2020-02-24T13:11:04.000Z" },
  activityIds: ["a".repeat(64)],
  before: STANDING,
  after: { ...STANDING, generation: 2 },
}

describe("parseBackfillBatch", () => {
  it("reads what is written", () => {
    expect(parseBackfillBatch(JSON.stringify(BATCH))).toEqual(BATCH)
    expect(parseBackfillBatch(new TextEncoder().encode(JSON.stringify(BATCH)))).toEqual(BATCH)
  })

  it("reads anything malformed as no record, never a guess", () => {
    expect(parseBackfillBatch("not json")).toBeNull()
    expect(parseBackfillBatch(JSON.stringify({ ...BATCH, version: 2 }))).toBeNull()
    expect(parseBackfillBatch(JSON.stringify({ ...BATCH, activityIds: [1] }))).toBeNull()
    expect(parseBackfillBatch(JSON.stringify({ ...BATCH, before: { ...STANDING, generation: "1" } }))).toBeNull()
    expect(parseBackfillBatch(JSON.stringify({ ...BATCH, window: undefined }))).toBeNull()
  })
})

describe("the mark and the membership", () => {
  it("serves everything but the ids", () => {
    const mark = markOf(BATCH)
    expect(mark).not.toHaveProperty("activityIds")
    expect(mark).not.toHaveProperty("writtenAt")
    expect(mark.before).toEqual(STANDING)
  })

  it("knows which activities came in", () => {
    expect(isBackfilled(BATCH, "a".repeat(64))).toBe(true)
    expect(isBackfilled(BATCH, "b".repeat(64))).toBe(false)
    expect(isBackfilled(null, "a".repeat(64))).toBe(false)
  })

  it("keys the device's seen flag so it cannot collide with an activity id", () => {
    expect(revealSeenKey(BATCH.batchId)).toBe("backfill:2026-10-16T15:10:03.786Z")
    expect(revealSeenKey(BATCH.batchId)).not.toMatch(/^[0-9a-f]{64}$/)
  })

  it("folds a null batch in as null, and leaves every run unmarked", () => {
    const c = { type: "FeatureCollection" as const, features: [{ properties: { activityId: "a".repeat(64) } }] }
    expect(withBackfill(c, null)).toEqual({ ...c, backfill: null })
  })
})

describe("the record is written by tools only", () => {
  it("no app route, page or component imports the writer", () => {
    for (const f of [
      "app/api/runs/latest/route.ts",
      "app/api/runs/chronicle/route.ts",
      "app/(home)/chronicle/page.tsx",
      "components/plinth/home-screen.tsx",
      "components/backfill/use-backfill-reveal.ts",
    ]) {
      expect(readFileSync(join(process.cwd(), f), "utf8")).not.toMatch(/writeBackfillBatch|buildBackfillBatch/)
    }
  })
})
