import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand } from "@aws-sdk/client-s3"
import { QueryCommand } from "@aws-sdk/lib-dynamodb"

import { getObject, readManifest, type FogReadDeps } from "@/lib/fog/server"
import { rulesForSkills, type CachedSkill } from "@/lib/log/optimistic"
import { skillsPanel } from "@/lib/skills/panel"
import { decodeExploredBlob } from "@/src/domain/explored-blob"
import { RES } from "@/src/domain/fog"
import { objectKeys } from "@/src/pipeline/explored-blob-store"
import { readShownRows, snapshotPrefix, type SkillStateSnapshot } from "@/src/pipeline/skillstate-snapshot"

import {
  BACKFILL_RECORD_VERSION,
  parseBackfillBatch,
  type BackfillBatch,
  type BackfillStanding,
} from "./batch"

/**
 * WHERE THE BACKFILL BATCH RECORD LIVES, AND HOW IT IS BUILT. Ticket `0257`.
 *
 * ─── AN S3 OBJECT UNDER THE USER'S DERIVED PREFIX, NOT A TABLE ─────────────
 *
 * `users/<uid>/backfill/batch.json`. Three reasons, each sufficient:
 *
 *   1. **No new AWS resource and no new grant.** The SSR compute already reads `users/*` (it serves
 *      the explored blobs from there, `amplify/backend.ts`), and nothing else needs to read it. A new
 *      AppSync model would be a new table, a new owner rule and a schema change for one record.
 *   2. **It is derived.** Everything in it is rebuilt from immutable facts — T3's `ingestedAt`, the
 *      SkillState snapshots (D-143), the generation-named blobs — so it belongs with the other
 *      derived objects, not with the systems of record. Lose it and `tools/backfill/batch-record.ts`
 *      writes it again, byte for byte bar `writtenAt`.
 *   3. **One record per account.** A later import overwrites it with a new `batchId`; the reveal and
 *      the "not new" rule then follow the newer import, which is the one nobody has seen yet.
 *
 * WRITTEN BY TOOLS ONLY (the backfill CLI on completion, and the one-off `batch-record.ts`), under
 * the operator's credentials. The app only ever reads it, and the browser never sees the object —
 * `/api/runs/latest` serves the mark without the ids (`markOf`).
 */

export const backfillBatchKey = (userId: string) => `users/${userId}/backfill/batch.json`

/**
 * The record, or `null`: absent, or unreadable as a record. A missing object is the ordinary answer
 * for every account that never ran a historical import. An S3 failure THROWS: the caller decides
 * (the latest-run route serves `null` rather than lose the line).
 */
export async function readBackfillBatch(userId: string, deps: FogReadDeps): Promise<BackfillBatch | null> {
  const bytes = await getObject(backfillBatchKey(userId), deps)
  return bytes === undefined ? null : parseBackfillBatch(bytes)
}

/**
 * For the routes: the record, or `null` on ANY failure. A record that cannot be read costs the
 * account its aggregate reveal and its "not new" marks for one answer — never the map's line or the
 * Chronicle's page, which are what the routes are for.
 */
export async function backfillBatchOrNull(userId: string, deps: FogReadDeps): Promise<BackfillBatch | null> {
  try {
    return await readBackfillBatch(userId, deps)
  } catch {
    return null
  }
}

export async function writeBackfillBatch(batch: BackfillBatch, userId: string, deps: FogReadDeps): Promise<string> {
  const key = backfillBatchKey(userId)
  await deps.s3.send(
    new PutObjectCommand({
      Bucket: deps.bucket,
      Key: key,
      Body: JSON.stringify(batch, null, 2) + "\n",
      ContentType: "application/json",
      // Rewritten in place (a later import, a refresh after the XP replay), so never cached.
      CacheControl: "no-cache",
    }),
  )
  return key
}

/** The document-client surface `buildBackfillBatch` uses — structural, so a test passes a stub. */
export interface BatchDdb {
  send(command: QueryCommand): Promise<{ Items?: Record<string, unknown>[]; LastEvaluatedKey?: Record<string, unknown> }>
}

/** The S3 surface: `getObject`'s, plus a listing. */
export interface BatchS3 {
  send(command: GetObjectCommand | ListObjectsV2Command | PutObjectCommand): Promise<unknown>
}

