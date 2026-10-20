import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"

import { DynamoDBClient } from "@aws-sdk/client-dynamodb"
import { ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3"
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs"
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb"

import { isOwner } from "../../lib/auth/owner-ids"
import { ingestKeyFor } from "../../src/adapters/strava/accept"
import { RAW_ENVELOPE_SCHEMA_HINT, sealRawEnvelope } from "../../src/adapters/strava/raw-envelope"
import type { IngestJob } from "../../src/adapters/types"
import { computeActivityId } from "../../src/domain/activity-id"
import { archiveRaw } from "../../src/pipeline/archive"
import { acceptIngest, type ReceiptDdb } from "../../src/pipeline/ingest-receipt"
import { modelTables } from "../xp-replay/tables"

/**
 * GIVE A THROWAWAY ACCOUNT ONE GENUINELY INGESTED RUN. Ticket `0106`, for its one execution.
 *
 *   npx vite-node --config vitest.config.ts tools/account-deletion/seed-throwaway.ts -- --user <throwaway-sub>
 *   npx vite-node --config vitest.config.ts tools/account-deletion/seed-throwaway.ts -- --user <throwaway-sub> --confirm
 *
 * The deletion has to be run against an account with real raw objects, cells, ledger rows and
 * explored cells, or it proves only that the script runs (0106 Notes). Nobody goes running for it
 * (D-229), and the throwaway has no Strava connection, so the run comes from a committed SYNTHETIC
 * fixture (`run-continuous.json`, Point Nemo geometry, D-199) and goes through the REAL pipeline:
 *
 *   1. `archiveRaw` — the worker's own archive PUT, to `raw/<sub>/strava/<id>/<sha>.json`
 *   2. `acceptIngest` — the accept gate's receipt row, keyed as the webhook would key it
 *   3. one `command: "reingest"` job on the ingest queue — the deployed worker reads the bytes back
 *      out of `raw/` (`src/pipeline/replay.ts`), normalizes, projects cells, writes `ExploredCell`,
 *      the ledger and the explored blob, exactly as for any replayed run
 *
 * REFUSES the owner, a sub that is not a user in the pool, and an account that already has an
 * archive or activities: this tool only ever seeds a fresh throwaway, so the deletion that follows
 * has a known before-state.
 */

const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "")
const FIXTURE = `${ROOT}/src/adapters/strava/__fixtures__/run-continuous.json`
const outputs = JSON.parse(readFileSync(`${ROOT}/amplify_outputs.json`, "utf8")) as {
  auth?: { user_pool_id?: string }
  storage?: { bucket_name?: string }
  custom?: { activityIngestQueueUrl?: string }
  data?: { aws_region?: string }
}

const args = process.argv.slice(2)
const at = args.indexOf("--user")
const userId = at >= 0 ? args[at + 1] : undefined
const confirm = args.includes("--confirm")
if (!userId) {
  console.error("usage: seed-throwaway.ts --user <throwaway-cognito-sub> [--confirm]")
  process.exit(2)
}
if (isOwner(userId)) {
  console.error("refusing: that sub is in OWNER_USER_IDS. This seeds throwaway accounts only.")
  process.exit(2)
}
const region = outputs.data?.aws_region ?? "us-east-1"
const bucket = outputs.storage?.bucket_name
const queue = outputs.custom?.activityIngestQueueUrl
const pool = outputs.auth?.user_pool_id
if (!bucket || !queue || !pool) {
  console.error("amplify_outputs.json lacks storage.bucket_name, custom.activityIngestQueueUrl or auth.user_pool_id")
  process.exit(2)
}

const users = JSON.parse(
  execFileSync("aws", ["cognito-idp", "list-users", "--user-pool-id", pool, "--filter", `sub = "${userId}"`, "--output", "json"], {
    encoding: "utf8",
  }),
) as { Users?: unknown[] }
if ((users.Users ?? []).length !== 1) {
  console.error(`refusing: no Cognito user with sub ${userId} in ${pool}`)
  process.exit(2)
}

const raw = new DynamoDBClient({ region })
const ddb = DynamoDBDocumentClient.from(raw)
const s3 = new S3Client({ region })
const tables = await modelTables(raw)

const archived = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: `raw/${userId}/`, MaxKeys: 1 }))
const activities = await ddb.send(
  new QueryCommand({
    TableName: tables.Activity,
    IndexName: "byUserAndStart",
    KeyConditionExpression: "userId = :u",
    ExpressionAttributeValues: { ":u": userId },
    Limit: 1,
  }),
)
if ((archived.KeyCount ?? 0) > 0 || (activities.Items ?? []).length > 0) {
  console.error("refusing: this account already has an archive or activities. Seed a FRESH throwaway.")
  process.exit(2)
}

const fixture = JSON.parse(readFileSync(FIXTURE, "utf8")) as { detail: { id: number }; streams: unknown }
const externalId = String(fixture.detail.id)
const body = sealRawEnvelope(Buffer.from(JSON.stringify(fixture.detail)), Buffer.from(JSON.stringify(fixture.streams)))
const activityId = computeActivityId(userId, "strava", externalId)
// The webhook keys a create by the athlete id; a throwaway has none, so its own sub stands in.
const ingestKey = ingestKeyFor(`throwaway-${userId}`, externalId)

console.log(`user        ${userId}`)
console.log(`fixture     ${FIXTURE.slice(ROOT.length + 1)} (strava/${externalId}, synthetic geometry)`)
console.log(`activityId  ${activityId}`)
console.log(`ingestKey   ${ingestKey}`)
if (!confirm) {
  console.log("\nDRY RUN — nothing written. Re-run with --confirm.")
  process.exit(0)
}

const put = await archiveRaw(
  { userId, source: "strava", externalId, body, contentType: "application/json", ext: "json", schemaHint: RAW_ENVELOPE_SCHEMA_HINT },
  { s3, bucket },
)
console.log(`archived    ${JSON.stringify(put)}`)
const accepted = await acceptIngest({ ingestKey, userId, activityId, source: "strava" }, { ddb: ddb as unknown as ReceiptDdb })
console.log(`receipt     ${accepted.kind}`)
const now = new Date().toISOString()
const job: IngestJob = {
  ingestKey,
  userId,
  source: "strava",
  externalId,
  command: "reingest",
  startedAt: now,
  meta: null,
  enqueuedAt: now,
}
await new SQSClient({ region }).send(new SendMessageCommand({ QueueUrl: queue, MessageBody: JSON.stringify(job) }))
console.log("enqueued    1 reingest job. Wait for the receipt to reach DONE, then inventory before deleting.")
