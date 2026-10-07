import { describe, expect, it } from "vitest"

import { exerciseKind, parseWorkoutEntry } from "@/lib/log/workout-entry"
import { loadRuleSet } from "@/src/rules/load"
import type { RuleSkill } from "@/src/rules/schema"

import {
  clampValue,
  DECIMALS_BY_ENTRY,
  entryFor,
  entrySetFor,
  formatTime,
  formatValue,
  logRows,
  parseTime,
  parseValue,
  SET_SCALE_BY_ENTRY,
  STEP_BY_ENTRY,
  stepValue,
} from "./rows"

/**
 * Tickets 0068 and 0071: `/log`'s rows are the registry's, in its order, with its numbers.
 * Run against the real v3 registry — the newest, which the operator's ledger moves onto at
 * `0240`'s replay — so a YAML edit that changes what `/log` shows fails here, not in the browser.
 */
const registry = loadRuleSet(3)

describe("logRows — one row per hand-loggable exercise, from the registry (0068)", () => {
  const rows = logRows(registry)

  it("renders exactly the enabled activity skills' declared exercises (D-286: no logMode filter)", () => {
    const expected = registry.skills
      .filter((s) => s.enabled && s.kind === "activity")
      .flatMap((s) => (s.exercises ?? []).map((e) => e.id))
    expect(rows.map((r) => r.exerciseId).sort()).toEqual([...expected].sort())
    expect(rows.length).toBeGreaterThanOrEqual(3)
  })

  it("is in displayOrder, never re-sorted (§6.5)", () => {
    const order = rows.map((r) => registry.skills.find((s) => s.id === r.skillId)!.displayOrder)
    expect(order).toEqual([...order].sort((a, b) => a - b))
  })

  it("has no meta row, and a trace skill only where it declares an exercise (D-286)", () => {
    for (const r of rows) {
      const skill = registry.skills.find((s) => s.id === r.skillId)!
      expect(skill.kind).toBe("activity")
      expect(skill.exercises?.some((e) => e.id === r.exerciseId)).toBe(true)
    }
    // Wayfaring, Roving and Cadence declare none, so a trace logMode alone adds no row.
    const traceWithout = registry.skills.filter((s) => s.logMode === "trace" && !s.exercises?.length).map((s) => s.id)
    expect(traceWithout.length).toBeGreaterThan(0)
    for (const id of traceWithout) expect(rows.some((r) => r.skillId === id)).toBe(false)
  })

  it("a distance exercise is a kilometre row with an optional time (D-286)", () => {
    const distance = rows.filter((r) => r.entry === "distance")
    expect(distance.length).toBeGreaterThan(0)
    for (const r of distance) {
      expect(r).toMatchObject({ step: 0.5, decimals: 1, optionalTime: true })
      expect(formatValue(r, r.fallback)).toMatch(/^\d+\.\d km$/)
    }
    for (const r of rows.filter((r) => r.entry !== "distance")) expect(r.optionalTime).toBe(false)
  })

  it("labels each row in plain English, never the schema's unit word (0071)", () => {
    for (const r of rows) {
      expect(r.label).not.toMatch(/^(rep|reps|second|seconds)$/)
      const ex = registry.skills.flatMap((s) => s.exercises ?? []).find((e) => e.id === r.exerciseId)!
      expect(r.label).toBe(ex.label.toLowerCase())
    }
  })

  it("steps by entry kind — count ±5, seconds ±15 (D-282), distance ±0.5 km (D-286)", () => {
    expect(STEP_BY_ENTRY).toEqual({ count: 5, seconds: 15, distance: 0.5 })
    for (const r of rows) expect(r.step).toBe(STEP_BY_ENTRY[r.entry])
  })

  it("floors at minUnitsForCredit and starts a fresh install at the first quickValue", () => {
    for (const r of rows) {
      const skill = registry.skills.find((s) => s.id === r.skillId)!
      const ex = skill.exercises!.find((e) => e.id === r.exerciseId)!
      // Rounded UP to the row's precision: whole units for counts and seconds, 0.1 km for a distance.
      const unit = 10 ** -DECIMALS_BY_ENTRY[r.entry]
      expect(r.min).toBeCloseTo(Math.max(unit, Math.ceil(skill.minUnitsForCredit / unit) * unit), 9)
      expect(r.fallback).toBe(Math.max(r.min, ex.quickValues[0]))
    }
  })

  it("a new registry row is a new /log row with no code (0072's claim, previewed)", () => {
    const template = registry.skills.find((s) => s.logMode === "reps")!
    const grip: RuleSkill = {
      ...template,
      id: "grip",
      name: "Grip",
      displayOrder: 45,
      exercises: [{ id: "pullup", label: "Pull-ups", entry: "count", quickValues: [5, 10, 15] }],
    }
    const withGrip = logRows({ skills: [...registry.skills, grip] })
    expect(withGrip).toHaveLength(rows.length + 1)
    const added = withGrip.find((r) => r.exerciseId === "pullup")!
    expect(added).toMatchObject({ skillName: "Grip", label: "pull-ups", step: 5, fallback: 5 })
    // Slotted by displayOrder (45), not appended.
    const i = withGrip.indexOf(added)
    const orderOf = (id: string) => [...registry.skills, grip].find((s) => s.id === id)!.displayOrder
    expect(orderOf(withGrip[i - 1].skillId)).toBeLessThanOrEqual(45)
    if (withGrip[i + 1]) expect(orderOf(withGrip[i + 1].skillId)).toBeGreaterThanOrEqual(45)
  })

  it("a disabled skill has no row", () => {
    const first = rows[0]
    const disabled = registry.skills.map((s) => (s.id === first.skillId ? { ...s, enabled: false } : s))
    expect(logRows({ skills: disabled }).some((r) => r.skillId === first.skillId)).toBe(false)
  })
})

