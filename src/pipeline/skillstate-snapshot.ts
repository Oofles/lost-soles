import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand } from "@aws-sdk/client-s3"
import { QueryCommand } from "@aws-sdk/lib-dynamodb"

import type { RuleSet } from "@/src/rules/schema"
import { levelForXp, type Waterline } from "@/src/scoring"

/**
 * THE SKILL-STATE SNAPSHOT — THE ONE DOCUMENTED EXCEPTION TO D-101. Ticket `0067`. D-143, D-259,
 * `02-data-model.md` §8.2, I-2.
 *
 * Everything else in this system is reconstructible from `raw/`. What the user was SHOWN is not:
 * a GPX proves the run happened and cannot prove the app once printed `Wayfaring 47`. D-135 says
 * no replay may lower a displayed number, so that number has to survive losing every table — and
 * `SkillState` alone is only as durable as PITR's 35-day window.
 *
 * Written at two moments, both keyed `snapshots/skillstate/<uid>/<takenAt>-<generation>.json`:
 *
 *   1. after every successful ingest transaction (`process-activity.ts`) — OUTSIDE it, and never
 *      fatal: a missed snapshot is logged and the next ingest writes another;
 *   2. in replay step 0 (`xp-replay.ts`), before anything is cleared — fatal there, because a
 *      rebalance must not start without its durable pre-flight record.
 *
 * Immutable: `IfNoneMatch: "*"`, and the key carries `takenAt`. Plain JSON on purpose — it is read
 * by a human exactly once, during an incident, and that is when a clever encoding costs most.
 *
 * NOT A BACKUP OF THE LEDGER. The ledger is already durable and append-only. This is a record of
 * DISPLAY, a different fact with a different lifetime.
 */

export const SNAPSHOT_PREFIX = "snapshots/skillstate/"

export const snapshotPrefix = (userId: string) => `${SNAPSHOT_PREFIX}${userId}/`

/** ISO `takenAt` sorts lexicographically, so the newest key is the greatest one. */
export const snapshotKey = (s: Pick<SkillStateSnapshot, "userId" | "takenAt" | "generation">) =>
  `${snapshotPrefix(s.userId)}${s.takenAt}-${s.generation}.json`

export interface SnapshotSkill {
  skillId: string
  displayedXp: number
  xpLedgerSum: number
  level: number
  levelHighWater: number
  firstSeenRulesVersion: number
}

export interface SkillStateSnapshot {
  userId: string
  takenAt: string
  /** The ruleset the displayed numbers were computed under. */
  rulesVersion: number
  /** The published explored-map generation at the time (`manifest.json`); 0 before the first. */
  generation: number
  /** What wrote it. For the human reading it during an incident. */
  trigger: "ingest" | "replay-preflight"
  /** Every skill in the registry, level 1 / 0 XP included, plus any T2 row the registry lacks. */
  skills: SnapshotSkill[]
}

/** A T2 row as the snapshot reads it. Every field past `skillId` may be missing on an old row. */
export interface ShownRow {
  skillId: string
  displayedXp?: number
  xpLedgerSum?: number
  level?: number
  levelHighWater?: number
  firstSeenRulesVersion?: number
}

/**
 * Pure. `level` falls back to the curve because ingest does not write it until `0219`; the level a
 * user is shown is the one the current curve gives their XP. `levelHighWater` is never below it.
 */
export function buildSnapshot(args: {
  userId: string
  takenAt: string
  generation: number
  trigger: SkillStateSnapshot["trigger"]
  rules: Pick<RuleSet, "version" | "skills" | "curve">
  rows: readonly ShownRow[]
}): SkillStateSnapshot {
  const { rules } = args
  const byId = new Map(args.rows.map((r) => [r.skillId, r] as const))
  const introducedIn = new Map(rules.skills.map((s) => [s.id, s.introducedIn] as const))
  const ids = [...new Set([...rules.skills.map((s) => s.id), ...byId.keys()])].sort()

  const skills = ids.map((skillId): SnapshotSkill => {
    const r = byId.get(skillId)
    const displayedXp = r?.displayedXp ?? 0
    const level = r?.level ?? levelForXp(displayedXp, rules.curve)
    return {
      skillId,
      displayedXp,
      xpLedgerSum: r?.xpLedgerSum ?? displayedXp,
      level,
      levelHighWater: Math.max(level, r?.levelHighWater ?? 0),
      firstSeenRulesVersion: r?.firstSeenRulesVersion ?? introducedIn.get(skillId) ?? rules.version,
    }
  })
  return {
    userId: args.userId,
    takenAt: args.takenAt,
    rulesVersion: rules.version,
    generation: args.generation,
    trigger: args.trigger,
    skills,
  }
}

