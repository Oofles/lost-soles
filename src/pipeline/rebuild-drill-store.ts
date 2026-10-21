import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3"
import { BatchGetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb"

import { generationKey } from "./explored-generation"
import { landmarkPutItem } from "./landmarks"
import { amplifyMetadata } from "./persist"
import type { DrillStore, DrillTarget } from "./rebuild-drill-back"
import { ledgerPutItem } from "./xp-ledger"
import { activityScoreItem, PROFILE_TYPENAME, skillStateThawItem } from "./xp-replay-store"

/**
 * THE REBUILD DRILL'S TARGET, ON DYNAMODB AND S3. Ticket `0103`. `rebuild-drill-back.ts` is the
 * orchestration; this is only the wire shapes.
 *
 * ─── EVERY CREATE IS CONDITIONED ON ABSENCE ─────────────────────────────────
 *
 * §8.3 rebuilds into NEW, EMPTY tables. Rather than check emptiness once and trust it, every put
 * here carries `attribute_not_exists` (DynamoDB) or `IfNoneMatch: "*"` (S3), so a target that
 * holds anything refuses the drill at the first colliding write instead of being overwritten. The
 * two updates that follow a create in the same run (T3's score columns, T2's thaw) are the shapes
 * the XP replay already writes, conditioned as it conditions them.
 *
 * ─── ONE ITEM PER REQUEST ───────────────────────────────────────────────────
 *
 * §8.3 step 5 budgets T6 as `BatchWriteItem`, 25 a request. A batch write can carry a removal, so
 * `check-fog-hot-path.mjs` forbids the command in any file that knows T6 (I-7); a `PutItem` per
 * item, conditioned on absence, costs the same write units and states the intent outright. At
 * live volume (~5,000 cells) that is seconds; at the five-year ~150,000, a minute or two at the
 * default concurrency — inside §8.3's 30-minute budget.
 *
 * Reads are step 5's cells-file read-back and step 8's consistent `BatchGetItem` by key. No read
 * of `SkillState` happens before step 8: step 6's waterline is the snapshot (D-399).
 */

type Item = Record<string, unknown>

export interface DrillStoreDeps {
  ddb: { send(command: unknown): Promise<unknown> }
  s3: { send(command: unknown): Promise<unknown> }
  target: DrillTarget
  concurrency?: number
}

const BATCH_GET = 100

async function pool<T>(items: readonly T[], n: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(n, items.length)) }, async () => {
      while (next < items.length) await fn(items[next++]!)
    }),
  )
}

const isConditionalFailure = (e: unknown) => (e as { name?: string })?.name === "ConditionalCheckFailedException"
const isNoSuchKey = (e: unknown) => {
  const x = e as { name?: string; $metadata?: { httpStatusCode?: number } }
  return x?.name === "NoSuchKey" || x?.name === "NotFound" || x?.$metadata?.httpStatusCode === 404
}

