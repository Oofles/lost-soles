import { GetCommand, QueryCommand, TransactWriteCommand, type TransactWriteCommandInput } from "@aws-sdk/lib-dynamodb"
import type { H3Index } from "h3-js"

import type { Activity, Trace } from "@/src/domain/activity"
import { classifyCells } from "@/src/domain/discovery"
import { traceToCells } from "@/src/domain/fog"
import { revealsGround } from "@/src/rules/reveals-ground"
import { reconcile, scoreActivity, sumXp, xpBySkill, type XpLedgerEntry } from "@/src/scoring"

import { appendCellsToRun, regenerateExplored, type BlobStoreDeps } from "./explored-blob-store"
import {
  lastRunDay,
  readCells,
  writeAggregates,
  writeCells,
  type CellReadDeps,
  type CellWriteDeps,
} from "./explored-cells"
import {
  assertKnownKind,
  newKindOverrideId,
  recordKindOverride,
  type KindOverride,
  type KindOverrideDeps,
  type KindOverrideMirror,
} from "./kind-override"
import { assertNoCellWrites } from "./persist"
import type { Registry } from "./worker-rules"
import {
  BY_ACTIVITY_INDEX,
  ReplayInProgressError,
  ledgerPutItem,
  profileTotalsItem,
  readSkillStates,
  skillStateUpdateItem,
  type LedgerDeps,
} from "./xp-ledger"

/**
 * APPLY A KIND OVERRIDE AND RE-SCORE THAT ONE ACTIVITY. Ticket `0243`, D-284, D-285.
 *
 * ```
 * 1 REFUSE     an unknown kind, a missing / foreign / tombstoned activity — before any write
 * 2 RECORD     the immutable fact under raw/ (kind-override.ts). From here a re-sync honours it.
 * 3 CELLS      only if the new kind reveals ground and the old did not (D-284 c): written with
 *              firstRunAt = startedAt, outside the transaction, and NO discovery award
 * 4 RE-SCORE   D-142 for one activity: its non-floor rows out, the new kind's rows in, a
 *              retained_floor for any skill's shortfall. ONE transaction, with the T3 mirror.
 * ```
 *
 * ─── IF NO SKILL WOULD GAIN, NO XP IS WRITTEN ───────────────────────────────
 *
 * Floors make every re-score add-only, so a re-score in which nothing gains would only churn rows
 * into floors without changing a single number. That case writes the kind mirror and nothing in
 * the ledger, and says so. Walk → run under v2 is that case: both are Wayfaring.
 *
 * ─── GROUND IS RATED RECENT (D-285) ─────────────────────────────────────────
 *
 * The re-score passes no ground split, so a ground-scored skill rates the whole distance as recent
 * ground (`05` §3.6's no-projection rule). Classifying against the map as it stands now would judge
 * the run against a "before" that is not the one it was run into — the reason D-284 c awards no
 * discovery here. The next ruleset replay folds history in order and rates it properly.
 *
 * ─── THE CONCURRENCY GUARD ──────────────────────────────────────────────────
 *
 * The XP replay's `replayInProgress` flag, checked ATOMICALLY: the transaction carries the same
 * Profile item ingest's does (`profileTotalsItem`, conditioned on the flag and on
 * `ledgerRulesVersion`), or a `ConditionCheck` on it when no XP moves. So a re-score cannot land
 * between a replay's CLEAR and its THAW, and a replay that finishes between this function's
 * version read and its commit refuses it, exactly as it refuses an ingest (D-273, D-275).
 *
 * NOT D-278. That covers the SOURCE revising an activity, and it does not re-score. This is the
 * operator asserting a kind, which re-scores on purpose.
 */

