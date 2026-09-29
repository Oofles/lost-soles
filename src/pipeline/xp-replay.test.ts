import type { H3Index } from "h3-js"
import { describe, expect, it } from "vitest"

import type { Trace } from "@/src/domain/activity"
import { awardOf, classifyCells, NO_CELLS, type CellRecord } from "@/src/domain/discovery"
import { traceToCells, traceToSegments } from "@/src/domain/fog"
import type { FoldedCell } from "@/src/domain/fold"
import { matchable, revealsGround } from "@/src/rules/reveals-ground"
import { loadRuleSet } from "@/src/rules/load"
import type { RuleSet } from "@/src/rules/schema"
import {
  groundSplit,
  levelForXp,
  lookupFromClassified,
  scoreActivity,
  sumXp,
  xpBySkill,
  type XpLedgerEntry,
} from "@/src/scoring"
import {
  REPLAY_ACTIVITY_ID,
  replayUser,
  type ReplayActivity,
  type ReplayRunRecord,
  type ReplayStore,
  type SkillStateWrite,
  type StoredSkillState,
} from "@/src/pipeline/xp-replay"

/**
 * Ticket 0066. `02-data-model.md` §4.4–§4.6; I-14, I-15, I-16, I-17.
 *
 * The orchestration runs against `MemoryStore`, which holds exactly what the job reads and
 * writes and nothing else. The DynamoDB and S3 shapes are `xp-replay-store.test.ts`'s, and the
 * real tables are the ticket's smoke test.
 *
 * THE FIXTURE IS SEEDED THE WAY INGEST WOULD HAVE SEEDED IT — classified incrementally against a
 * growing T6, scored by the same `scoreActivity` — so "a v1 → v1 replay is a no-op" is a claim
 * about the replay agreeing with ingest, not about the replay agreeing with itself.
 */

const USER = "u-1"
const V1 = loadRuleSet(1)

/** v2 pays every activity skill half. Meta rows keep their rate — the feeds still halve. */
const STINGY: RuleSet = {
  ...V1,
  version: 2,
  skills: V1.skills.map((s) => (s.kind === "activity" ? { ...s, xpPerUnit: s.xpPerUnit / 2 } : s)),
}

/** v2 changes ONLY the curve (I-17): XP untouched, every level lower at the same XP. */
const STEEP: RuleSet = { ...V1, version: 2, curve: { ...V1.curve, stepFormula: "6 * L^2" } }

function rulesFor(v2: RuleSet) {
  return (version: number): RuleSet => {
    if (version === 1) return V1
    if (version === 2) return v2
    throw new Error(`no ruleset v${version}`)
  }
}

/** A straight north-bound line near Point Nemo (D-199). `offset` shifts it east. */
function line(offset: number, n = 6): Trace {
  const points = Array.from({ length: n }, (_, i) => ({
    lat: -48.876 + i * 0.0012,
    lng: -123.393 + offset,
    t: i * 30_000,
  }))
  return {
    points,
    gaps: [],
    simplified: false,
    bbox: [points[0]!.lng, points[0]!.lat, points[n - 1]!.lng, points[n - 1]!.lat],
    pointCount: n,
  }
}

function activity(
  id: string,
  startedAt: string,
  over: Partial<ReplayActivity> = {},
): ReplayActivity {
  return {
    activityId: id,
    userId: USER,
    kind: "run",
    startedAt,
    startedAtLocal: startedAt.slice(0, 19),
    timezone: "UTC",
    elapsedS: 1_800,
    distanceM: 5_000,
    source: { source: "manual", externalId: id, sourceTypeRaw: "run", fetchedAt: startedAt },
    raw: null,
    traceRef: null,
    hasTrace: false,
    sets: [],
    ingestedAt: startedAt.replace("T0", "T1"),
    status: "ACTIVE",
    ...over,
  } as ReplayActivity
}

interface Fixture {
  activities: ReplayActivity[]
  traces: Map<string, Trace>
}

/**
 * Five activities. Two runs over the same line a month apart (new, then recent ground), a run over
 * fresh ground, a treadmill run, a strength session, and a TOMBSTONED run whose cells must still
 * count in the fold. Two share a `startedAt`, so the activityId tie-break is exercised.
 */