export interface BuildBatchDeps {
  ddb: BatchDdb
  s3: BatchS3
  bucket: string
  activityTable: string
  skillStateTable: string
  now?: () => Date
}

/** One T3 row, as far as the record reads it. `id` is the activity id (`persist.ts`). */
interface ActivityRow {
  id: string
  startedAt: string
  ingestedAt: string
  status: string
}

async function listActivities(userId: string, deps: BuildBatchDeps): Promise<ActivityRow[]> {
  const out: ActivityRow[] = []
  let ExclusiveStartKey: Record<string, unknown> | undefined
  do {
    const page = await deps.ddb.send(
      new QueryCommand({
        TableName: deps.activityTable,
        IndexName: "byUserAndStart",
        KeyConditionExpression: "#u = :u",
        ExpressionAttributeNames: { "#u": "userId" },
        ExpressionAttributeValues: { ":u": userId },
        ExclusiveStartKey,
      }),
    )
    for (const i of page.Items ?? []) {
      if (typeof i.id !== "string" || typeof i.startedAt !== "string" || typeof i.ingestedAt !== "string") continue
      out.push({ id: i.id, startedAt: i.startedAt, ingestedAt: i.ingestedAt, status: String(i.status ?? "ACTIVE") })
    }
    ExclusiveStartKey = page.LastEvaluatedKey
  } while (ExclusiveStartKey)
  return out
}

interface Listed {
  Key?: string
  LastModified?: Date
}

async function listPrefix(prefix: string, deps: BuildBatchDeps): Promise<Listed[]> {
  const out: Listed[] = []
  let ContinuationToken: string | undefined
  do {
    const page = (await deps.s3.send(
      new ListObjectsV2Command({ Bucket: deps.bucket, Prefix: prefix, ContinuationToken }),
    )) as { Contents?: Listed[]; IsTruncated?: boolean; NextContinuationToken?: string }
    out.push(...(page.Contents ?? []))
    ContinuationToken = page.IsTruncated ? page.NextContinuationToken : undefined
  } while (ContinuationToken)
  return out
}

/**
 * THE GENERATION THE MAP WAS DRAWN FROM AT `at`: the newest cell blob published before it. Blobs are
 * named by generation and never rewritten, so `LastModified` is when that generation was published.
 * 0 when there was none.
 */
export async function generationAt(userId: string, at: string, deps: BuildBatchDeps): Promise<number> {
  const prefix = `users/${userId}/explored/explored-r${RES}.`
  const cutoff = Date.parse(at)
  let best = 0
  for (const o of await listPrefix(prefix, deps)) {
    const gen = Number(o.Key?.slice(prefix.length).replace(/\.bin$/, ""))
    if (!Number.isSafeInteger(gen) || !o.LastModified) continue
    if (o.LastModified.getTime() < cutoff && gen > best) best = gen
  }
  return best
}

/** Cells in one generation's blob. 0 for generation 0. */
async function cellsIn(userId: string, generation: number, deps: BuildBatchDeps): Promise<number> {
  if (generation === 0) return 0
  const bytes = await getObject(objectKeys.cells(userId, generation), deps as unknown as FogReadDeps)
  if (bytes === undefined) throw new Error(`no explored blob for generation ${generation}`)
  return decodeExploredBlob(bytes).cells.length
}

/** The newest SkillState snapshot taken strictly before `at` (D-143), or `undefined`. */
async function snapshotBefore(userId: string, at: string, deps: BuildBatchDeps): Promise<SkillStateSnapshot | undefined> {
  const prefix = snapshotPrefix(userId)
  let newest: string | undefined
  for (const o of await listPrefix(prefix, deps)) {
    // `<takenAt>-<generation>.json`; ISO instants sort lexicographically.
    const takenAt = o.Key?.slice(prefix.length, prefix.length + 24)
    if (!o.Key?.endsWith(".json") || !takenAt || !(takenAt < at)) continue
    if (newest === undefined || o.Key > newest) newest = o.Key
  }
  if (newest === undefined) return undefined
  const got = (await deps.s3.send(new GetObjectCommand({ Bucket: deps.bucket, Key: newest }))) as {
    Body?: { transformToString(): Promise<string> }
  }
  const snapshot = JSON.parse((await got.Body?.transformToString()) ?? "") as SkillStateSnapshot
  if (snapshot.userId !== userId || !Array.isArray(snapshot.skills)) {
    throw new Error(`${newest} is not a skill-state snapshot for ${userId}`)
  }
  return snapshot
}

