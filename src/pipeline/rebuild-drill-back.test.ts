import { gunzipSync, gzipSync } from "node:zlib"

import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3"
import { BatchGetCommand, GetCommand, PutCommand, QueryCommand, ScanCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb"
import { describe, expect, it } from "vitest"

import type { RawArchiveRef, Trace } from "@/src/domain/activity"
import { decodeExploredBlob, encodeExploredBlob } from "@/src/domain/explored-blob"
import { traceToCells } from "@/src/domain/fog"
import { loadRuleSet } from "@/src/rules/load"
import type { RuleSet } from "@/src/rules/schema"
import type { XpLedgerEntry } from "@/src/scoring"

import { objectKeys } from "./explored-blob-store"
import type { KindCorrected } from "./kind-override"
import type { DrillEntry, DrillSummary, FrontHalf } from "./rebuild-drill"
import {
  assertGenerationAdvances,
  CHECK_REASONS,
  DrillAbort,
  foldCells,
  liveNamesFromOutputs,
  persistFacts,
  publishDelivery,
  replayXp,
  runDrillBackHalf,
  t6Items,
  targetCollisions,
  type DrillStore,
  type DrillTarget,
  type LiveNames,
  type ObjectMeta,
  type SpotCheck,
} from "./rebuild-drill-back"
import { dynamoDrillStore } from "./rebuild-drill-store"
import { buildSnapshot, type SkillStateSnapshot } from "./skillstate-snapshot"
import type { ActivityScoreWrite, SkillStateWrite } from "./xp-replay"

/**
 * Ticket `0103`. Steps 4–8 against an in-memory target (`MemoryStore`), and the wire shapes against
 * stubbed clients. The fold, the scorer and the floors are the shipped ones (`xp-replay.ts`), so a
 * pass here is a claim about the drill agreeing with the code a rebalance uses.
 */

const UID = "u-drill"
const V1 = loadRuleSet(1)
/** A lower ruleset: every activity skill pays half (the D-135 / §9.2 case). */
const STINGY: RuleSet = {
  ...V1,
  version: 2,
  skills: V1.skills.map((s) => (s.kind === "activity" ? { ...s, xpPerUnit: s.xpPerUnit / 2 } : s)),
}

const LIVE: LiveNames = liveNamesFromOutputs({
  storage: { bucket_name: "live-bucket" },
  custom: { activityTableName: "Activity-liveapi123-NONE" },
})

const TARGET: DrillTarget = {
  tables: {
    activity: "Activity-drillapi-NONE",
    ledger: "XpLedgerEntry-drillapi-NONE",
    skillState: "SkillState-drillapi-NONE",
    profile: "Profile-drillapi-NONE",
    exploredCell: "DrillExploredCell",
  },
  bucket: "drill-bucket",
  prefix: "",
}

/** A straight north-bound line near Point Nemo (D-199). `offset` shifts it east. */
function line(offset: number, n = 6): Trace {
  const points = Array.from({ length: n }, (_, i) => ({ lat: -48.876 + i * 0.0012, lng: -123.393 + offset, t: i * 30_000 }))
  return {
    points,
    gaps: [],
    simplified: false,
    bbox: [points[0]!.lng, points[0]!.lat, points[n - 1]!.lng, points[n - 1]!.lat],
    pointCount: n,
  }
}

const REF: RawArchiveRef = {
  bucket: "live-bucket",
  key: "raw/x",
  contentType: "application/json",
  bytes: 1,
  sha256: "0".repeat(64),
  archivedAt: "2026-10-01T00:00:00.000Z",
}

function entry(id: string, startedAt: string, trace?: Trace, over: Partial<KindCorrected> = {}): DrillEntry {
  const activity = {
    activityId: id,
    userId: UID,
    kind: "run",
    derivedKind: "run",
    kindOverride: null,
    startedAt,
    startedAtLocal: startedAt.slice(0, 19),
    timezone: "UTC",
    elapsedS: 1_800,
    distanceM: 5_000,
    source: { source: "manual", externalId: id, sourceTypeRaw: "run", fetchedAt: startedAt },
    raw: REF,
    traceRef: null,
    hasTrace: trace !== undefined,
    sets: [],
    dedupeKey: `dk-${id}`,
    ingestedAt: startedAt.replace("T0", "T1"),
    revision: 1,
    ...over,
  } as unknown as KindCorrected
  return { activity, trace, ref: REF }
}

/**
 * Six activities, sorted. The same line three times (new, cooled a month later, re-armed seven
 * months after that), fresh ground, a treadmill run, and a D-263 loser whose ground nobody else
 * covered — its cells must not reach the map.
 */
function history(): DrillEntry[] {
  return [
    entry("a-first", "2026-01-01T07:00:00.000Z", line(0)),
    entry("a-again", "2026-02-01T07:00:00.000Z", line(0)),
    entry("b-fresh", "2026-03-01T07:00:00.000Z", line(0.01)),
    entry("treadmill", "2026-03-02T07:00:00.000Z"),
    entry("dup-loser", "2026-03-05T07:00:00.000Z", line(0.02)),
    entry("a-rearm", "2026-09-15T07:00:00.000Z", line(0)),
  ]
}

const DUPLICATES = new Map([["dup-loser", `raw/${UID}/manual/dup-loser.duplicate-of.json`]])

/** What the live map holds for `history()`: every cell but the duplicate's. */
function liveCellCount(entries = history()): number {
  const cells = new Set<string>()
  for (const e of entries) if (e.trace && !DUPLICATES.has(e.activity.activityId)) for (const c of traceToCells(e.trace)) cells.add(c)
  return cells.size
}

function front(over: { sorted?: DrillEntry[]; snapshot?: SkillStateSnapshot; summary?: Partial<DrillSummary> } = {}): FrontHalf {
  const sorted = over.sorted ?? history()
  const summary: DrillSummary = {
    phase: "normalize",
    userId: UID,
    bucket: "live-bucket",
    dryRun: false,
    refused: false,
    preconditions: [],
    step0: { generation: 269, cellCount: liveCellCount(sorted), manifestPresent: true, snapshotKey: "s", snapshotPath: "/tmp/s" },
    objectCount: sorted.length + 2,
    // One superseded re-fetch beside the six emitted payloads.
    payloadCount: sorted.length + 1,
    kindOverrideObjectCount: 0,
    duplicatePointerCount: DUPLICATES.size,
    unrecognisedKeys: [],
    sourceIds: ["manual"],
    activityCount: sorted.length,
    supersededObjects: 1,
    kindOverridesApplied: 0,
    normalizeFailures: 0,
    failures: [],
    firstStartedAt: null,
    lastStartedAt: null,
    sortedActivityIds: sorted.map((e) => e.activity.activityId),
    ...over.summary,
  }
  return { summary, sorted, duplicatePointers: DUPLICATES, snapshot: over.snapshot ?? emptySnapshot() }
}

const emptySnapshot = (): SkillStateSnapshot =>
  buildSnapshot({ userId: UID, takenAt: "2026-10-01T00:00:00.000Z", generation: 269, trigger: "ingest", rules: V1, rows: [] })

const snapshotOf = (writes: readonly SkillStateWrite[], rules = V1): SkillStateSnapshot =>
  buildSnapshot({
    userId: UID,
    takenAt: "2026-10-01T00:00:00.000Z",
    generation: 269,
    trigger: "ingest",
    rules,
    rows: writes.map((w) => ({ skillId: w.skillId, displayedXp: w.xp, xpLedgerSum: w.xp, level: w.level, levelHighWater: w.levelHighWater })),
  })

type Item = Record<string, unknown>

/** The target, in memory. `log` is every write, in order. */
class MemoryStore implements DrillStore {
  objects = new Map<string, { body: Uint8Array; meta: ObjectMeta }>()
  t3 = new Map<string, Item>()
  t6: Item[] = []
  ledger = new Map<string, XpLedgerEntry>()
  skills = new Map<string, SkillStateWrite>()
  profile?: Item
  generation?: number
  mirrored?: number
  log: string[] = []
  /** Tamper with a read-back, to fake a lost or damaged write. */
  onGet?: (key: string, body: Uint8Array) => Uint8Array | undefined
  onReadSkills?: (rows: Array<{ skillId: string; displayedXp: number; xpLedgerSum: number }>) => typeof rows
  onReadLedger?: (rows: Array<{ id: string; skillId: string; xpAwarded: number }>) => typeof rows

  async putObject(key: string, body: Uint8Array, meta: ObjectMeta) {
    if (this.objects.has(key)) throw new Error(`PreconditionFailed: ${key}`)
    this.objects.set(key, { body, meta })
    this.log.push(`s3 ${key}`)
  }
  async getObject(key: string) {
    const o = this.objects.get(key)
    if (!o) return undefined
    return this.onGet ? this.onGet(key, o.body) : o.body
  }
  async putActivity(item: Item) {
    this.t3.set(String(item.id), { ...item })
    this.log.push(`t3 ${String(item.id)}`)
  }
  async putCellItems(items: readonly Item[]) {
    this.t6.push(...items)
    this.log.push(`t6 ${items.length}`)
  }
  async putLedger(entries: readonly XpLedgerEntry[]) {
    for (const e of entries) this.ledger.set(e.id, e)
    this.log.push(`t4 ${entries.length}`)
  }
  async writeActivityScores(rows: readonly ActivityScoreWrite[]) {
    for (const w of rows) Object.assign(this.t3.get(w.activityId)!, { xpAwarded: w.xpAwarded, xpRulesVersion: w.xpRulesVersion, ...(w.award ?? {}) })
    this.log.push(`t3-scores ${rows.length}`)
  }
  async writeSkillStates(_u: string, rows: readonly SkillStateWrite[]) {
    for (const w of rows) this.skills.set(w.skillId, w)
    this.log.push(`t2 ${rows.length}`)
  }
  async putProfile(_u: string, totals: Item) {
    this.profile = { ...totals }
    this.log.push("t1")
  }
  async raiseGeneration(_u: string, g: number) {
    if (this.generation !== undefined) return false
    this.generation = g
    this.log.push(`gen ${g}`)
    return true
  }
  async mirrorGeneration(_u: string, g: number) {
    this.mirrored = g
    this.log.push(`mirror ${g}`)
  }
  async readSkillStates(_u: string, ids: readonly string[]) {
    const rows = ids.flatMap((id) => {
      const w = this.skills.get(id)
      return w ? [{ skillId: id, displayedXp: w.xp, xpLedgerSum: w.xp }] : []
    })
    return this.onReadSkills ? this.onReadSkills(rows) : rows
  }
  async readLedger(ids: readonly string[]) {
    const rows = ids.flatMap((id) => {
      const e = this.ledger.get(id)
      return e ? [{ id, skillId: e.skillId, xpAwarded: e.xpAwarded }] : []
    })
    return this.onReadLedger ? this.onReadLedger(rows) : rows
  }

  manifest() {
    const o = this.objects.get(objectKeys.manifest(UID))
    return o && (JSON.parse(Buffer.from(o.body).toString("utf8")) as { generation: number; cellCount: number; deltasFrom: number })
  }
}

const NOW = () => new Date("2026-10-20T12:00:00.000Z")

/** What the live ledger says, for the spot check: the same run under the same rules, by a clean drill. */
async function liveState(rules = V1) {
  const store = new MemoryStore()
  const summary = await runDrillBackHalf(front(), { target: TARGET, live: LIVE, store, rules, now: NOW })
  return { store, summary, snapshot: snapshotOf([...store.skills.values()], rules) }
}

function spotOf(store: MemoryStore, activityId: string): SpotCheck {
  return {
    activityId,
    expected: [...store.ledger.values()]
      .filter((e) => e.activityId === activityId)
      .map(({ id, xpAwarded, xpRulesVersion, reason, units }) => ({ id, xpAwarded, xpRulesVersion, reason, units })),
  }
}

async function cleanRun(over: Parameters<typeof front>[0] = {}, rules = V1) {
  const live = await liveState()
  const store = new MemoryStore()
  const summary = await runDrillBackHalf(front({ snapshot: live.snapshot, ...over }), {
    target: TARGET,
    live: LIVE,
    store,
    rules,
    now: NOW,
    spotCheck: spotOf(live.store, "b-fresh"),
  })
  return { live, store, summary }
}

// ─── Criterion 1: the parallel stack ────────────────────────────────────────

describe("criterion 1 — the drill refuses the live stack", () => {
  it("names every collision: a live table, the live API's id, the live bucket", () => {
    expect(targetCollisions(TARGET, LIVE)).toEqual([])
    const bad: DrillTarget = {
      tables: { ...TARGET.tables, activity: "Activity-liveapi123-NONE", ledger: "Copy-liveapi123-x", exploredCell: "LostSolesExploredCell" },
      bucket: "live-bucket",
      prefix: "",
    }
    const hits = targetCollisions(bad, LIVE)
    expect(hits).toEqual([
      'target activity table "Activity-liveapi123-NONE" is a live table',
      'target ledger table "Copy-liveapi123-x" belongs to the live API liveapi123',
      'target exploredCell table "LostSolesExploredCell" is a live table',
      'target bucket "live-bucket" is the live bucket and no prefix separates the rebuild from it',
    ])
  })

  it("allows the live bucket only behind a staging prefix outside raw/, users/ and snapshots/", () => {
    expect(targetCollisions({ ...TARGET, bucket: "live-bucket", prefix: "drill-2026-10-20/" }, LIVE)).toEqual([])
    expect(targetCollisions({ ...TARGET, bucket: "live-bucket", prefix: "users/" }, LIVE)).toHaveLength(1)
    expect(targetCollisions({ ...TARGET, prefix: "no-slash" }, LIVE)).toHaveLength(1)
    expect(targetCollisions({ ...TARGET, tables: { ...TARGET.tables, ledger: TARGET.tables.activity } }, LIVE)).toHaveLength(1)
  })

  it("every live table is on the list, Amplify's and the CDK literals", () => {
    expect(LIVE.tables).toEqual(
      expect.arrayContaining(["Activity-liveapi123-NONE", "SkillState-liveapi123-NONE", "XpLedgerEntry-liveapi123-NONE", "Profile-liveapi123-NONE", "LostSolesExploredCell"]),
    )
  })

  it("refuses before the first write, exit 4", async () => {
    const store = new MemoryStore()
    const summary = await runDrillBackHalf(front(), {
      target: { ...TARGET, tables: { ...TARGET.tables, skillState: "SkillState-liveapi123-NONE" } },
      live: LIVE,
      store,
      rules: V1,
      now: NOW,
    })
    expect(summary.failed).toMatchObject({ reason: "TARGET_IS_LIVE", exitCode: 4 })
    expect(store.log).toEqual([])
  })
})

// ─── Steps 4–8 end to end ───────────────────────────────────────────────────

describe("a clean drill", () => {
  it("passes all six and publishes generation step0 + 1", async () => {
    const { store, summary } = await cleanRun()
    expect(summary.failed).toBeNull()
    expect(summary.step8.map((c) => [c.n, c.status])).toEqual([
      [1, "pass"],
      [2, "pass"],
      [3, "pass"],
      [4, "pass"],
      [5, "pass"],
      [6, "pass"],
    ])
    expect(summary.generation).toBe(270)
    expect(store.manifest()).toMatchObject({ generation: 270, cellCount: liveCellCount(), deltasFrom: 270 })
    expect(store.mirrored).toBe(270)
    expect(summary.floors).toEqual([])
  })

  it("drops the D-263 loser before step 4: no row, no cells, no XP", async () => {
    const { store, summary } = await cleanRun()
    expect(summary.duplicatesDropped).toBe(1)
    expect(summary.activitiesWritten).toBe(5)
    expect(store.t3.has("dup-loser")).toBe(false)
    expect(store.objects.has(objectKeys.runCells(UID, "dup-loser"))).toBe(false)
    expect([...store.ledger.values()].some((e) => e.activityId === "dup-loser")).toBe(false)
    expect(store.t6.some((i) => i.firstRunId === "dup-loser" || i.lastRunId === "dup-loser")).toBe(false)
  })

  it("step 4 writes facts only; the T3 row names the objects it wrote", async () => {
    const store = new MemoryStore()
    const persisted = await persistFacts(history().slice(0, 4), V1, store)
    expect(store.t6).toEqual([])
    expect(store.ledger.size).toBe(0)
    expect(persisted.map((p) => p.cellsWritten)).toEqual([true, true, true, false])
    expect(store.t3.get("a-first")).toMatchObject({
      traceRef: `users/${UID}/traces/a-first.segments.json.gz`,
      cellsRef: objectKeys.runCells(UID, "a-first"),
      xpAwarded: 0,
      cellCount: 0,
      status: "ACTIVE",
    })
    expect(store.t3.get("treadmill")).toMatchObject({ traceRef: null, cellsRef: null })
    // Each row after the objects it names.
    expect(store.log.indexOf("t3 a-first")).toBeGreaterThan(store.log.indexOf(`s3 ${objectKeys.runCells(UID, "a-first")}`))
  })

  it("T3 ends with the fold's award: new, then cooled, then re-armed", async () => {
    const { store } = await cleanRun()
    const n = liveCellCount([history()[0]!])
    expect(store.t3.get("a-first")).toMatchObject({ newCellCount: n, cooledCellCount: 0 })
    expect(store.t3.get("a-again")).toMatchObject({ newCellCount: 0, cooledCellCount: n })
    expect(store.t3.get("a-rearm")).toMatchObject({ newCellCount: 0, rearmedCellCount: n })
    expect(store.objects.has(objectKeys.runClasses(UID, "a-rearm"))).toBe(true)
  })

  it("writes the trace web from the routes step 4 wrote", async () => {
    const { store } = await cleanRun()
    const web = JSON.parse(gunzipSync(store.objects.get(`users/${UID}/traces/web.json.gz`)!.body).toString("utf8")) as {
      runs: Record<string, unknown>
    }
    expect(Object.keys(web.runs).sort()).toEqual(["a-again", "a-first", "a-rearm", "b-fresh"])
  })
})

// ─── Criterion 2: the fold is deterministic ─────────────────────────────────

describe("criterion 2 — step 5 is deterministic", () => {
  async function t6Of(entries: DrillEntry[]) {
    const store = new MemoryStore()
    const persisted = await persistFacts(entries, V1, store)
    await foldCells(UID, persisted, liveCellCount(entries), false, store)
    return JSON.stringify(store.t6)
  }

  it("two runs over the same sorted input produce byte-identical T6 item sets", async () => {
    const input = history().filter((e) => !DUPLICATES.has(e.activity.activityId))
    const a = await t6Of(input)
    const b = await t6Of(input)
    expect(a).toBe(b)
    // And the fold sorts for itself: the same set in any order is the same table.
    expect(await t6Of([...input].reverse())).toBe(a)
  })

  it("carries visitCount and discoveryCount: three visits, two of them credited", async () => {
    const input = history().filter((e) => !DUPLICATES.has(e.activity.activityId))
    const items = JSON.parse(await t6Of(input)) as Item[]
    const line0 = items.filter((i) => i.firstRunId === "a-first")
    expect(line0.length).toBeGreaterThan(0)
    for (const i of line0) {
      expect(i).toMatchObject({ visitCount: 3, discoveryCount: 2, lastRunId: "a-rearm", lastRunAt: "2026-09-15T07:00:00.000Z" })
      expect(typeof i.lastRunDay).toBe("number")
    }
    const aggs = items.filter((i) => String(i.pk).includes("#AGG#"))
    expect(new Set(aggs.map((i) => String(i.pk).split("#").pop()))).toEqual(new Set(["6", "7", "8"]))
  })

  it("t6Items is a pure function of the map", () => {
    expect(t6Items(UID, new Map())).toEqual([])
  })
})

// ─── Criterion 3: the waterline is the snapshot ─────────────────────────────

describe("criterion 3 — step 6 reads its waterline from the snapshot, never SkillState", () => {
  it("runs to completion with every DynamoDB read stubbed to throw", async () => {
    const { snapshot } = await liveState()
    const sent: unknown[] = []
    const ddb = {
      async send(c: unknown) {
        if (c instanceof GetCommand || c instanceof QueryCommand || c instanceof BatchGetCommand || c instanceof ScanCommand) {
          throw new Error(`T2 is stubbed to throw: step 6 issued a ${c.constructor.name}`)
        }
        sent.push(c)
        return {}
      },
    }
    const objects = new Map<string, Uint8Array>()
    const s3 = {
      async send(c: unknown) {
        if (c instanceof PutObjectCommand) objects.set(c.input.Key!, c.input.Body as Uint8Array)
        if (c instanceof GetObjectCommand) {
          const body = objects.get(c.input.Key!)
          return { Body: { transformToByteArray: async () => body! } }
        }
        return {}
      },
    }
    const store = dynamoDrillStore({ ddb, s3, target: TARGET })
    const entries = history().filter((e) => !DUPLICATES.has(e.activity.activityId))
    const persisted = await persistFacts(entries, V1, store)
    const { history: folded } = await foldCells(UID, persisted, liveCellCount(), false, store)

    // A waterline above anything v1 earns: only the snapshot can say so, and floors prove it was read.
    const high = { ...snapshot, skills: snapshot.skills.map((k) => (k.displayedXp > 0 ? { ...k, displayedXp: k.displayedXp + 1_000 } : k)) }
    const out = await replayXp({ userId: UID, persisted, history: folded, rules: V1, snapshot: high, generation: 270, at: NOW().toISOString(), store })
    expect(out.floors.length).toBeGreaterThan(0)

    const t2 = sent.filter((c) => (c as { input?: { TableName?: string } }).input?.TableName === TARGET.tables.skillState)
    expect(t2.length).toBe(out.writes.length)
    expect(t2.every((c) => c instanceof UpdateCommand)).toBe(true)
  })
})

// ─── Criterion 4: a lower ruleset retains floors ────────────────────────────

describe("criterion 4 — a replay against a lower ruleset writes floors and lowers nothing", () => {
  it("retained_floor rows close the gap; every displayedXp holds", async () => {
    const { live, store, summary } = await cleanRun({}, STINGY)
    expect(summary.rulesVersion).toBe(2)
    const floors = [...store.ledger.values()].filter((e) => e.isFloor)
    expect(floors.length).toBeGreaterThan(0)
    expect(floors.every((f) => f.reason === "retained_floor" && f.xpRulesVersion === 2 && f.supersedesRulesVersion === 1)).toBe(true)
    for (const k of live.snapshot.skills) {
      expect(store.skills.get(k.skillId)?.xp ?? 0).toBeGreaterThanOrEqual(k.displayedXp)
    }
    expect(summary.step8.find((c) => c.n === 4)!.status).toBe("pass")
    expect(summary.step8.find((c) => c.n === 5)!.status).toBe("pass")
    // The spot check prices v1; under v2 it is not comparable, which is not a failure.
    expect(summary.step8.find((c) => c.n === 6)!.status).toBe("n/a")
    expect(summary.failed).toBeNull()
  })
})

// ─── Criterion 5: the generation ────────────────────────────────────────────

describe("criterion 5 — generation = step0 + 1, manifest last", () => {
  it("manifest.json is the last object written", async () => {
    const { store } = await cleanRun()
    const s3 = store.log.filter((l) => l.startsWith("s3 "))
    expect(s3.at(-1)).toBe(`s3 ${objectKeys.manifest(UID)}`)
    // Only the Profile mirror follows it, and step 8 writes nothing.
    expect(store.log.slice(store.log.indexOf(s3.at(-1)!) + 1)).toEqual(["mirror 270"])
  })

  it("never 1, never step 0's", () => {
    expect(() => assertGenerationAdvances(269, 269)).toThrow(DrillAbort)
    expect(() => assertGenerationAdvances(269, 1)).toThrow(/GENERATION_NOT_ADVANCING/)
    expect(() => assertGenerationAdvances(269, 270)).not.toThrow()
  })

  it("a run that would emit generation <= step0 aborts before any PUT", async () => {
    const store = new MemoryStore()
    await expect(
      publishDelivery({ userId: UID, persisted: [], cells: new Map(), step0Generation: 269, generation: 269, at: "x", store }),
    ).rejects.toThrow(/GENERATION_NOT_ADVANCING/)
    expect(store.log).toEqual([])
  })

  it("a target whose counter is already taken aborts before any step-7 PUT", async () => {
    const live = await liveState()
    const store = new MemoryStore()
    store.generation = 270
    const summary = await runDrillBackHalf(front({ snapshot: live.snapshot }), { target: TARGET, live: LIVE, store, rules: V1, now: NOW })
    expect(summary.failed).toMatchObject({ reason: "TARGET_GENERATION_TAKEN", exitCode: 5 })
    expect([...store.objects.keys()].some((k) => k.includes("/explored/") || k.endsWith("manifest.json") || k.endsWith("web.json.gz"))).toBe(false)
  })
})

// ─── Criterion 6: the six, each with its own reason ─────────────────────────

describe("criterion 6 — step 8 fails by name", () => {
  it("every check has its own exit reason", () => {
    expect(new Set(Object.values(CHECK_REASONS)).size).toBe(6)
  })

  it("1: a normalize failure", async () => {
    const { summary } = await cleanRun({ summary: { normalizeFailures: 1 } })
    expect(summary.failed).toMatchObject({ reason: "ASSERT_1_NORMALIZE_FAILURES", exitCode: 11 })
  })

  it("2: a lost activity", async () => {
    const { summary } = await cleanRun({ summary: { payloadCount: 8 } })
    expect(summary.failed).toMatchObject({ reason: "ASSERT_2_ACTIVITY_COUNT", exitCode: 12 })
  })

  it("3: a lost cell ABORTS — no T6, no XP, no manifest", async () => {
    const live = await liveState()
    const f = front({ snapshot: live.snapshot })
    f.summary.step0!.cellCount += 1
    const store = new MemoryStore()
    const summary = await runDrillBackHalf(f, { target: TARGET, live: LIVE, store, rules: V1, now: NOW })
    expect(summary.failed).toMatchObject({ reason: "ASSERT_3_CELL_COUNT", exitCode: 13 })
    expect(summary.step8).toEqual([expect.objectContaining({ n: 3, status: "fail" })])
    expect(store.t6).toEqual([])
    expect(store.ledger.size).toBe(0)
    expect(store.manifest()).toBeUndefined()
  })

  it("3: a cells file that lost a cell between write and fold (the corrupted-fixture case)", async () => {
    const live = await liveState()
    const store = new MemoryStore()
    store.onGet = (key, body) => {
      if (key !== objectKeys.runCells(UID, "b-fresh")) return body
      const cells = decodeExploredBlob(gunzipSync(body)).cells
      return gzipSync(encodeExploredBlob(cells.slice(1), 0))
    }
    const summary = await runDrillBackHalf(front({ snapshot: live.snapshot }), { target: TARGET, live: LIVE, store, rules: V1, now: NOW })
    expect(summary.failed?.reason).toBe("ASSERT_3_CELL_COUNT")
    expect(store.manifest()).toBeUndefined()
  })

  it("a cells file that does not decode aborts before step 7", async () => {
    const live = await liveState()
    const store = new MemoryStore()
    store.onGet = (key, body) => (key === objectKeys.runCells(UID, "b-fresh") ? new Uint8Array([1, 2, 3]) : body)
    const summary = await runDrillBackHalf(front({ snapshot: live.snapshot }), { target: TARGET, live: LIVE, store, rules: V1, now: NOW })
    expect(summary.failed?.reason).toBe("CELLS_FILE_UNREADABLE")
    expect(store.manifest()).toBeUndefined()
  })

  it("3: a changed fogAlgoVersion allows more cells, never fewer", async () => {
    const live = await liveState()
    const more = front({ snapshot: live.snapshot })
    more.summary.step0!.cellCount -= 1
    const ok = await runDrillBackHalf(more, { target: TARGET, live: LIVE, store: new MemoryStore(), rules: V1, now: NOW, fogAlgoChanged: true, spotCheck: spotOf(live.store, "b-fresh") })
    expect(ok.failed).toBeNull()
    const fewer = front({ snapshot: live.snapshot })
    fewer.summary.step0!.cellCount += 1
    const bad = await runDrillBackHalf(fewer, { target: TARGET, live: LIVE, store: new MemoryStore(), rules: V1, now: NOW, fogAlgoChanged: true })
    expect(bad.failed?.reason).toBe("ASSERT_3_CELL_COUNT")
  })

  it("4: a displayedXp below the snapshot's", async () => {
    const live = await liveState()
    const store = new MemoryStore()
    store.onReadSkills = (rows) => rows.map((r) => ({ ...r, displayedXp: r.displayedXp - 1 }))
    const summary = await runDrillBackHalf(front({ snapshot: live.snapshot }), { target: TARGET, live: LIVE, store, rules: V1, now: NOW, spotCheck: spotOf(live.store, "b-fresh") })
    expect(summary.failed).toMatchObject({ reason: "ASSERT_4_DISPLAYED_XP_FELL", exitCode: 14 })
  })

  it("5: a ledger row the table did not keep", async () => {
    const live = await liveState()
    const store = new MemoryStore()
    store.onReadLedger = (rows) => rows.slice(1)
    const summary = await runDrillBackHalf(front({ snapshot: live.snapshot }), { target: TARGET, live: LIVE, store, rules: V1, now: NOW, spotCheck: spotOf(live.store, "b-fresh") })
    expect(summary.failed).toMatchObject({ reason: "ASSERT_5_LEDGER_SUM", exitCode: 15 })
  })

  it("6: an itemisation that moved, and a spot check nobody gave", async () => {
    const live = await liveState()
    const spot = spotOf(live.store, "b-fresh")
    const moved: SpotCheck = { ...spot, expected: spot.expected.map((r, i) => (i === 0 ? { ...r, xpAwarded: r.xpAwarded + 1 } : r)) }
    const a = await runDrillBackHalf(front({ snapshot: live.snapshot }), { target: TARGET, live: LIVE, store: new MemoryStore(), rules: V1, now: NOW, spotCheck: moved })
    expect(a.failed).toMatchObject({ reason: "ASSERT_6_SPOT_CHECK", exitCode: 16 })
    const b = await runDrillBackHalf(front({ snapshot: live.snapshot }), { target: TARGET, live: LIVE, store: new MemoryStore(), rules: V1, now: NOW })
    expect(b.failed?.reason).toBe("ASSERT_6_SPOT_CHECK")
  })

  it("refuses a front half that did not normalize", async () => {
    const store = new MemoryStore()
    const summary = await runDrillBackHalf(front({ summary: { phase: "enumerate" } }), { target: TARGET, live: LIVE, store, rules: V1, now: NOW })
    expect(summary.failed?.reason).toBe("FRONT_HALF_INCOMPLETE")
    expect(store.log).toEqual([])
  })
})

// ─── The wire shapes ────────────────────────────────────────────────────────

describe("dynamoDrillStore", () => {
  function rig(target: DrillTarget = TARGET) {
    const ddbSent: unknown[] = []
    const s3Sent: unknown[] = []
    const store = dynamoDrillStore({
      ddb: {
        async send(c: unknown) {
          ddbSent.push(c)
          return {}
        },
      },
      s3: {
        async send(c: unknown) {
          s3Sent.push(c)
          return {}
        },
      },
      target,
    })
    return { store, ddbSent, s3Sent }
  }

  it("prefixes every key and refuses to overwrite an object", async () => {
    const { store, s3Sent } = rig({ ...TARGET, bucket: "live-bucket", prefix: "drill-x/" })
    await store.putObject("users/u/manifest.json", new Uint8Array([1]), { contentType: "application/json", cacheControl: "no-cache" })
    const put = s3Sent[0] as PutObjectCommand
    expect(put.input).toMatchObject({ Bucket: "live-bucket", Key: "drill-x/users/u/manifest.json", IfNoneMatch: "*" })
    expect(put.input.ContentEncoding).toBeUndefined()
  })

  it("creates every item conditioned on absence, in the target's tables", async () => {
    const { store, ddbSent } = rig()
    await store.putActivity({ id: "a" })
    await store.putCellItems([{ pk: "p", sk: "s" }])
    await store.putProfile(UID, { totalXp: 1, totalLevel: 2, ledgerRulesVersion: 1 }, "t")
    const puts = ddbSent as PutCommand[]
    expect(puts.map((p) => [p.input.TableName, p.input.ConditionExpression])).toEqual([
      [TARGET.tables.activity, "attribute_not_exists(id)"],
      [TARGET.tables.exploredCell, "attribute_not_exists(pk)"],
      [TARGET.tables.profile, "attribute_not_exists(id)"],
    ])
  })

  it("reports a taken generation counter as false, not a throw", async () => {
    const store = dynamoDrillStore({
      ddb: {
        async send() {
          throw Object.assign(new Error("x"), { name: "ConditionalCheckFailedException" })
        },
      },
      s3: { send: async () => ({}) },
      target: TARGET,
    })
    expect(await store.raiseGeneration(UID, 270)).toBe(false)
  })

  it("reads step 8 back strongly consistent, by key", async () => {
    const { store, ddbSent } = rig()
    await store.readSkillStates(UID, ["running"])
    const get = ddbSent[0] as BatchGetCommand
    expect(get.input.RequestItems![TARGET.tables.skillState]).toEqual({ Keys: [{ userId: UID, skillId: "running" }], ConsistentRead: true })
  })
})
