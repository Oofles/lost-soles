import { PutCommand } from "@aws-sdk/lib-dynamodb"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { logWorkout } from "@/lib/log/log-workout"
import SIGILS from "@/rules/sigils.json"
import { BUNDLED_RULES } from "@/rules/xp-rules.bundled"
import { JOB, LEDGER_TABLE, rig, TRACE, type Options } from "@/src/pipeline/__fixtures__/process-rig"
import { processActivity } from "@/src/pipeline/process-activity"
import { NEW_EXERCISE_ID, NEW_IDS, NEW_SIGIL, NEW_SKILL_ID, withNewWorkoutType } from "@/src/rules/__fixtures__/new-workout-type"
import { ACTIVITY_KINDS, type RuleSet } from "@/src/rules/schema"
import { selectActivitySkills } from "@/src/rules/select-activity-skills"
import { assertValidRuleSet } from "@/src/rules/validate"
import { cumulativeXp } from "@/src/scoring/levels"

/**
 * TICKET 0072 — A NEW WORKOUT TYPE IS A REGISTRY ROW AND A SIGIL, AND NOTHING ELSE.
 * `02-data-model.md` §3.8 check 5, invariant I-24, D-031, D-061, D-132, `06` §6.5.
 *
 * Two worlds, built from the same source tree:
 *
 *   BEFORE — the bundled rulesets and sigils exactly as shipped;
 *   AFTER  — the same, plus `withNewWorkoutType`: the newest ruleset with a Pull-ups row, as the
 *            next version, and one sigil.
 *
 * The ONLY things that differ between the worlds are the two DATA modules under `rules/`
 * (`DATA_MODULES` below). Every component, page, scorer and pipeline step is the real module,
 * re-imported fresh in each world. So every assertion here is "the shipped code, given only the
 * new data, already does the right thing", which is the zero-`src/`-diff claim made mechanical:
 * if a new workout type needed a code change to appear, score or stay out of the way, one of these
 * fails. The I-25 grep (`no-skill-names.test.ts`) carries the other half — it is fed this
 * fixture's ids, so no source file may name the skill either.
 *
 * IF THIS FAILS, DO NOT ADD AN EXCEPTION. The exception is the finding (0072's notes): file a
 * ticket and fix the code or the schema. A green run is the only durable evidence that the
 * schema is not missing another job (D-141).
 */

const I24 =
  "I-24 / D-031 — adding a workout type must be a registry row plus a sigil, and nothing else. " +
  "This assertion failed on the AFTER world, so code is standing between the new data and the " +
  "screen or the scorer. Fix the code or the schema; never weaken this test."

// ── The environment both worlds render in. Identical in both, so it cannot explain a difference.
vi.mock("next/headers", () => ({ cookies: () => ({}), headers: async () => new Headers() }))
vi.mock("@/lib/amplify-server", () => ({ runWithAmplifyServerContext: async () => true }))
vi.mock("@/lib/auth/owner", () => ({ currentUserId: async () => "sub-1" }))
// MapLibre's CSS import cannot load under vitest; the map is not what is under test.
vi.mock("@/components/map/map-shell", () => ({ MapShell: () => null }))
vi.mock("@/lib/log/transport", () => ({
  currentUid: vi.fn(async () => undefined),
  fetchSkills: vi.fn(async () => []),
  sendLog: vi.fn(),
}))

/** The two modules a new workout type is allowed to change. Both live under `rules/`. */
const DATA_MODULES = { rules: "@/rules/xp-rules.bundled", sigils: "@/rules/sigils.json" } as const

const NEWEST = Math.max(...Object.keys(BUNDLED_RULES).map(Number))
const BASE = BUNDLED_RULES[NEWEST] as RuleSet
const AFTER_RULES = withNewWorkoutType(BASE)
const BEFORE = { bundle: BUNDLED_RULES, sigils: SIGILS }
const AFTER = {
  bundle: { ...BUNDLED_RULES, [AFTER_RULES.version]: AFTER_RULES },
  sigils: { ...SIGILS, sigils: { ...SIGILS.sigils, [NEW_SKILL_ID]: NEW_SIGIL } },
}