function standing(generation: number, cells: number, activities: number, skills: CachedSkill[]): BackfillStanding {
  const panel = skillsPanel(rulesForSkills(skills), skills)
  return { generation, cells, activities, skills, totalLevel: panel.totalLevel, totalXp: panel.totalXp }
}

/**
 * WHICH ACTIVITIES THE IMPORT BROUGHT IN: the ACTIVE rows whose `ingestedAt` falls inside the window,
 * and — when the account already had activities — that START before the oldest of them. A historical
 * import only ever fetches what the first Sync's lookback did not reach (`0177`), so its runs are
 * all older than the account's oldest earlier activity; a run recorded and synced WHILE the import
 * was going is newer, and it stays an ordinary new run with its own sequence.
 */
export function batchActivities(
  rows: readonly { id: string; startedAt: string; ingestedAt: string; status: string }[],
  window: { from: string; to: string },
): { pre: typeof rows; batch: typeof rows } {
  const active = rows.filter((r) => r.status === "ACTIVE")
  const pre = active.filter((r) => r.ingestedAt < window.from)
  const oldestPre = pre.reduce<string | null>((m, r) => (m === null || r.startedAt < m ? r.startedAt : m), null)
  const batch = active.filter(
    (r) => r.ingestedAt >= window.from && r.ingestedAt <= window.to && (oldestPre === null || r.startedAt < oldestPre),
  )
  return { pre, batch }
}

/**
 * BUILD THE RECORD for an import that ran between `window.from` and `window.to`.
 *
 * - **before** is what the user was shown just before the window opened: the newest SkillState
 *   snapshot taken before it, and the newest explored blob published before it.
 * - **after** is the account NOW — SkillState as it stands, the manifest's generation. Built after the
 *   XP replay (the run order `0177` set out), that is the post-replay standing the reveal must show.
 *
 * Read-only. `writeBackfillBatch` is the one write.
 */
export async function buildBackfillBatch(
  userId: string,
  window: { from: string; to: string },
  deps: BuildBatchDeps,
): Promise<BackfillBatch> {
  if (!(window.from < window.to)) throw new Error(`the window must open before it closes: ${window.from} → ${window.to}`)
  const rows = await listActivities(userId, deps)
  const { pre, batch } = batchActivities(rows, window)

  const snapshot = await snapshotBefore(userId, window.from, deps)
  const beforeSkills: CachedSkill[] = (snapshot?.skills ?? []).map((s) => ({
    skillId: s.skillId,
    xp: s.displayedXp,
    rulesVersionLastComputed: snapshot!.rulesVersion,
    levelHighWater: s.levelHighWater,
  }))
  const beforeGen = await generationAt(userId, window.from, deps)

  const shown = await readShownRows(userId, { ddb: deps.ddb, table: deps.skillStateTable })
  const afterSkills: CachedSkill[] = shown.map((s) => ({
    skillId: s.skillId,
    xp: s.displayedXp ?? 0,
    ...(typeof s.rulesVersionLastComputed === "number" ? { rulesVersionLastComputed: s.rulesVersionLastComputed } : {}),
    ...(typeof s.levelHighWater === "number" ? { levelHighWater: s.levelHighWater } : {}),
  }))
  const manifest = await readManifest(userId, deps as unknown as FogReadDeps)
  const afterGen = manifest?.generation ?? 0

  const started = batch.map((r) => r.startedAt).sort()
  return {
    version: BACKFILL_RECORD_VERSION,
    batchId: window.from,
    window: { from: window.from, to: window.to },
    writtenAt: (deps.now ?? (() => new Date()))().toISOString(),
    imported: { count: batch.length, firstStartedAt: started[0] ?? null, lastStartedAt: started.at(-1) ?? null },
    activityIds: batch.map((r) => r.id).sort(),
    before: standing(beforeGen, await cellsIn(userId, beforeGen, deps), pre.length, beforeSkills),
    after: standing(afterGen, manifest?.cellCount ?? (await cellsIn(userId, afterGen, deps)), rows.filter((r) => r.status === "ACTIVE").length, afterSkills),
  }
}
