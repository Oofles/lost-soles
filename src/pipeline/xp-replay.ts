import type { H3Index } from "h3-js"

import type { Activity, Trace } from "@/src/domain/activity"
import { NO_CELLS, type ClassifiedCell, type DiscoveryAward } from "@/src/domain/discovery"
import { traceToSegments } from "@/src/domain/fog"
import { foldActivities, type FoldedCell } from "@/src/domain/fold"
import { revealsGround } from "@/src/rules/reveals-ground"
import type { RuleSet } from "@/src/rules/schema"
import {
  groundSplit,
  levelForXp,
  lookupFromClassified,
  ratchetLevel,
  reconcile,
  scoreActivity,
  sumXp,
  waterlineOf,
  xpBySkill,
  type ShownState,
  type Waterline,
  type XpLedgerEntry,
} from "@/src/scoring"

import { lastRunDay } from "./explored-cells"
import { buildSnapshot, waterlineOfSnapshot, type SkillStateSnapshot } from "./skillstate-snapshot"
import { ledgerRulesVersion } from "./worker-rules"

/**
 * THE XP REPLAY — A REBALANCE. Ticket `0066`. `02-data-model.md` §4.4–§4.6; D-135, D-142,
 * I-14–I-17.
 *
 * A rebalance is: write `rules/xp-rules-v<N>.yaml`, then run this for each user
 * (`tools/xp-replay/`). **Per user, one at a time** (D-014): a partial failure is one person's,
 * and resumable.
 *
 * ```
 * 0 PRE-FLIGHT  waterline from SkillState — or, when T2 is empty, from the newest
 *               snapshots/skillstate/ object (D-143) — written to S3 as a snapshot, then into
 *               ReplayRun (status RUNNING)
 * 1 FREEZE      Profile.replayInProgress = true, then wait REPLAY_DRAIN_MS (`0223`)
 * 2 CLEAR       delete every T4 row with isFloor = false. Floors, ReplayRuns and the rows of
 *               TOMBSTONED activities survive.
 * 3 REPLAY      fold cells.bin in (startedAt, activityId) order; score each ACTIVE activity,
 *               and rewrite its T3 row's copy of that score and its award (`0224`, `0226`)
 * 4 REBUILD     merge the fold into T6 (monotone), publish the blobs — ONE generation bump
 * 5 RECONCILE   floors for any shortfall against the waterline. The only step that adds rows.
 * 6 THAW        SkillState + Profile totals; clear the flag; ReplayRun → DONE (the chronicle entry)
 * ```
 *
 * ─── RESUMABLE BY CONSTRUCTION, NOT BY CHECKPOINT ───────────────────────────
 *
 * Nothing in steps 1–5 depends on how far a previous attempt got. Step 0 finds an unfinished
 * `ReplayRun` for the same target version and **reuses its waterline** — SkillState is untouched
 * until step 6, but a crash inside step 6 would otherwise let a half-thawed row become the
 * waterline. Step 2 then clears whatever a dead attempt wrote, step 3 rewrites the same
 * deterministic ids, and step 5 finds any floor the dead attempt already wrote among the
 * surviving floors and computes a gap of zero. Killed anywhere, re-run, same final state.
 *
 * ─── WHAT IT DELIBERATELY READS, AND WHAT IT DOES NOT ───────────────────────
 *
 * Ground is classified by folding `cells/<activityId>.bin` — the per-run facts — never by reading
 * `ExploredCell`, which is a cache of this very fold (§4.4 step 3b). The path metres come from the
 * archived raw bytes through the shipped normalizer (`loadTrace`), not from the 6-dp route GeoJSON:
 * a split computed from rounded coordinates would score the same run differently from ingest, and
 * a v1 → v1 replay would then not be the no-op it must be.
 *
 * Tombstoned activities are FOLDED but not SCORED. Their cells stay revealed (D-020), so later
 * activities must classify against them. Their XP is not re-derived either: §4.7 says their ledger
 * rows are *kept*, so step 2 leaves them where they are, under the version that awarded them.
 */

