import { gunzipSync, gzipSync } from "node:zlib"

import { cellToParent, type H3Index } from "h3-js"

import type { Trace } from "@/src/domain/activity"
import { FOG_ALGO_VERSION } from "@/src/domain/discovery"
import { AGG_RESOLUTIONS, computeAgg, totalChildren } from "@/src/domain/explored-agg"
import { bigToCell, cellToBig, decodeExploredBlob, encodeExploredBlob, encodeLastRunBlob } from "@/src/domain/explored-blob"
import { NO_REJECTS, RES, traceToCells, traceToSegments, type TraceRejects } from "@/src/domain/fog"
import type { FoldedCell } from "@/src/domain/fold"
import { revealsGround } from "@/src/rules/reveals-ground"
import type { RuleSet } from "@/src/rules/schema"
import { reconcile, xpBySkill, type XpLedgerEntry } from "@/src/scoring"

import { IMMUTABLE_CACHE_CONTROL, MANIFEST_CACHE_CONTROL, objectKeys, type ExploredManifest } from "./explored-blob-store"
import { cellKey, EXPLORED_CELL_TABLE, lastRunDay } from "./explored-cells"
import { backfillLandmarks, type LandmarkRecord } from "./landmarks"
import { activityItem } from "./persist"
import type { DrillEntry, FrontHalf } from "./rebuild-drill"
import { routeTraceKey, segmentsToGeometry, type RouteTraceGeometry } from "./route-trace-store"
import { waterlineOfSnapshot, type SkillStateSnapshot } from "./skillstate-snapshot"
import { encodeTraceWeb, traceWebKey, webRunFrom, type TraceWebRun } from "./trace-web-store"
import {
  foldHistory,
  profileTotals,
  scoreHistory,
  thawWrites,
  type ActivityScoreWrite,
  type FoldedHistory,
  type ReplayActivity,
  type SkillStateWrite,
} from "./xp-replay"

/**
 * THE REBUILD DRILL, BACK HALF: STEPS 4–8. Ticket `0103`. `02-data-model.md` §8.3; D-020, D-101,
 * D-135, D-143, D-399.
 *
 * Takes `runDrillFrontHalf()`'s sorted, normalized history and rebuilds every derived fact from it
 * into a PARALLEL target — tables and a bucket the caller names, never the live stack's. Nothing
 * here removes or truncates anything, anywhere: every write is a put or a guarded update, and
 * `scripts/check-drill-no-delete.mjs` fails the build if a removal command is ever named in a drill
 * file. Cutover is not this module's business. It verifies; a human points the app.
 *
 *   4 PERSIST   per activity, in sorted order: the route trace, the per-run cells file, the T3 row.
 *               No XP and no `ExploredCell` writes.
 *   5 FOLD      read the cells files BACK, fold them (`foldHistory`, the one fold), and assert
 *               check 3 before writing anything else — then put the T6 cell and AGG items.
 *   6 REPLAY    score the fold under the target rules, against the precondition-4 snapshot as the
 *               D-135 waterline (no `SkillState` read: the tables are new). Floors, T2, T1 totals,
 *               then the landmark backfill over the rebuilt ledger and routes (`0302`, D-307).
 *   7 PUBLISH   generation = step 0's + 1, the three blobs and the trace web, manifest LAST.
 *   8 VERIFY    the six assertions, from what the target now holds.
 *
 * ─── WHY THE FOLD READS THE CELLS BACK ──────────────────────────────────────
 *
 * Step 4 has the cell sets in memory, and folding those would be faster by a few seconds. §8.3
 * folds `users/<uid>/cells/<id>.bin` because that object is the per-run fact a later replay folds
 * (`xp-replay.ts`); folding what was WRITTEN is what makes the drill a test of the facts rather
 * than of its own memory. A cells file that is lost or damaged surfaces here, before step 7.
 *
 * ─── D-263 LOSERS NEVER ENTER ───────────────────────────────────────────────
 *
 * An activity with a `duplicate-of` pointer is dropped from `sorted` before step 4. Live ingest
 * never writes a row, a cell or a ledger entry for a duplicate, so a rebuild that did would be a
 * different history. Check 2 reconciles against `payloadCount − supersededObjects − pointers`.
 */

type Item = Record<string, unknown>

// ─── The target, and the refusal ────────────────────────────────────────────

/** Where the rebuild writes. Every name is the caller's; none defaults to a live one. */
export interface DrillTarget {
  tables: {
    activity: string
    ledger: string
    skillState: string
    profile: string
    exploredCell: string
    /** `0302`: step 6's landmark backfill writes here (D-307). */
    landmark: string
  }
  bucket: string
  /**
   * Prepended to every key the drill writes in `bucket` (`""` for none). Stored references — T3's
   * `traceRef`/`cellsRef`, the manifest's blob keys — stay canonical, because they describe the
   * stack after cutover, not the staging namespace.
   */
  prefix: string
}