/** The real modules, imported fresh against one world's data. */
async function world(data: typeof BEFORE | typeof AFTER) {
  vi.resetModules()
  vi.doMock(DATA_MODULES.rules, () => ({ BUNDLED_RULES: data.bundle }))
  vi.doMock(DATA_MODULES.sigils, () => ({ default: data.sigils }))
  const [{ LogPage }, { SkillsPanel }, { skillsPanel }, { nextLine }, { rulesForSkills, awardFor }, { logRows, entryFor }, { default: Home }] =
    await Promise.all([
      import("@/app/log/log-page"),
      import("@/app/skills/skills-panel"),
      import("@/lib/skills/panel"),
      import("@/lib/skills/next"),
      import("@/lib/log/optimistic"),
      import("@/lib/log/rows"),
      import("@/app/page"),
    ])
  const rules = rulesForSkills([])
  return {
    rules,
    logHtml: renderToStaticMarkup(<LogPage />),
    logRows: logRows(rules),
    skills: (standing: { skillId: string; xp: number }[]) => {
      const model = skillsPanel(rules, standing)
      return { model, html: renderToStaticMarkup(<SkillsPanel model={model} next={nextLine(rules, model.activity, {})} />) }
    },
    homeHtml: renderToStaticMarkup(await Home()),
    awardFor,
    entryFor,
  }
}

const before = await world(BEFORE)
const after = await world(AFTER)

const enabledOf = (r: RuleSet) => r.skills.filter((s) => s.enabled).sort((a, b) => a.displayOrder - b.displayOrder)
/** Every skill of the BASE ruleset trained, to distinct levels — the realistic panel. */
const TRAINED = enabledOf(BASE).map((s, i) => ({ skillId: s.id, xp: cumulativeXp(5 + 3 * i) + 1 }))

const groups = (html: string) => [...html.matchAll(/role="group" aria-label="([^"]+)"/g)].map((m) => m[1])
const items = (html: string) => html.split("<li>").slice(1).map((li) => li.replace(/<\/ul><\/main>$/, ""))
const section = (html: string, label: string) => new RegExp(`<section aria-label="${label}">[\\s\\S]*?</section>`).exec(html)?.[0] ?? ""
const sectionLabels = (html: string) => [...html.matchAll(/<section aria-label="([^"]+)"/g)].map((m) => m[1])
const tiles = (html: string) => [...html.matchAll(/data-skill="([^"]+)"/g)].map((m) => m[1])

describe("the fixture (0072)", () => {
  it("is a valid next ruleset: the schema and the matcher's checks accept the row as data", () => {
    expect(() => assertValidRuleSet(AFTER_RULES), I24).not.toThrow()
    expect(after.rules.version, "the AFTER world reads the new version").toBe(AFTER_RULES.version)
  })

  it("is scoped to this test: no shipped ruleset or sigil set carries it", () => {
    for (const [v, r] of Object.entries(BUNDLED_RULES)) {
      const ids = (r as RuleSet).skills.flatMap((s) => [s.id, ...(s.exercises ?? []).map((e) => e.id)])
      for (const id of NEW_IDS) expect(ids, `v${v} ships the 0072 fixture`).not.toContain(id)
    }
    expect(Object.keys(SIGILS.sigils)).not.toContain(NEW_SKILL_ID)
  })

  it("changes only data modules under rules/", () => {
    for (const m of Object.values(DATA_MODULES)) expect(m.startsWith("@/rules/")).toBe(true)
  })
})

describe("/log gains one row, at the bottom (0072)", () => {
  it("renders the new row after every existing one, which do not change", () => {
    expect(groups(after.logHtml), I24).toEqual([...groups(before.logHtml), "Ascent: pull-ups"])
    const was = items(before.logHtml)
    expect(items(after.logHtml).slice(0, was.length), I24).toEqual(was)
  })

  it("gives it the registry's step and plain-English unit label", () => {
    const row = after.logRows.find((r) => r.exerciseId === NEW_EXERCISE_ID)!
    expect(row, I24).toMatchObject({ skillName: "Ascent", label: "pull-ups", entry: "count" })
    expect(after.logHtml).toContain(`aria-label="Increase pull-ups by ${row.step}"`)
    expect(after.logHtml).toContain(`aria-label="Log ${row.fallback} pull-ups"`)
  })

  it("draws the new skill's sigil from the data map (0245)", () => {
    const row = /<div[^>]*aria-label="Ascent: pull-ups"[\s\S]*?>LOG</.exec(after.logHtml)![0]
    expect(row, I24).toContain(`d="${NEW_SIGIL[0]}"`)
  })
})