/**
 * The D-135 waterline a snapshot stands for — the same shape `waterlineOf` gives from T2. An
 * untrained skill (0 XP, level 1) constrains nothing and is left out, so a restore does not make
 * step 6 mint T2 rows that T2 never had.
 */
export function waterlineOfSnapshot(snapshot: SkillStateSnapshot): Waterline {
  const out: Waterline = {}
  for (const s of snapshot.skills) {
    const level = Math.max(s.level, s.levelHighWater)
    if (s.displayedXp > 0 || level > 1) out[s.skillId] = { xp: s.displayedXp, level }
  }
  return out
}

export interface SnapshotS3 {
  send(command: PutObjectCommand): Promise<unknown>
  send(command: ListObjectsV2Command): Promise<{
    Contents?: Array<{ Key?: string }>
    NextContinuationToken?: string
    IsTruncated?: boolean
  }>
  send(command: GetObjectCommand): Promise<{ Body?: { transformToString(): Promise<string> } }>
}

export interface SnapshotDeps {
  s3: SnapshotS3
  bucket: string
}

export async function writeSnapshot(snapshot: SkillStateSnapshot, deps: SnapshotDeps): Promise<string> {
  const key = snapshotKey(snapshot)
  // D-143: what was DISPLAYED is not derivable from raw/, so this write is system-of-record — not a cache to "simplify" away.
  await deps.s3.send(
    new PutObjectCommand({
      Bucket: deps.bucket,
      Key: key,
      Body: JSON.stringify(snapshot, null, 2) + "\n",
      ContentType: "application/json",
      IfNoneMatch: "*",
    }),
  )
  return key
}

/** The newest snapshot for this user, or `undefined` when none was ever written. */
export async function latestSnapshot(userId: string, deps: SnapshotDeps): Promise<SkillStateSnapshot | undefined> {
  let newest: string | undefined
  let ContinuationToken: string | undefined
  do {
    const page = await deps.s3.send(
      new ListObjectsV2Command({ Bucket: deps.bucket, Prefix: snapshotPrefix(userId), ContinuationToken }),
    )
    for (const o of page.Contents ?? []) {
      if (o.Key?.endsWith(".json") && (newest === undefined || o.Key > newest)) newest = o.Key
    }
    ContinuationToken = page.IsTruncated ? page.NextContinuationToken : undefined
  } while (ContinuationToken)
  if (newest === undefined) return undefined

  const got = await deps.s3.send(new GetObjectCommand({ Bucket: deps.bucket, Key: newest }))
  const snapshot = JSON.parse((await got.Body?.transformToString()) ?? "") as SkillStateSnapshot
  if (snapshot.userId !== userId || !Array.isArray(snapshot.skills)) {
    throw new Error(`latestSnapshot: ${newest} is not a skill-state snapshot for ${userId}`)
  }
  return snapshot
}

/** Every T2 row for this user, strongly consistent, as the snapshot and the replay read it. */
export async function readShownRows(
  userId: string,
  deps: { ddb: { send(command: QueryCommand): Promise<unknown> }; table: string },
): Promise<Array<ShownRow & Record<string, unknown>>> {
  const items: Record<string, unknown>[] = []
  let ExclusiveStartKey: Record<string, unknown> | undefined
  do {
    const page = (await deps.ddb.send(
      new QueryCommand({
        TableName: deps.table,
        KeyConditionExpression: "userId = :u",
        ExpressionAttributeValues: { ":u": userId },
        ConsistentRead: true,
        ExclusiveStartKey,
      }),
    )) as { Items?: Record<string, unknown>[]; LastEvaluatedKey?: Record<string, unknown> }
    items.push(...(page.Items ?? []))
    ExclusiveStartKey = page.LastEvaluatedKey
  } while (ExclusiveStartKey)
  const num = (v: unknown) => (v === undefined || v === null ? undefined : Number(v))
  return items.map((i) => ({
    ...i,
    skillId: String(i.skillId),
    displayedXp: Number(i.displayedXp ?? 0),
    xpLedgerSum: Number(i.xpLedgerSum ?? 0),
    level: num(i.level),
    levelHighWater: num(i.levelHighWater),
    firstSeenRulesVersion: num(i.firstSeenRulesVersion),
  }))
}
