import { describe, expect, it } from "vitest"

import SIGILS from "@/rules/sigils.json"
import { loadRuleSet } from "@/src/rules/load"
import type { RuleSet } from "@/src/rules/schema"

import { LOG_LAYOUT, logColumns, logSplits, splitLogLines, splitPreview, type LogColumn, type LogLayout } from "./layout"
import { logRows } from "./rows"

/** Ticket 0344, D-485: `/log`'s columns are read from `rules/log-layout.json` and the ruleset. */

const V5 = loadRuleSet(5)
const ids = (c: LogColumn) => c.items.map((i) => i.id)

describe("rules/log-layout.json", () => {
  it("names a column for every entry kind, and lists no entry twice", () => {
    const columnIds = LOG_LAYOUT.columns.map((c) => c.id)
    for (const entry of ["count", "seconds", "distance", "minutes"] as const) {
      expect(columnIds, entry).toContain(LOG_LAYOUT.fallbackByEntry[entry])
    }
    const listed = LOG_LAYOUT.columns.flatMap((c) => c.entries)
    expect(new Set(listed).size).toBe(listed.length)
  })

  it("lists only ids the newest ruleset knows: an exercise or a split", () => {
    const known = new Set([...logRows(V5).map((r) => r.exerciseId), ...(V5.splits ?? []).map((s) => s.id)])
    for (const id of LOG_LAYOUT.columns.flatMap((c) => c.entries)) expect(known.has(id), id).toBe(true)
  })

  it("every split /log offers has a sigil", () => {
    for (const s of logSplits(V5)) expect(Object.hasOwn(SIGILS.sigils, s.splitId), s.splitId).toBe(true)
  })
})

describe("logColumns under v5 (the approved mock)", () => {
  const [full, quick] = logColumns(V5)

  it("is Full workouts (Strength, Poise, Vigil) beside Quick workouts (pushups, situps, plank)", () => {
    expect(full).toMatchObject({ title: "Full workouts" })
    expect(quick).toMatchObject({ title: "Quick workouts" })
    expect(ids(full!)).toEqual(["strength", "yoga", "treadmill"])
    expect(ids(quick!)).toEqual(["pushup", "situp", "plank"])
  })

  it("never draws a split's members as rows of their own", () => {
    const members = new Set(V5.splits!.flatMap((s) => s.members))
    const rowIds = [full!, quick!].flatMap((c) => c.items.filter((i) => i.kind === "row").map((i) => i.id))
    for (const id of rowIds) expect(members.has(id), id).toBe(false)
  })

  it("draws the split from its declaration: label, members in order, step", () => {
    const item = full!.items[0]!
    expect(item.kind).toBe("split")
    if (item.kind !== "split") return
    expect(item.split).toMatchObject({ label: "Strength workout", shareStep: 10, step: 5, fallback: 30 })
    expect(item.split.members.map((m) => m.skillName)).toEqual(["Might", "Footing", "Fortitude"])
  })
})

describe("an entry the layout does not list (06 §6.5: a new row needs nothing else)", () => {
  it("lands at the bottom of its entry kind's column, in registry order", () => {
    const empty: LogLayout = { ...LOG_LAYOUT, columns: LOG_LAYOUT.columns.map((c) => ({ ...c, entries: [] })) }
    const [full, quick] = logColumns(V5, empty)
    // Registry order: treadmill (15), the split where Might's rows begin (30), yoga (55).
    expect(ids(full!)).toEqual(["treadmill", "strength", "yoga"])
    expect(ids(quick!)).toEqual(["pushup", "situp", "plank"])
  })

  it("a second split in the YAML renders with no code (D-031)", () => {
    const rules: RuleSet = structuredClone(V5)
    const s = rules.splits![0]!
    rules.splits!.push({ ...s, id: "upper-lower", label: "Upper / lower", members: s.members.slice(0, 2) })
    const [full] = logColumns(rules)
    expect(ids(full!)).toEqual(["strength", "yoga", "treadmill", "upper-lower"])
  })

  it("v4 has no split, so its minutes rows stand as rows", () => {
    const [full, quick] = logColumns(loadRuleSet(4))
    expect(ids(full!)).toEqual(["yoga", "treadmill"])
    expect(ids(quick!)).toEqual(["pushup", "situp", "plank"])
  })
})

describe("splitPreview", () => {
  const split = logSplits(V5)[0]!

  it("45 min at 40/30/30 is 18:00 / 13:30 / 13:30 and 540 / 405 / 405 XP", () => {
    const p = splitPreview(split, 45, [40, 30, 30], V5)
    expect(p.total).toBe(100)
    expect(p.regions.map((r) => r.seconds)).toEqual([1080, 810, 810])
    expect(p.regions.map((r) => r.xp)).toEqual([540, 405, 405])
  })

  it("a remainder second goes to the largest share, as the server apportions it", () => {
    const p = splitPreview(split, 1 + 1 / 60, [30, 40, 30], V5) // 61 s
    expect(p.regions.map((r) => r.seconds)).toEqual([18, 25, 18])
  })

  it("every share starts at 0%: nothing to log, nothing previewed", () => {
    const p = splitPreview(split, 45, [0, 0, 0], V5)
    expect(p.total).toBe(0)
    expect(p.regions.every((r) => r.seconds === 0 && r.xp === 0)).toBe(true)
  })

  it("applies each skill's soft cap: two hours all upper body is 2,700, not 3,600", () => {
    expect(splitPreview(split, 120, [100, 0, 0], V5).regions[0]!.xp).toBe(2700)
  })
})

describe("splitLogLines: what a split log's confirmation lists (0344)", () => {
  const split = logSplits(V5)[0]!

  it("members' skills in split order, then what they feed, with levels from the live standing", async () => {
    const { awardFor } = await import("./optimistic")
    const { splitEntryFor } = await import("./rows")
    const entry = splitEntryFor(V5.splits![0]!, 45, split.members.map((m, i) => ({ exerciseId: m.exerciseId, percent: [40, 30, 30][i]! })), {
      now: new Date("2026-11-04T18:00:00Z"),
      idempotencyKey: "k",
      timezone: "America/Denver",
    })
    const award = awardFor(entry, V5)
    const live: Record<string, number> = { might: 120, endurance: 40 }
    const lines = splitLogLines(split, award, V5, (id) => live[id] ?? 0)
    expect(lines.map((l) => l.name)).toEqual(["Might", "Footing", "Fortitude", "Constitution", "Iron"])
    expect(lines.slice(0, 3).map((l) => l.xpGained)).toEqual([540, 405, 405])
    expect(lines[0]!.level).toBe(8) // 120 + 540 = 660 XP
    expect(Math.round(lines[4]!.xpGained)).toBe(450)
  })
})