function fixture(): Fixture {
  const traces = new Map<string, Trace>([
    ["a-first", line(0)],
    ["a-again", line(0)],
    ["b-tie", line(0.01)],
    ["a-tie", line(0.02)],
    ["z-gone", line(0.03)],
  ])
  const traced = (id: string, at: string, over: Partial<ReplayActivity> = {}) =>
    activity(id, at, { hasTrace: true, ...over })
  return {
    traces,
    activities: [
      traced("a-first", "2026-01-01T07:00:00.000Z"),
      traced("z-gone", "2026-01-05T07:00:00.000Z", { status: "TOMBSTONED" }),
      traced("a-again", "2026-02-01T07:00:00.000Z"),
      // Same instant: `a-tie` folds before `b-tie` (I-14).
      traced("b-tie", "2026-03-01T07:00:00.000Z"),
      traced("a-tie", "2026-03-01T07:00:00.000Z", { distanceM: 7_000 }),
      activity("treadmill", "2026-03-02T07:00:00.000Z", { distanceM: 3_000 }),
      activity("lift", "2026-03-03T07:00:00.000Z", {
        kind: "strength",
        distanceM: undefined,
        sets: [{ exercise: "pushup", reps: 40 }],
      }),
    ],
  }
}

class MemoryStore implements ReplayStore {
  runs = new Map<string, ReplayRunRecord>()
  skills = new Map<string, StoredSkillState & { levelHighWater?: number; level?: number }>()
  profile = { replayInProgress: false, totalXp: 0, totalLevel: 0 }
  ledger = new Map<string, XpLedgerEntry>()
  t6 = new Map<H3Index, FoldedCell>()
  runCells = new Map<string, H3Index[]>()
  generation = 0
  publishes = 0
  /** Every operation, in order, with whether SkillState had changed since the replay began. */
  ops: string[] = []
  /** Throws from inside an operation — a crash at that point. */
  crash?: (op: string, n: number) => Error | undefined
  private counts = new Map<string, number>()

  constructor(
    readonly fx: Fixture,
    readonly rules: (v: number) => RuleSet,
  ) {}

  private op(name: string) {
    const n = (this.counts.get(name) ?? 0) + 1
    this.counts.set(name, n)
    this.ops.push(name)
    const e = this.crash?.(name, n)
    if (e) throw e
  }

  /** Seed as ingest would: incremental classification in arrival (= time) order, v1 rates. */
  seedByIngest(): this {
    const records = new Map<H3Index, CellRecord>()
    const sorted = [...this.fx.activities].sort((a, b) =>
      a.startedAt === b.startedAt ? (a.activityId < b.activityId ? -1 : 1) : a.startedAt < b.startedAt ? -1 : 1,
    )
    for (const a of sorted) {
      const trace = this.fx.traces.get(a.activityId)
      let split = null
      let award = NO_CELLS
      if (trace && revealsGround(matchable(a), V1)) {
        const cells = traceToCells(trace)
        const classified = classifyCells(cells, records, a.startedAt)
        award = awardOf(classified)
        split = groundSplit(traceToSegments(trace).segments, lookupFromClassified(classified))
        this.runCells.set(a.activityId, [...cells])
        for (const c of cells) {
          const prev = this.t6.get(c)
          const credit = classified.find((x) => x.cell === c)!.discovery !== "cooled" ? 1 : 0
          this.t6.set(
            c,
            prev
              ? { ...prev, lastRunAt: a.startedAt, lastRunId: a.activityId, visitCount: prev.visitCount + 1, discoveryCount: prev.discoveryCount + credit }
              : { firstRunAt: a.startedAt, firstRunId: a.activityId, lastRunAt: a.startedAt, lastRunId: a.activityId, visitCount: 1, discoveryCount: 1 },
          )
          records.set(c, { lastRunAt: a.startedAt })
        }
      }
      // Tombstoned after it was scored: its rows stay (§4.7).
      const rows = scoreActivity(a, V1, split, award, a.ingestedAt)
      for (const r of rows) this.ledger.set(r.id, r)
      for (const [skillId, xp] of xpBySkill(rows)) {
        const s = this.skills.get(skillId)
        this.skills.set(skillId, {
          skillId,
          xpLedgerSum: (s?.xpLedgerSum ?? 0) + xp,
          displayedXp: (s?.displayedXp ?? 0) + xp,
          rulesVersionLastComputed: 1,
          firstXpAt: s?.firstXpAt ?? a.startedAt,
          lastXpAt: a.startedAt,
        })
      }
    }
    this.generation = 3
    return this
  }