/** `ReplayRun` rows share T4 with the ledger (§4.5). Their `activityId`, so a sweep can skip them. */
export const REPLAY_ACTIVITY_ID = "__replay__"
/** Sorts before every activity row in GSI2, so the audit rows are cheap to find. */
export const REPLAY_SEQ_PREFIX = "0000-00-00T00:00:00Z#__replay__#"

export type ReplayStatus = "RUNNING" | "DONE" | "FAILED"

/** §4.5. Retained for ever; ~3 in five years. The DONE row is the chronicle's entry (D-258). */
export interface ReplayRunRecord {
  /** `REPLAY#<userId>#<sortable id>` */
  id: string
  userId: string
  fromRulesVersion: number
  toRulesVersion: number
  startedAt: string
  finishedAt?: string
  status: ReplayStatus
  /** Step 0. What the user had been shown. */
  waterline: Waterline
  /** Step 3. What the new rules say, before any floor. */
  recomputed?: Waterline
  /** Step 5. Per skill, the XP retained by this run's floor rows. */
  floorsWritten?: Record<string, number>
  /** The generation step 4 published. */
  generation?: number
  /** Set on FAILED. */
  error?: string
}

/** An activity as the replay reads it off T3: the contract `Activity` plus T3's `status`. */
export type ReplayActivity = Activity & { status: string }

/** A T2 row as the replay reads and writes it. */
export interface StoredSkillState extends ShownState {
  xpLedgerSum: number
  firstSeenRulesVersion?: number
  firstXpAt?: string
  lastXpAt?: string
  rulesVersionLastComputed?: number
}

/** Everything step 6 writes to one T2 row. */
export interface SkillStateWrite {
  skillId: string
  /** `xpLedgerSum` and `displayedXp` both — equal by construction (I-15). */
  xp: number
  level: number
  levelHighWater: number
  rulesVersion: number
  firstXpAt?: string
  lastXpAt?: string
  /** For a row this replay creates (D-146): the registry row's `introducedIn`. */
  introducedIn: number
  firstSeenAt?: string
}

/**
 * `0224`. What step 3 writes back to one ACTIVE activity's T3 row: the row's denormalised copy of
 * the ledger (`0062`), which the activity list and `/run/:id` read. Same rule as ingest's
 * `LedgerCommit`: `xpRulesVersion` is the ruleset the rows cite, `null` when the activity earned
 * nothing — so a v1 → v1 replay leaves the row exactly as ingest wrote it.
 */
export interface ActivityScoreWrite {
  activityId: string
  xpAwarded: number
  xpRulesVersion: number | null
  /**
   * `0226`, D-261. The fold's discovery award, for an activity the replay scored with cells.
   * Absent for one it did not (no cells, or not a ground-revealing kind): its T3 award is left
   * exactly as ingest wrote it. Present, it replaces §3.4's provisional award — the fold decides
   * every cell, so `deferredCellCount` comes back 0 and the row stops being provisional.
   */
  award?: DiscoveryAward
}

/**
 * THE STORE. Narrow, so the orchestration is tested against a map and the DynamoDB/S3 shapes are
 * tested on their own (`xp-replay-store.ts`) and on the real tables (the ticket's smoke test).
 */
export interface ReplayStore {
  /** The newest run for this user whose status is not `DONE`, if any. */
  findUnfinishedRun(userId: string): Promise<ReplayRunRecord | undefined>
  putRun(run: ReplayRunRecord): Promise<void>
  updateRun(run: ReplayRunRecord): Promise<void>

  readSkillStates(userId: string): Promise<StoredSkillState[]>

  /**
   * Step 0, `0067`. The newest `snapshots/skillstate/` object — the D-135 waterline when T2 is
   * empty (a table rebuild, a region move, the drill). `undefined` when none was ever written.
   */
  latestSnapshot(userId: string): Promise<SkillStateSnapshot | undefined>
  /** Step 0, `0067`. Immutable; returns the key. */
  writeSnapshot(snapshot: SkillStateSnapshot): Promise<string>
  /** The published explored-map generation (`manifest.json`); 0 before the first publish. */
  currentGeneration(userId: string): Promise<number>
  writeSkillStates(userId: string, rows: readonly SkillStateWrite[], at: string): Promise<void>

