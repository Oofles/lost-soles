import { latLngToCell } from "h3-js"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import {
  awardOf,
  awardsDiscovery,
  classifyCells,
  creditOf,
  needsReplay,
  CREDIT_COOLED,
  CREDIT_NEW,
  CREDIT_REARM,
  FOG_ALGO_VERSION,
  NO_CELLS,
  newShare,
  OutOfOrderScoringError,
  SIX_MONTHS_MS,
  type CellRecord,
} from "./discovery"
import { RES } from "./fog"

/**
 * Ticket `0048`. `05-fog-of-war.md` §3.1–§3.3, §9.2; D-120; I-12.
 *
 * ─── THE CLOCK IS STUBBED TO THROW, FOR THE WHOLE FILE ──────────────────────
 *
 * Criterion 2, and it is the criterion that matters most here. I-12 says scoring time is
 * `activity.startedAt` and never `now()`, and the damage a stray `Date.now()` does is
 * **silent**: every test still passes, replay stops reproducing the original answer, and
 * the discrepancy only surfaces months later as a total nobody can reconcile.
 *
 * A test that merely passes a fixed `at` cannot catch that — the module could read the
 * clock as well and nothing would notice. So the three ways to ask the time are replaced
 * with throws for the entire suite, and any reach for one fails loudly here.
 *
 * `Date.parse(iso)` and `new Date(iso)` stay available, and that is not a loophole: a
 * function that can only answer a question you already asked it cannot tell the time.
 *
 * GEOMETRY IS SYNTHETIC, near Point Nemo (`08-security-privacy.md` §7.2, D-199).
 */

const realNow = Date.now
const realPerfNow = performance.now
const RealDate = Date

beforeAll(() => {
  const refuse = () => {
    throw new Error("I-12: the scoring path may not read the clock. Use activity.startedAt.")
  }
  Date.now = refuse as typeof Date.now
  performance.now = refuse as typeof performance.now

  // The no-argument `Date` constructor is the third door and the easiest one to forget.
  // `new Date(iso)` is left working; `new Date()` is not.
  class GuardedDate extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) refuse()
      super(...(args as ConstructorParameters<typeof RealDate>))
    }
  }
  globalThis.Date = GuardedDate as unknown as DateConstructor
  globalThis.Date.now = refuse as typeof Date.now
  globalThis.Date.parse = RealDate.parse
  globalThis.Date.UTC = RealDate.UTC
})

afterAll(() => {
  globalThis.Date = RealDate
  Date.now = realNow
  performance.now = realPerfNow
})

const cellAt = (i: number) => latLngToCell(-48.876 + i * 0.0012, -123.393, RES)
const CELLS = Array.from({ length: 8 }, (_, i) => cellAt(i))

const AT = "2026-09-06T03:00:00.000Z"
const AT_MS = RealDate.parse(AT)
const iso = (msBefore: number) => new RealDate(AT_MS - msBefore).toISOString()
const days = (n: number) => n * 24 * 60 * 60 * 1000

const store = (entries: Record<string, string>): Map<string, CellRecord> =>
  new Map(Object.entries(entries).map(([cell, lastRunAt]) => [cell, { lastRunAt }]))

const by = (classified: ReturnType<typeof classifyCells>, kind: string) =>
  classified.filter((c) => c.discovery === kind).map((c) => c.cell)

describe("the clock guard itself (criterion 2)", () => {
  /**
   * FIRST, because every other test in this file is worthless if the stub is not armed —
   * a `beforeAll` that silently failed to install would leave 30 tests asserting nothing
   * about I-12. This is the same vacuous-gate lesson `0047`'s IAM test learned.
   */
  it("is armed — Date.now, performance.now and new Date() all throw", () => {
    expect(() => Date.now()).toThrow(/I-12/)
    expect(() => performance.now()).toThrow(/I-12/)
    expect(() => new Date()).toThrow(/I-12/)
  })

  it("still allows parsing a timestamp someone handed us", () => {
    expect(Date.parse(AT)).toBe(AT_MS)
    expect(new Date(AT).toISOString()).toBe(AT)
  })
})