  snapshot() {
    const sorted = <T>(m: Map<string, T>) => [...m].sort(([a], [b]) => (a < b ? -1 : 1))
    return {
      ledger: sorted(this.ledger).map(([, e]) => ({ ...e, awardedAt: e.isFloor ? "<floor>" : e.awardedAt })),
      skills: sorted(this.skills).map(([, s]) => s),
      t6: sorted(this.t6 as Map<string, FoldedCell>),
      profile: { ...this.profile },
    }
  }

  async findUnfinishedRun(userId: string) {
    this.op("findUnfinishedRun")
    return [...this.runs.values()].filter((r) => r.userId === userId && r.status !== "DONE").sort((a, b) => (a.id < b.id ? 1 : -1))[0]
  }
  async putRun(run: ReplayRunRecord) {
    this.op("putRun")
    if (this.runs.has(run.id)) throw new Error("ConditionalCheckFailed: run exists")
    this.runs.set(run.id, structuredClone(run))
  }
  async updateRun(run: ReplayRunRecord) {
    this.op("updateRun")
    this.runs.set(run.id, structuredClone(run))
  }
  async readSkillStates() {
    this.op("readSkillStates")
    return [...this.skills.values()].map((s) => ({ ...s }))
  }
  async writeSkillStates(_u: string, rows: readonly SkillStateWrite[]) {
    this.op("writeSkillStates")
    for (const w of rows) {
      const s = this.skills.get(w.skillId)
      this.skills.set(w.skillId, {
        ...s,
        skillId: w.skillId,
        xpLedgerSum: w.xp,
        displayedXp: w.xp,
        level: w.level,
        levelHighWater: w.levelHighWater,
        rulesVersionLastComputed: w.rulesVersion,
        firstXpAt: w.firstXpAt,
        lastXpAt: w.lastXpAt,
      })
    }
  }
  async freeze() {
    this.op("freeze")
    this.profile.replayInProgress = true
  }
  async thaw(_u: string, totals: { totalXp: number; totalLevel: number }) {
    this.op("thaw")
    this.profile = { replayInProgress: false, ...totals }
  }
  async listLedger() {
    this.op("listLedger")
    const runs = [...this.runs.values()].map(
      (r) => ({ id: r.id, activityId: REPLAY_ACTIVITY_ID, skillId: REPLAY_ACTIVITY_ID, xpAwarded: 0, isFloor: false }) as XpLedgerEntry,
    )
    return [...this.ledger.values(), ...runs].map((e) => ({ ...e }))
  }
  async deleteLedger(ids: readonly string[]) {
    for (const id of ids) {
      this.op("deleteLedger")
      if (this.ledger.get(id)?.isFloor) throw new Error(`deleted a floor row ${id} (I-18)`)
      this.ledger.delete(id)
    }
  }
  async putLedger(entries: readonly XpLedgerEntry[]) {
    for (const e of entries) {
      this.op("putLedger")
      if (e.isFloor && this.ledger.has(e.id)) throw new Error(`ConditionalCheckFailed: floor ${e.id}`)
      this.ledger.set(e.id, { ...e })
    }
  }
  async listActivities() {
    this.op("listActivities")
    return [...this.fx.activities].reverse()
  }
  async readRunCells(_u: string, activityId: string) {
    return this.runCells.get(activityId)
  }
  async loadTrace(a: ReplayActivity) {
    this.op("loadTrace")
    return this.fx.traces.get(a.activityId)
  }
  async mergeCells(_u: string, cells: ReadonlyMap<H3Index, FoldedCell>) {
    this.op("mergeCells")
    const created: H3Index[] = []
    let updated = 0
    for (const [c, f] of cells) {
      const prev = this.t6.get(c)
      if (!prev) {
        created.push(c)
        this.t6.set(c, { ...f })
        continue
      }
      const next = {
        firstRunAt: f.firstRunAt < prev.firstRunAt ? f.firstRunAt : prev.firstRunAt,
        firstRunId: f.firstRunAt < prev.firstRunAt ? f.firstRunId : prev.firstRunId,
        lastRunAt: f.lastRunAt > prev.lastRunAt ? f.lastRunAt : prev.lastRunAt,
        lastRunId: f.lastRunAt > prev.lastRunAt ? f.lastRunId : prev.lastRunId,
        visitCount: Math.max(f.visitCount, prev.visitCount),
        discoveryCount: Math.max(f.discoveryCount, prev.discoveryCount),
      }
      if (JSON.stringify(next) !== JSON.stringify(prev)) updated++
      this.t6.set(c, next)
    }
    return { created, updated }
  }
  async publish() {
    this.op("publish")
    this.publishes++
    return ++this.generation
  }
}

