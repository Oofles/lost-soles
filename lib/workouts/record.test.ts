import { describe, expect, it } from "vitest"

import type { ActivityLedgerRow } from "@/lib/runs/ledger"
import type { RunListItem } from "@/lib/runs/wire"

import { workoutRecord } from "./record"

/** Ticket `0345` — a past workout as a plain record (`06` §2.6, D-486). Pure; no store is touched. */

const item = (over: Partial<RunListItem> = {}): RunListItem => ({
  activityId: "w-1",
  startedAt: "2026-11-04T23:00:00.000Z",
  startedAtLocal: "2026-11-04T18:00:00",
  name: null,
  kind: "strength",
  distanceM: null,
  durationS: null,
  newCellCount: null,
  traced: false,
  sets: [],
  ...over,
})

const label = (id: string) => ({ upper: "upper body", lower: "lower body", pushup: "pushups" })[id] ?? id
const skillName = (id: string) => ({ strength: "Strength", endurance: "Endurance" })[id] ?? id
const ledger = (rows: Partial<ActivityLedgerRow>[]): ActivityLedgerRow[] =>
  rows.map((r) => ({ skillId: "strength", reason: "work", xpAwarded: 0, xpRulesVersion: 3, isFloor: false, ...r }))

describe("workoutRecord", () => {
  it("is the date, the kind, the count logged, and each skill's XP", () => {
    const view = workoutRecord(
      item({ sets: [{ exercise: "pushup", reps: 40 }] }),
      ledger([{ skillId: "strength", xpAwarded: 120 }]),
      label,
      skillName,
    )
    expect(view.date).toBe("Wed 4 Nov 2026")
    expect(view.kind).toBe("Strength")
    expect(view.logged).toEqual([{ what: "pushups", measure: "40", share: null }])
    expect(view.xp).toEqual([{ skillId: "strength", name: "Strength", xp: "+120 XP" }])
  })

  it("reads a split back as its members, their time and their shares (D-483)", () => {
    const view = workoutRecord(
      item({ sets: [{ exercise: "upper", durationS: 1800 }, { exercise: "lower", durationS: 600 }] }),
      [],
      label,
      skillName,
    )
    expect(view.logged).toEqual([
      { what: "upper body", measure: "30:00", share: "75%" },
      { what: "lower body", measure: "10:00", share: "25%" },
    ])
  })

  it("never reads repeated sets of one exercise as a split", () => {
    const view = workoutRecord(item({ sets: [{ exercise: "plank", durationS: 60 }, { exercise: "plank", durationS: 60 }] }), [], label, skillName)
    expect(view.logged.map((l) => l.share)).toEqual([null, null])
  })

  it("a session with no sets is its kind and its duration", () => {
    const view = workoutRecord(item({ kind: "yoga", durationS: 2700 }), [], label, skillName)
    expect(view.logged).toEqual([{ what: "yoga", measure: "45:00", share: null }])
  })

  it("XP is per skill, highest first, newest ruleset only, floors excluded, with a total", () => {
    const view = workoutRecord(
      item(),
      ledger([
        { skillId: "endurance", xpAwarded: 30 },
        { skillId: "strength", xpAwarded: 90 },
        { skillId: "strength", xpAwarded: 999, xpRulesVersion: 2 },
        { skillId: "strength", xpAwarded: 500, isFloor: true },
      ]),
      label,
      skillName,
    )
    expect(view.xp!.map((x) => [x.name, x.xp])).toEqual([["Strength", "+90 XP"], ["Endurance", "+30 XP"]])
    expect(view.totalXp).toBe("120 XP")
  })

  it("an unreadable ledger is null, never a row of zeros", () => {
    expect(workoutRecord(item(), null, label, skillName).xp).toBeNull()
  })
})
