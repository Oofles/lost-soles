import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"

import { DynamoDBClient } from "@aws-sdk/client-dynamodb"
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3"
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb"

import type { RouteTraceGeometry } from "../../src/pipeline/route-trace-store"
import { routeTraceKey } from "../../src/pipeline/route-trace-store"
import { editTraceWeb, webRunFrom, type TraceWebRun } from "../../src/pipeline/trace-web-store"

/**
 * REBUILD THE PERMANENT WEB FROM THE PER-RUN ROUTES. Ticket `0085`, D-299.
 *
 *   npx vite-node --config vitest.config.ts tools/trace-web/rebuild-trace-web.ts -- --user <sub>
 *   npx vite-node --config vitest.config.ts tools/trace-web/rebuild-trace-web.ts -- --user <sub> --confirm
 *
 * `users/<uid>/traces/web.json.gz` is derived: every entry in it is a per-run object
 * (`<activityId>.segments.json.gz`, written by `0195`) plus the row's `startedAt`. This walks T3's
 * `byUserAndStart` for every row with a `traceRef`, reads its object, and folds the lot into the web
 * — the backfill for runs ingested before `0085`, and the repair if the web is ever lost.
 *
 * MERGES, never replaces: it goes through `editTraceWeb`'s `IfMatch`, so an ingest landing mid-run
 * is kept. DRY RUN BY DEFAULT — without `--confirm` it reports what it would write.
 *
 * AWS: the ambient profile. `AWS_PROFILE=devault`, account 286588821906, us-east-1 (CLAUDE.md).
 */

const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "")
const outputs = JSON.parse(readFileSync(`${ROOT}/amplify_outputs.json`, "utf8")) as {
  storage?: { bucket_name?: string; aws_region?: string }
  custom?: { activityTableName?: string }
}

const args = process.argv.slice(2)
const flag = (name: string): string | undefined => {
  const at = args.indexOf(`--${name}`)
  return at >= 0 ? args[at + 1] : undefined
}
const userId = flag("user")
const confirm = args.includes("--confirm")
if (!userId) {
  console.error("usage: rebuild-trace-web.ts --user <cognito-sub> [--confirm]")
  process.exit(2)
}

const region = outputs.storage?.aws_region ?? "us-east-1"
const bucket = outputs.storage?.bucket_name
const table = outputs.custom?.activityTableName
if (!bucket || !table) {
  console.error("amplify_outputs.json has no storage.bucket_name or custom.activityTableName.")
  process.exit(2)
}

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region }))
const s3 = new S3Client({ region })

const rows: Array<{ id: string; startedAt: string }> = []
let start: Record<string, unknown> | undefined
do {
  const out = await ddb.send(
    new QueryCommand({
      TableName: table,
      IndexName: "byUserAndStart",
      KeyConditionExpression: "#u = :u",
      ExpressionAttributeNames: { "#u": "userId" },
      ExpressionAttributeValues: { ":u": userId },
      ExclusiveStartKey: start,
    }),
  )
  for (const r of out.Items ?? []) {
    if (typeof r.traceRef === "string" && r.traceRef && typeof r.id === "string" && typeof r.startedAt === "string") {
      rows.push({ id: r.id, startedAt: r.startedAt })
    }
  }
  start = out.LastEvaluatedKey
} while (start)

const runs: Record<string, TraceWebRun> = {}
let missing = 0
for (const row of rows) {
  try {
    const out = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: routeTraceKey(userId, row.id) }))
    const bytes = await out.Body!.transformToByteArray()
    const geometry = JSON.parse(gunzipSync(bytes).toString("utf8")) as RouteTraceGeometry
    const run = webRunFrom(row.startedAt, geometry)
    if (run.lines.length > 0) runs[row.id] = run
  } catch (e) {
    missing++
    console.warn(`  ${row.id}: no route object (${(e as Error).name})`)
  }
}

const vertices = Object.values(runs).reduce((n, r) => n + r.lines.reduce((m, l) => m + l.length, 0), 0)
console.log(`${rows.length} traced rows, ${Object.keys(runs).length} routes, ${vertices} vertices, ${missing} missing`)

if (!confirm) {
  console.log("dry run — nothing written. Re-run with --confirm.")
  process.exit(0)
}

await editTraceWeb(userId, (web) => ({ v: 1, runs: { ...web.runs, ...runs } }), { s3: s3 as never, bucket })
console.log(`wrote users/${userId}/traces/web.json.gz`)