describe("the stepper's arithmetic (0071)", () => {
  const count = { entry: "count" as const, step: 5, min: 1 }
  const secs = { entry: "seconds" as const, step: 15, min: 5 }

  it("steps by the row's step", () => {
    expect(stepValue(count, 30, 1)).toBe(35)
    expect(stepValue(count, 30, -1)).toBe(25)
    expect(stepValue(secs, 90, 1)).toBe(105)
  })

  it("clamps at minUnitsForCredit, never below", () => {
    expect(stepValue(count, 3, -1)).toBe(1)
    expect(stepValue(count, 1, -1)).toBe(1)
    expect(stepValue(secs, 10, -1)).toBe(5)
    expect(clampValue(count, 0)).toBe(1)
    expect(clampValue(count, -40)).toBe(1)
    expect(clampValue(count, Number.NaN)).toBe(1)
    expect(clampValue(count, 12.6)).toBe(13)
  })

  it("formats seconds as m:ss and counts as integers", () => {
    expect(formatValue(secs, 90)).toBe("1:30")
    expect(formatValue(secs, 5)).toBe("0:05")
    expect(formatValue(secs, 600)).toBe("10:00")
    expect(formatValue(count, 40)).toBe("40")
  })

  it("a distance steps in 0.5 km, keeps one decimal, and floors at its minimum (D-286)", () => {
    const km = { entry: "distance" as const, step: 0.5, min: 0.3, decimals: 1 }
    expect(stepValue(km, 5, 1)).toBe(5.5)
    expect(stepValue(km, 0.3, 1)).toBe(0.8)
    expect(stepValue(km, 0.5, -1)).toBe(0.3)
    expect(clampValue(km, 5.04)).toBe(5)
    expect(formatValue(km, 5)).toBe("5.0 km")
    expect(parseValue(km, "5.5")).toBe(5.5)
    expect(parseValue(km, "5,5 km")).toBe(5.5)
    expect(parseValue(km, "12 km")).toBe(12)
    expect(parseValue(km, "five")).toBeNull()
  })

  it("reads and writes an optional time", () => {
    expect(parseTime("30:00")).toBe(1800)
    expect(parseTime("1:02:05")).toBe(3725)
    expect(parseTime("25")).toBe(1500)
    expect(parseTime("")).toBeNull()
    expect(parseTime("0:00")).toBeNull()
    expect(parseTime("1:75")).toBeNull()
    expect(formatTime(3725)).toBe("1:02:05")
    expect(formatTime(90)).toBe("1:30")
  })

  it("parses what a person types", () => {
    expect(parseValue(secs, "1:30")).toBe(90)
    expect(parseValue(secs, " 90 ")).toBe(90)
    expect(parseValue(secs, "1:75")).toBeNull()
    expect(parseValue(count, "40")).toBe(40)
    expect(parseValue(count, "1:30")).toBeNull()
    expect(parseValue(count, "forty")).toBeNull()
    expect(parseValue(count, "")).toBeNull()
  })
})

describe("what one click sends", () => {
  const rows = logRows(registry)

  it("writes one set, in the field the registry's measure names, for every row", () => {
    for (const r of rows) {
      const set = entrySetFor(r, 30, registry)
      expect(Object.values(set)).toEqual([30 * SET_SCALE_BY_ENTRY[r.entry]])
      expect(Object.keys(set)[0]).toBe({ seconds: "durationS", count: "reps", distance: "distanceM" }[r.entry])
    }
  })

  it("builds an entry the server's own boundary accepts unchanged, stamped at the click", () => {
    const at = new Date("2026-10-06T18:30:00.000Z")
    for (const r of rows) {
      const entry = entryFor(r, r.fallback, registry, { now: at, idempotencyKey: `k-${r.exerciseId}`, timezone: "America/Denver" })
      expect(entry.occurredAt).toBe("2026-10-06T18:30:00.000Z")
      expect(entry.sets).toHaveLength(1)
      // The server adds one thing: the kind it stamps from the registry (D-286).
      expect(parseWorkoutEntry(entry, registry)).toEqual({ ...entry, kind: exerciseKind(r.exerciseId, registry) })
    }
  })

  it("a distance log sends whole metres and its optional time, and the server accepts both", () => {
    const r = rows.find((x) => x.entry === "distance")!
    const entry = entryFor(r, 5.5, registry, { now: new Date(0), idempotencyKey: "k", timezone: undefined, durationS: 1800 })
    expect(entry.sets).toEqual([{ distanceM: 5500, durationS: 1800 }])
    expect(parseWorkoutEntry(entry, registry)).toMatchObject({ sets: [{ distanceM: 5500, durationS: 1800 }], kind: "run" })
  })

  it("omits timezone when the browser offers none", () => {
    const entry = entryFor(rows[0], 10, registry, { now: new Date(0), idempotencyKey: "k", timezone: undefined })
    expect("timezone" in entry).toBe(false)
  })
})