/** The live stack's names: what the target must not be. */
export interface LiveNames {
  tables: readonly string[]
  bucket: string
  /** Amplify's `<Model>-<apiId>-NONE`. Any target table carrying it is the live API's. */
  apiId?: string
}

/** Every `defineData` model (`amplify/data/resource.ts`). */
export const LIVE_MODELS = ["Activity", "Profile", "SkillState", "XpLedgerEntry", "Landmark", "DeploySmokeTest"] as const

/** The literal CDK table names `amplify/backend.ts` states. */
export const LIVE_CDK_TABLES = [
  EXPLORED_CELL_TABLE,
  "LostSolesIngestReceipt",
  "LostSolesSourceAccount",
  "LostSolesOAuthState",
  "LostSolesCaptureGuard",
] as const

/** The live names, from `amplify_outputs.json`. The apiId is read off `custom.activityTableName`. */
export function liveNamesFromOutputs(outputs: {
  storage?: { bucket_name?: string }
  custom?: { activityTableName?: string }
}): LiveNames {
  const bucket = outputs.storage?.bucket_name
  if (!bucket) throw new Error("amplify_outputs.json has no storage.bucket_name: cannot tell what is live")
  const m = /^Activity-([a-z0-9]+)-NONE$/.exec(outputs.custom?.activityTableName ?? "")
  if (!m) throw new Error("amplify_outputs.json has no custom.activityTableName: cannot tell which tables are live")
  const apiId = m[1]!
  return { bucket, apiId, tables: [...LIVE_MODELS.map((model) => `${model}-${apiId}-NONE`), ...LIVE_CDK_TABLES] }
}

/** The target's table roles, in the order a refusal lists them. */
export const TARGET_TABLE_ROLES = ["activity", "ledger", "skillState", "profile", "exploredCell", "landmark"] as const satisfies ReadonlyArray<
  keyof DrillTarget["tables"]
>

/** Top-level prefixes the live bucket keeps its state under. A staging prefix may not start with one. */
const LIVE_KEY_ROOTS = ["raw/", "users/", "snapshots/"]

/**
 * Criterion 1. Every way the target could land on the live stack, as a list; empty means safe.
 * Pure, so the refusal is tested without a client in sight.
 */
export function targetCollisions(target: DrillTarget, live: LiveNames): string[] {
  const out: string[] = []
  const liveTables = new Set(live.tables)
  const seen = new Map<string, string>()
  // Every role, not `Object.entries`: a target file that omits one (a pre-`0302` file with no
  // `landmark`) is refused, rather than letting that step write to `undefined`.
  for (const role of TARGET_TABLE_ROLES) {
    const name = target.tables[role]
    if (!name) out.push(`target ${role} table is empty`)
    else if (liveTables.has(name)) out.push(`target ${role} table "${name}" is a live table`)
    else if (live.apiId && name.includes(live.apiId)) out.push(`target ${role} table "${name}" belongs to the live API ${live.apiId}`)
    const other = seen.get(name)
    if (other !== undefined) out.push(`target ${role} and ${other} tables are both "${name}"`)
    seen.set(name, role)
  }
  if (!target.bucket) out.push("target bucket is empty")
  if (target.prefix !== "" && !target.prefix.endsWith("/")) out.push(`target prefix "${target.prefix}" must end with "/"`)
  if (target.bucket === live.bucket) {
    if (target.prefix === "") {
      out.push(`target bucket "${target.bucket}" is the live bucket and no prefix separates the rebuild from it`)
    } else if (LIVE_KEY_ROOTS.some((root) => target.prefix.startsWith(root))) {
      out.push(`target prefix "${target.prefix}" is inside the live bucket's own key space`)
    }
  }
  return out
}

// ─── The store ──────────────────────────────────────────────────────────────

export interface ObjectMeta {
  contentType: string
  cacheControl: string
  /** Set exactly where the live writer sets it: everything but `manifest.json` is gzip-encoded. */
  contentEncoding?: "gzip"
}

/**
 * THE TARGET, AS THE BACK HALF SEES IT. Narrow, so the orchestration is tested against a map
 * (`rebuild-drill-back.test.ts`) and the DynamoDB/S3 shapes on their own (`rebuild-drill-store.ts`).
 *
 * There are no removal methods, and every create is conditioned on the item or object not
 * existing: a target that is not empty refuses the drill at its first write.
 */