describe("the constants (§3.1, §9.2)", () => {
  it("SIX_MONTHS_MS is 183 days, not a calendar month", () => {
    expect(SIX_MONTHS_MS).toBe(183 * 24 * 60 * 60 * 1000)
    expect(SIX_MONTHS_MS).toBe(15_811_200_000)
  })

  it("the three credits are 1.0 / 0.5 / 0.0", () => {
    expect([CREDIT_NEW, CREDIT_REARM, CREDIT_COOLED]).toEqual([1.0, 0.5, 0.0])
  })

  it("creditOf covers every class, and only new/rearmed award discovery", () => {
    expect(creditOf("new")).toBe(1.0)
    expect(creditOf("rearmed")).toBe(0.5)
    expect(creditOf("cooled")).toBe(0.0)
    expect(awardsDiscovery("new")).toBe(true)
    expect(awardsDiscovery("rearmed")).toBe(true)
    expect(awardsDiscovery("cooled")).toBe(false)
  })
})

describe("classifyCells — the three classes (D-120)", () => {
  it("no record → new, full credit", () => {
    const classified = classifyCells([CELLS[0]], store({}), AT)
    expect(classified).toEqual([{ cell: CELLS[0], discovery: "new" }])
  })

  it("run 7 months ago → re-armed, half credit", () => {
    const classified = classifyCells([CELLS[0]], store({ [CELLS[0]]: iso(days(213)) }), AT)
    expect(classified[0].discovery).toBe("rearmed")
  })

  it("run 5 months ago → cooled, zero credit", () => {
    const classified = classifyCells([CELLS[0]], store({ [CELLS[0]]: iso(days(152)) }), AT)
    expect(classified[0].discovery).toBe("cooled")
  })

  it("run this morning → cooled — the cooldown does not care it is the same day (§3.3)", () => {
    const classified = classifyCells([CELLS[0]], store({ [CELLS[0]]: iso(days(0.2)) }), AT)
    expect(classified[0].discovery).toBe("cooled")
  })
})

describe("classifyCells — the boundary (criterion 3)", () => {
  it("182 days is cooled", () => {
    expect(classifyCells([CELLS[0]], store({ [CELLS[0]]: iso(days(182)) }), AT)[0].discovery).toBe(
      "cooled",
    )
  })

  it("184 days is re-armed", () => {
    expect(classifyCells([CELLS[0]], store({ [CELLS[0]]: iso(days(184)) }), AT)[0].discovery).toBe(
      "rearmed",
    )
  })

  /**
   * The comparison is `delta < SIX_MONTHS_MS` → cooled, so exactly 183 days RE-ARMS. Stated
   * as a test because it is the one bit a reader has to take on trust from §3.2's `<`, and
   * because the generous side is the right one under D-013: nothing is ever taken away.
   */
  it("exactly 183 days re-arms — the boundary belongs to the generous side", () => {
    expect(
      classifyCells([CELLS[0]], store({ [CELLS[0]]: iso(SIX_MONTHS_MS) }), AT)[0].discovery,
    ).toBe("rearmed")
    expect(
      classifyCells([CELLS[0]], store({ [CELLS[0]]: iso(SIX_MONTHS_MS - 1) }), AT)[0].discovery,
    ).toBe("cooled")
  })
})

describe("classifyCells — classify-then-write (criterion 6, §3.3)", () => {
  /**
   * THE BUG THIS TICKET EXISTS TO PREVENT. Written naively — read the store, classify,
   * write, move to the next cell — the tail of a long run through new territory comes back
   * "cooled", because the head already moved `lastRunAt`. It would halve the credit of
   * exactly the runs the game is built to reward, and nothing would look wrong.
   *
   * Here it cannot happen structurally: there is no store in scope, only a map read before
   * the loop. This asserts the consequence anyway, because the structure could be undone.
   */
  it("100 contiguous NEW cells all classify as new", () => {
    const cells = Array.from({ length: 100 }, (_, i) => cellAt(i))
    const classified = classifyCells(cells, store({}), AT)

    expect(classified).toHaveLength(100)
    expect(by(classified, "new")).toHaveLength(100)
    expect(awardOf(classified).discoveryCredits).toBe(100)
  })

  it("the classifier cannot see its own effects — the record map is never mutated", () => {
    const records = store({ [CELLS[0]]: iso(days(400)) })
    const snapshot = JSON.stringify([...records])
    classifyCells(CELLS, records, AT)
    expect(JSON.stringify([...records])).toBe(snapshot)
  })

  it("carries the pre-read record alongside each cell, rather than re-reading", () => {
    const lastRunAt = iso(days(400))
    const classified = classifyCells([CELLS[0]], store({ [CELLS[0]]: lastRunAt }), AT)
    expect(classified[0].record).toEqual({ lastRunAt })
    // A new cell has no record to carry, and the absence is meaningful.
    expect(classifyCells([CELLS[1]], store({}), AT)[0].record).toBeUndefined()
  })
})

