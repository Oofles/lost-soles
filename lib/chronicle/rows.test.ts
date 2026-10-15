import { describe, expect, it } from "vitest"

import { rulesForSkills } from "@/lib/log/optimistic"
import type { RunListItem } from "@/lib/runs/wire"

import { chronicleRow, exerciseLabels, unseenIds, workoutSummary } from "./rows"

/** Ticket `0088` — a Chronicle row, as words. */

const item = (over: Partial<RunListItem> = {}): RunListItem => ({
  activityId: "a-9",
  startedAt: "2026-08-28T11:00:00.000Z",
  startedAtLocal: "2026-08-28T07:00:00",
  name: "Morning Run",
  kind: "run",
  distanceM: 8400,
  durationS: 2530,
  newCellCount: 21,
  traced: true,
  sets: [],
  ...over,
})

const asIs = (id: string) => id

describe("chronicleRow", () => {
  it("a run: its date, its kind, its distance and its new cells", () => {
    expect(chronicleRow(item(), asIs)).toEqual({
      activityId: "a-9",
      href: "/run/a-9",
      date: "Fri 28 Aug 2026",
      kind: "Run",
      name: "Morning Run",
      measure: "8.40 km",
      newCells: "21 new",
    })
  })

  it("opens the run's END STATE: the link carries no autoplay intent (§3.1)", () => {
    expect(chronicleRow(item(), asIs).href).not.toMatch(/play/)
  })

  it("a run with no new cells says nothing about cells (D-316)", () => {
    expect(chronicleRow(item({ newCellCount: 0 }), asIs).newCells).toBeNull()
    expect(chronicleRow(item({ newCellCount: null }), asIs).newCells).toBeNull()
  })

  it("a logged session: the workout summary, from its sets", () => {
    const row = chronicleRow(item({ kind: "strength", distanceM: null, traced: false, newCellCount: 0, sets: [{ exercise: "pushup", reps: 40 }] }), (id) => `${id}s`)
    expect(row.kind).toBe("Strength")
    expect(row.measure).toBe("40 pushups")
  })

  it("an activity with neither a distance nor sets falls back to its duration", () => {
    expect(chronicleRow(item({ kind: "strength", distanceM: null, sets: [] }), asIs).measure).toBe("42:10")
    expect(chronicleRow(item({ kind: "strength", distanceM: null, sets: [], durationS: null }), asIs).measure).toBeNull()
  })
})

describe("workoutSummary", () => {
  it("formats reps, time and distance without knowing what any exercise is", () => {
    expect(workoutSummary([{ exercise: "x", reps: 1200 }], asIs)).toBe("1,200 x")
    expect(workoutSummary([{ exercise: "y", durationS: 120 }], asIs)).toBe("2:00 y")
    expect(workoutSummary([{ exercise: "z", distanceM: 5000, durationS: 1800 }], asIs)).toBe("5.00 km z")
    expect(workoutSummary([], asIs)).toBeNull()
  })

  it("labels exercises from the registry, so a new type is a data row (D-031)", () => {
    const rules = rulesForSkills([])
    const label = exerciseLabels(rules)
    const first = rules.skills.flatMap((s) => s.exercises ?? [])[0]!
    expect(label(first.id)).toBe(first.label.toLowerCase())
    expect(label("not-in-the-registry")).toBe("not-in-the-registry")
  })
})

describe("unseenIds — at most the latest traced run, like the plinth's line", () => {
  const run = (id: string) => ({ activityId: id, traced: true })
  const logged = (id: string) => ({ activityId: id, traced: false })

  it("marks the latest traced run when this device has not seen it", () => {
    expect(unseenIds([run("a"), run("b")], new Map([["a", false]]))).toEqual(new Set(["a"]))
  })

  it("never marks an older run, so a backfill is not a gold wall", () => {
    const seen = new Map([["a", true], ["b", false], ["c", false]])
    expect(unseenIds([run("a"), run("b"), run("c")], seen)).toEqual(new Set())
  })

  it("skips a newer logged workout to find the latest run; the workout is never marked", () => {
    expect(unseenIds([logged("w"), run("a")], new Map([["w", false], ["a", false]]))).toEqual(new Set(["a"]))
  })

  it("marks nothing until the flag has been read — no flash of gold", () => {
    expect(unseenIds([run("a")], new Map())).toEqual(new Set())
  })
})