export interface DrillStore {
  /** `key` is canonical; the store applies the target prefix. */
  putObject(key: string, body: Uint8Array, meta: ObjectMeta): Promise<void>
  /** Step 5's read-back. `undefined` when there is no such object. */
  getObject(key: string): Promise<Uint8Array | undefined>
  putActivity(item: Item): Promise<void>
  /** T6 cell and AGG items, created. */
  putCellItems(items: readonly Item[]): Promise<void>
  putLedger(entries: readonly XpLedgerEntry[]): Promise<void>
  writeActivityScores(rows: readonly ActivityScoreWrite[], at: string): Promise<void>
  writeSkillStates(userId: string, rows: readonly SkillStateWrite[], at: string): Promise<void>
  putProfile(
    userId: string,
    totals: { totalXp: number; totalLevel: number; ledgerRulesVersion: number },
    at: string,
  ): Promise<void>
  /** Step 6's landmark backfill (`0302`, D-307): each created, conditioned on absence. */
  putLandmarks(records: readonly LandmarkRecord[], at: string): Promise<void>
  /** T6's generation counter, set to exactly `generation`. `false` when it already stood at or above. */
  raiseGeneration(userId: string, generation: number): Promise<boolean>
  /** `Profile.exploredGeneration`, after the manifest (the mirror follows the commit point). */
  mirrorGeneration(userId: string, generation: number): Promise<void>
  /** Step 8, strongly consistent, by key. */
  readSkillStates(
    userId: string,
    skillIds: readonly string[],
  ): Promise<Array<{ skillId: string; displayedXp: number; xpLedgerSum: number }>>
  readLedger(ids: readonly string[]): Promise<Array<{ id: string; skillId: string; xpAwarded: number }>>
}

// ─── Aborts and the step-8 table ────────────────────────────────────────────

export type AbortReason =
  | "TARGET_IS_LIVE"
  | "FRONT_HALF_INCOMPLETE"
  | "CELLS_FILE_UNREADABLE"
  | "ASSERT_3_CELL_COUNT"
  | "GENERATION_NOT_ADVANCING"
  | "TARGET_GENERATION_TAKEN"

/** A stop. Nothing after the throwing step runs; in particular no manifest is written. */
export class DrillAbort extends Error {
  constructor(
    readonly reason: AbortReason,
    detail: string,
    /** The step-8 row this abort decided, when it was one (assertion 3). */
    readonly check?: Step8Check,
  ) {
    super(`${reason}: ${detail}`)
    this.name = "DrillAbort"
  }
}

export const CHECK_REASONS = {
  1: "ASSERT_1_NORMALIZE_FAILURES",
  2: "ASSERT_2_ACTIVITY_COUNT",
  3: "ASSERT_3_CELL_COUNT",
  4: "ASSERT_4_DISPLAYED_XP_FELL",
  5: "ASSERT_5_LEDGER_SUM",
  6: "ASSERT_6_SPOT_CHECK",
} as const

export type CheckN = keyof typeof CHECK_REASONS

export interface Step8Check {
  n: CheckN
  name: string
  /** `n/a` passes: check 6 under a changed ruleset, where the pre-drill rows price another version. */
  status: "pass" | "fail" | "n/a"
  /** `CHECK_REASONS[n]`. The CLI's exit reason when this is the first failure. */
  reason: string
  detail: string
}

/** The CLI's exit code for a failed check: 10 + n. Assertion 3 aborts, so it exits 13 from the abort. */
export const exitCodeForCheck = (n: CheckN): number => 10 + n

// ─── Step 4: persist facts ──────────────────────────────────────────────────

export interface PersistedActivity {
  /** As written to T3 — `traceRef` set when a route was written — plus T3's `status`. */
  activity: ReplayActivity
  trace?: Trace
  geometry: RouteTraceGeometry | null
  /** The per-run cells file was written (the projection ran and kept at least one cell). */
  cellsWritten: boolean
  rejects: TraceRejects
}

const gz = (b: Uint8Array | string) => gzipSync(typeof b === "string" ? Buffer.from(b, "utf8") : b)

/**
 * Step 4. In sorted order, per activity: route trace, cells file, T3 row — the row last, so it never
 * names an object that was not written (ingest's `traces`/`cells` before `persist`, for the same
 * reason). The projection runs only where the TARGET rules say the activity reveals ground (D-189),
 * exactly as `projectCells` gates it, at the current `fogAlgoVersion`.
 */
export async function persistFacts(
  entries: readonly DrillEntry[],
  rules: RuleSet,
  store: DrillStore,
): Promise<PersistedActivity[]> {
  const out: PersistedActivity[] = []
  for (const e of entries) {
    const base = e.activity
    let geometry: RouteTraceGeometry | null = null
    let traceRef: string | null = null
    if (e.trace) {
      geometry = segmentsToGeometry(traceToSegments(e.trace).segments)
      if (geometry.coordinates.length > 0) {
        traceRef = routeTraceKey(base.userId, base.activityId)
        await store.putObject(traceRef, gz(JSON.stringify(geometry)), {
          contentType: "application/geo+json",
          contentEncoding: "gzip",
          cacheControl: "no-cache",
        })
      } else {
        geometry = null
      }
    }

    let cellsWritten = false
    let rejects: TraceRejects = NO_REJECTS
    if (e.trace && revealsGround(base, rules)) {
      const cells = traceToCells(e.trace)
      rejects = cells.rejects
      if (cells.size > 0) {
        const sorted = [...cells].map(cellToBig).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
        await store.putObject(objectKeys.runCells(base.userId, base.activityId), gz(encodeExploredBlob(sorted, 0)), {
          contentType: "application/octet-stream",
          contentEncoding: "gzip",
          cacheControl: "no-store",
        })
        cellsWritten = true
      }
    }

    const activity: ReplayActivity = { ...base, traceRef, status: "ACTIVE" }
    // No award yet — that is the fold's (step 6 writes it). `cellsRef` is known now, from the write.
    const item = activityItem({ ...base, traceRef }, undefined, rejects)
    item.cellsRef = cellsWritten ? objectKeys.runCells(base.userId, base.activityId) : null
    await store.putActivity(item)
    out.push({ activity, trace: e.trace, geometry, cellsWritten, rejects })
  }
  return out
}

