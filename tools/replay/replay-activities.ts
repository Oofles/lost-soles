import { readFileSync } from "node:fs"

import { DynamoDBClient } from "@aws-sdk/client-dynamodb"
import { ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3"
import { GetCommand, ScanCommand, DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb"
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs"

import { computeActivityId } from "../../src/domain/activity-id"
import type { IngestJob } from "../../src/adapters/types"
import type { SourceId } from "../../src/domain/activity"
import { adoptReceipt, type ReceiptDdb } from "../../src/pipeline/ingest-receipt"

/**
 * REPLAY ARCHIVED ACTIVITIES THROUGH THE REAL PIPELINE. Ticket `0192`.
 *
 *   npx vite-node tools/replay/replay-activities.ts -- --user <sub>
 *   npx vite-node tools/replay/replay-activities.ts -- --user <sub> --confirm
 *   npx vite-node tools/replay/replay-activities.ts -- --user <sub> --adopt --confirm
 *
 * Enqueues one `command: "reingest"` job per archived activity. The worker reads the bytes back out
 * of `raw/` rather than from the source (`src/pipeline/replay.ts`), and the score gate re-claims the
 * `DONE` receipt (`ClaimOptions.replay`). Nothing else about the pipeline changes: same normalizer,
 * same projection, same cell writes, same transaction.
 *
 * ─── DRY RUN BY DEFAULT, AND THE DEFAULT IS THE POINT ────────────────────────
 *
 * This writes to a map that never re-fogs (D-020). Nothing it reveals can be taken back, so the safe
 * direction has to be the one you get by forgetting a flag. `--confirm` is the only thing that sends
 * a message, and the dry run prints exactly what the real run would do.
 *
 * ─── TYPESCRIPT, NOT `scripts/*.mjs`, AND THAT IS DELIBERATE ─────────────────
 *
 * Everything in `scripts/` is plain node because it runs in the Amplify build container, which has
 * no TypeScript (D-163). This never runs in CI — it is an operator tool — and it needs
 * `computeActivityId` to link an archived object to its receipt row. Restating that derivation in a
 * script would be a second implementation of I-5's deterministic id, which is exactly the kind of
 * duplicate that is right until the day it is not.
 *
 * ─── WHY IT RECURS, SO IT IS A FILE AND NOT A ONE-LINER ──────────────────────
 *
 * `0192` is the first replay — ten runs ingested before the cell writer existed. It will not be the
 * last: the SCORE receipt key carries `FOG_ALGO_VERSION` precisely so *"a deliberate scoring change
 * invalidates every key and forces an auditable rescore"*, and capability `09` will want these same
 * runs re-scored once XP exists. A tool typed once into a terminal is a tool that gets reinvented,
 * differently, under time pressure.
 *
 * ─── `--adopt`: ARCHIVED BYTES WITH NO RECEIPT. Ticket `0193`, D-265 ─────────
 *
 * An activity imported before the accept gate existed — or one whose receipt has outlived its 90-day
 * TTL, which will be every activity eventually — has no row for `recordDelivery` to count, and the
 * worker rejects its reingest by design. `--adopt` writes the missing row through `adoptReceipt`:
 * `keyKind: "ADOPT"`, naming the archived object it came from, so the table never claims the gate
 * saw an acceptance it did not. Only for an activity with BOTH archived bytes and an `Activity` row;
 * bytes alone could be a run that never got as far as being one.
 *
 * Without `--adopt` the orphans are listed with the flag that would recover them. They are not
 * "skipped" — that word read as a verdict, and it was only ever a missing operator decision.
 *
 * AWS: the ambient profile. `AWS_PROFILE=devault`, account 286588821906, us-east-1 (CLAUDE.md).
 */

const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "")
const outputs = JSON.parse(readFileSync(`${ROOT}/amplify_outputs.json`, "utf8")) as {
  storage?: { bucket_name?: string }
  custom?: { activityIngestQueueUrl?: string; activityTableName?: string }
  data?: { aws_region?: string }
}

const RECEIPT_TABLE = "LostSolesIngestReceipt"

const args = process.argv.slice(2)
const flag = (name: string): string | undefined => {
  const at = args.indexOf(`--${name}`)
  return at >= 0 ? args[at + 1] : undefined
}
const userId = flag("user")
const only = flag("external")
const confirm = args.includes("--confirm")
const adopt = args.includes("--adopt")

if (!userId) {
  console.error(
    "usage: replay-activities.ts --user <cognito-sub> [--external <externalId>] [--adopt] [--confirm]",
  )
  process.exit(2)
}

const region = outputs.data?.aws_region ?? "us-east-1"
const bucket = outputs.storage?.bucket_name
const queue = outputs.custom?.activityIngestQueueUrl
const activityTable = outputs.custom?.activityTableName
if (!bucket || !queue || !activityTable) {
  console.error(
    "amplify_outputs.json has no storage.bucket_name, custom.activityIngestQueueUrl or " +
      "custom.activityTableName — this " +
      "file is generated per environment and a missing value means it predates the deploy.",
  )
  process.exit(2)
}

const s3 = new S3Client({ region })
const sqs = new SQSClient({ region })
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region }))