export function dynamoDrillStore(deps: DrillStoreDeps): DrillStore {
  const { target } = deps
  const t = target.tables
  const n = deps.concurrency ?? 16
  const ddb = (c: unknown) => deps.ddb.send(c)

  async function batchGet(table: string, keys: Item[]): Promise<Item[]> {
    const out: Item[] = []
    for (let i = 0; i < keys.length; i += BATCH_GET) {
      let pending = keys.slice(i, i + BATCH_GET)
      for (let attempt = 0; pending.length > 0; attempt++) {
        if (attempt > 6) throw new Error(`BatchGetItem: ${pending.length} keys still unprocessed on ${table}`)
        if (attempt > 0) await new Promise((r) => setTimeout(r, 2 ** attempt * 50))
        const res = (await ddb(
          new BatchGetCommand({ RequestItems: { [table]: { Keys: pending, ConsistentRead: true } } }),
        )) as { Responses?: Record<string, Item[]>; UnprocessedKeys?: Record<string, { Keys?: Item[] }> }
        out.push(...(res.Responses?.[table] ?? []))
        pending = res.UnprocessedKeys?.[table]?.Keys ?? []
      }
    }
    return out
  }

  return {
    async putObject(key, body, meta) {
      await deps.s3.send(
        new PutObjectCommand({
          Bucket: target.bucket,
          Key: `${target.prefix}${key}`,
          Body: body,
          ContentType: meta.contentType,
          CacheControl: meta.cacheControl,
          ...(meta.contentEncoding ? { ContentEncoding: meta.contentEncoding } : {}),
          IfNoneMatch: "*",
        }),
      )
    },

    async getObject(key) {
      try {
        const got = (await deps.s3.send(new GetObjectCommand({ Bucket: target.bucket, Key: `${target.prefix}${key}` }))) as {
          Body?: { transformToByteArray(): Promise<Uint8Array> }
        }
        return got.Body ? await got.Body.transformToByteArray() : undefined
      } catch (e) {
        if (isNoSuchKey(e)) return undefined
        throw e
      }
    },

    async putActivity(item) {
      await ddb(new PutCommand({ TableName: t.activity, Item: item, ConditionExpression: "attribute_not_exists(id)" }))
    },

    async putCellItems(items) {
      await pool(items, n, async (item) => {
        await ddb(new PutCommand({ TableName: t.exploredCell, Item: item, ConditionExpression: "attribute_not_exists(pk)" }))
      })
    },

    async putLedger(entries) {
      await pool(entries, n, async (e) => {
        await ddb(new PutCommand(ledgerPutItem(e, t.ledger).Put! as never))
      })
    },

    async writeActivityScores(rows, at) {
      await pool(rows, n, async (w) => {
        await ddb(new UpdateCommand(activityScoreItem(w, at, t.activity)))
      })
    },

    async writeSkillStates(userId, rows, at) {
      await pool(rows, n, async (w) => {
        await ddb(new UpdateCommand(skillStateThawItem(userId, w, at, t.skillState)))
      })
    },

    async putProfile(userId, totals, at) {
      await ddb(
        new PutCommand({
          TableName: t.profile,
          Item: {
            ...amplifyMetadata(userId, at, PROFILE_TYPENAME),
            id: userId,
            totalXp: totals.totalXp,
            totalLevel: totals.totalLevel,
            ledgerRulesVersion: totals.ledgerRulesVersion,
            replayInProgress: false,
          },
          ConditionExpression: "attribute_not_exists(id)",
        }),
      )
    },

    async putLandmarks(records, at) {
      await pool(records, n, async (l) => {
        await ddb(new PutCommand(landmarkPutItem(l, at, t.landmark)))
      })
    },

    async raiseGeneration(userId, generation) {
      try {
        await ddb(
          new UpdateCommand({
            TableName: t.exploredCell,
            Key: generationKey(userId),
            UpdateExpression: "SET generation = :n",
            // A fresh target has no counter. One that has any value is not empty.
            ConditionExpression: "attribute_not_exists(generation)",
            ExpressionAttributeValues: { ":n": generation },
          }),
        )
        return true
      } catch (e) {
        if (isConditionalFailure(e)) return false
        throw e
      }
    },

    async mirrorGeneration(userId, generation) {
      await ddb(
        new UpdateCommand({
          TableName: t.profile,
          Key: { id: userId },
          UpdateExpression: "SET exploredGeneration = :g",
          ConditionExpression: "attribute_exists(id) AND (attribute_not_exists(exploredGeneration) OR exploredGeneration < :g)",
          ExpressionAttributeValues: { ":g": generation },
        }),
      )
    },

    async readSkillStates(userId, skillIds) {
      const rows = await batchGet(
        t.skillState,
        skillIds.map((skillId) => ({ userId, skillId })),
      )
      return rows.map((r) => ({
        skillId: String(r.skillId),
        displayedXp: Number(r.displayedXp ?? 0),
        xpLedgerSum: Number(r.xpLedgerSum ?? 0),
      }))
    },

    async readLedger(ids) {
      const rows = await batchGet(
        t.ledger,
        ids.map((id) => ({ id })),
      )
      return rows.map((r) => ({ id: String(r.id), skillId: String(r.skillId), xpAwarded: Number(r.xpAwarded) }))
    },
  }
}
