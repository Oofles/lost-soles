import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"

import { DynamoDBClient } from "@aws-sdk/client-dynamodb"
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3"
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand, type UpdateCommandInput } from "@aws-sdk/lib-dynamodb"

import { lanternPath } from "../../lib/run-moment/lantern-path"
import { landmarksFromLedger, landmarkUpdateItem, type WalkRow } from "../../src/pipeline/landmarks"
import { routeTraceKey, type RouteTraceGeometry } from "../../src/pipeline/route-trace-store"
import { rulesForUser } from "../../src/pipeline/worker-rules"
import { loadRuleSet } from "../../src/rules/load"
import { modelTables } from "../xp-replay/tables"

/**
 * BACKFILL A USER'S LANDMARKS FROM THEIR LEDGER. Ticket `0248`, D-301.
 *
 *   npx vite-node --config vitest.config.ts tools/landmarks/backfill-landmarks.ts -- --user <sub>
 *   npx vite-node --config vitest.config.ts tools/landmarks/backfill-landmarks.ts -- --user <sub> --confirm
 *
 * Walks T4's `byUserAndSeq` in activity order (`landmarksFromLedger`), and for every 50 or 99 a
 * skill has passed, names the activity whose XP carried it there and places the landmark on that
 * activity's stored route (`0195`) at the threshold's arc — the same rule the pipeline writes by.
 *
 * SAFE TO RE-RUN, AND SAFE AFTER A REPLAY. Every write is `landmarkUpdateItem`'s `if_not_exists`,
 * so a landmark already recorded — by ingest, or by an earlier run of this — is left exactly where
 * it is. That is also the repair for a replay that newly carries a skill past 50: the replay never
 * writes landmarks, and this picks up what it crossed.
 *
 * DRY RUN BY DEFAULT. It prints skill, level, activity and date, and whether a route was found —
 * never the coordinate (`08` §7.2: a landmark is a place near home).
 *
 * AWS: the ambient profile. `AWS_PROFILE=devault`, account 286588821906, us-east-1 (CLAUDE.md).
 */

const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "")
const outputs = JSON.parse(readFileSync(`${ROOT}/amplify_outputs.json`, "utf8")) as {
  storage?: { bucket_name?: string; aws_region?: string }
}

const args = process.argv.slice(2)
const flag = (name: string): string | undefined => {
  const at = args.indexOf(`--${name}`)
  return at >= 0 ? args[at + 1] : undefined
}
const userId = flag("user")
const confirm = args.includes("--confirm")
if (!userId) {
  console.error("usage: backfill-landmarks.ts --user <cognito-sub> [--confirm]")
  process.exit(2)
}

const region = outputs.storage?.aws_region ?? "us-east-1"
const bucket = outputs.storage?.bucket_name
if (!bucket) {
  console.error("amplify_outputs.json has no storage.bucket_name — it predates the deploy.")
  process.exit(2)
}

const raw = new DynamoDBClient({ region })
const ddb = DynamoDBDocumentClient.from(raw, { marshallOptions: { removeUndefinedValues: true } })
const s3 = new S3Client({ region })
const tables = await modelTables(raw)
const bundled = new Map([1, 2].map((v) => [v, loadRuleSet(v)] as const))
const registry = await rulesForUser(userId, { ddb, table: tables.SkillState, profileTable: tables.Profile, bundled })

const rows: WalkRow[] = []
let start: Record<string, unknown> | undefined
do {
  const out = await ddb.send(
    new QueryCommand({
      TableName: tables.XpLedgerEntry,
      IndexName: "byUserAndSeq",
      KeyConditionExpression: "#u = :u",
      ExpressionAttributeNames: { "#u": "userId" },
      ExpressionAttributeValues: { ":u": userId },
      ExclusiveStartKey: start,
    }),
  )
  for (const r of out.Items ?? []) {
    rows.push({ skillId: String(r.skillId), activityId: String(r.activityId), xpAwarded: Number(r.xpAwarded), seq: String(r.seq) })
  }
  start = out.LastEvaluatedKey
} while (start)

async function route(activityId: string): Promise<RouteTraceGeometry | null> {
  try {
    const out = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: routeTraceKey(userId!, activityId) }))
    return JSON.parse(gunzipSync(await out.Body!.transformToByteArray()).toString("utf8")) as RouteTraceGeometry
  } catch (e) {
    if ((e as Error).name === "NoSuchKey") return null
    throw e
  }
}

const crossings = landmarksFromLedger(rows, registry.curve)
console.log(`${rows.length} ledger rows under ruleset v${registry.version}; ${crossings.length} place-bound crossing(s)`)

const recordedAt = new Date().toISOString()
for (const c of crossings) {
  const path = lanternPath(await route(c.activityId))
  const at = path ? path.at(c.arc) : null
  console.log(`  ${c.skillId} ${c.level} (${c.place}) — ${c.activityId}, ${c.earnedAt.slice(0, 10)}, ${at ? "on its route" : "no route: no location"}`)
  if (!confirm) continue
  const item = landmarkUpdateItem(
    { userId, skillId: c.skillId, level: c.level, place: c.place, activityId: c.activityId, earnedAt: c.earnedAt, lng: at?.[0] ?? null, lat: at?.[1] ?? null },
    recordedAt,
    tables.Landmark,
  )
  await ddb.send(new UpdateCommand(item.Update as UpdateCommandInput))
}

console.log(confirm ? "written (if_not_exists: an existing landmark was left where it was)" : "\ndry run — nothing written. Re-run with --confirm.")