const clock = () => {
  let t = Date.parse("2026-09-29T12:00:00.000Z")
  return () => new Date((t += 1_000))
}

let runIds = 0
function deps(store: MemoryStore, v2: RuleSet) {
  return { store, rules: rulesFor(v2), now: clock(), newId: () => `RUN${String(++runIds).padStart(4, "0")}` }
}

const sumBySkill = (store: MemoryStore) =>
  xpBySkill([...store.ledger.values()].filter((e) => e.activityId !== REPLAY_ACTIVITY_ID))

// ─────────────────────────────────────────────────────────────────────────────

describe("an unchanged ruleset is a no-op (v1 → v1)", () => {
  it("rewrites identical rows, writes zero floors, and agrees with ingest", async () => {
    const store = new MemoryStore(fixture(), rulesFor(V1)).seedByIngest()
    const before = store.snapshot()
    const result = await replayUser(USER, 1, deps(store, V1))

    expect(result.floors).toEqual([])
    const after = store.snapshot()
    expect(after.ledger).toEqual(before.ledger)
    expect(after.t6).toEqual(before.t6)
    for (const s of after.skills) {
      const was = before.skills.find((b) => b.skillId === s.skillId)!
      expect(s.displayedXp).toBe(was.displayedXp)
      expect(s.levelHighWater).toBe(levelForXp(s.displayedXp, V1.curve))
    }
    expect(result.run.status).toBe("DONE")
  })
})

describe("a stingier ruleset (I-16)", () => {
  it("(a) lowers no skill, (b) floors exactly the gap, (c) is not doubled by a second replay", async () => {
    const store = new MemoryStore(fixture(), rulesFor(STINGY)).seedByIngest()
    const shown = new Map([...store.skills].map(([k, s]) => [k, s.displayedXp]))
    const first = await replayUser(USER, 2, deps(store, STINGY))

    // (a)
    for (const [skillId, xp] of shown) expect(store.skills.get(skillId)!.displayedXp).toBeGreaterThanOrEqual(xp)
    // (b) the floors sum to exactly the gap between what was shown and what v2 recomputes
    // …on top of the tombstoned activity's rows, which step 2 kept as awarded (§4.7).
    const recomputed = new Map(Object.entries(first.run.recomputed!).map(([k, v]) => [k, v.xp]))
    const kept = xpBySkill([...store.ledger.values()].filter((e) => e.activityId === "z-gone"))
    expect(first.floors.length).toBeGreaterThan(0)
    for (const f of first.floors) {
      const gap = shown.get(f.skillId)! - (recomputed.get(f.skillId) ?? 0) - (kept.get(f.skillId) ?? 0)
      expect(f.xpAwarded).toBe(gap)
      expect(f).toMatchObject({ isFloor: true, activityId: "__floor__", reason: "retained_floor", xpRulesVersion: 2, supersedesRulesVersion: 1 })
    }
    expect(first.run.floorsWritten).toEqual(Object.fromEntries(first.floors.map((f) => [f.skillId, f.xpAwarded])))
    // Displayed is exactly what was shown: rows at half rate + floors.
    for (const [skillId, xp] of shown) expect(store.skills.get(skillId)!.displayedXp).toBe(xp)

    // (c)
    const floorsAfterFirst = [...store.ledger.values()].filter((e) => e.isFloor)
    const second = await replayUser(USER, 2, deps(store, STINGY))
    expect(second.floors).toEqual([])
    expect([...store.ledger.values()].filter((e) => e.isFloor)).toEqual(floorsAfterFirst)
    for (const [skillId, xp] of shown) expect(store.skills.get(skillId)!.displayedXp).toBe(xp)
  })

  it("step 2 deletes only isFloor = false rows: every floor survives a replay (I-18)", async () => {
    const store = new MemoryStore(fixture(), rulesFor(STINGY)).seedByIngest()
    await replayUser(USER, 2, deps(store, STINGY))
    const floors = [...store.ledger.values()].filter((e) => e.isFloor)
    expect(floors.length).toBeGreaterThan(0)
    // MemoryStore.deleteLedger throws on a floor id, so reaching here is half the proof.
    await replayUser(USER, 2, deps(store, STINGY))
    for (const f of floors) expect(store.ledger.get(f.id)).toEqual(f)
  })
})