export interface KindRescoreDeps {
  ddb: { send(command: GetCommand | QueryCommand | TransactWriteCommand): Promise<unknown> }
  activityTable: string
  ledger: Omit<LedgerDeps, "ddb">
  overrides: KindOverrideDeps
  /** The ruleset the user's ledger is on — the same resolver the worker uses (`0234`). */
  registry: Registry | ((userId: string) => Promise<Registry>)
  cells: CellWriteDeps & CellReadDeps
  blobs: BlobStoreDeps
  /** The trace, from the archive through the shipped normalizer — the bytes ingest scored. */
  loadTrace(activity: Activity): Promise<Trace | undefined>
  now?: () => Date
  rand?: () => number
}

export interface KindRescoreRequest {
  userId: string
  activityId: string
  kind: string
  /** Who asked. Audit only. */
  setBy: string
}

export type KindRescoreResult =
  | { outcome: "unchanged"; activityId: string; kind: string; message: string }
  | {
      outcome: "applied"
      activityId: string
      from: string
      to: string
      derivedKind: string
      /** The `raw/` object written. */
      key: string
      /** Cells revealed because the new kind opens the map and the old did not. `0` when none. */
      cellsRevealed: number
      /** `null`: no skill would gain, and nothing was written to the ledger. */
      xp: {
        gained: Record<string, number>
        floors: Record<string, number>
        rowsDeleted: number
        rowsWritten: number
      } | null
      message: string
    }

const ACTIVE = "ACTIVE"
const MAX_ATTEMPTS = 3
type TransactItems = NonNullable<TransactWriteCommandInput["TransactItems"]>

