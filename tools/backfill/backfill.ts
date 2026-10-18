import { readFileSync } from "node:fs"

import { DynamoDBClient } from "@aws-sdk/client-dynamodb"
import { S3Client } from "@aws-sdk/client-s3"
import { GetQueueAttributesCommand, SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs"
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb"

import { buildBackfillBatch, writeBackfillBatch } from "../../lib/backfill/store"
import { runBackfill, type BackfillWindowReport } from "../../lib/sources/backfill"
import { oauthCredentialsFor } from "../../lib/sources/adapter-credentials"
import { getSourceAccountSummary } from "../../lib/sources/source-account-store"
import { getAdapter } from "../../src/adapters/registry"
import {
  backfillPace,
  describeReadBudget,
  mergeRateLimit,
  parseRateLimit,
  type RateLimitStatus,
} from "../../src/adapters/strava/rate-limit"
import { modelTables } from "../xp-replay/tables"

/**
 * THE HISTORICAL BACKFILL. Ticket 0177, `03-integrations.md` §2.5.
 *
 *   npx vite-node --config vitest.config.ts tools/backfill/backfill.ts -- --user <sub>
 *   npx vite-node --config vitest.config.ts tools/backfill/backfill.ts -- --user <sub> --confirm
 *
 * Imports the connected Strava account's whole history, oldest first, through the ordinary
 * ingest queue. It is paced against the read budget one 15-minute window at a time, and it
 * sleeps between windows. ONE invocation covers the whole import. The account holds about 115
 * activities, which is about 230 worker reads: three windows at the default tier
 * (100 reads / 15 min), so about 45 minutes.
 *
 * WITHOUT `--confirm` it reads the connection and the ingest queue depth, prints them and stops.
 * It makes no provider call, so it spends no read budget. That makes it the safe status check.
 *
 * KILL IT AND RE-RUN IT FREELY. It keeps no checkpoint. A re-run lists from the beginning, and
 * every activity already accepted is a free duplicate at the receipt gate. Before every listing it
 * waits for the ingest queue to drain, so a re-run never enqueues an activity twice
 * (`lib/sources/backfill.ts`).
 *
 * THE PROGRESS SURFACE IS THIS TERMINAL (operator decision, ticket 0177). It prints one line per
 * window: the date the listing has reached, the counts, and the read budget. Nothing in the app
 * shows it, and D-318 stands.
 *
 * WHEN IT FINISHES (`0257`) it waits for the ingest queue to drain — the last window's activities
 * are still being processed — and writes the BACKFILL BATCH RECORD (`lib/backfill/store.ts`): the
 * window, which activities came in, and the standing before and after. The next map visit, on any
 * device, plays one aggregate reveal of the whole import from it, and none of the imported runs
 * counts as new. An import that queued nothing writes no record.
 *
 * THEN run the XP replay. Cells a historical run shares with the recent,
 * already-scored month classify `deferred` and earn nothing until a replay folds the history
 * (D-221, D-271). The completion message prints the exact command.
 *
 * AWS: the ambient profile. `AWS_PROFILE=devault`, account 286588821906, us-east-1 (CLAUDE.md).
 */

const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "")
const outputs = JSON.parse(readFileSync(`${ROOT}/amplify_outputs.json`, "utf8")) as {
  custom?: { activityIngestQueueUrl?: string }
  data?: { aws_region?: string }
  storage?: { bucket_name?: string }
}

const args = process.argv.slice(2)
const flag = (name: string): string | undefined => {
  const at = args.indexOf(`--${name}`)
  return at >= 0 ? args[at + 1] : undefined
}
const userId = flag("user")
const confirm = args.includes("--confirm")
/** Strava is the only source with a history to import and the only one §2.5 paces. */
const SOURCE = "strava" as const

if (!userId) {
  console.error("usage: backfill.ts --user <cognito-sub> [--confirm]")
  process.exit(2)
}

const region = outputs.data?.aws_region ?? "us-east-1"
const queueUrl = outputs.custom?.activityIngestQueueUrl
if (!queueUrl) {
  console.error("amplify_outputs.json has no custom.activityIngestQueueUrl. It predates the deploy.")
  process.exit(2)
}

const sqs = new SQSClient({ region })
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region }), {
  marshallOptions: { removeUndefinedValues: true },
})

const stamp = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace("T", " ") + "Z"
const month = (iso: string) => iso.slice(0, 7)

const account = await getSourceAccountSummary(userId, SOURCE)
console.log(`user ${userId} · ${SOURCE} ${account?.status ?? "not connected"}`)

if (account?.status !== "ACTIVE") {
  console.error(`  ${SOURCE} is not ACTIVE; reconnect it in /settings before importing.`)
  process.exit(1)
}
if (!confirm) {
  console.log(`  ingest queue depth: ${await queueDepth()}`)
  console.log("\nstatus only: no provider call made. Re-run with --confirm to import.")
  process.exit(0)
}

/**
 * THE BUDGET READING, taken off every list response by wrapping the client's `fetch`. The
 * adapter's list call goes through this. Nothing else in this process calls the read API.
 * `mergeRateLimit` keeps the last reading across a response without headers, and
 * `beginWindow` clears it, so each window is paced on its own list call's headers.
 */
let reading: RateLimitStatus | null = null

/** 1° tiles of each listed activity's start, for sizing the basemap follow-up. Terminal only. */
const tiles = new Map<string, Set<string>>()