describe("a curve-only ruleset (I-17)", () => {
  it("leaves XP untouched, no displayed level falls, and levelHighWater ratchets", async () => {
    const store = new MemoryStore(fixture(), rulesFor(STEEP)).seedByIngest()
    const shown = new Map([...store.skills].map(([k, s]) => [k, { xp: s.displayedXp, level: levelForXp(s.displayedXp, V1.curve) }]))
    const result = await replayUser(USER, 2, deps(store, STEEP))

    expect(result.floors).toEqual([])
    let loweredSomewhere = false
    for (const [skillId, was] of shown) {
      const s = store.skills.get(skillId)!
      expect(s.displayedXp).toBe(was.xp)
      expect(Math.max(s.level!, s.levelHighWater!)).toBeGreaterThanOrEqual(was.level)
      expect(s.levelHighWater).toBe(was.level)
      if (s.level! < was.level) loweredSomewhere = true
    }
    // The fixture must actually exercise the ratchet, or this test proves nothing.
    expect(loweredSomewhere).toBe(true)
  })
})

describe("I-15 after every replay", () => {
  it.each([
    ["v1", V1],
    ["stingier", STINGY],
    ["steeper", STEEP],
  ])("displayedXp == xpLedgerSum == SUM(xpAwarded) for every skill (%s)", async (_n, v2) => {
    const store = new MemoryStore(fixture(), rulesFor(v2)).seedByIngest()
    await replayUser(USER, v2.version, deps(store, v2))
    const sums = sumBySkill(store)
    for (const [skillId, s] of store.skills) {
      expect(s.displayedXp).toBe(sums.get(skillId) ?? 0)
      expect(s.xpLedgerSum).toBe(s.displayedXp)
    }
  })
})

describe("replay order and the ground fold (I-14)", () => {
  it("folds cells.bin in startedAt order with activityId tie-breaks, and never reads T6 to classify", async () => {
    const store = new MemoryStore(fixture(), rulesFor(V1)).seedByIngest()
    // Corrupt the cache in a way that would change the classification if it were read.
    for (const [c, f] of store.t6) store.t6.set(c, { ...f, lastRunAt: "2030-01-01T00:00:00.000Z" })
    const result = await replayUser(USER, 1, deps(store, V1))
    expect(result.floors).toEqual([])
    // Same XP as ingest gave, so the classification came from the fold, not the corrupt T6.
    for (const [skillId, s] of store.skills) expect(s.displayedXp).toBe(sumBySkill(store).get(skillId))

    const seqOf = (id: string) => [...store.ledger.values()].find((e) => e.activityId === id)!.seq
    expect(seqOf("a-tie") < seqOf("b-tie")).toBe(true)
  })

  it("reconstructs firstRunAt/lastRunAt from the facts, and a tombstoned run's cells still count", async () => {
    const store = new MemoryStore(fixture(), rulesFor(V1)).seedByIngest()
    const truth = new Map(store.t6)
    store.t6.clear() // a T6 that lost everything
    await replayUser(USER, 1, deps(store, V1))
    expect(new Map(store.t6)).toEqual(truth)
    const gone = store.runCells.get("z-gone")!
    expect(gone.every((c) => store.t6.get(c)!.firstRunId === "z-gone")).toBe(true)
  })

  it("keeps a tombstoned activity's rows as awarded, and neither re-scores nor floors them (§4.7)", async () => {
    const store = new MemoryStore(fixture(), rulesFor(STINGY)).seedByIngest()
    const kept = [...store.ledger.values()].filter((e) => e.activityId === "z-gone")
    expect(kept.length).toBeGreaterThan(0)
    await replayUser(USER, 2, deps(store, STINGY))
    expect([...store.ledger.values()].filter((e) => e.activityId === "z-gone")).toEqual(kept)
  })
})

