import { customOutput, defaultDdb, queryAll, type QueryDdb } from "@/lib/aws-server"
import type { CachedSkill } from "@/lib/log/optimistic"

import type { DetailLedgerRow, LandmarkRow } from "./detail"
import type { SkillLedgerRow } from "./next"
import { LEDGER_ROWS } from "./wire"

/**
 * THE SKILLS PANEL'S READS, ON THE SSR COMPUTE. Ticket `0331`, D-472.
 *
 * What `lib/skills/transport.ts` and `lib/log/transport.ts`'s `fetchSkills` asked AppSync for, one
 * for one, read here with `dynamodb:Query` as the SSR compute role. Each function returns exactly
 * the shape its transport returned before, so no component changed.
 *
 * ─── THE `userId` CONTRACT ──────────────────────────────────────────────────
 *
 * AppSync's owner rule used to do the scoping. Now the PARTITION KEY does: every query below names
 * `userId` (or `${userId}#${skillId}`, or Profile's `id`, which is the uid) as its key condition, so
 * a query cannot return another user's row. `userId` comes from `currentUserId()` in the route and
 * from nowhere else, never the query string or the body (`08` §5.3).
 */

export interface SkillReadDeps {
  ddb: QueryDdb
  ledgerTable: string
  skillStateTable: string
  profileTable: string
  landmarkTable: string
}

export const defaultSkillReadDeps = (): SkillReadDeps => ({
  ddb: defaultDdb(),
  ledgerTable: customOutput("xpLedgerTableName"),
  skillStateTable: customOutput("skillStateTableName"),
  profileTable: customOutput("profileTableName"),
  landmarkTable: customOutput("landmarkTableName"),
})

const str = (v: unknown): string => (typeof v === "string" ? v : "")
const num = (v: unknown): number => (typeof v === "number" ? v : 0)
const numOrNull = (v: unknown): number | null => (typeof v === "number" ? v : null)

/** The user's `SkillState` rows: T2's base table, partition `userId`. Every skill. */
export async function skillStates(userId: string, deps: SkillReadDeps): Promise<CachedSkill[]> {
  const items = await queryAll(deps.ddb, {
    TableName: deps.skillStateTable,
    KeyConditionExpression: "#u = :u",
    ExpressionAttributeNames: {
      "#u": "userId",
      "#s": "skillId",
      "#x": "displayedXp",
      "#r": "rulesVersionLastComputed",
      "#h": "levelHighWater",
    },
    ExpressionAttributeValues: { ":u": userId },
    ProjectionExpression: "#s, #x, #r, #h",
  })
  return items.map((s) => ({
    skillId: str(s.skillId),
    xp: num(s.displayedXp),
    ...(typeof s.rulesVersionLastComputed === "number" ? { rulesVersionLastComputed: s.rulesVersionLastComputed } : {}),
    ...(typeof s.levelHighWater === "number" ? { levelHighWater: s.levelHighWater } : {}),
  }))
}

/** Every attribute name is aliased: `level`, `units` and friends collide with DynamoDB's reserved words. */
const LEDGER_NAMES = {
  "#sk": "skillId",
  "#a": "activityId",
  "#x": "xpAwarded",
  "#v": "xpRulesVersion",
  "#f": "isFloor",
  "#q": "seq",
} as const

function ledgerRow(r: Record<string, unknown>): SkillLedgerRow {
  return {
    skillId: str(r.skillId),
    activityId: str(r.activityId),
    xpAwarded: num(r.xpAwarded),
    xpRulesVersion: num(r.xpRulesVersion),
    isFloor: r.isFloor === true,
    seq: str(r.seq),
  }
}

/** The newest `LEDGER_ROWS` ledger rows, newest activity first: T4's `byUserAndSeq`, descending. */
export async function recentLedger(userId: string, deps: SkillReadDeps): Promise<SkillLedgerRow[]> {
  const items = await queryAll(
    deps.ddb,
    {
      TableName: deps.ledgerTable,
      IndexName: "byUserAndSeq",
      KeyConditionExpression: "#u = :u",
      ExpressionAttributeNames: { "#u": "userId", ...LEDGER_NAMES },
      ExpressionAttributeValues: { ":u": userId },
      ProjectionExpression: "#sk, #a, #x, #v, #f, #q",
      ScanIndexForward: false,
    },
    { max: LEDGER_ROWS, page: 250 },
  )
  return items.map(ledgerRow)
}

/** One skill's whole ledger, every ruleset version, unordered: T4's `bySkill`, `${userId}#${skillId}`. */
export async function skillLedger(userId: string, skillId: string, deps: SkillReadDeps): Promise<DetailLedgerRow[]> {
  const items = await queryAll(deps.ddb, {
    TableName: deps.ledgerTable,
    IndexName: "bySkill",
    KeyConditionExpression: "#us = :us",
    ExpressionAttributeNames: { "#us": "userIdSkillId", ...LEDGER_NAMES, "#r": "reason", "#n": "units" },
    ExpressionAttributeValues: { ":us": `${userId}#${skillId}` },
    ProjectionExpression: "#sk, #a, #x, #v, #f, #q, #r, #n",
  })
  return items.map((r) => ({ ...ledgerRow(r), reason: str(r.reason), units: num(r.units) }))
}

/** `Profile.replayInProgress`. `false` for a user with no Profile row yet. T1's key `id` is the uid. */
export async function replayInProgress(userId: string, deps: SkillReadDeps): Promise<boolean> {
  const items = await queryAll(deps.ddb, {
    TableName: deps.profileTable,
    KeyConditionExpression: "#id = :u",
    ExpressionAttributeNames: { "#id": "id", "#r": "replayInProgress" },
    ExpressionAttributeValues: { ":u": userId },
    ProjectionExpression: "#r",
  })
  return items[0]?.replayInProgress === true
}

/**
 * The user's `Landmark` rows: the base table, partition `userId`, and for one skill a `skillLevel`
 * prefix. Two rows a skill at most, so every page is read: a list that silently stopped at one page
 * would be a cairn that silently is not there.
 */
export async function landmarks(userId: string, skillId: string | undefined, deps: SkillReadDeps): Promise<LandmarkRow[]> {
  const one = skillId !== undefined
  const items = await queryAll(deps.ddb, {
    TableName: deps.landmarkTable,
    KeyConditionExpression: one ? "#u = :u AND begins_with(#sl, :p)" : "#u = :u",
    ExpressionAttributeNames: {
      "#u": "userId",
      "#l": "level",
      "#p": "place",
      "#lng": "lng",
      "#lat": "lat",
      ...(one ? { "#sl": "skillLevel" } : {}),
    },
    ExpressionAttributeValues: { ":u": userId, ...(one ? { ":p": `${skillId}#` } : {}) },
    ProjectionExpression: "#l, #p, #lng, #lat",
  })
  return items.map((r) => ({ level: num(r.level), place: str(r.place), lng: numOrNull(r.lng), lat: numOrNull(r.lat) }))
}