const meteredFetch: typeof fetch = async (input, init) => {
  const res = await fetch(input, init)
  reading = mergeRateLimit(reading, parseRateLimit(res.headers))
  if (res.ok && String(input).includes("/athlete/activities")) {
    try {
      const page = JSON.parse(await res.clone().text()) as Array<{ id?: unknown; start_latlng?: unknown }>
      for (const a of Array.isArray(page) ? page : []) {
        const ll = a.start_latlng
        if (!Array.isArray(ll) || ll.length !== 2) continue
        const key = `${Math.floor(Number(ll[0]))},${Math.floor(Number(ll[1]))}`
        if (!tiles.has(key)) tiles.set(key, new Set())
        tiles.get(key)!.add(String(a.id))
      }
    } catch {
      // The summary is a convenience; the import never depends on it.
    }
  }
  return res
}

async function queueDepth(): Promise<number> {
  const res = await sqs.send(
    new GetQueueAttributesCommand({
      QueueUrl: queueUrl,
      AttributeNames: [
        "ApproximateNumberOfMessages",
        "ApproximateNumberOfMessagesNotVisible",
        "ApproximateNumberOfMessagesDelayed",
      ],
    }),
  )
  const a = res.Attributes ?? {}
  return (
    Number(a.ApproximateNumberOfMessages ?? 0) +
    Number(a.ApproximateNumberOfMessagesNotVisible ?? 0) +
    Number(a.ApproximateNumberOfMessagesDelayed ?? 0)
  )
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

function line(r: BackfillWindowReport): string {
  const reached = r.completed ? "reached the end of the account" : `reached ${month(r.cursor)}`
  const next = r.completed
    ? "done"
    : r.sleepUntilMs
      ? `next window ${stamp(r.sleepUntilMs)} (${r.reason})`
      : "continuing"
  return (
    `[${stamp(Date.now())}] window ${r.window} · ${reached} · +${r.queuedThisWindow} queued ` +
    `(${r.queued} total), ${r.knownThisWindow} already known · ${describeReadBudget(reading)} · ${next}`
  )
}

const runStartedAt = new Date().toISOString()
const tally = await runBackfill(userId, {
  adapter: getAdapter(SOURCE),
  credentials: { ...oauthCredentialsFor({ userId, source: SOURCE }), fetch: meteredFetch },
  receipt: { ddb: ddb as never },
  enqueue: async (job) => {
    await sqs.send(new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: JSON.stringify(job) }))
  },
  async beginWindow() {
    let depth = await queueDepth()
    if (depth > 0) console.log(`[${stamp(Date.now())}] waiting for ${depth} queued activities to finish`)
    while (depth > 0) {
      await sleep(15_000)
      depth = await queueDepth()
    }
    reading = null
  },
  pace: (enqueuedThisWindow) => backfillPace(reading, enqueuedThisWindow, Date.now()),
  sleep,
  report: (r) => console.log(line(r)),
})

/**
 * `0257`. THE WINDOW CLOSES WHEN THE WORKER HAS FINISHED, not when the last enqueue returned: on
 * 2026-10-16 four of the 97 activities were ingested a few seconds after the end instant this CLI
 * printed. So wait for the queue to drain, then a little longer for the last commit.
 */
if (tally.queued > 0) {
  let depth = await queueDepth()
  while (depth > 0) {
    console.log(`[${stamp(Date.now())}] waiting for ${depth} queued activities to finish`)
    await sleep(15_000)
    depth = await queueDepth()
  }
  await sleep(15_000)
}
const runEndedAt = new Date().toISOString()

const range = tally.importedFrom ? `, runs dated ${tally.importedFrom} → ${tally.importedTo}` : ""
console.log(
  `\nbackfill complete: ${tally.queued} queued, ${tally.alreadyKnown} already known${range}\n` +
    `  this run: ${runStartedAt} → ${runEndedAt} (match T3 ingestedAt against it)`,
)

/** `0257`. The record the aggregate reveal plays from. Only for an import that brought something in. */
const bucket = outputs.storage?.bucket_name
if (tally.queued > 0 && bucket) {
  try {
    const s3 = new S3Client({ region })
    const tables = await modelTables(new DynamoDBClient({ region }))
    const batch = await buildBackfillBatch(
      userId,
      { from: runStartedAt, to: runEndedAt },
      { ddb: ddb as never, s3: s3 as never, bucket, activityTable: tables.Activity, skillStateTable: tables.SkillState },
    )
    const key = await writeBackfillBatch(batch, userId, { s3: s3 as never, bucket })
    console.log(
      `\nbatch record written: s3://${bucket}/${key}\n` +
        `  ${batch.imported.count} activities · Total Level ${batch.before.totalLevel} → ${batch.after.totalLevel} · ` +
        `${batch.after.cells - batch.before.cells} cells to burn back`,
    )
  } catch (error) {
    // The import itself succeeded; the record can be written by hand (the command below).
    console.error(`\nthe batch record could not be written: ${(error as Error).message}`)
  }
}
if (tiles.size > 0) {
  console.log("\nwhere the listed activities start, by 1° tile (lat, lng of the south-west corner):")
  for (const [tile, ids] of [...tiles].sort((a, b) => b[1].size - a[1].size)) {
    console.log(`  ${tile.padEnd(10)} ${ids.size}`)
  }
}
console.log(
  "\nNEXT, once the ingest queue and its DLQ are quiet: fold the history so deferred cells earn their credit.\n" +
    `  npx vite-node --config vitest.config.ts tools/xp-replay/replay-xp.ts -- --user ${userId} --to <current version>\n` +
    "  (the dry run prints each skill's current ruleset version; re-run with that --to and --confirm)\n" +
    "\nTHEN refresh the batch record, so the reveal shows the post-replay standing (0257):\n" +
    `  npx vite-node --config vitest.config.ts tools/backfill/batch-record.ts -- --user ${userId} --from ${runStartedAt} --to ${runEndedAt} --confirm`,
)