describe("/skills gains one tile in ACTIVITY and nothing else moves (0072)", () => {
  it("untrained: ACTIVITY is byte-identical and the new skill waits in Untrained", () => {
    const b = before.skills(TRAINED)
    const a = after.skills(TRAINED)
    expect(section(a.html, "ACTIVITY"), I24).toBe(section(b.html, "ACTIVITY"))
    expect(sectionLabels(a.html)).toEqual(sectionLabels(b.html))
    expect(a.model.untrained.map((t) => t.skillId), I24).toEqual([NEW_SKILL_ID])
    // The minted free point (D-146): Total Level rises by exactly one, with nothing earned.
    expect(a.model.totalLevel).toBe(b.model.totalLevel + 1)
  })

  it("trained: the new tile is the next one in ACTIVITY, with its sigil; no tile moves, no section appears", () => {
    const b = before.skills(TRAINED)
    const a = after.skills([...TRAINED, { skillId: NEW_SKILL_ID, xp: cumulativeXp(7) }])
    expect(tiles(section(a.html, "ACTIVITY")), I24).toEqual([...tiles(section(b.html, "ACTIVITY")), NEW_SKILL_ID])
    expect(tiles(section(a.html, "META"))).toEqual(tiles(section(b.html, "META")))
    expect(sectionLabels(a.html), "no new section").toEqual(sectionLabels(b.html))
    const tile = new RegExp(`<a [^>]*data-skill="${NEW_SKILL_ID}"[\\s\\S]*?</a>`).exec(a.html)![0]
    expect(tile, I24).toContain(`d="${NEW_SIGIL[0]}"`)
    expect(tile).toContain("Ascent")
    // The existing tiles' markup is unchanged, byte for byte.
    const was = /<section aria-label="ACTIVITY">[\s\S]*?<\/li><\/ul>/.exec(b.html)![0].replace(/<\/ul>$/, "")
    expect(section(a.html, "ACTIVITY").startsWith(was), I24).toBe(true)
  })
})

describe("the home screen changes by zero pixels (0072, D-061)", () => {
  it("renders byte-identically before and after", () => {
    expect(before.homeHtml, "the real plinth controls rendered").toContain('href="/log"')
    expect(after.homeHtml, I24).toBe(before.homeHtml)
  })
})

/** `0069`'s harness: the real `logWorkout`, manual adapter and `processActivity` over the rig. */
function logHarness(registry: RuleSet) {
  const r = rig()
  const workerReceipt = r.deps.receipt.ddb
  const receipt = {
    ...r.deps.receipt,
    ddb: {
      async send(command: unknown) {
        if (command instanceof PutCommand) return {}
        return workerReceipt.send(command as never)
      },
    },
  }
  return { ...r, deps: { ...r.deps, receipt, registry: async () => registry, now: () => new Date("2026-10-06T13:15:00.000Z") } }
}

const ledgerItems = (transacts: ReturnType<typeof rig>["transacts"]) =>
  transacts.flatMap((t) => (t.TransactItems ?? []).filter((i) => i.Put?.TableName === LEDGER_TABLE).map((i) => i.Put!.Item!))

describe("logging the new row scores it at the registry's rate and feeds Constitution (0072)", () => {
  const row = AFTER_RULES.skills.find((s) => s.id === NEW_SKILL_ID)!
  const feed = row.feeds[0]!
  const reps = 10

  it("through the real logWorkout → manual adapter → processActivity", async () => {
    const h = logHarness(AFTER_RULES)
    const entry = after.entryFor({ exerciseId: NEW_EXERCISE_ID }, reps, AFTER_RULES, {
      now: new Date("2026-10-06T13:15:00.000Z"),
      idempotencyKey: "k-0072",
      timezone: "America/Denver",
    })
    const result = await logWorkout({ ...entry }, "u-1", h.deps)
    expect(result, I24).toMatchObject({ logged: true })
    const rows = ledgerItems(h.transacts)
    const own = rows.filter((r) => r.skillId === NEW_SKILL_ID)
    const fed = rows.filter((r) => r.skillId === feed.skill)
    expect(own.reduce((s, r) => s + Number(r.xpAwarded), 0), I24).toBe(reps * row.xpPerUnit)
    expect(fed.length, `${I24} (no ${feed.skill} feed row)`).toBeGreaterThan(0)
    expect(h.cellWrites, "a pull-up happens nowhere on the map").toHaveLength(0)

    // The browser's optimistic award agrees with the server, skill for skill.
    const optimistic = after.awardFor(entry, AFTER_RULES)
    expect(optimistic[NEW_SKILL_ID]).toBe(reps * row.xpPerUnit)
    expect(optimistic[feed.skill]).toBe(fed.reduce((s, r) => s + Number(r.xpAwarded), 0))
  })
})

