import { describe, expect, it } from "vitest"

import { parseWorkoutEntry } from "@/lib/log/workout-entry"
import { loadRuleSet } from "@/src/rules/load"
import type { RuleSkill } from "@/src/rules/schema"

import { clampValue, entryFor, entrySetFor, formatValue, logRows, parseValue, STEP_BY_ENTRY, stepValue } from "./rows"

/**
 * Tickets 0068 and 0071: `/log`'s rows are the registry's, in its order, with its numbers.
 * Run against the real v2 registry — the one the operator's ledger is on — so a YAML edit that
 * changes what `/log` shows fails here, not in the browser.
 */
const v2 = loadRuleSet(2)

describe("logRows — one row per hand-loggable exercise, from the registry (0068)", () => {
  const rows = logRows(v2)

  it("renders exactly the enabled reps|duration skills' exercises", () => {
    const expected = v2.skills
      .filter((s) => s.enabled && s.kind === "activity" && (s.logMode === "reps" || s.logMode === "duration"))
      .flatMap((s) => (s.exercises ?? []).map((e) => e.id))
    expect(rows.map((r) => r.exerciseId).sort()).toEqual([...expected].sort())
    expect(rows.length).toBeGreaterThanOrEqual(3)
  })

  it("is in displayOrder, never re-sorted (§6.5)", () => {
    const order = rows.map((r) => v2.skills.find((s) => s.id === r.skillId)!.displayOrder)
    expect(order).toEqual([...order].sort((a, b) => a - b))
  })

  it("has no trace, derived or meta row (D-282: there is no trace-manual logMode)", () => {
    for (const r of rows) {
      const skill = v2.skills.find((s) => s.id === r.skillId)!
      expect(skill.kind).toBe("activity")
      expect(["reps", "duration"]).toContain(skill.logMode)
    }
  })

  it("labels each row in plain English, never the schema's unit word (0071)", () => {
    for (const r of rows) {
      expect(r.label).not.toMatch(/^(rep|reps|second|seconds)$/)
      const ex = v2.skills.flatMap((s) => s.exercises ?? []).find((e) => e.id === r.exerciseId)!
      expect(r.label).toBe(ex.label.toLowerCase())
    }
  })

  it("steps by entry kind — count ±5, seconds ±15 (D-282)", () => {
    expect(STEP_BY_ENTRY).toEqual({ count: 5, seconds: 15 })
    for (const r of rows) expect(r.step).toBe(STEP_BY_ENTRY[r.entry])
  })

  it("floors at minUnitsForCredit and starts a fresh install at the first quickValue", () => {
    for (const r of rows) {
      const skill = v2.skills.find((s) => s.id === r.skillId)!
      const ex = skill.exercises!.find((e) => e.id === r.exerciseId)!
      expect(r.min).toBe(Math.max(1, Math.ceil(skill.minUnitsForCredit)))
      expect(r.fallback).toBe(Math.max(r.min, ex.quickValues[0]))
    }
  })

  it("a new registry row is a new /log row with no code (0072's claim, previewed)", () => {
    const template = v2.skills.find((s) => s.logMode === "reps")!
    const grip: RuleSkill = {
      ...template,
      id: "grip",
      name: "Grip",
      displayOrder: 45,
      exercises: [{ id: "pullup", label: "Pull-ups", entry: "count", quickValues: [5, 10, 15] }],
    }
    const withGrip = logRows({ skills: [...v2.skills, grip] })
    expect(withGrip).toHaveLength(rows.length + 1)
    const added = withGrip.find((r) => r.exerciseId === "pullup")!
    expect(added).toMatchObject({ skillName: "Grip", label: "pull-ups", step: 5, fallback: 5 })
    // Slotted by displayOrder (45), not appended.
    const i = withGrip.indexOf(added)
    const orderOf = (id: string) => [...v2.skills, grip].find((s) => s.id === id)!.displayOrder
    expect(orderOf(withGrip[i - 1].skillId)).toBeLessThanOrEqual(45)
    if (withGrip[i + 1]) expect(orderOf(withGrip[i + 1].skillId)).toBeGreaterThanOrEqual(45)
  })

  it("a disabled skill has no row", () => {
    const first = rows[0]
    const disabled = v2.skills.map((s) => (s.id === first.skillId ? { ...s, enabled: false } : s))
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
  const rows = logRows(v2)

  it("writes one set, in the field the registry's measure names, for every row", () => {
    for (const r of rows) {
      const set = entrySetFor(r, 30, v2)
      expect(Object.values(set)).toEqual([30])
      expect(Object.keys(set)[0]).toBe(r.entry === "seconds" ? "durationS" : "reps")
    }
  })

  it("builds an entry the server's own boundary accepts unchanged, stamped at the click", () => {
    const at = new Date("2026-10-06T18:30:00.000Z")
    for (const r of rows) {
      const entry = entryFor(r, r.fallback, v2, { now: at, idempotencyKey: `k-${r.exerciseId}`, timezone: "America/Denver" })
      expect(entry.occurredAt).toBe("2026-10-06T18:30:00.000Z")
      expect(entry.sets).toHaveLength(1)
      expect(parseWorkoutEntry(entry, v2)).toEqual(entry)
    }
  })

  it("omits timezone when the browser offers none", () => {
    const entry = entryFor(rows[0], 10, v2, { now: new Date(0), idempotencyKey: "k", timezone: undefined })
    expect("timezone" in entry).toBe(false)
  })
})
