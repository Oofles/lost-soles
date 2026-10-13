import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import {
  assertChronicleTable,
  chronicleFacts,
  chronicleLine,
  ChronicleTableError,
  FORBIDDEN_SHAPES,
  LEAGUE_M,
  numberWords,
  ordinalWords,
  renderRow,
  type ChronicleRun,
  type ChronicleTable,
  type PriorRun,
} from "./chronicle"

/** Ticket `0083`. `04-game-design.md` §4.2 step 4; `06-ui-ux.md` §3.2 beat 4, §3.5 rule 4. */

const TABLE = assertChronicleTable(JSON.parse(readFileSync(join(process.cwd(), "rules", "chronicle.json"), "utf8")))

const run = (over: Partial<ChronicleRun> = {}): ChronicleRun => ({
  activityId: "act-100",
  startedAt: "2026-09-01T07:00:00Z",
  distanceM: 5100,
  newCellCount: 0,
  rearmedCellCount: 0,
  cellCount: 120,
  traced: true,
  ...over,
})

const prior = (i: number, over: Partial<PriorRun> = {}): PriorRun => ({
  activityId: `act-${i}`,
  startedAt: new Date(Date.parse("2026-08-31T07:00:00Z") - i * 86_400_000).toISOString(),
  distanceM: 5000,
  newCellCount: 10,
  ...over,
})

const ids = (n: number) => Array.from({ length: n }, (_, i) => `act-${1000 + i}`)

describe("the shipped table", () => {
  it("validates, and has a fallback in each set", () => {
    expect(TABLE.rows.length).toBeGreaterThan(10)
  })

  it("contains none of the three forbidden shapes, in any chronicle table in the repository", () => {
    const dir = join(process.cwd(), "rules")
    const files = readdirSync(dir).filter((f) => /^chronicle.*\.json$/.test(f))
    expect(files).toContain("chronicle.json")
    for (const f of files) {
      const table = JSON.parse(readFileSync(join(dir, f), "utf8")) as ChronicleTable
      for (const row of table.rows) {
        for (const shape of FORBIDDEN_SHAPES) expect(row.text, `${f} ${row.id}`).not.toMatch(shape)
      }
    }
  })

  it("names the three shapes exactly: a stated lack, a quantified lack, an instruction", () => {
    const hit = (s: string) => FORBIDDEN_SHAPES.some((r) => r.test(s))
    expect(hit("No new territory today")).toBe(true)
    expect(hit("0 cells discovered")).toBe(true)
    expect(hit("Try somewhere new!")).toBe(true)
    expect(hit("Old roads, run well. The map holds them still.")).toBe(false)
  })
})

describe("selection", () => {
  it("is deterministic: the same activity reads the same line twice", () => {
    for (const id of ids(50)) {
      const facts = chronicleFacts(run({ activityId: id }), [])
      expect(chronicleLine(facts, TABLE, id)).toEqual(chronicleLine(facts, TABLE, id))
    }
  })

  it("spreads ordinary runs across the tied rows rather than repeating one", () => {
    const seen = new Set(ids(50).map((id) => chronicleLine(chronicleFacts(run({ activityId: id }), []), TABLE, id).rowId))
    expect(seen.size).toBeGreaterThan(1)
  })

  it("newCells = 0 reads only from the no-new-ground set, across every fact shape", () => {
    const histories: PriorRun[][] = [[], Array.from({ length: 30 }, (_, i) => prior(i + 1)), [prior(1, { distanceM: 9e6 })]]
    for (const id of ids(40)) {
      for (const h of histories) {
        for (const r of [run({ activityId: id }), run({ activityId: id, rearmedCellCount: 40 }), run({ activityId: id, traced: false, cellCount: null, distanceM: null })]) {
          const c = chronicleLine(chronicleFacts(r, h), TABLE, id)
          expect(c.set).toBe("no-new-ground")
          const row = TABLE.rows.find((x) => x.id === c.rowId)!
          expect([row.set].flat()).toContain("no-new-ground")
          expect(c.text).not.toMatch(/never felt your step|fresh ground|cells of the map/i)
        }
      }
    }
  })

  it("new ground reads the paces line, in words", () => {
    const facts = chronicleFacts(run({ newCellCount: 46, cellCount: 120 }), [])
    expect(chronicleLine(facts, TABLE, "x").text).toBe(
      "Thirty-eight paces in a hundred fell on roads that had never felt your step.",
    )
  })

  it("an untraced activity gets a line that does not talk about roads", () => {
    const facts = chronicleFacts(run({ traced: false, cellCount: null, distanceM: null }), [])
    expect(chronicleLine(facts, TABLE, "gym").rowId).toBe("untraced-kept")
  })

  it("the rarest fact wins: crossing a hundred leagues outranks the paces line", () => {
    const before = Array.from({ length: 5 }, (_, i) => prior(i + 1, { distanceM: (99.5 * LEAGUE_M) / 5 }))
    const facts = chronicleFacts(run({ newCellCount: 46, distanceM: 5000 }), before)
    expect(chronicleLine(facts, TABLE, "x").rowId).toBe("leagues-100")
  })

  it("a row naming a fact nobody computes waits, silently — it is never selected", () => {
    const facts = chronicleFacts(run({ rearmedCellCount: 500 }), [])
    for (const id of ids(30)) expect(chronicleLine(facts, TABLE, id).rowId).not.toMatch(/named/)
  })

  it("has a guaranteed fallback: a run whose facts match nothing still gets a real line", () => {
    const bare: ChronicleTable = assertChronicleTable({
      version: 1,
      rows: [
        { id: "a", set: "new-ground", rank: 9, when: { never: { eq: 1 } }, text: "unreachable" },
        { id: "fb-new", set: "new-ground", rank: 0, text: "Fresh ground, and the map is wider for it." },
        { id: "fb-old", set: "no-new-ground", rank: 0, text: "Set down in the record." },
      ],
    })
    expect(chronicleLine({ newCells: 3 }, bare, "x").rowId).toBe("fb-new")
    expect(chronicleLine({}, bare, "x").rowId).toBe("fb-old")
  })

  it("adding a line is a data row, never code: a row the shipped table lacks can be selected", () => {
    const added: ChronicleTable = assertChronicleTable({
      ...TABLE,
      rows: [
        ...TABLE.rows,
        { id: "test-a-row-nobody-wrote", set: "no-new-ground", rank: 1000, when: { distanceKm: { gte: 5 } }, text: "{distanceKm} km, set down." },
      ],
    })
    const c = chronicleLine(chronicleFacts(run(), []), added, "x")
    expect(c).toEqual({ rowId: "test-a-row-nobody-wrote", set: "no-new-ground", text: "5.1 km, set down." })
  })
})