interface Archived {
  source: SourceId
  externalId: string
  newestKey: string
  objects: number
}

/**
 * Every activity this user has archived bytes for, from the key layout alone.
 *
 * `raw/<uid>/<source>/<externalId>/<sha256>.<ext>` (`src/pipeline/archive.ts`), so **the path is
 * the index**: there is no table to consult and nothing that can fall out of step with it. That is
 * also the property that makes the archive a system of record rather than a cache.
 */
async function archivedActivities(): Promise<Archived[]> {
  const found = new Map<string, Archived & { newestAt: number }>()
  let token: string | undefined
  do {
    const page = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: `raw/${userId}/`,
        ContinuationToken: token,
      }),
    )
    for (const object of page.Contents ?? []) {
      const parts = (object.Key ?? "").split("/")
      // raw / uid / source / externalId / <digest>.<ext>
      if (parts.length !== 5 || !parts[4]) continue
      // `0243`. `<externalId>.kind-override/<id>.json` has the same depth and is a correction, not a run.
      if (parts[3]!.endsWith(".kind-override")) continue
      const source = parts[2] as SourceId
      const externalId = parts[3]!
      const at = object.LastModified?.getTime() ?? 0
      const id = `${source}/${externalId}`
      const existing = found.get(id)
      if (!existing) {
        found.set(id, { source, externalId, newestKey: object.Key!, newestAt: at, objects: 1 })
      } else {
        existing.objects++
        if (at > existing.newestAt) {
          existing.newestAt = at
          existing.newestKey = object.Key!
        }
      }
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined
  } while (token)
  return [...found.values()]
    .map(({ source, externalId, newestKey, objects }) => ({ source, externalId, newestKey, objects }))
    .sort((a, b) => (a.externalId < b.externalId ? -1 : 1))
}

/**
 * `activityId -> receipt`. The receipt carries the ACCEPT `ingestKey`, which is
 * `sha256("<source>:<ownerId>:<externalId>:<aspectType>")` — built by the adapter, because only the
 * adapter knows what its events look like (D-100). A script cannot rebuild it and must not try; the
 * deterministic `activityId` is the link that lets it be looked up instead.
 *
 * A `Scan` over a table holding one row per import, bounded by how much the operator has run. Honest
 * at this size; an index built for a backfill would be infrastructure carried forever.
 */
async function receiptsByActivityId(): Promise<
  Map<string, { ingestKey: string; status: string; newCellCount?: number }>
> {
  const byId = new Map<string, { ingestKey: string; status: string; newCellCount?: number }>()
  let start: Record<string, unknown> | undefined
  do {
    const page = await ddb.send(
      new ScanCommand({ TableName: RECEIPT_TABLE, ExclusiveStartKey: start }),
    )
    for (const item of (page.Items ?? []) as Array<Record<string, string | number>>) {
      if (item.userId !== userId) continue
      byId.set(String(item.activityId), {
        ingestKey: String(item.ingestKey),
        status: String(item.status),
        newCellCount: item.newCellCount as number | undefined,
      })
    }
    start = page.LastEvaluatedKey
  } while (start)
  return byId
}