  /** Step 1. Creates the T1 row if there is none. */
  freeze(userId: string, at: string): Promise<void>
  /**
   * Step 6. Totals, the flag and `ledgerRulesVersion` in one write. The version is what an ingest
   * commit is conditioned on (`0235`, D-275): one scored before this replay cannot land after it.
   */
  thaw(
    userId: string,
    totals: { totalXp: number; totalLevel: number; ledgerRulesVersion: number },
    at: string,
  ): Promise<void>

  /** Every T4 row for the user (GSI2), floors and ReplayRuns included. */
  listLedger(userId: string): Promise<XpLedgerEntry[]>
  deleteLedger(ids: readonly string[]): Promise<void>
  /**
   * Rule-derived rows: an unconditional put, because the ids are deterministic and the value is a
   * pure function of the same inputs — overwriting a row a dead attempt wrote is the idempotency.
   * Floor rows: `attribute_not_exists(id)`, always. A floor is never overwritten.
   */
  putLedger(entries: readonly XpLedgerEntry[]): Promise<void>

  /**
   * Step 3, `0224`. One update per row, touching only the score columns. An ACTIVE row only —
   * a tombstoned activity's row describes rows the replay kept as awarded (D-258), and the table
   * refuses the write rather than trusting the caller to have filtered.
   */
  writeActivityScores(userId: string, rows: readonly ActivityScoreWrite[], at: string): Promise<void>

  /** T3 GSI1 `byUserAndStart`, every status. Order does not matter — the fold sorts. */
  listActivities(userId: string): Promise<ReplayActivity[]>
  /** `users/<uid>/cells/<activityId>.bin`, or `undefined` when the activity never projected. */
  readRunCells(userId: string, activityId: string): Promise<H3Index[] | undefined>
  /** The trace, from the S3 archive through the shipped normalizer. Throws when it cannot. */
  loadTrace(activity: ReplayActivity): Promise<Trace | undefined>

  /**
   * Step 4. Merge the folded cells into T6 without lowering anything: `firstRunAt` by `min`,
   * `lastRunAt` by `max`, the counts by `max`. Returns the cells T6 did not hold at all.
   */
  mergeCells(userId: string, cells: ReadonlyMap<H3Index, FoldedCell>): Promise<{ created: H3Index[]; updated: number }>
  /** Step 4, last. Publishes a new generation — exactly one bump. */
  publish(userId: string, created: readonly H3Index[], day: number): Promise<number>
}

export interface ReplayDeps {
  store: ReplayStore
  /** Any ruleset by version. The from-version's curve prices the waterline's levels. */
  rules(version: number): RuleSet
  now?: () => Date
  /** A sortable unique id for the ReplayRun. Injected for deterministic tests. */
  newId?: () => string
  /** Step 1's drain. Injected so tests do not wait a minute. */
  sleep?: (ms: number) => Promise<void>
  log?: (line: string) => void
}

export interface ReplayResult {
  run: ReplayRunRecord
  resumed: boolean
  deleted: number
  written: number
  floors: XpLedgerEntry[]
}

const ACTIVE = "ACTIVE"

/**
 * STEP 1's DRAIN. `0223`, D-273.
 *
 * From the freeze on, ingest cannot commit XP: the `Update Profile` item in its transaction is
 * conditioned on the flag (`xp-ledger.ts` `profileTotalsItem`), so the check is atomic with the
 * write and no in-flight worker can slip past it. What the condition cannot cover is a commit that
 * landed JUST BEFORE the freeze: step 2 reads T3 and T4 through GSIs, which are eventually
 * consistent, and a row not yet visible there is either deleted without being re-scored or left
 * beside the replay's own. GSI propagation is normally under a second; a minute is the margin.
 */
export const REPLAY_DRAIN_MS = 60_000