describe("the table validator", () => {
  const ok = { id: "fb-new", set: "new-ground", rank: 0, text: "Fresh." }
  const old = { id: "fb-old", set: "no-new-ground", rank: 0, text: "Kept." }

  it("refuses a set with no fallback", () => {
    expect(() => assertChronicleTable({ version: 1, rows: [ok] })).toThrow(/no-new-ground.*no fallback/)
  })

  it("refuses a forbidden shape at load, not only in the test", () => {
    expect(() =>
      assertChronicleTable({ version: 1, rows: [ok, old, { id: "bad", set: "no-new-ground", rank: 1, text: "No new territory today." }] }),
    ).toThrow(ChronicleTableError)
  })

  it("refuses an unknown op, a duplicate id and a malformed placeholder", () => {
    const base = [ok, old]
    expect(() => assertChronicleTable({ version: 1, rows: [...base, { ...ok, id: "x", when: { a: { ne: 1 } } }] })).toThrow(/unknown op/)
    expect(() => assertChronicleTable({ version: 1, rows: [...base, ok] })).toThrow(/duplicated/)
    expect(() => assertChronicleTable({ version: 1, rows: [...base, { ...ok, id: "y", text: "{a:shout}" }] })).toThrow(/malformed/)
  })
})

describe("the facts", () => {
  it("are computed AS OF the run: later activities and the run itself do not move them", () => {
    const r = run({ newCellCount: 5 })
    const before = [prior(1), prior(2)]
    const after = { activityId: "act-999", startedAt: "2026-10-01T07:00:00Z", distanceM: 40_000, newCellCount: 900 }
    const self = { activityId: r.activityId, startedAt: r.startedAt, distanceM: r.distanceM, newCellCount: r.newCellCount }
    expect(chronicleFacts(r, [...before, after, self])).toEqual(chronicleFacts(r, before))
  })

  it("a failed history read knows nothing lifetime-shaped, rather than calling the run a first one", () => {
    const f = chronicleFacts(run({ newCellCount: 5 }), null)
    expect(Object.keys(f).sort()).toEqual(["cellCount", "distanceKm", "newCells", "newPerHundred", "rearmedCells", "traced"])
  })

  it("an unknowable fact is absent, never zero", () => {
    const f = chronicleFacts(run({ distanceM: null, cellCount: null }), [])
    expect(f).not.toHaveProperty("distanceKm")
    expect(f).not.toHaveProperty("newPerHundred")
    expect(f).not.toHaveProperty("longestInYear")
  })

  it("longest-in-a-year needs enough of a year behind it to mean something", () => {
    const thin = Array.from({ length: 3 }, (_, i) => prior(i + 1))
    const full = Array.from({ length: 10 }, (_, i) => prior(i + 1))
    expect(chronicleFacts(run({ distanceM: 9000 }), thin).longestInYear).toBe(0)
    expect(chronicleFacts(run({ distanceM: 9000 }), full).longestInYear).toBe(1)
    expect(chronicleFacts(run({ distanceM: 4000 }), full).longestInYear).toBe(0)
  })

  it("counts roads, not gym sessions", () => {
    const h = [prior(1), prior(2, { distanceM: null }), prior(3, { distanceM: 0 })]
    expect(chronicleFacts(run(), h).roadCount).toBe(2)
  })
})

describe("numbers in words", () => {
  it.each([
    [0, "zero"],
    [7, "seven"],
    [38, "thirty-eight"],
    [100, "one hundred"],
    [211, "two hundred and eleven"],
    [1_005, "one thousand and five"],
    [25_250, "twenty-five thousand two hundred and fifty"],
  ])("%i → %s", (n, s) => expect(numberWords(n)).toBe(s))

  it.each([
    [1, "first"],
    [12, "twelfth"],
    [20, "twentieth"],
    [100, "one hundredth"],
    [250, "two hundred and fiftieth"],
    [1_000, "one thousandth"],
  ])("ordinal %i → %s", (n, s) => expect(ordinalWords(n)).toBe(s))

  it("capitalises on request and refuses to guess a missing fact", () => {
    expect(renderRow("{n:Words} in {n:ordinal}", { n: 3 })).toBe("Three in third")
    expect(renderRow("{street} again", {})).toBeNull()
  })
})