describe("classifyCells — out-of-order arrival (§3.4, revised by 0050)", () => {
  /**
   * A negative delta means this activity's `startedAt` precedes a cell's `lastRunAt` — a
   * backfill, a redelivered webhook, an old GPX import. The naive comparison yields "cooled"
   * and awards zero for ground the user genuinely discovered first, permanently.
   *
   * `0048` THREW HERE, on the reasoning that the replay queue should have caught it first.
   * `0050` built the replay path and found the throw was the wrong end of the trade: it sent
   * the activity to the DLQ, so the ground never reached the map at all and a backfill — the
   * case §3.4 names FIRST — was unusable. The cell is now `"deferred"`: counted, awarded zero,
   * and the user marked for a fold.
   *
   * **The zero is the safety property.** D-135 permits only additions, so a replay can raise
   * this and never lower a number the user has seen. Guessing "cooled" would look identical
   * today and be permanent.
   */
  it("DEFERS rather than scoring a future lastRunAt as cooled", () => {
    const future = new RealDate(AT_MS + days(30)).toISOString()
    const classified = classifyCells([CELLS[0]], store({ [CELLS[0]]: future }), AT)
    expect(classified[0].discovery).toBe("deferred")
    expect(creditOf(classified[0].discovery)).toBe(0)
    expect(awardsDiscovery(classified[0].discovery)).toBe(false)
  })

  it("carries the record forward, so the replay knows what it is correcting", () => {
    const future = new RealDate(AT_MS + days(1)).toISOString()
    const classified = classifyCells([CELLS[0]], store({ [CELLS[0]]: future }), AT)
    expect(classified[0].record).toEqual({ lastRunAt: future })
  })

  it("counts them, and needsReplay is the only signal that says so", () => {
    const future = new RealDate(AT_MS + days(1)).toISOString()
    const award = awardOf(classifyCells(CELLS.slice(0, 2), store({ [CELLS[0]]: future }), AT))
    expect(award.deferredCellCount).toBe(1)
    expect(award.newCellCount).toBe(1)
    expect(award.discoveryCredits).toBe(1)
    expect(needsReplay(award)).toBe(true)
  })

  it("does not mark a replay when nothing was deferred", () => {
    expect(needsReplay(awardOf(classifyCells(CELLS, store({}), AT)))).toBe(false)
  })

  /**
   * `OutOfOrderScoringError` survives, and its home moved: the FOLD may never produce one,
   * because the fold's input is sorted and a negative delta there is a sorting bug in the one
   * function whose whole contract is that it is sorted (I-14). See `fold.test.ts`.
   */
  it("still exports an error that names the cell, both timestamps and §3.4", () => {
    const err = new OutOfOrderScoringError(CELLS[0], AT, "2027-01-01T00:00:00.000Z")
    expect(err.cell).toBe(CELLS[0])
    expect(err.at).toBe(AT)
    expect(err.message).toContain("§3.4")
    expect(err.name).toBe("OutOfOrderScoringError")
  })

  it("a delta of exactly zero is NOT out of order — it is the same instant, and cooled", () => {
    // Re-scoring an activity against cells it wrote itself. Zero is not negative; the
    // guard must not fire on the ordinary replay path.
    const classified = classifyCells([CELLS[0]], store({ [CELLS[0]]: AT }), AT)
    expect(classified[0].discovery).toBe("cooled")
  })

  it("rejects an unparseable startedAt rather than classifying everything new", () => {
    expect(() => classifyCells([CELLS[0]], store({}), "not-a-date")).toThrow(/unparseable/)
  })
})

