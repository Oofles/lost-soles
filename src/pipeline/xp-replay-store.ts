import {
  BatchWriteCommand,
  DeleteCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
  type QueryCommandInput,
} from "@aws-sdk/lib-dynamodb"
import type { XpLedgerEntry } from "@/src/scoring"

import { readManifest, regenerateExplored, readRunCells, type BlobStoreDeps } from "./explored-blob-store"
import { mergeFoldedCells } from "./explored-merge"
import { amplifyMetadata } from "./persist"
import { latestSnapshot, readShownRows, writeSnapshot, type SnapshotDeps } from "./skillstate-snapshot"
import { LEDGER_TYPENAME, ledgerPutItem, SKILL_STATE_TYPENAME } from "./xp-ledger"
import {
  REPLAY_ACTIVITY_ID,
  REPLAY_SEQ_PREFIX,
  type ReplayActivity,
  type ReplayRunRecord,
  type ReplayStore,
  type SkillStateWrite,
  type StoredSkillState,
} from "./xp-replay"

/**
 * THE XP REPLAY'S STORE, ON DYNAMODB AND S3. Ticket `0066`. `02-data-model.md` §4.4–§4.6.
 *
 * Every write here that could lower a number is refused by a CONDITION, not avoided by a
 * computation: `displayedXp` and `levelHighWater` only move up, a floor row is never overwritten,
 * and a ledger delete only applies to a row with `isFloor = false`. The orchestrator already
 * guarantees each of these; the conditions are there so a bug in it fails loudly on the table
 * rather than succeeding quietly.
 *
 * Deletes are one conditional `DeleteItem` each rather than §4.4's `BatchWriteItem` of 25, because
 * a batch write cannot carry a condition and I-18's guard is worth more than the batching: 25,000
 * rows at five years is well under a minute at this concurrency.
 */

export const PROFILE_TYPENAME = "Profile"
/** T4 GSI2. The name `amplify/data/resource.ts` gives it. */
export const BY_USER_AND_SEQ_INDEX = "byUserAndSeq"
/** T3 GSI1. */
export const BY_USER_AND_START_INDEX = "byUserAndStart"

type Send = (command: unknown) => Promise<unknown>
type Item = Record<string, unknown>

export interface ReplayStoreDeps {
  ddb: { send: Send }
  tables: {
    ledger: string
    skillState: string
    profile: string
    activity: string
    cells?: string
  }
  blobs: BlobStoreDeps
  /** `0067`. `snapshots/skillstate/` — the same bucket as the blobs today. */
  snapshots: SnapshotDeps
  /** The trace from the S3 archive through the shipped normalizer. The CLI wires this. */
  loadTrace: ReplayStore["loadTrace"]
  concurrency?: number
}

const BATCH = 25

async function queryAll(deps: ReplayStoreDeps, input: QueryCommandInput): Promise<Item[]> {
  const items: Item[] = []
  let ExclusiveStartKey: Item | undefined
  do {
    const page = (await deps.ddb.send(new QueryCommand({ ...input, ExclusiveStartKey }))) as {
      Items?: Item[]
      LastEvaluatedKey?: Item
    }
    items.push(...(page.Items ?? []))
    ExclusiveStartKey = page.LastEvaluatedKey
  } while (ExclusiveStartKey)
  return items
}

async function pool<T>(items: readonly T[], n: number, fn: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items]
  await Promise.all(
    Array.from({ length: Math.min(n, queue.length) }, async () => {
      for (let next = queue.shift(); next !== undefined; next = queue.shift()) await fn(next)
    }),
  )
}

/** `BatchWriteItem`, re-sending whatever DynamoDB hands back unprocessed. */
async function batchWrite(deps: ReplayStoreDeps, table: string, requests: Item[]): Promise<void> {
  for (let i = 0; i < requests.length; i += BATCH) {
    let pending: Item[] = requests.slice(i, i + BATCH)
    for (let attempt = 0; pending.length > 0; attempt++) {
      if (attempt > 6) throw new Error(`batchWrite: ${pending.length} items still unprocessed on ${table}`)
      if (attempt > 0) await new Promise((r) => setTimeout(r, 2 ** attempt * 50))
      const out = (await deps.ddb.send(new BatchWriteCommand({ RequestItems: { [table]: pending } }))) as {
        UnprocessedItems?: Record<string, Item[]>
      }
      pending = out.UnprocessedItems?.[table] ?? []
    }
  }
}