export async function rescoreKind(req: KindRescoreRequest, deps: KindRescoreDeps): Promise<KindRescoreResult> {
  const now = deps.now ?? (() => new Date())
  const registry = typeof deps.registry === "function" ? await deps.registry(req.userId) : deps.registry

  // ── 1. REFUSE ──────────────────────────────────────────────────────────────
  assertKnownKind(req.kind, registry)
  const kind = req.kind
  const row = await readRow(req.activityId, deps)
  if (!row) throw new Error(`rescoreKind: no activity ${req.activityId}`)
  if (row.userId !== req.userId) throw new Error(`rescoreKind: ${req.activityId} is not ${req.userId}'s`)
  if (row.status !== ACTIVE) {
    throw new Error(`rescoreKind: ${req.activityId} is ${String(row.status)}; a tombstoned activity's XP is kept as awarded (§4.7)`)
  }
  const activity = activityOf(row)
  const from = activity.kind
  const derivedKind = (row.derivedKind as Activity["kind"] | undefined) ?? from
  if (kind === from) {
    return { outcome: "unchanged", activityId: req.activityId, kind, message: `already ${kind}; nothing written` }
  }

  // ── 2. RECORD ──────────────────────────────────────────────────────────────
  const setAt = now().toISOString()
  const override: KindOverride = {
    id: newKindOverrideId(now(), deps.rand),
    activityId: activity.activityId,
    userId: activity.userId,
    source: activity.source.source,
    externalId: activity.source.externalId,
    derivedKind,
    kind,
    setBy: req.setBy,
    setAt,
  }
  const key = await recordKindOverride(override, deps.overrides)
  const mirror: KindOverrideMirror = { kind, derivedKind, setBy: req.setBy, setAt, key }

  // ── 3. CELLS (D-284 b, c) ──────────────────────────────────────────────────
  const before = activity
  const after: Activity = { ...activity, kind }
  let cellsRevealed = 0
  if (revealsGround(after, registry) && !revealsGround(before, registry)) {
    const trace = await deps.loadTrace(activity)
    if (trace) cellsRevealed = await revealWithoutAward(after, trace, deps)
  }

  // ── 4. RE-SCORE ────────────────────────────────────────────────────────────
  const award = { newCellCount: num(row.newCellCount), rearmedCellCount: num(row.rearmedCellCount) }
  const fresh = scoreActivity(after, registry, null, award, activity.ingestedAt)

  for (let attempt = 1; ; attempt += 1) {
    const old = await activityRows(activity.activityId, deps)
    const plan = planRescore({ old, fresh, userId: activity.userId, version: registry.version, runKey: `kind-${override.id}`, setAt })
    const states = plan ? await readSkillStates(activity.userId, { ddb: deps.ddb as never, ...deps.ledger }) : new Map()

    const t3 = t3Item({ activityId: activity.activityId, from, kind, derivedKind, mirror, setAt, plan, version: registry.version }, deps.activityTable)
    const ledgerOps = plan ? plan.ops.map((op) => opItem(op, deps.ledger.ledgerTable)) : []
    const skillOps = plan
      ? [...plan.gained].map(([skillId, xp]) =>
          skillStateUpdateItem(
            {
              userId: activity.userId,
              skillId,
              xp,
              prev: states.get(skillId),
              startedAt: activity.startedAt,
              ingestedAt: setAt,
              rulesVersion: registry.version,
              introducedIn: registry.skills.find((s) => s.id === skillId)?.introducedIn ?? registry.version,
              curve: registry.curve,
            },
            deps.ledger.skillStateTable,
          ),
        )
      : []
    const profile = plan
      ? profileTotalsItem(
          {
            userId: activity.userId,
            states,
            xpBySkill: plan.gained,
            skills: registry.skills,
            curve: registry.curve,
            ingestedAt: setAt,
            rulesVersion: registry.version,
          },
          deps.ledger.profileTable,
        )
      : replayGuard(activity.userId, registry.version, deps.ledger.profileTable)

    const items: TransactItems = [t3, ...ledgerOps, ...skillOps, profile]
    assertNoCellWrites(items)
    const firstSkillItem = 1 + ledgerOps.length
    try {
      await deps.ddb.send(new TransactWriteCommand({ TransactItems: items }))
    } catch (err) {
      const reasons = cancellation(err)
      if (reasons?.[items.length - 1] === "ConditionalCheckFailed") throw new ReplayInProgressError(activity.userId, registry.version)
      const lostRace =
        reasons !== undefined &&
        reasons.every((code, i) => code === "None" || (code === "ConditionalCheckFailed" && i >= firstSkillItem))
      if (lostRace && attempt < MAX_ATTEMPTS) continue
      throw err
    }

    const changed = `${derivedKind === from ? from : `${from} (derived ${derivedKind})`} → ${kind}`
    return {
      outcome: "applied",
      activityId: activity.activityId,
      from,
      to: kind,
      derivedKind,
      key,
      cellsRevealed,
      xp: plan
        ? {
            gained: Object.fromEntries(plan.gained),
            floors: Object.fromEntries(plan.floors.map((f) => [f.skillId, f.xpAwarded])),
            rowsDeleted: plan.ops.filter((o) => o.op === "delete").length,
            rowsWritten: plan.ops.filter((o) => o.op !== "delete").length,
          }
        : null,
      message: plan
        ? `${changed}: ${[...plan.gained].map(([s, x]) => `+${x} ${s}`).join(", ")}` +
          (plan.floors.length ? `; retained ${plan.floors.map((f) => `${f.xpAwarded} ${f.skillId}`).join(", ")}` : "")
        : `${changed}: no skill would gain, so no XP was written`,
    }
  }
}

/** One ledger write in the re-score. A row whose id survives is overwritten only if it changed. */
export type LedgerOp =
  | { op: "delete"; entry: XpLedgerEntry }
  | { op: "put"; entry: XpLedgerEntry }
  | { op: "replace"; entry: XpLedgerEntry; was: XpLedgerEntry }

export interface RescorePlan {
  ops: LedgerOp[]
  /** Per skill, the XP it rises by. Only positive entries. */
  gained: Map<string, number>
  floors: XpLedgerEntry[]
  /** Σ of the activity's rule-derived rows after the re-score — T3's `xpAwarded`. */
  activityXp: number
}

/**
 * PURE. D-142 for one activity: what the ledger must become, or `null` when no skill would gain.
 *
 * The floor is `reconcile`'s — the one function permitted to invent a ledger row — with the
 * activity's old per-skill sums as the waterline. A skill that lost XP keeps it as a floor, a skill
 * that gained gains in full, and the SkillState delta is therefore `max(0, new − old)` per skill.
 */