describe("the ReplayRun audit row (§4.5)", () => {
  it("is written in step 0 as RUNNING with the waterline, and finishes DONE with every field", async () => {
    const store = new MemoryStore(fixture(), rulesFor(STINGY)).seedByIngest()
    let atFreeze: ReplayRunRecord | undefined
    store.crash = (op) => {
      if (op === "freeze") atFreeze = structuredClone([...store.runs.values()][0])
      return undefined
    }
    const { run } = await replayUser(USER, 2, deps(store, STINGY))

    expect(atFreeze).toMatchObject({ status: "RUNNING", fromRulesVersion: 1, toRulesVersion: 2 })
    expect(Object.keys(atFreeze!.waterline).sort()).toEqual([...store.skills.keys()].sort())
    expect(store.ops.indexOf("putRun")).toBeLessThan(store.ops.indexOf("freeze"))

    const saved = store.runs.get(run.id)!
    expect(saved.status).toBe("DONE")
    expect(saved.finishedAt).toBeDefined()
    expect(saved.waterline).toEqual(atFreeze!.waterline)
    expect(saved.recomputed).toBeDefined()
    expect(saved.floorsWritten).toBeDefined()
  })

  it("is marked FAILED on a crash and survives it, waterline intact", async () => {
    const store = new MemoryStore(fixture(), rulesFor(STINGY)).seedByIngest()
    store.crash = (op) => (op === "thaw" ? new Error("boom in step 6") : undefined)
    await expect(replayUser(USER, 2, deps(store, STINGY))).rejects.toThrow("boom")
    const [run] = [...store.runs.values()]
    expect(run).toMatchObject({ status: "FAILED", error: "boom in step 6" })
    expect(run!.floorsWritten).toBeDefined()
  })

  it("carries xpAwarded 0, so a SUM over the user's whole partition is unaffected", async () => {
    const store = new MemoryStore(fixture(), rulesFor(STINGY)).seedByIngest()
    await replayUser(USER, 2, deps(store, STINGY))
    const partition = await store.listLedger()
    const withRuns = sumXp(partition)
    expect(partition.some((e) => e.activityId === REPLAY_ACTIVITY_ID)).toBe(true)
    expect(withRuns).toBe(sumXp([...store.ledger.values()]))
  })
})

