import { describe, expect, it } from "vitest"

import { getAdapter } from "@/src/adapters/registry"
import type { IngestJob } from "@/src/adapters/types"
import type { RawArchiveRef } from "@/src/domain/activity"
import { loadRuleSet } from "@/src/rules/load"
import { levelForXp } from "@/src/scoring/levels"
import { scoreActivity } from "@/src/scoring/score-activity"

import { addAwards, awardFor, rowResult, rulesForSkills } from "./optimistic"
import { entryFor, logRows } from "./rows"

/**
 * Ticket 0068 criterion 7: the row shows units, XP and the resulting level before the write has
 * left the browser. The number is only worth showing if it is the number the server will award,
 * so the core test here scores the same entry BOTH ways — the optimistic path, and the manual
 * adapter's real `normalize` into `scoreActivity` — and requires them to agree.
 */
const v2 = loadRuleSet(2)
const rows = logRows(v2)

function serverAward(entry: ReturnType<typeof entryFor>): Record<string, number> {
  const job: IngestJob = {
    ingestKey: "ik",
    userId: "u",
    source: "manual",
    externalId: entry.idempotencyKey,
    command: "ingest",
    startedAt: entry.occurredAt,
    meta: { body: JSON.stringify(entry) },
    enqueuedAt: entry.occurredAt,
  }
  const ref = { archivedAt: entry.occurredAt } as RawArchiveRef
  const { activity } = getAdapter("manual").normalize(Buffer.from(JSON.stringify(entry)), ref, job)
  const out: Record<string, number> = {}
  for (const r of scoreActivity(activity, v2, null, { newCellCount: 0, rearmedCellCount: 0 }, entry.occurredAt)) {
    out[r.skillId] = (out[r.skillId] ?? 0) + r.xpAwarded
  }
  return out
}

describe("awardFor — the optimistic award is the server's award", () => {
  it.each(rows.map((r) => [r.exerciseId, r] as const))("%s, at several values", (_id, row) => {
    for (const value of [row.min, row.fallback, row.fallback * 3, 10_000]) {
      const entry = entryFor(row, value, v2, { now: new Date("2026-10-06T12:00:00Z"), idempotencyKey: "k", timezone: "UTC" })
      expect(awardFor(entry, v2)).toEqual(serverAward(entry))
    }
  })

  it("credits the row's own skill and the meta skill it feeds", () => {
    const row = rows[0]
    const award = awardFor(entryFor(row, 30, v2, { now: new Date(), idempotencyKey: "k", timezone: undefined }), v2)
    expect(award[row.skillId]).toBeGreaterThan(0)
    const feeds = v2.skills.find((s) => s.id === row.skillId)!.feeds.map((f) => f.skill)
    for (const f of feeds) expect(award[f]).toBeGreaterThan(0)
  })
})

describe("rowResult — the gain and the level it lands on", () => {
  it("reads the level off the curve after adding the gain", () => {
    const r = rowResult("s", { s: 120 }, { xp: 1000 }, v2)
    expect(r.xpGained).toBe(120)
    expect(r.level).toBe(levelForXp(1120, v2.curve))
    expect(r.progress).toBeGreaterThanOrEqual(0)
    expect(r.progress).toBeLessThanOrEqual(1)
  })

  it("a skill the award does not touch gains nothing", () => {
    expect(rowResult("other", { s: 120 }, { xp: 0 }, v2)).toMatchObject({ xpGained: 0, level: 1 })
  })

  it("a level boundary is progress 0 in the new level", () => {
    let xp = 0
    while (levelForXp(xp, v2.curve) < 2) xp++
    expect(rowResult("s", { s: xp }, { xp: 0 }, v2)).toMatchObject({ level: 2, progress: 0 })
  })
})

describe("rulesForSkills — the user's ledger version, as the worker reads it", () => {
  it("is the newest bundled for a user with no skills", () => {
    expect(rulesForSkills([]).version).toBeGreaterThanOrEqual(2)
  })

  it("is the highest rulesVersionLastComputed", () => {
    expect(rulesForSkills([{ skillId: "a", xp: 1, rulesVersionLastComputed: 1 }]).version).toBe(1)
    expect(
      rulesForSkills([
        { skillId: "a", xp: 1, rulesVersionLastComputed: 1 },
        { skillId: "b", xp: 1, rulesVersionLastComputed: 2 },
      ]).version,
    ).toBe(2)
  })

  it("falls back to the newest for a version this build does not carry", () => {
    expect(rulesForSkills([{ skillId: "a", xp: 1, rulesVersionLastComputed: 999 }])).toBe(rulesForSkills([]))
  })
})

describe("addAwards", () => {
  it("sums per skill, and undo is the negated award", () => {
    const a = { x: 10, y: 3 }
    expect(addAwards(a, { x: 5 })).toEqual({ x: 15, y: 3 })
    expect(addAwards(a, { x: -10, y: -3 })).toEqual({ x: 0, y: 0 })
  })
})