// ─── Step 5: the fold ───────────────────────────────────────────────────────

/**
 * T6 as the fold implies it: one cell item per cell (`02` T6's attributes, exactly as
 * `explored-cells.ts` writes them), and one AGG item per parent at each of 6/7/8 counting the
 * children under it. Sorted by key, so the set is a pure function of the fold and two runs over
 * the same history serialise to the same bytes (criterion 2).
 */
export function t6Items(userId: string, cells: ReadonlyMap<H3Index, FoldedCell>): Item[] {
  const items: Item[] = []
  const agg = new Map<string, { exploredChildren: number; lastRunDay: number; res: number; parent: H3Index }>()
  for (const [cell, f] of cells) {
    const day = lastRunDay(f.lastRunAt)
    items.push({
      ...cellKey(userId, cell),
      firstRunAt: f.firstRunAt,
      firstRunId: f.firstRunId,
      lastRunAt: f.lastRunAt,
      lastRunId: f.lastRunId,
      lastRunDay: day,
      visitCount: f.visitCount,
      discoveryCount: f.discoveryCount,
    })
    for (const res of AGG_RESOLUTIONS) {
      const parent = cellToParent(cell, res)
      const k = `${res}|${parent}`
      const cur = agg.get(k)
      if (cur === undefined) agg.set(k, { exploredChildren: 1, lastRunDay: day, res, parent })
      else {
        cur.exploredChildren++
        cur.lastRunDay = Math.max(cur.lastRunDay, day)
      }
    }
  }
  for (const a of agg.values()) {
    items.push({
      pk: `U#${userId}#AGG#${a.res}`,
      sk: a.parent,
      totalChildren: totalChildren(a.res as (typeof AGG_RESOLUTIONS)[number]),
      exploredChildren: a.exploredChildren,
      lastRunDay: a.lastRunDay,
    })
  }
  const key = (i: Item) => `${String(i.pk)}\u0000${String(i.sk)}`
  return items.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0))
}

/** Check 3, as a value. `==` when the algorithm is unchanged, `≥` when it moved (D-020). */
export function cellCountCheck(rebuilt: number, step0: number, fogAlgoChanged: boolean): Step8Check {
  const ok = fogAlgoChanged ? rebuilt >= step0 : rebuilt === step0
  return {
    n: 3,
    name: "rebuilt cellCount vs step 0",
    status: ok ? "pass" : "fail",
    reason: CHECK_REASONS[3],
    detail: `${rebuilt} cells rebuilt, step 0 published ${step0} (${fogAlgoChanged ? "≥, fogAlgoVersion changed" : "==, fogAlgoVersion unchanged"})`,
  }
}

export interface FoldOutput {
  history: FoldedHistory
  check3: Step8Check
  t6ItemCount: number
}

/**
 * Step 5. Reads every cells file step 4 wrote, folds them in sorted order, and asserts check 3
 * BEFORE anything else is written — a lost cell stops the run here, ahead of T6, XP and the
 * manifest. Single-threaded: one fold, one map, one user (§8.3 step 3).
 */
export async function foldCells(
  userId: string,
  persisted: readonly PersistedActivity[],
  step0CellCount: number,
  fogAlgoChanged: boolean,
  store: DrillStore,
): Promise<FoldOutput> {
  const items: Array<{ activityId: string; startedAt: string; cells: H3Index[] }> = []
  for (const p of persisted) {
    const id = p.activity.activityId
    if (!p.cellsWritten) {
      items.push({ activityId: id, startedAt: p.activity.startedAt, cells: [] })
      continue
    }
    const key = objectKeys.runCells(userId, id)
    const bytes = await store.getObject(key)
    if (bytes === undefined) throw new DrillAbort("CELLS_FILE_UNREADABLE", `${key} was written in step 4 and is gone`)
    let cells: H3Index[]
    try {
      cells = decodeExploredBlob(gunzipSync(bytes)).cells.map(bigToCell)
    } catch (e) {
      throw new DrillAbort("CELLS_FILE_UNREADABLE", `${key} does not decode: ${(e as Error).message}`)
    }
    items.push({ activityId: id, startedAt: p.activity.startedAt, cells })
  }
  const history = foldHistory(items)
  const check3 = cellCountCheck(history.fold.cells.size, step0CellCount, fogAlgoChanged)
  if (check3.status === "fail") {
    throw new DrillAbort("ASSERT_3_CELL_COUNT", `${check3.detail}. Do not cut over (D-020).`, check3)
  }
  const t6 = t6Items(userId, history.fold.cells)
  await store.putCellItems(t6)
  return { history, check3, t6ItemCount: t6.length }
}