describe("resumability", () => {
  async function finalOf(v2: RuleSet) {
    const clean = new MemoryStore(fixture(), rulesFor(v2)).seedByIngest()
    await replayUser(USER, v2.version, deps(clean, v2))
    return clean.snapshot()
  }

  it.each([
    ["mid-step-3 (a trace read dies)", "loadTrace", 3],
    ["mid-step-2 (half the deletes landed)", "deleteLedger", 4],
    ["mid-step-5 (one floor landed)", "putLedger", 1],
    ["mid-step-6 (SkillState written, Profile not)", "thaw", 1],
  ] as const)("killed %s and restarted, it reaches the same final state", async (_n, op, at) => {
    const want = await finalOf(STINGY)
    const store = new MemoryStore(fixture(), rulesFor(STINGY)).seedByIngest()
    // For putLedger, die after the FIRST FLOOR row lands — step 5 half done. The rule-row puts of
    // step 3 go through untouched.
    let floorPuts = 0
    if (op === "putLedger") {
      const put = store.putLedger.bind(store)
      store.putLedger = async (entries) => {
        if (!entries.some((e) => e.isFloor)) return put(entries)
        await put(entries.slice(0, 1))
        floorPuts++
        throw new Error("killed after one floor")
      }
    } else {
      store.crash = (name, n) => (name === op && n === at ? new Error(`killed in ${op}`) : undefined)
    }
    await expect(replayUser(USER, 2, deps(store, STINGY))).rejects.toThrow(/killed/)
    if (op === "putLedger") {
      expect(floorPuts).toBe(1)
      store.putLedger = MemoryStore.prototype.putLedger.bind(store)
    }
    store.crash = undefined

    const resumed = await replayUser(USER, 2, deps(store, STINGY))
    expect(resumed.resumed).toBe(true)
    expect(store.snapshot()).toEqual(want)
    expect(store.runs.size).toBe(1)
    expect([...store.runs.values()][0]!.status).toBe("DONE")
  })

  it("a process death that never reached the FAILED write is resumed from the RUNNING row", async () => {
    const want = await finalOf(STINGY)
    const store = new MemoryStore(fixture(), rulesFor(STINGY)).seedByIngest()
    store.crash = (name, n) => (name === "loadTrace" && n === 2) || name === "updateRun" ? new Error("SIGKILL") : undefined
    await expect(replayUser(USER, 2, deps(store, STINGY))).rejects.toThrow("SIGKILL")
    expect([...store.runs.values()][0]!.status).toBe("RUNNING")
    store.crash = undefined
    await replayUser(USER, 2, deps(store, STINGY))
    expect(store.snapshot()).toEqual(want)
  })

  it("refuses to start a replay to a different version over an unfinished one", async () => {
    const store = new MemoryStore(fixture(), rulesFor(STINGY)).seedByIngest()
    store.crash = (name) => (name === "thaw" ? new Error("boom") : undefined)
    await expect(replayUser(USER, 2, deps(store, STINGY))).rejects.toThrow()
    store.crash = undefined
    await expect(replayUser(USER, 1, deps(store, STINGY))).rejects.toThrow(/unfinished replay to v2/)
  })
})

describe("the freeze (§4.4 step 1) and the generation (step 4)", () => {
  it("raises replayInProgress first, and SkillState is untouched until step 6", async () => {
    const store = new MemoryStore(fixture(), rulesFor(STINGY)).seedByIngest()
    const pre = JSON.stringify([...store.skills])
    const flags: Array<[string, boolean, boolean]> = []
    store.crash = (op) => {
      flags.push([op, store.profile.replayInProgress, JSON.stringify([...store.skills]) === pre])
      return undefined
    }
    await replayUser(USER, 2, deps(store, STINGY))

    const firstWrite = flags.findIndex(([op]) => op === "writeSkillStates")
    const freeze = flags.findIndex(([op]) => op === "freeze")
    expect(freeze).toBeGreaterThan(-1)
    for (const [op, frozen, untouched] of flags.slice(freeze + 1, firstWrite + 1)) {
      expect({ op, frozen, untouched }).toEqual({ op, frozen: true, untouched: true })
    }
    expect(store.profile.replayInProgress).toBe(false)
  })

  it("bumps the generation exactly once, after the T6 merge", async () => {
    const store = new MemoryStore(fixture(), rulesFor(STINGY)).seedByIngest()
    const gen = store.generation
    const { run } = await replayUser(USER, 2, deps(store, STINGY))
    expect(store.publishes).toBe(1)
    expect(store.generation).toBe(gen + 1)
    expect(run.generation).toBe(gen + 1)
    expect(store.ops.lastIndexOf("mergeCells")).toBeLessThan(store.ops.indexOf("publish"))
    expect(store.ops.indexOf("publish")).toBeLessThan(store.ops.indexOf("writeSkillStates"))
  })

  it("writes Profile totals from the displayed levels, untrained enabled skills counting 1", async () => {
    const store = new MemoryStore(fixture(), rulesFor(STEEP)).seedByIngest()
    await replayUser(USER, 2, deps(store, STEEP))
    let level = 0
    let xp = 0
    for (const s of STEEP.skills.filter((r) => r.enabled)) {
      const row = store.skills.get(s.id)
      level += row ? Math.max(row.level!, row.levelHighWater!) : 1
      xp += row?.displayedXp ?? 0
    }
    expect(store.profile).toEqual({ replayInProgress: false, totalXp: xp, totalLevel: level })
  })
})