describe("selectActivitySkills (0072)", () => {
  const sources = ["manual", "gpslogger", "a-source-nobody-wrote"]
  it("returns the new skill for activities its match covers, and leaves every other selection as it was", () => {
    for (const kind of ACTIVITY_KINDS) {
      for (const hasTrace of [true, false]) {
        for (const source of sources) {
          const activity = { kind, hasTrace, source: { source } }
          const was = selectActivitySkills(activity, BASE).map((s) => s.id)
          const now = selectActivitySkills(activity, AFTER_RULES).map((s) => s.id)
          const covered = AFTER_RULES.skills.find((s) => s.id === NEW_SKILL_ID)!.match!.kinds!.includes(kind)
          expect(now.filter((id) => id !== NEW_SKILL_ID), `${I24} (${kind}/${hasTrace}/${source})`).toEqual(was)
          expect(now.includes(NEW_SKILL_ID), `${kind}/${hasTrace}/${source}`).toBe(covered)
        }
      }
    }
  })
})

/**
 * D-132's Vigil clauses (I-24 (b)–(d)), run under the AFTER ruleset: adding a type must not
 * disturb the traced/traceless split. Through the real `processActivity` on the rig.
 */
describe("the D-132 Vigil clauses still hold with the new row present (0072)", () => {
  const traceless = AFTER_RULES.skills.find((s) => s.match?.measure === "distanceKm" && s.match.requiresTrace === false && s.match.kinds?.includes("run"))!
  const traced = AFTER_RULES.skills.find((s) => s.match?.measure === "distanceKm" && s.match.requiresTrace === true && s.match.kinds?.includes("run"))!

  async function run(ingest: Options["ingest"]) {
    const r = rig({ ingest })
    await processActivity(JOB, { ...r.deps, registry: AFTER_RULES })
    return { rows: ledgerItems(r.transacts), cellWrites: r.cellWrites }
  }

  it("a hasTrace:false run scores into the traceless distance skill at full rate", async () => {
    const { rows } = await run({ kind: "run", hasTrace: false, distanceM: 5000 })
    const own = rows.filter((r) => r.skillId === traceless.id)
    expect(own.reduce((s, r) => s + Number(r.xpAwarded), 0)).toBe(5 * traceless.xpPerUnit)
    expect(rows.some((r) => r.skillId === traced.id)).toBe(false)
  })

  it("the same run with a trace scores into the traced skill instead", async () => {
    const { rows } = await run({ kind: "run", hasTrace: true, trace: TRACE, distanceM: 280 })
    expect(rows.some((r) => r.skillId === traced.id)).toBe(true)
    expect(rows.some((r) => r.skillId === traceless.id)).toBe(false)
  })

  it("the traceless case writes no ExploredCell", async () => {
    const { cellWrites } = await run({ kind: "run", hasTrace: false, distanceM: 5000 })
    expect(cellWrites).toHaveLength(0)
  })
})

describe("registry order, forever (0072, 06 §6.5, §5.3 rule 2)", () => {
  it("never reorders rows or tiles by level, recency or frequency — a row that moves is a row you mis-click", () => {
    const order = enabledOf(AFTER_RULES).map((s) => s.id)
    // Levels rising, falling and scrambled against registry order: the order must not care.
    const shapes = [
      order.map((id, i) => ({ skillId: id, xp: cumulativeXp(2 + i) })),
      order.map((id, i) => ({ skillId: id, xp: cumulativeXp(40 - i) })),
      order.map((id, i) => ({ skillId: id, xp: cumulativeXp(2 + ((i * 7) % 11)) })),
    ]
    for (const standing of shapes) {
      const { model } = after.skills(standing)
      for (const tiles of [model.activity, model.meta, model.untrained]) {
        const shown = tiles.map((t) => t.skillId)
        expect(shown).toEqual(order.filter((id) => shown.includes(id)))
      }
    }
    expect(after.logRows.map((r) => r.skillId)).toEqual(order.filter((id) => after.logRows.some((r) => r.skillId === id)))
    expect(after.logRows.at(-1)!.skillId, "the new row is appended, never inserted").toBe(NEW_SKILL_ID)
  })
})