/** Time-sortable and unique enough for ~3 rows per user per five years. */
function sortableId(now: Date): string {
  const rand = Math.floor(Math.random() * 36 ** 6).toString(36).padStart(6, "0")
  return `${now.getTime().toString(36).padStart(9, "0")}${rand}`.toUpperCase()
}

/** The run's own id tail, `REPLAY#<user>#<runKey>`. Its floors carry it (`floorId`, `0237`). */
export function replayRunKey(runId: string): string {
  return runId.split("#").pop()!
}

/** The version SkillState was last computed under; `to` for a user with no XP yet. */
function fromVersionOf(states: readonly StoredSkillState[], to: number): number {
  // The same reading the ingest worker takes (`0234`), so the two cannot disagree.
  return ledgerRulesVersion(states) ?? to
}

export async function replayUser(userId: string, toVersion: number, deps: ReplayDeps): Promise<ReplayResult> {
  const { store } = deps
  const now = deps.now ?? (() => new Date())
  const log = deps.log ?? (() => {})
  const to = deps.rules(toVersion)
  const at = () => now().toISOString()

  // ── 0. PRE-FLIGHT ──────────────────────────────────────────────────────────
  let run = await store.findUnfinishedRun(userId)
  const resumed = run !== undefined
  if (run !== undefined && run.toRulesVersion !== toVersion) {
    throw new Error(
      `replayUser: ${userId} has an unfinished replay to v${run.toRulesVersion} (${run.id}). ` +
        `Finish it before starting one to v${toVersion} — its waterline is the only record of what ` +
        "the user was shown.",
    )
  }
  if (run === undefined) {
    const states = await store.readSkillStates(userId)
    /**
     * T2 EMPTY IS NOT "NOTHING WAS SHOWN" (D-143). After a table rebuild it means the record of
     * what was shown lives only in S3, so the newest snapshot stands in for T2. A user who really
     * has never earned XP has no snapshot either, and the waterline is empty as before.
     */
    const restored = states.length === 0 ? await store.latestSnapshot(userId) : undefined
    const fromVersion = restored?.rulesVersion ?? fromVersionOf(states, toVersion)
    const from = deps.rules(fromVersion)
    const waterline = restored ? waterlineOfSnapshot(restored) : waterlineOf(states, from.curve)

    // The pre-flight snapshot, before anything is cleared. Fatal here, unlike ingest's: a
    // rebalance does not start without a durable record of what it must not lower.
    const preflight = await store.writeSnapshot(
      buildSnapshot({
        userId,
        takenAt: at(),
        generation: await store.currentGeneration(userId),
        trigger: "replay-preflight",
        rules: from,
        rows: restored ? restored.skills : states,
      }),
    )
    run = {
      id: `REPLAY#${userId}#${(deps.newId ?? (() => sortableId(now())))()}`,
      userId,
      fromRulesVersion: fromVersion,
      toRulesVersion: toVersion,
      startedAt: at(),
      status: "RUNNING",
      waterline,
    }
    await store.putRun(run)
    log(
      `step 0: ${run.id} v${fromVersion} → v${toVersion}, waterline over ${Object.keys(run.waterline).length} skills ` +
        `(${restored ? `restored from ${restored.takenAt}` : "from SkillState"}); snapshot ${preflight}`,
    )
  } else {
    run = { ...run, status: "RUNNING", error: undefined }
    await store.updateRun(run)
    log(`step 0: resuming ${run.id}`)
  }

  try {
    // ── 1. FREEZE ────────────────────────────────────────────────────────────
    await store.freeze(userId, at())
    log(`step 1: frozen; draining ${REPLAY_DRAIN_MS / 1000}s for index propagation`)
    await (deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))))(REPLAY_DRAIN_MS)

    // ── 2. CLEAR ─────────────────────────────────────────────────────────────
    // A TOMBSTONED activity's rows are KEPT, not re-derived (§4.7): its XP stays in the total
    // exactly as awarded. Step 3 scores ACTIVE activities only (§4.4), so clearing those rows
    // would turn every tombstone into a floor — and a v1 → v1 replay into something other than
    // the no-op it must be.
    const activities = await store.listActivities(userId)
    const tombstoned = new Set(activities.filter((a) => a.status !== ACTIVE).map((a) => a.activityId))
    const before = await store.listLedger(userId)
    const doomed = before
      .filter((e) => !e.isFloor && e.activityId !== REPLAY_ACTIVITY_ID && !tombstoned.has(e.activityId))
      .map((e) => e.id)
    await store.deleteLedger(doomed)
    // Everything that survived step 2 and is not about to be re-derived: floors, and the kept
    // rows of tombstoned activities. Step 5 measures the shortfall on top of both.
    const survivors = xpBySkill(before.filter((e) => e.isFloor || tombstoned.has(e.activityId)))
    log(`step 2: deleted ${doomed.length} rows; ${before.filter((e) => e.isFloor).length} floor rows survive`)

    // ── 3. REPLAY ────────────────────────────────────────────────────────────
    const folded = await Promise.all(
      activities.map(async (a) => ({ a, cells: (await store.readRunCells(userId, a.activityId)) ?? [] })),
    )
    const byId = new Map(activities.map((a) => [a.activityId, a] as const))
    const classifiedBy = new Map<string, readonly ClassifiedCell[]>()
    const fold = foldActivities(
      folded.map(({ a, cells }) => ({ activityId: a.activityId, startedAt: a.startedAt, cells })),
      (id, classified) => classifiedBy.set(id, classified),
    )

    const entries: XpLedgerEntry[] = []
    const scores: ActivityScoreWrite[] = []
    for (const activityId of fold.order) {
      const activity = byId.get(activityId)!
      if (activity.status !== ACTIVE) continue
      const classified = classifiedBy.get(activityId) ?? []
      let award: DiscoveryAward = NO_CELLS
      let split = null
      const groundScored = classified.length > 0 && revealsGround(activity, to)
      if (groundScored) {
        award = fold.awards.get(activityId)!
        const trace = await store.loadTrace(activity)
        if (trace === undefined) {
          throw new Error(
            `replayUser: ${activityId} has projected cells but its trace could not be loaded. ` +
              "Refusing to score it as pathless — that would quietly change its XP.",
          )
        }
        split = groundSplit(traceToSegments(trace).segments, lookupFromClassified(classified))
      }
      const rows = scoreActivity(activity, to, split, award, activity.ingestedAt)
      entries.push(...rows)
      scores.push({
        activityId,
        xpAwarded: sumXp(rows),
        xpRulesVersion: rows.length > 0 ? toVersion : null,
        ...(groundScored ? { award } : {}),
      })
    }
    await store.putLedger(entries)
    // After the ledger, so T3 never shows a number the ledger does not hold yet. A crash between
    // the two is healed by the re-run, which writes the same values.
    await store.writeActivityScores(userId, scores, at())
    const recomputedXp = xpBySkill(entries)
    run = {
      ...run,
      recomputed: Object.fromEntries(
        [...recomputedXp].sort(([a], [b]) => (a < b ? -1 : 1)).map(([s, xp]) => [s, { xp, level: levelForXp(xp, to.curve) }]),
      ),
    }
    await store.updateRun(run)
    log(`step 3: ${fold.order.length} activities folded, ${entries.length} rows written, ${scores.length} T3 rows rescored`)

    // ── 4. REBUILD ───────────────────────────────────────────────────────────
    const { created, updated } = await store.mergeCells(userId, fold.cells)
    const newest = created.reduce((d, c) => Math.max(d, lastRunDay(fold.cells.get(c)!.lastRunAt)), 0)
    const generation = await store.publish(userId, created, newest)
    run = { ...run, generation }
    log(`step 4: T6 +${created.length} cells, ${updated} raised; published generation ${generation}`)

    // ── 5. RECONCILE ─────────────────────────────────────────────────────────
    const floors = reconcile({
      userId,
      waterline: run.waterline,
      recomputed: recomputedXp,
      existingFloors: survivors,
      fromVersion: run.fromRulesVersion,
      toVersion,
      runKey: replayRunKey(run.id),
      awardedAt: at(),
    })
    await store.putLedger(floors)
    run = { ...run, floorsWritten: Object.fromEntries(floors.map((f) => [f.skillId, f.xpAwarded])) }
    await store.updateRun(run)
    log(`step 5: ${floors.length} floor rows`)

    // ── 6. THAW ──────────────────────────────────────────────────────────────
    const ledger = await store.listLedger(userId)
    const xp = xpBySkill(ledger.filter((e) => e.activityId !== REPLAY_ACTIVITY_ID))
    const prior = new Map((await store.readSkillStates(userId)).map((s) => [s.skillId, s] as const))
    const introducedIn = new Map(to.skills.map((s) => [s.id, s.introducedIn] as const))
    const span = xpSpans(entries, byId)

    const writes: SkillStateWrite[] = []
    for (const skillId of [...new Set([...xp.keys(), ...Object.keys(run.waterline)])].sort()) {
      const total = xp.get(skillId) ?? 0
      const mark = run.waterline[skillId]
      // Unreachable while step 5 is right. Checked anyway: a THAW that lowered a number would be
      // the one bug this whole ticket exists to make impossible, so it refuses to write it.
      if (mark !== undefined && total < mark.xp) {
        throw new Error(`replayUser: ${skillId} would fall from ${mark.xp} to ${total} XP (D-135)`)
      }
      const level = levelForXp(total, to.curve)
      const was = prior.get(skillId)
      writes.push({
        skillId,
        xp: total,
        level,
        levelHighWater: ratchetLevel(mark?.level, level),
        rulesVersion: toVersion,
        firstXpAt: minOf(was?.firstXpAt, span.get(skillId)?.first),
        lastXpAt: maxOf(was?.lastXpAt, span.get(skillId)?.last),
        introducedIn: introducedIn.get(skillId) ?? run.fromRulesVersion,
        firstSeenAt: span.get(skillId)?.first,
      })
    }
    const thawedAt = at()
    await store.writeSkillStates(userId, writes, thawedAt)

    const shown = new Map(writes.map((w) => [w.skillId, w] as const))
    let totalXp = 0
    let totalLevel = 0
    for (const s of to.skills.filter((r) => r.enabled)) {
      const w = shown.get(s.id)
      totalXp += w?.xp ?? 0
      totalLevel += w ? Math.max(w.level, w.levelHighWater) : 1
    }
    await store.thaw(userId, { totalXp, totalLevel, ledgerRulesVersion: toVersion }, thawedAt)

    run = { ...run, status: "DONE", finishedAt: thawedAt }
    await store.updateRun(run)
    log(`step 6: ${writes.length} SkillState rows; Total Level ${totalLevel}, ${totalXp} XP. DONE.`)

    return { run, resumed, deleted: doomed.length, written: entries.length, floors }
  } catch (e) {
    // Best effort. The flag stays up and SkillState is untouched unless step 6 was reached, so
    // the UI keeps showing the pre-replay numbers until a re-run finishes the job.
    const failed: ReplayRunRecord = { ...run, status: "FAILED", error: String((e as Error)?.message ?? e) }
    await store.updateRun(failed).catch(() => {})
    throw e
  }
}

/** Per skill, the earliest and latest `startedAt` among the rows the replay wrote (I-12). */
function xpSpans(entries: readonly XpLedgerEntry[], byId: ReadonlyMap<string, ReplayActivity>) {
  const out = new Map<string, { first: string; last: string }>()
  for (const e of entries) {
    const at = byId.get(e.activityId)!.startedAt
    const cur = out.get(e.skillId)
    out.set(e.skillId, cur ? { first: minOf(cur.first, at)!, last: maxOf(cur.last, at)! } : { first: at, last: at })
  }
  return out
}

const minOf = (a?: string, b?: string) => (a === undefined ? b : b === undefined ? a : a < b ? a : b)
const maxOf = (a?: string, b?: string) => (a === undefined ? b : b === undefined ? a : a > b ? a : b)