describe("awardOf", () => {
  it("30 new + 30 cooled is 30.0 credit, not 60 and not 45 (criterion 5)", () => {
    const cells = Array.from({ length: 60 }, (_, i) => cellAt(i))
    const known = Object.fromEntries(cells.slice(30).map((c) => [c, iso(days(10))]))
    const award = awardOf(classifyCells(cells, store(known), AT))

    expect(award.discoveryCredits).toBe(30)
    expect(award.newCellCount).toBe(30)
    expect(award.cooledCellCount).toBe(30)
    expect(award.rearmedCellCount).toBe(0)
  })

  it("sums a mixed run: 4 new + 2 re-armed + 2 cooled = 5.0", () => {
    const known = {
      [CELLS[4]]: iso(days(400)),
      [CELLS[5]]: iso(days(400)),
      [CELLS[6]]: iso(days(10)),
      [CELLS[7]]: iso(days(10)),
    }
    const award = awardOf(classifyCells(CELLS, store(known), AT))
    expect(award).toEqual({
      cellCount: 8,
      newCellCount: 4,
      rearmedCellCount: 2,
      cooledCellCount: 2,
      deferredCellCount: 0,
      discoveryCredits: 5,
      res: RES,
      algoVersion: FOG_ALGO_VERSION,
    })
  })

  it("the three classes always add up to cellCount", () => {
    const known = { [CELLS[1]]: iso(days(400)), [CELLS[2]]: iso(days(10)) }
    const a = awardOf(classifyCells(CELLS, store(known), AT))
    expect(a.newCellCount + a.rearmedCellCount + a.cooledCellCount).toBe(a.cellCount)
  })

  it("does not accumulate float error over a long run", () => {
    // 131 re-armed cells at 0.5 each. Summed naively this can land on 65.49999999999999,
    // and the number is written to a permanent record a replay later compares against.
    const cells = Array.from({ length: 131 }, (_, i) => cellAt(i))
    const known = Object.fromEntries(cells.map((c) => [c, iso(days(400))]))
    expect(awardOf(classifyCells(cells, store(known), AT)).discoveryCredits).toBe(65.5)
  })

  it("records res 10 and the algorithm version on every award", () => {
    const award = awardOf(classifyCells([CELLS[0]], store({}), AT))
    expect(award.res).toBe(10)
    expect(award.algoVersion).toBe(FOG_ALGO_VERSION)
  })

  it("an empty run is a real award of nothing", () => {
    expect(awardOf([])).toEqual({ ...NO_CELLS })
  })
})

describe("the no-cells award (§3.6)", () => {
  it("is zeros, not absence — a treadmill run still writes the record", () => {
    expect(NO_CELLS.cellCount).toBe(0)
    expect(NO_CELLS.discoveryCredits).toBe(0)
    expect(NO_CELLS.res).toBe(RES)
    expect(NO_CELLS.algoVersion).toBe(FOG_ALGO_VERSION)
  })

  it("is frozen, so a caller cannot mutate the shared instance", () => {
    expect(Object.isFrozen(NO_CELLS)).toBe(true)
  })
})

describe("newShare — the one number fog hands the XP engine (§3.6, D-021)", () => {
  it("is the new-cell fraction", () => {
    const cells = Array.from({ length: 10 }, (_, i) => cellAt(i))
    const known = Object.fromEntries(cells.slice(6).map((c) => [c, iso(days(10))]))
    expect(newShare(awardOf(classifyCells(cells, store(known), AT)))).toBe(0.6)
  })

  it("is 0 for a treadmill run, not NaN", () => {
    // `0/0`. A NaN here would propagate into a Wayfaring award and into a permanent ledger.
    expect(newShare(NO_CELLS)).toBe(0)
  })

  it("is 1 for a run entirely over new ground", () => {
    expect(newShare(awardOf(classifyCells(CELLS, store({}), AT)))).toBe(1)
  })
})

describe("purity", () => {
  it("is deterministic — the same inputs twice give the same answer", () => {
    const known = { [CELLS[1]]: iso(days(400)) }
    const once = awardOf(classifyCells(CELLS, store(known), AT))
    const twice = awardOf(classifyCells(CELLS, store(known), AT))
    expect(once).toEqual(twice)
  })

  it("scores the same run at two different `at` values differently — `at` is the input", () => {
    // The point of I-12 restated as a property: move the scoring instant and the answer
    // moves with it. If the module read a clock, both calls would agree.
    const known = { [CELLS[0]]: "2026-01-01T00:00:00.000Z" }
    const early = classifyCells([CELLS[0]], store(known), "2026-03-01T00:00:00.000Z")
    const late = classifyCells([CELLS[0]], store(known), "2026-09-06T03:00:00.000Z")
    expect(early[0].discovery).toBe("cooled")
    expect(late[0].discovery).toBe("rearmed")
  })

  it("accepts a Set, which is what traceToCells returns (§3.3)", () => {
    const set = new Set([CELLS[0], CELLS[0], CELLS[1]])
    // The Set has already absorbed the duplicate — an out-and-back scores once.
    expect(classifyCells(set, store({}), AT)).toHaveLength(2)
  })
})
