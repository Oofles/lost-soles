import { describe, expect, it } from "vitest"

import { rulesForSkills } from "@/lib/log/optimistic"
import { EMPTY_COLLECTION, type RunFeatureCollection } from "@/lib/runs/wire"
import { skillsPanel } from "@/lib/skills/panel"

import { lastRunLine, mapSummary, milestoneTarget, plinthModel, quickView } from "./model"

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

describe("the map, as text (0112, 06 §9.4)", () => {
  it("names the territory, then the last run, then its new cells", () => {
    expect(mapSummary(12480, run())).toBe("Map. 12,480 cells revealed. Last run Fri 28 Aug, 8.40 km, 21 new cells.")
  })

  it("is the rail's own facts: the same date, distance and count as the last-run line", () => {
    const line = lastRunLine(run())!.text
    for (const fact of ["Fri 28 Aug", "8.40 km", "21"]) {
      expect(line).toContain(fact)
      expect(mapSummary(5, run())).toContain(fact)
    }
  })

  it("leaves out what the run does not have, and says nothing of a run that revealed nothing new", () => {
    expect(mapSummary(1, run({ distanceM: null, newCellCount: 0 }))).toBe("Map. 1 cell revealed. Last run Fri 28 Aug.")
  })

  it("with no run, is the territory alone; with the explored set unknown, is nothing rather than a guess", () => {
    expect(mapSummary(0, EMPTY_COLLECTION)).toBe("Map. 0 cells revealed.")
    expect(mapSummary(null, run())).toBeNull()
  })

  it("never names an age, a gap or what was missed (H2, D-013)", () => {
    expect(mapSummary(12480, run())).not.toMatch(/ago|since|days?\b|welcome|missed|while you/i)
  })
})

describe("the home screen's states (0087, `06` §2.4)", () => {
  const SOURCES = (state: "connected" | "not-connected" | "reconnect") => [{ sourceId: "src", name: "Example", state }]

  it("an unseen run reads `1 new run — open it`, opens the sequence with autoplay, and pulses as told", () => {
    const model = plinthModel({ skills: [], cells: 10, latest: run(), seen: false, pulse: true })
    expect(model.lastRun).toEqual({ href: "/run/a-9?play=1", text: "1 new run — open it", fresh: true, pulse: true })
  })

  it("while the seen flag is being read the row is empty, never one line swapped for the other", () => {
    expect(plinthModel({ skills: [], cells: 10, latest: run(), seen: null }).lastRun).toBeNull()
  })

  it("a seen run is the ordinary last-run line, which opens the end state (no autoplay)", () => {
    expect(plinthModel({ skills: [], cells: 10, latest: run(), seen: true }).lastRun).toEqual(lastRunLine(run()))
  })

  it("nothing ever imported and nothing connected: `Connect <source> to begin` → /settings", () => {
    const model = plinthModel({ skills: [], cells: 0, latest: EMPTY_COLLECTION, sources: SOURCES("not-connected") })
    expect(model.connect).toEqual({ href: "/settings", text: "Connect Example to begin" })
    expect(model.lastRun).toBeNull()
  })

  it("never invites a connection that exists, nor one while territory is unknown or present", () => {
    expect(plinthModel({ skills: [], cells: 0, latest: EMPTY_COLLECTION, sources: SOURCES("connected") }).connect).toBeNull()
    expect(plinthModel({ skills: [], cells: null, latest: EMPTY_COLLECTION, sources: SOURCES("not-connected") }).connect).toBeNull()
    expect(plinthModel({ skills: [], cells: 40, latest: EMPTY_COLLECTION, sources: SOURCES("not-connected") }).connect).toBeNull()
    expect(plinthModel({ skills: [], cells: 0, latest: run(), sources: SOURCES("not-connected") }).connect).toBeNull()
  })

  it("a broken token — and only that — is the one reconnect line, from the server or from a Sync press", () => {
    expect(plinthModel({ skills: [], cells: 10, latest: run(), sources: SOURCES("reconnect") }).reconnect).toEqual({
      href: "/settings",
      text: "Example needs reconnecting",
    })
    expect(
      plinthModel({ skills: [], cells: 10, latest: run(), sources: SOURCES("connected"), reconnectIds: ["src"] }).reconnect,
    ).toEqual({ href: "/settings", text: "Example needs reconnecting" })
    expect(plinthModel({ skills: [], cells: 10, latest: run(), sources: SOURCES("connected") }).reconnect).toBeNull()
    expect(plinthModel({ skills: [], cells: 10, latest: run(), sources: SOURCES("not-connected") }).reconnect).toBeNull()
  })
})