const activities = await archivedActivities()
const receipts = await receiptsByActivityId()

const plan: Array<{
  activity: Archived
  ingestKey: string
  status: string
  cells: number
  adopting?: { activityId: string }
}> = []
const orphans: Array<Archived & { hasActivityRow: boolean }> = []

for (const activity of activities) {
  if (only && activity.externalId !== only) continue
  const activityId = computeActivityId(userId, activity.source, activity.externalId)
  const receipt = receipts.get(activityId)
  if (!receipt) {
    // No receipt means `recordDelivery`'s condition would fail and the message would be rejected
    // having written nothing. Never enqueued as-is. With `--adopt` and an `Activity` row to prove
    // the run was real, a receipt is reconstructed — marked as such — and the run joins the plan.
    const row = await ddb.send(
      new GetCommand({ TableName: activityTable, Key: { id: activityId }, ProjectionExpression: "id" }),
    )
    const hasActivityRow = row.Item !== undefined
    if (adopt && hasActivityRow) {
      plan.push({ activity, ingestKey: "", status: "ADOPT", cells: 0, adopting: { activityId } })
    } else {
      orphans.push({ ...activity, hasActivityRow })
    }
    continue
  }
  plan.push({
    activity,
    ingestKey: receipt.ingestKey,
    status: receipt.status,
    cells: receipt.newCellCount ?? 0,
  })
}

console.log(`user     ${userId}`)
console.log(`bucket   ${bucket}`)
console.log(`archived ${activities.length} activities, ${receipts.size} receipts\n`)
console.log("  external id            status  cells  archived object")
for (const entry of plan) {
  console.log(
    `  ${`${entry.activity.source}/${entry.activity.externalId}`.padEnd(22)} ` +
      `${entry.status.padEnd(7)} ${String(entry.cells).padStart(5)}  ${entry.activity.newestKey}` +
      (entry.activity.objects > 1 ? `  (${entry.activity.objects} objects, newest wins)` : ""),
  )
}
for (const orphan of orphans) {
  console.log(
    `  ${`${orphan.source}/${orphan.externalId}`.padEnd(22)} NO RECEIPT — ` +
      (orphan.hasActivityRow
        ? "re-run with --adopt to reconstruct one"
        : "and no Activity row; not adoptable, investigate by hand"),
  )
}

if (!confirm) {
  console.log(`\nDRY RUN — nothing was enqueued. ${plan.length} would be. Re-run with --confirm.`)
  process.exit(0)
}

const enqueuedAt = new Date().toISOString()
let sent = 0
for (const entry of plan) {
  if (entry.adopting) {
    const adopted = await adoptReceipt(
      {
        userId: userId!,
        activityId: entry.adopting.activityId,
        source: entry.activity.source,
        adoptedFrom: entry.activity.newestKey,
      },
      { ddb: ddb as unknown as ReceiptDdb },
    )
    entry.ingestKey = adopted.ingestKey
    console.log(`  ${adopted.kind} receipt ${adopted.ingestKey}`)
  }
  /**
   * `startedAt` is `IngestJob`'s "when the activity happened" (D-208), and it exists on the job for
   * the WATERMARK's benefit — `listSince` is written in terms of activity start dates. A replay does
   * not move the watermark and nothing downstream reads this field, so the enqueue time is an honest
   * placeholder and a fabricated activity date would not be.
   *
   * The real start date reaches the pipeline the same way it always does: out of the archived bytes,
   * through the adapter's own `normalize`. That is the value the cells are scored on.
   */
  const job: IngestJob = {
    ingestKey: entry.ingestKey,
    userId: userId!,
    source: entry.activity.source,
    externalId: entry.activity.externalId,
    command: "reingest",
    startedAt: enqueuedAt,
    meta: null,
    enqueuedAt,
  }
  await sqs.send(new SendMessageCommand({ QueueUrl: queue, MessageBody: JSON.stringify(job) }))
  sent++
  console.log(`  enqueued ${entry.activity.source}/${entry.activity.externalId}`)
}

console.log(`\nenqueued ${sent} reingest job(s). Watch the worker's logs, then check T6.`)