/** The ReplayRun as a T4 item: ledger-shaped so every required field is present (§4.5). */
export function replayRunItem(run: ReplayRunRecord): Item {
  const idTail = run.id.split("#").pop()!
  return {
    ...amplifyMetadata(run.userId, run.startedAt, LEDGER_TYPENAME),
    updatedAt: run.finishedAt ?? run.startedAt,
    id: run.id,
    userId: run.userId,
    activityId: REPLAY_ACTIVITY_ID,
    skillId: REPLAY_ACTIVITY_ID,
    reason: "replay_run",
    skillIdReason: `${REPLAY_ACTIVITY_ID}#replay_run`,
    userIdSkillId: `${run.userId}#${REPLAY_ACTIVITY_ID}`,
    units: 0,
    unitsEffective: 0,
    /** Harmless to any SUM that sweeps the partition (§4.5). */
    xpAwarded: 0,
    xpRulesVersion: run.toRulesVersion,
    isFloor: false,
    seq: `${REPLAY_SEQ_PREFIX}${idTail}`,
    awardedAt: run.startedAt,
    fromRulesVersion: run.fromRulesVersion,
    toRulesVersion: run.toRulesVersion,
    status: run.status,
    startedAt: run.startedAt,
    ...(run.finishedAt ? { finishedAt: run.finishedAt } : {}),
    waterline: run.waterline,
    ...(run.recomputed ? { recomputed: run.recomputed } : {}),
    ...(run.floorsWritten ? { floorsWritten: run.floorsWritten } : {}),
    ...(run.generation !== undefined ? { generation: run.generation } : {}),
    ...(run.error ? { error: run.error } : {}),
  }
}

function runOf(i: Item): ReplayRunRecord {
  return {
    id: String(i.id),
    userId: String(i.userId),
    fromRulesVersion: Number(i.fromRulesVersion),
    toRulesVersion: Number(i.toRulesVersion),
    startedAt: String(i.startedAt),
    finishedAt: i.finishedAt as string | undefined,
    status: i.status as ReplayRunRecord["status"],
    waterline: i.waterline as ReplayRunRecord["waterline"],
    recomputed: i.recomputed as ReplayRunRecord["recomputed"],
    floorsWritten: i.floorsWritten as ReplayRunRecord["floorsWritten"],
    generation: i.generation === undefined ? undefined : Number(i.generation),
    error: i.error as string | undefined,
  }
}

/**
 * One T2 row, written wholesale (§4.4 step 6). Guarded so neither ratchet can move down: the
 * condition refuses the write rather than the code clamping it.
 */
export function skillStateThawItem(userId: string, w: SkillStateWrite, at: string, table: string) {
  const meta = amplifyMetadata(userId, at, SKILL_STATE_TYPENAME)
  const sets = [
    "#tn = :tn",
    "#owner = :owner",
    "createdAt = if_not_exists(createdAt, :now)",
    "updatedAt = :now",
    "xpLedgerSum = :xp",
    "displayedXp = :xp",
    "#level = :level",
    "levelHighWater = :hw",
    "rulesVersionLastComputed = :ver",
    "firstSeenRulesVersion = if_not_exists(firstSeenRulesVersion, :intro)",
  ]
  const values: Item = {
    ":tn": meta.__typename,
    ":owner": meta.owner,
    ":now": at,
    ":xp": w.xp,
    ":level": w.level,
    ":hw": w.levelHighWater,
    ":ver": w.rulesVersion,
    ":intro": w.introducedIn,
  }
  const optional: Array<[string | undefined, string, string]> = [
    [w.firstXpAt, "firstXpAt = :first", ":first"],
    [w.lastXpAt, "lastXpAt = :last", ":last"],
    [w.firstSeenAt, "firstSeenAt = if_not_exists(firstSeenAt, :seen)", ":seen"],
  ]
  for (const [value, clause, name] of optional) {
    if (value === undefined) continue
    sets.push(clause)
    values[name] = value
  }
  return {
    TableName: table,
    Key: { userId, skillId: w.skillId },
    UpdateExpression: `SET ${sets.join(", ")}`,
    ConditionExpression:
      "(attribute_not_exists(displayedXp) OR displayedXp <= :xp) AND " +
      "(attribute_not_exists(levelHighWater) OR levelHighWater <= :hw)",
    ExpressionAttributeNames: {
      "#tn": "__typename",
      "#owner": "owner",
      "#level": "level",
    },
    ExpressionAttributeValues: values,
  }
}