export function planRescore(input: {
  old: readonly XpLedgerEntry[]
  fresh: readonly XpLedgerEntry[]
  userId: string
  version: number
  runKey: string
  setAt: string
}): RescorePlan | null {
  const { old, fresh, userId, version, runKey, setAt } = input
  const oldBy = xpBySkill(old)
  const newBy = xpBySkill(fresh)
  const gained = new Map<string, number>()
  for (const [skillId, xp] of newBy) {
    const delta = xp - (oldBy.get(skillId) ?? 0)
    if (delta > 0) gained.set(skillId, delta)
  }
  if (gained.size === 0) return null

  const floors = reconcile({
    userId,
    waterline: Object.fromEntries([...oldBy].map(([s, xp]) => [s, { xp, level: 0 }])),
    recomputed: newBy,
    existingFloors: new Map(),
    fromVersion: old[0]?.xpRulesVersion ?? version,
    toVersion: version,
    runKey,
    awardedAt: setAt,
  })

  const freshById = new Map(fresh.map((e) => [e.id, e] as const))
  const oldById = new Map(old.map((e) => [e.id, e] as const))
  const ops: LedgerOp[] = []
  for (const e of old) {
    const next = freshById.get(e.id)
    if (!next) ops.push({ op: "delete", entry: e })
    else if (next.xpAwarded !== e.xpAwarded || next.units !== e.units || next.unitsEffective !== e.unitsEffective) {
      ops.push({ op: "replace", entry: next, was: e })
    }
  }
  for (const e of fresh) if (!oldById.has(e.id)) ops.push({ op: "put", entry: e })
  for (const f of floors) ops.push({ op: "put", entry: f })

  return { ops, gained, floors, activityXp: sumXp(fresh) }
}

function opItem(op: LedgerOp, table: string): TransactItems[number] {
  if (op.op === "delete") {
    // I-18 at the table, as the replay's delete: a floor row cannot be removed by this, whatever asked.
    return {
      Delete: {
        TableName: table,
        Key: { id: op.entry.id },
        ConditionExpression: "attribute_exists(id) AND isFloor = :f",
        ExpressionAttributeValues: { ":f": false },
      },
    }
  }
  const put = ledgerPutItem(op.entry, table)
  if (op.op === "put") return put
  return {
    Put: {
      ...put.Put!,
      ConditionExpression: "attribute_exists(id) AND isFloor = :f AND xpAwarded = :was",
      ExpressionAttributeValues: { ":f": false, ":was": op.was.xpAwarded },
    },
  }
}

/** The T3 mirror. Conditioned on the kind it was read with, so two overrides cannot interleave. */
function t3Item(
  a: {
    activityId: string
    from: string
    kind: string
    derivedKind: string
    mirror: KindOverrideMirror
    setAt: string
    plan: RescorePlan | null
    version: number
  },
  table: string,
): TransactItems[number] {
  const xp = a.plan ? ", xpAwarded = :xp, xpRulesVersion = :ver" : ""
  return {
    Update: {
      TableName: table,
      Key: { id: a.activityId },
      UpdateExpression: `SET kind = :kind, derivedKind = :derived, kindOverride = :mirror, updatedAt = :now${xp}`,
      ConditionExpression: "attribute_exists(id) AND kind = :from AND #status = :active",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: {
        ":kind": a.kind,
        ":derived": a.derivedKind,
        ":mirror": a.mirror,
        ":now": a.setAt,
        ":from": a.from,
        ":active": ACTIVE,
        ...(a.plan ? { ":xp": a.plan.activityXp, ":ver": a.plan.activityXp > 0 ? a.version : null } : {}),
      },
    },
  }
}