// ─── Step 6: replay XP ──────────────────────────────────────────────────────

export interface ReplayOutput {
  entries: XpLedgerEntry[]
  floors: XpLedgerEntry[]
  writes: SkillStateWrite[]
  totals: { totalXp: number; totalLevel: number }
}

/** The floors' run key: one drill per target generation, so its floor ids never meet a replay's. */
export const drillRunKey = (generation: number) => `DRILL-G${generation}`

/**
 * Step 6. `scoreHistory` over step 5's fold — the same function a rebalance scores with — then
 * `reconcile` against the SNAPSHOT's waterline (D-143, D-399). There is no `SkillState` read
 * anywhere in this function, and no store method that could make one: `prior` is empty because
 * the tables are new. Writes ledger, T3 scores, `classes.json`, T2 and T1's totals.
 */
export async function replayXp(args: {
  userId: string
  persisted: readonly PersistedActivity[]
  history: FoldedHistory
  rules: RuleSet
  snapshot: SkillStateSnapshot
  generation: number
  at: string
  store: DrillStore
}): Promise<ReplayOutput> {
  const { userId, rules, snapshot, store, at } = args
  if (snapshot.userId !== userId) throw new Error(`snapshot is ${snapshot.userId}'s, not ${userId}'s`)
  const byId = new Map(args.persisted.map((p) => [p.activity.activityId, p.activity] as const))
  const traces = new Map(args.persisted.map((p) => [p.activity.activityId, p.trace] as const))
  const waterline = waterlineOfSnapshot(snapshot)

  const { entries, scores, classes } = await scoreHistory(args.history, byId, rules, async (a) => traces.get(a.activityId))
  const floors = reconcile({
    userId,
    waterline,
    recomputed: xpBySkill(entries),
    existingFloors: new Map(),
    fromVersion: snapshot.rulesVersion,
    toVersion: rules.version,
    runKey: drillRunKey(args.generation),
    awardedAt: at,
  })
  const writes = thawWrites({
    xp: xpBySkill([...entries, ...floors]),
    waterline,
    prior: new Map(),
    to: rules,
    fromVersion: snapshot.rulesVersion,
    entries,
    byId,
  })
  const totals = profileTotals(writes, rules)

  await store.putLedger([...entries, ...floors])
  await store.writeActivityScores(scores, at)
  for (const { activityId, classes: k } of classes) {
    // Field for field what `writeRunClasses` serialises, so the object is byte-identical to ingest's.
    const body = JSON.stringify({ new: k.new, rearmed: k.rearmed, rearmedSince: k.rearmedSince, rearmSoon: k.rearmSoon })
    await store.putObject(objectKeys.runClasses(userId, activityId), gz(body), {
      contentType: "application/json",
      contentEncoding: "gzip",
      cacheControl: "no-store",
    })
  }
  await store.writeSkillStates(userId, writes, at)
  await store.putProfile(userId, { ...totals, ledgerRulesVersion: rules.version }, at)
  return { entries, floors, writes, totals }
}

/**
 * Step 6, last (`0302`, D-307): the landmark backfill against the REBUILT ledger and routes. The
 * same `backfillLandmarks` `tools/landmarks/backfill-landmarks.ts` runs over the live tables, so
 * under the same rules every landmark lands where it stood. Routes are read back from the target
 * (as step 5 reads its cells files back), and only for an activity whose XP crossed something.
 * Replay writes no landmarks (D-301): without this the rebuilt stack would have no cairns.
 */
export async function backfillTargetLandmarks(args: {
  userId: string
  persisted: readonly PersistedActivity[]
  replay: Pick<ReplayOutput, "entries" | "floors">
  rules: RuleSet
  at: string
  store: DrillStore
}): Promise<LandmarkRecord[]> {
  const { userId, store } = args
  const traceRefs = new Map(args.persisted.map((p) => [p.activity.activityId, p.activity.traceRef] as const))
  const records = await backfillLandmarks({
    userId,
    rows: [...args.replay.entries, ...args.replay.floors],
    curve: args.rules.curve,
    route: async (activityId) => {
      const key = traceRefs.get(activityId)
      if (!key) return null
      const bytes = await store.getObject(key)
      return bytes === undefined ? null : (JSON.parse(gunzipSync(bytes).toString("utf8")) as RouteTraceGeometry)
    },
  })
  await store.putLandmarks(records, args.at)
  return records
}

// ─── Step 7: the delivery layer ─────────────────────────────────────────────

/** Criterion 5, pure: a generation that does not move forward never reaches a PUT. */
export function assertGenerationAdvances(step0Generation: number, generation: number): void {
  if (!Number.isInteger(generation) || generation <= step0Generation) {
    throw new DrillAbort(
      "GENERATION_NOT_ADVANCING",
      `would publish generation ${generation} over step 0's ${step0Generation}. A generation that goes ` +
        "backwards leaves every cached client convinced it is already up to date.",
    )
  }
}