export function dynamoReplayStore(deps: ReplayStoreDeps): ReplayStore {
  const { tables } = deps
  const concurrency = deps.concurrency ?? 8
  const send = (c: unknown) => deps.ddb.send(c)

  return {
    async findUnfinishedRun(userId) {
      const items = await queryAll(deps, {
        TableName: tables.ledger,
        IndexName: BY_USER_AND_SEQ_INDEX,
        KeyConditionExpression: "userId = :u AND begins_with(seq, :p)",
        ExpressionAttributeValues: { ":u": userId, ":p": REPLAY_SEQ_PREFIX },
      })
      return items
        .filter((i) => i.status !== "DONE")
        .sort((a, b) => (String(a.seq) < String(b.seq) ? 1 : -1))
        .map(runOf)[0]
    },

    async putRun(run) {
      await send(
        new PutCommand({
          TableName: tables.ledger,
          Item: replayRunItem(run),
          ConditionExpression: "attribute_not_exists(id)",
        }),
      )
    },

    async updateRun(run) {
      await send(
        new PutCommand({
          TableName: tables.ledger,
          Item: replayRunItem(run),
          ConditionExpression: "attribute_exists(id)",
        }),
      )
    },

    async readSkillStates(userId): Promise<StoredSkillState[]> {
      const rows = await readShownRows(userId, { ddb: deps.ddb, table: tables.skillState })
      const num = (v: unknown) => (v === undefined || v === null ? undefined : Number(v))
      return rows.map((i) => ({
        skillId: i.skillId,
        xpLedgerSum: i.xpLedgerSum ?? 0,
        displayedXp: i.displayedXp ?? 0,
        level: i.level,
        levelHighWater: i.levelHighWater,
        firstSeenRulesVersion: i.firstSeenRulesVersion,
        firstXpAt: i.firstXpAt as string | undefined,
        lastXpAt: i.lastXpAt as string | undefined,
        rulesVersionLastComputed: num(i.rulesVersionLastComputed),
      }))
    },

    latestSnapshot: (userId) => latestSnapshot(userId, deps.snapshots),

    writeSnapshot: (snapshot) => writeSnapshot(snapshot, deps.snapshots),

    async currentGeneration(userId) {
      return (await readManifest(userId, deps.blobs))?.manifest.generation ?? 0
    },

    async writeSkillStates(userId, rows, at) {
      await pool(rows, concurrency, async (w) => {
        await send(new UpdateCommand(skillStateThawItem(userId, w, at, tables.skillState)))
      })
    },

    async freeze(userId, at) {
      const meta = amplifyMetadata(userId, at, PROFILE_TYPENAME)
      await send(
        new UpdateCommand({
          TableName: tables.profile,
          Key: { id: userId },
          UpdateExpression:
            "SET replayInProgress = :t, #tn = :tn, #owner = :owner, " +
            "createdAt = if_not_exists(createdAt, :now), updatedAt = :now",
          ExpressionAttributeNames: { "#tn": "__typename", "#owner": "owner" },
          ExpressionAttributeValues: {
            ":t": true,
            ":tn": meta.__typename,
            ":owner": meta.owner,
            ":now": at,
          },
        }),
      )
    },

    async thaw(userId, totals, at) {
      await send(
        new UpdateCommand({
          TableName: tables.profile,
          Key: { id: userId },
          UpdateExpression: "SET replayInProgress = :f, totalXp = :xp, totalLevel = :lvl, updatedAt = :now",
          ConditionExpression: "attribute_exists(id)",
          ExpressionAttributeValues: {
            ":f": false,
            ":xp": totals.totalXp,
            ":lvl": totals.totalLevel,
            ":now": at,
          },
        }),
      )
    },

    async listLedger(userId) {
      const items = await queryAll(deps, {
        TableName: tables.ledger,
        IndexName: BY_USER_AND_SEQ_INDEX,
        KeyConditionExpression: "userId = :u",
        ExpressionAttributeValues: { ":u": userId },
      })
      return items as unknown as XpLedgerEntry[]
    },

    async deleteLedger(ids) {
      await pool(ids, concurrency, async (id) => {
        // I-18 at the table: a floor row cannot be deleted by this call, whatever asked for it.
        await send(
          new DeleteCommand({
            TableName: tables.ledger,
            Key: { id },
            ConditionExpression: "attribute_not_exists(id) OR isFloor = :f",
            ExpressionAttributeValues: { ":f": false },
          }),
        )
      })
    },

    async putLedger(entries) {
      const item = (e: XpLedgerEntry) => ledgerPutItem(e, tables.ledger).Put!.Item as Item
      const floors = entries.filter((e) => e.isFloor)
      const rows = entries.filter((e) => !e.isFloor)
      await batchWrite(
        deps,
        tables.ledger,
        rows.map((e) => ({ PutRequest: { Item: item(e) } })),
      )
      for (const f of floors) {
        await send(
          new PutCommand({
            TableName: tables.ledger,
            Item: item(f),
            ConditionExpression: "attribute_not_exists(id)",
          }),
        )
      }
    },

    async listActivities(userId) {
      const items = await queryAll(deps, {
        TableName: tables.activity,
        IndexName: BY_USER_AND_START_INDEX,
        KeyConditionExpression: "userId = :u",
        ExpressionAttributeValues: { ":u": userId },
      })
      return items.map(
        (i) =>
          ({
            ...(i as object),
            activityId: String(i.id),
          }) as unknown as ReplayActivity,
      )
    },

    readRunCells: (userId, activityId) => readRunCells(userId, activityId, deps.blobs),

    loadTrace: (activity) => deps.loadTrace(activity),

    mergeCells: (userId, cells) => mergeFoldedCells(userId, cells, { ddb: deps.ddb, table: tables.cells }),

    async publish(userId, created, day) {
      const result = await regenerateExplored({ userId, touched: created, day }, deps.blobs)
      return result.generation
    },
  }
}
