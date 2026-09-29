import { readFileSync } from "node:fs"

import { DynamoDBClient, ListTablesCommand } from "@aws-sdk/client-dynamodb"
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3"
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb"

import { getAdapter } from "../../src/adapters/registry"
import type { IngestJob } from "../../src/adapters/types"
import type { BlobStoreDeps } from "../../src/pipeline/explored-blob-store"
import { replayUser, type ReplayActivity } from "../../src/pipeline/xp-replay"
import { dynamoReplayStore } from "../../src/pipeline/xp-replay-store"
import { loadRuleSet } from "../../src/rules/load"

/**
 * RUN A REBALANCE FOR ONE USER. Ticket `0066`. `02-data-model.md` §4.4.
 *
 *   npx vite-node --config vitest.config.ts tools/xp-replay/replay-xp.ts -- --user <sub> --to <version>
 *   npx vite-node --config vitest.config.ts tools/xp-replay/replay-xp.ts -- --user <sub> --to <version> --confirm
 *
 * `--config vitest.config.ts` is required: it is what resolves the `@/` alias the pipeline
 * modules import through (declared once, in tsconfig.json). Without it vite-node fails on the
 * first `@/src/...` import.
 *
 * A rebalance is: write `rules/xp-rules-v<N>.yaml`, then run this once per user (D-014 — one at a
 * time, so a failure is one person's). Re-running after a failure RESUMES: the unfinished
 * `ReplayRun` carries the waterline, and every step is idempotent (`src/pipeline/xp-replay.ts`).
 *
 * DRY RUN BY DEFAULT, like `tools/replay/`: this rewrites a user's whole ledger. Without
 * `--confirm` it prints what it would replay and touches nothing.
 *
 * The ruleset is read from the YAML (`loadRuleSet`) — the authority; T5 does not exist yet
 * (D-217). The trace for each activity comes from **the exact archived object its `Activity.raw`
 * names**, through the shipped normalizer: the bytes ingest scored, not a re-fetch (D-121.2) and
 * not the 6-dp route GeoJSON.
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
const to = Number(flag("to"))
const confirm = args.includes("--confirm")

if (!userId || !Number.isInteger(to) || to < 1) {
  console.error("usage: replay-xp.ts --user <cognito-sub> --to <rules version> [--confirm]")
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

/** `defineData` names each table `<Model>-<apiId>-NONE`. Exactly one of each, or stop. */
async function modelTables(): Promise<Record<"Profile" | "SkillState" | "XpLedgerEntry" | "Activity", string>> {
  const names: string[] = []
  let ExclusiveStartTableName: string | undefined
  do {
    const page = await raw.send(new ListTablesCommand({ ExclusiveStartTableName }))
    names.push(...(page.TableNames ?? []))
    ExclusiveStartTableName = page.LastEvaluatedTableName
  } while (ExclusiveStartTableName)
  const one = (model: string) => {
    const hits = names.filter((n) => new RegExp(`^${model}-[a-z0-9]+-NONE$`).test(n))
    if (hits.length !== 1) throw new Error(`expected one ${model} table, found ${JSON.stringify(hits)}`)
    return hits[0]!
  }
  return {
    Profile: one("Profile"),
    SkillState: one("SkillState"),
    XpLedgerEntry: one("XpLedgerEntry"),
    Activity: one("Activity"),
  }
}

async function loadTrace(activity: ReplayActivity) {
  if (!activity.hasTrace) return undefined
  if (!activity.raw) throw new Error(`${activity.activityId} has a trace but no raw archive reference`)
  const got = await s3.send(new GetObjectCommand({ Bucket: activity.raw.bucket, Key: activity.raw.key }))
  const body = Buffer.from(await got.Body!.transformToByteArray())
  const job: IngestJob = {
    ingestKey: `xp-replay:${activity.activityId}`,
    userId: activity.userId,
    source: activity.source.source,
    externalId: activity.source.externalId,
    command: "reingest",
    startedAt: activity.startedAt,
    meta: null,
    enqueuedAt: new Date().toISOString(),
  }
  return getAdapter(activity.source.source).normalize(body, activity.raw, job).trace
}

const tables = await modelTables()
const blobs: BlobStoreDeps = { s3: s3 as never, bucket, ddb: ddb as never }
const store = dynamoReplayStore({
  ddb: ddb as never,
  tables: {
    ledger: tables.XpLedgerEntry,
    skillState: tables.SkillState,
    profile: tables.Profile,
    activity: tables.Activity,
  },
  blobs,
  snapshots: { s3: s3 as never, bucket },
  loadTrace,
})

const rules = loadRuleSet(to)
const states = await store.readSkillStates(userId)
const activities = await store.listActivities(userId)
const unfinished = await store.findUnfinishedRun(userId)
console.log(`user ${userId} → ruleset v${rules.version} (${rules.effectiveFrom})`)
console.log(`  ${activities.length} activities (${activities.filter((a) => a.status === "ACTIVE").length} ACTIVE)`)
for (const s of states) {
  console.log(`  ${s.skillId.padEnd(14)} ${String(s.displayedXp).padStart(9)} XP  v${s.rulesVersionLastComputed ?? "?"}`)
}
if (unfinished) console.log(`  RESUMING ${unfinished.id} (${unfinished.status})`)

if (!confirm) {
  console.log("\ndry run — nothing written. Re-run with --confirm.")
  process.exit(0)
}

const result = await replayUser(userId, to, { store, rules: loadRuleSet, log: (l) => console.log(`  ${l}`) })
console.log(JSON.stringify({ run: result.run.id, status: result.run.status, floors: result.run.floorsWritten }, null, 2))
