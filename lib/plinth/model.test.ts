import { describe, expect, it } from "vitest"

import { rulesForSkills } from "@/lib/log/optimistic"
import { EMPTY_COLLECTION, type RunFeatureCollection } from "@/lib/runs/wire"
import { skillsPanel } from "@/lib/skills/panel"

import { lastRunLine, milestoneTarget, plinthModel } from "./model"

const run = (props: Partial<RunFeatureCollection["features"][0]["properties"]> = {}): RunFeatureCollection => ({
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: { type: "MultiLineString", coordinates: [] } as unknown as RunFeatureCollection["features"][0]["geometry"],
      properties: {
        activityId: "a-9",
        startedAt: "2026-08-28T11:00:00.000Z",
        name: null,
        startedAtLocal: "2026-08-28T07:00:00",
        distanceM: 8400,
        newCellCount: 21,
        ...props,
      },
    },
  ],
})

describe("the plinth's numbers (0086)", () => {
  it("Total Level is skillsPanel's, so the plinth and the /skills header cannot disagree", () => {
    const skills = [{ skillId: "x", xp: 1_000_000 }]
    const model = plinthModel({ skills, cells: 12480, latest: EMPTY_COLLECTION })
    expect(model.totalLevel).toBe(skillsPanel(rulesForSkills(skills), skills).totalLevel)
  })

  it("draws nothing it does not know: no standing and no explored set read as dashes, not as level 1", () => {
    const model = plinthModel({ skills: undefined, cells: null, latest: EMPTY_COLLECTION })
    expect(model).toMatchObject({ totalLevel: null, target: null, cells: null, lastRun: null })
  })

  it("formats lifetime cells with a fixed locale", () => {
    expect(plinthModel({ skills: [], cells: 12480, latest: EMPTY_COLLECTION }).cells).toBe("12,480")
  })
})

describe("the milestone target is named, never a bare percentage (§2.3)", () => {
  it("names the next rung", () => {
    expect(milestoneTarget({ from: 250, to: 300, fraction: 0.42 }, 2277)).toBe("next: 300")
  })

  it("names the ceiling once it is reached", () => {
    expect(milestoneTarget({ from: 2277, to: 2277, fraction: 1 }, 2277)).toBe("of 2,277")
  })

  it("is never a percentage for any standing", () => {
    for (const xp of [0, 10, 1_000, 100_000, 10_000_000]) {
      const { target } = plinthModel({ skills: [{ skillId: "x", xp }], cells: 0, latest: EMPTY_COLLECTION })
      expect(target).toMatch(/^(next: |of )[\d,]+$/)
      expect(target).not.toContain("%")
    }
  })
})

describe("the last-run line", () => {
  it("names the run by its own date, distance and new cells, and links to /run/:activityId", () => {
    expect(lastRunLine(run())).toEqual({ href: "/run/a-9", text: "Last: Fri 28 Aug · 8.40 km · 21 new" })
  })

  it("reads the naive wall clock, not UTC (I-13)", () => {
    expect(lastRunLine(run({ startedAt: "2026-08-29T02:00:00.000Z", startedAtLocal: "2026-08-28T22:00:00" }))!.text).toMatch(/^Last: Fri 28 Aug/)
  })

  it("leaves out what the run does not have, and says nothing of a run that revealed nothing new", () => {
    expect(lastRunLine(run({ distanceM: null, newCellCount: 0 }))!.text).toBe("Last: Fri 28 Aug")
  })

  it("falls back to the UTC date for a body from before 0086", () => {
    expect(lastRunLine(run({ startedAtLocal: undefined, distanceM: undefined, newCellCount: undefined }))!.text).toBe("Last: Fri 28 Aug")
  })

  it("is absent when there is no traced run", () => {
    expect(lastRunLine(EMPTY_COLLECTION)).toBeNull()
  })

  it("is never a relative age — no 'ago', no 'days since' (H2)", () => {
    expect(lastRunLine(run())!.text).not.toMatch(/ago|since|days?\b/i)
  })
})