/**
 * Step 7. `generation = step0 + 1`, never 1. The target's counter is raised to it first — and a
 * counter that already stands there means the target is not empty, which aborts before any PUT.
 * Then the three blobs, the trace web, and `manifest.json` LAST: the manifest is the commit point
 * (§6.4), and nothing may be written after it but the Profile mirror, which follows it by design.
 *
 * No delta: the target has no chain, so `deltasFrom = generation` sends every cached client to
 * the full blob, which is the correct outcome for a client that has never seen this stack.
 */
export async function publishDelivery(args: {
  userId: string
  persisted: readonly PersistedActivity[]
  cells: ReadonlyMap<H3Index, FoldedCell>
  step0Generation: number
  at: string
  store: DrillStore
  /** Injectable only so criterion 5's test can make a run that would go backwards. */
  generation?: number
}): Promise<{ generation: number; cellCount: number; manifest: ExploredManifest; webRuns: number }> {
  const { userId, store } = args
  const generation = args.generation ?? args.step0Generation + 1
  assertGenerationAdvances(args.step0Generation, generation)
  if (!(await store.raiseGeneration(userId, generation))) {
    throw new DrillAbort(
      "TARGET_GENERATION_TAKEN",
      `the target's generation counter already stands at or above ${generation}: the target is not empty`,
    )
  }

  const rows = [...args.cells].map(([cell, f]) => ({ big: cellToBig(cell), day: lastRunDay(f.lastRunAt) }))
  rows.sort((a, b) => (a.big < b.big ? -1 : a.big > b.big ? 1 : 0))
  const big = rows.map((r) => r.big)
  const days = Uint16Array.from(rows.map((r) => r.day))
  const immutable = (contentType: string): ObjectMeta => ({
    contentType,
    contentEncoding: "gzip",
    cacheControl: IMMUTABLE_CACHE_CONTROL,
  })

  await store.putObject(objectKeys.cells(userId, generation), gz(encodeExploredBlob(big, generation)), immutable("application/octet-stream"))
  await store.putObject(objectKeys.lastRun(userId, generation), gz(encodeLastRunBlob(days, generation)), immutable("application/octet-stream"))
  await store.putObject(objectKeys.agg(userId, generation), gz(JSON.stringify(computeAgg(big, generation))), immutable("application/json"))

  // D-299, D-307: the trace web, from the same routes step 4 wrote. An absent web reads as an
  // empty one (D-306), so forgetting it would fail silently.
  const runs: Record<string, TraceWebRun> = {}
  for (const p of args.persisted) {
    if (!p.geometry || !p.activity.traceRef) continue
    const run = webRunFrom(p.activity.startedAt, p.geometry)
    if (run.lines.length > 0) runs[p.activity.activityId] = run
  }
  await store.putObject(traceWebKey(userId), encodeTraceWeb({ v: 1, runs }), {
    contentType: "application/json",
    contentEncoding: "gzip",
    cacheControl: "no-cache",
  })

  const manifest: ExploredManifest = {
    generation,
    res: RES,
    cellCount: big.length,
    updatedAt: args.at,
    cells: objectKeys.cells(userId, generation),
    agg: objectKeys.agg(userId, generation),
    lastRun: objectKeys.lastRun(userId, generation),
    deltasFrom: generation,
  }
  // Uncompressed, as `regenerateExplored` writes it: the one mutable object, read on every load.
  await store.putObject(objectKeys.manifest(userId), Buffer.from(JSON.stringify(manifest, null, 2)), {
    contentType: "application/json",
    cacheControl: MANIFEST_CACHE_CONTROL,
  })
  await store.mirrorGeneration(userId, generation)
  return { generation, cellCount: big.length, manifest, webRuns: Object.keys(runs).length }
}

// ─── Step 8: verify ─────────────────────────────────────────────────────────

/** The pre-drill itemisation of one activity: its live T4 rows, read-only (`existingEntries`). */
export interface SpotCheck {
  activityId: string
  expected: ReadonlyArray<Pick<XpLedgerEntry, "id" | "xpAwarded" | "xpRulesVersion" | "reason" | "units">>
}

const itemisation = (rows: SpotCheck["expected"]) =>
  rows
    .map((r) => `${r.id}|${r.reason}|${r.units}|${r.xpAwarded}|v${r.xpRulesVersion}`)
    .sort()
    .join("\n")

/**
 * Step 8. The six, in order. Checks 4 and 5 read the TARGET back — strongly consistent, by key —
 * rather than trusting what step 6 meant to write; a write the table did not keep is the thing
 * they exist to catch. Check 3 arrives already decided (step 5 aborts on it).
 */