/** When no XP moves, the replay flag is still checked — a kind must not change under a replay's step 3. */
function replayGuard(userId: string, version: number, table: string): TransactItems[number] {
  return {
    ConditionCheck: {
      TableName: table,
      Key: { id: userId },
      ConditionExpression:
        "(attribute_not_exists(replayInProgress) OR replayInProgress = :thawed) AND " +
        "(attribute_not_exists(ledgerRulesVersion) OR ledgerRulesVersion = :ver)",
      ExpressionAttributeValues: { ":thawed": false, ":ver": version },
    },
  }
}

/**
 * D-284 c: THE CELLS OPEN, THE AWARD DOES NOT. `projectCells`'s steps 2–6 without its award and
 * without step 7's replay mark — a mark would have the next replay pay the discovery this refuses.
 * `writeCells` takes `firstRunAt` by `min` and `lastRunAt` by `max`, so a cell first revealed here
 * carries `startedAt`, and one already revealed keeps what it had (D-020).
 */
async function revealWithoutAward(activity: Activity, trace: Trace, deps: KindRescoreDeps): Promise<number> {
  const cells = traceToCells(trace)
  if (cells.size === 0) return 0
  const records = await readCells(cells, activity.userId, deps.cells)
  const { classified } = await writeCells(classifyCells(cells, records, activity.startedAt), activity, deps.cells)
  await writeAggregates(classified, activity, deps.cells)
  await appendCellsToRun(activity.userId, activity.activityId, cells as Iterable<H3Index>, deps.blobs)
  await regenerateExplored({ userId: activity.userId, touched: cells, day: lastRunDay(activity.startedAt) }, deps.blobs)
  return cells.size
}

async function readRow(activityId: string, deps: KindRescoreDeps): Promise<Record<string, unknown> | undefined> {
  const out = (await deps.ddb.send(
    new GetCommand({ TableName: deps.activityTable, Key: { id: activityId }, ConsistentRead: true }),
  )) as { Item?: Record<string, unknown> }
  return out.Item
}

/** T3 is the contract `Activity` stored flat, keyed by `id` (`persist.ts`). */
function activityOf(row: Record<string, unknown>): Activity {
  return { ...(row as unknown as Activity), activityId: String(row.id) }
}

/** This activity's rule-derived rows, every field (GSI1 `byActivity` projects ALL). */
async function activityRows(activityId: string, deps: KindRescoreDeps): Promise<XpLedgerEntry[]> {
  const items: XpLedgerEntry[] = []
  let ExclusiveStartKey: Record<string, unknown> | undefined
  do {
    const page = (await deps.ddb.send(
      new QueryCommand({
        TableName: deps.ledger.ledgerTable,
        IndexName: BY_ACTIVITY_INDEX,
        KeyConditionExpression: "activityId = :a",
        FilterExpression: "isFloor = :f",
        ExpressionAttributeValues: { ":a": activityId, ":f": false },
        ExclusiveStartKey,
      }),
    )) as { Items?: Record<string, unknown>[]; LastEvaluatedKey?: Record<string, unknown> }
    for (const i of page.Items ?? []) {
      // The ledger's own attributes only: the Amplify metadata and derived index keys are rewritten by `ledgerPutItem`.
      items.push({
        id: String(i.id),
        userId: String(i.userId),
        activityId: String(i.activityId),
        skillId: String(i.skillId),
        reason: i.reason as XpLedgerEntry["reason"],
        units: Number(i.units),
        unitsEffective: Number(i.unitsEffective),
        xpAwarded: Number(i.xpAwarded),
        xpRulesVersion: Number(i.xpRulesVersion),
        isFloor: false,
        seq: String(i.seq),
        awardedAt: String(i.awardedAt),
      })
    }
    ExclusiveStartKey = page.LastEvaluatedKey
  } while (ExclusiveStartKey)
  return items
}

function cancellation(err: unknown): string[] | undefined {
  const e = err as { name?: string; CancellationReasons?: Array<{ Code?: string }> }
  if (e?.name !== "TransactionCanceledException" || !Array.isArray(e.CancellationReasons)) return undefined
  return e.CancellationReasons.map((r) => r?.Code ?? "None")
}

const num = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0) || 0)