describe("the skills quick-view (0270)", () => {
  const rules = rulesForSkills([])
  const enabled = rules.skills.filter((s) => s.enabled).sort((a, b) => a.displayOrder - b.displayOrder)
  const activity = enabled.filter((s) => s.kind === "activity")
  const meta = enabled.filter((s) => s.kind === "meta")

  it("comes from the same SkillState read as Total Level: trained skills only, ACTIVITY then META, registry order", () => {
    // Trained in reverse registry order, to prove the order is the registry's and not the input's.
    const skills = [...enabled].reverse().filter((_, i) => i % 2 === 0).map((s) => ({ skillId: s.id, xp: 5_000 }))
    const model = plinthModel({ skills, cells: 0, latest: EMPTY_COLLECTION })
    const panel = skillsPanel(rulesForSkills(skills), skills)
    expect(model.quickView!.activity.map((r) => r.skillId)).toEqual(panel.activity.map((t) => t.skillId))
    expect(model.quickView!.meta.map((r) => r.skillId)).toEqual(panel.meta.map((t) => t.skillId))
    const trained = new Set(skills.map((s) => s.skillId))
    const rows = [...model.quickView!.activity, ...model.quickView!.meta]
    expect(rows.map((r) => r.skillId)).toEqual(enabled.filter((s) => trained.has(s.id)).map((s) => s.id))
    expect(rows.length).toBeGreaterThan(0)
  })

  it("an untrained skill has no row; a group with none trained is empty", () => {
    const skills = [
      { skillId: activity[0]!.id, xp: 5_000 },
      { skillId: activity[1]!.id, xp: 0 },
    ]
    const view = plinthModel({ skills, cells: 0, latest: EMPTY_COLLECTION }).quickView!
    expect(view.activity.map((r) => r.skillId)).toEqual([activity[0]!.id])
    expect(view.meta).toEqual([])
  })

  it("a row is level, progress and a link to the sheet — no XP — named by skill, level and kind", () => {
    const m = meta[0]!
    const skills = [{ skillId: m.id, xp: 5_000 }]
    const [row] = plinthModel({ skills, cells: 0, latest: EMPTY_COLLECTION }).quickView!.meta
    const tile = skillsPanel(rulesForSkills(skills), skills).meta[0]!
    expect(row).toEqual({
      skillId: m.id,
      href: `/skills/${m.id}`,
      name: m.name,
      kind: "meta",
      level: tile.level,
      fraction: tile.fraction,
      label: `${m.name}, level ${tile.level}, meta skill`,
    })
    expect(row).not.toHaveProperty("xp")
  })

  it("nothing known yet draws no list, rather than a list of level 1s", () => {
    expect(plinthModel({ skills: undefined, cells: null, latest: EMPTY_COLLECTION }).quickView).toBeNull()
  })

  it("a new registry row is a new quick-view row with no code change (D-031)", () => {
    // A synthetic skill the code has never heard of, slotted between two real ones.
    const synthetic = { ...activity[0]!, id: "synthetic-climbing", name: "Climbing", displayOrder: activity[0]!.displayOrder + 1 }
    const withRow = { ...rules, skills: [...rules.skills, synthetic] }
    const standing = [
      { skillId: activity[0]!.id, xp: 5_000 },
      { skillId: "synthetic-climbing", xp: 2_000 },
      { skillId: activity[1]!.id, xp: 1_000 },
    ]
    const view = quickView(skillsPanel(withRow, standing))
    expect(view.activity.map((r) => r.skillId)).toEqual([activity[0]!.id, "synthetic-climbing", activity[1]!.id])
    expect(view.activity[1]).toMatchObject({ name: "Climbing", href: "/skills/synthetic-climbing", label: expect.stringContaining("Climbing, level ") })
  })
})