export async function verify(args: {
  userId: string
  front: FrontHalf
  activitiesWritten: number
  check3: Step8Check
  snapshot: SkillStateSnapshot
  replay: ReplayOutput
  rulesVersion: number
  spotCheck?: SpotCheck
  store: DrillStore
}): Promise<Step8Check[]> {
  const { front, replay, store, snapshot } = args
  const s = front.summary
  const checks: Step8Check[] = []
  const add = (n: CheckN, name: string, ok: boolean | "n/a", detail: string) =>
    checks.push({ n, name, status: ok === "n/a" ? "n/a" : ok ? "pass" : "fail", reason: CHECK_REASONS[n], detail })

  const failures = s.normalizeFailures ?? 0
  add(1, "normalize() failures == 0", failures === 0, `${failures} failures`)

  const expected = s.payloadCount - (s.supersededObjects ?? 0) - s.duplicatePointerCount
  add(
    2,
    "activities == payloads − superseded − duplicates",
    args.activitiesWritten === expected,
    `${args.activitiesWritten} written; ${s.payloadCount} payloads − ${s.supersededObjects ?? 0} superseded − ` +
      `${s.duplicatePointerCount} duplicate pointers = ${expected}`,
  )

  checks.push(args.check3)

  const skillIds = [...new Set([...snapshot.skills.map((k) => k.skillId), ...replay.writes.map((w) => w.skillId)])].sort()
  const states = new Map((await store.readSkillStates(args.userId, skillIds)).map((r) => [r.skillId, r] as const))
  const fell = snapshot.skills
    .filter((k) => (states.get(k.skillId)?.displayedXp ?? 0) < k.displayedXp)
    .map((k) => `${k.skillId} ${k.displayedXp} → ${states.get(k.skillId)?.displayedXp ?? "absent"}`)
  add(
    4,
    "every skill's displayedXp ≥ the snapshot's",
    fell.length === 0,
    fell.length === 0 ? `${snapshot.skills.length} skills at or above ${snapshot.takenAt}'s snapshot` : fell.join("; "),
  )

  const ids = [...replay.entries, ...replay.floors].map((e) => e.id)
  const ledger = await store.readLedger(ids)
  const sums = xpBySkill(ledger)
  const off: string[] = []
  if (ledger.length !== ids.length) off.push(`${ids.length - ledger.length} of ${ids.length} ledger rows missing`)
  for (const skillId of new Set([...sums.keys(), ...states.keys()])) {
    const sum = sums.get(skillId) ?? 0
    const state = states.get(skillId)
    if (state === undefined ? sum !== 0 : state.xpLedgerSum !== sum) {
      off.push(`${skillId}: Σ ledger ${sum}, xpLedgerSum ${state?.xpLedgerSum ?? "absent"}`)
    }
  }
  add(5, "Σ ledger xpAwarded == xpLedgerSum, per skill", off.length === 0, off.length === 0 ? `${ledger.length} rows over ${sums.size} skills` : off.join("; "))

  const spot = args.spotCheck
  if (spot === undefined || spot.expected.length === 0) {
    add(6, "spot-check itemisation", false, spot === undefined ? "no spot-check activity was given" : `${spot.activityId} has no pre-drill rows to compare`)
  } else {
    const versions = new Set(spot.expected.map((r) => r.xpRulesVersion))
    const rebuilt = replay.entries.filter((e) => e.activityId === spot.activityId)
    if (versions.size !== 1 || !versions.has(args.rulesVersion)) {
      add(6, "spot-check itemisation", "n/a", `${spot.activityId}'s pre-drill rows price v${[...versions].join("/v")}; the rebuild is v${args.rulesVersion}`)
    } else {
      const same = itemisation(rebuilt) === itemisation(spot.expected)
      add(
        6,
        "spot-check itemisation",
        same,
        same
          ? `${spot.activityId}: ${rebuilt.length} rows match`
          : `${spot.activityId}: pre-drill [${itemisation(spot.expected).replace(/\n/g, ", ")}] vs rebuilt [${itemisation(rebuilt).replace(/\n/g, ", ")}]`,
      )
    }
  }
  return checks
}

// ─── The run ────────────────────────────────────────────────────────────────

export interface BackHalfOptions {
  target: DrillTarget
  live: LiveNames
  store: DrillStore
  /** The TARGET `xpRulesVersion`'s ruleset. */
  rules: RuleSet
  /** True when the projection's algorithm moved since step 0, so check 3 is `≥` (D-020). */
  fogAlgoChanged?: boolean
  spotCheck?: SpotCheck
  now?: () => Date
  log?: (line: string) => void
}

export interface BackHalfSummary {
  target: DrillTarget
  rulesVersion: number
  fogAlgoVersion: number
  duplicatesDropped: number
  activitiesWritten: number
  tracesWritten: number
  cellsFilesWritten: number
  t6Items: number
  cellCount: number | null
  ledgerRows: number
  floors: Array<{ skillId: string; xpAwarded: number }>
  skillStates: number
  totalXp: number | null
  totalLevel: number | null
  /** Step 6's landmark backfill (`0302`): rows written, and how many stand on a route. */
  landmarks: { written: number; placed: number } | null
  generation: number | null
  step8: Step8Check[]
  /** The first failure's reason, or the abort's; `null` when the drill passed and may be cut over. */
  failed: { reason: string; detail: string; exitCode: number } | null
}

/**
 * Steps 4–8 over a completed front half. Refuses a live target before the first write; aborts on
 * check 3 and on a generation that would not advance; otherwise runs to the end and reports the
 * six. Never throws a `DrillAbort` — it lands in `failed` — so the caller always has a summary.
 */
export async function runDrillBackHalf(front: FrontHalf, o: BackHalfOptions): Promise<BackHalfSummary> {
  const log = o.log ?? (() => {})
  const at = (o.now ?? (() => new Date()))().toISOString()
  const userId = front.summary.userId
  const summary: BackHalfSummary = {
    target: o.target,
    rulesVersion: o.rules.version,
    fogAlgoVersion: FOG_ALGO_VERSION,
    duplicatesDropped: 0,
    activitiesWritten: 0,
    tracesWritten: 0,
    cellsFilesWritten: 0,
    t6Items: 0,
    cellCount: null,
    ledgerRows: 0,
    floors: [],
    skillStates: 0,
    totalXp: null,
    totalLevel: null,
    landmarks: null,
    generation: null,
    step8: [],
    failed: null,
  }
  const abort = (e: DrillAbort) => {
    if (e.check) summary.step8 = [e.check]
    summary.failed = { reason: e.reason, detail: e.message, exitCode: e.reason === "ASSERT_3_CELL_COUNT" ? exitCodeForCheck(3) : e.reason === "TARGET_IS_LIVE" ? 4 : 5 }
    return summary
  }

  try {
    const collisions = targetCollisions(o.target, o.live)
    if (collisions.length > 0) throw new DrillAbort("TARGET_IS_LIVE", collisions.join("; "))
    const step0 = front.summary.step0
    if (front.summary.refused || front.summary.phase !== "normalize" || step0 === null || front.snapshot === null) {
      throw new DrillAbort("FRONT_HALF_INCOMPLETE", "steps 4–8 need a normalize-phase front half that passed its preconditions")
    }

    const sorted = front.sorted.filter((e) => !front.duplicatePointers.has(e.activity.activityId))
    summary.duplicatesDropped = front.sorted.length - sorted.length

    // ── 4 ──
    const persisted = await persistFacts(sorted, o.rules, o.store)
    summary.activitiesWritten = persisted.length
    summary.tracesWritten = persisted.filter((p) => p.activity.traceRef).length
    summary.cellsFilesWritten = persisted.filter((p) => p.cellsWritten).length
    log(`step 4: ${persisted.length} activities, ${summary.tracesWritten} routes, ${summary.cellsFilesWritten} cells files`)

    // ── 5 ──
    const folded = await foldCells(userId, persisted, step0.cellCount, o.fogAlgoChanged ?? false, o.store)
    summary.t6Items = folded.t6ItemCount
    summary.cellCount = folded.history.fold.cells.size
    log(`step 5: ${summary.cellCount} cells folded (step 0: ${step0.cellCount}), ${folded.t6ItemCount} T6 items`)

    // ── 6 ──
    const generation = step0.generation + 1
    const replay = await replayXp({
      userId,
      persisted,
      history: folded.history,
      rules: o.rules,
      snapshot: front.snapshot,
      generation,
      at,
      store: o.store,
    })
    summary.ledgerRows = replay.entries.length + replay.floors.length
    summary.floors = replay.floors.map((f) => ({ skillId: f.skillId, xpAwarded: f.xpAwarded }))
    summary.skillStates = replay.writes.length
    summary.totalXp = replay.totals.totalXp
    summary.totalLevel = replay.totals.totalLevel
    log(`step 6: ${replay.entries.length} rows, ${replay.floors.length} floors, Total Level ${replay.totals.totalLevel}`)
    const landmarks = await backfillTargetLandmarks({ userId, persisted, replay, rules: o.rules, at, store: o.store })
    summary.landmarks = { written: landmarks.length, placed: landmarks.filter((l) => l.lng !== null).length }
    log(`step 6: ${landmarks.length} landmarks backfilled, ${summary.landmarks.placed} on a route`)

    // ── 7 ──
    const published = await publishDelivery({
      userId,
      persisted,
      cells: folded.history.fold.cells,
      step0Generation: step0.generation,
      at,
      store: o.store,
    })
    summary.generation = published.generation
    log(`step 7: generation ${published.generation} (step 0: ${step0.generation}), ${published.webRuns} routes in the web`)

    // ── 8 ──
    summary.step8 = await verify({
      userId,
      front,
      activitiesWritten: persisted.length,
      check3: folded.check3,
      snapshot: front.snapshot,
      replay,
      rulesVersion: o.rules.version,
      spotCheck: o.spotCheck,
      store: o.store,
    })
    const first = summary.step8.find((c) => c.status === "fail")
    if (first) summary.failed = { reason: first.reason, detail: first.detail, exitCode: exitCodeForCheck(first.n) }
    return summary
  } catch (e) {
    if (e instanceof DrillAbort) return abort(e)
    throw e
  }
}
