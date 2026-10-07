import { readFileSync } from "node:fs"

import { DynamoDBClient } from "@aws-sdk/client-dynamodb"
import { S3Client } from "@aws-sdk/client-s3"
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb"

import type { Activity } from "../../src/domain/activity"
import { archivedTrace } from "../../src/pipeline/archived-trace"
import type { BlobStoreDeps } from "../../src/pipeline/explored-blob-store"
import { EXPLORED_CELL_TABLE } from "../../src/pipeline/explored-cells"
import { assertKnownKind, readKindOverride } from "../../src/pipeline/kind-override"
import { rescoreKind } from "../../src/pipeline/kind-rescore"
import { rulesForUser } from "../../src/pipeline/worker-rules"
import { loadRuleSet } from "../../src/rules/load"
import { modelTables } from "../xp-replay/tables"

/**
 * CORRECT ONE ACTIVITY'S KIND AND RE-SCORE IT. Ticket `0243`, D-284, D-285.
 *
 *   npx vite-node --config vitest.config.ts tools/kind-override/override-kind.ts -- --user <sub> --activity <id> --kind walk
 *   npx vite-node --config vitest.config.ts tools/kind-override/override-kind.ts -- --user <sub> --activity <id> --kind walk --confirm
 *
 * The operator's half of `src/pipeline/kind-rescore.ts` alongside `0244`'s `setActivityKind`
 * mutation, which puts the same call behind the single-run page. DRY RUN BY DEFAULT, like every tool here that writes to a map that never re-fogs: without
 * `--confirm` it prints the activity, its current and derived kind, and any override already on
 * file, and writes nothing.
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
const activityId = flag("activity")
const kind = flag("kind")
const confirm = args.includes("--confirm")
if (!userId || !activityId || !kind) {
  console.error("usage: override-kind.ts --user <cognito-sub> --activity <activityId> --kind <kind> [--confirm]")
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
assertKnownKind(kind, registry)

const row = (await ddb.send(new GetCommand({ TableName: tables.Activity, Key: { id: activityId } }))).Item
if (!row) {
  console.error(`no activity ${activityId}`)
  process.exit(1)
}
const source = row.source as Activity["source"]
const onFile = await readKindOverride({ userId, source: source.source, externalId: source.externalId }, { s3: s3 as never, bucket })
console.log(`activity ${activityId} (${source.source}/${source.externalId}), started ${String(row.startedAt)}`)
console.log(`  kind ${String(row.kind)}, derived ${String(row.derivedKind ?? row.kind)}, ${String(row.xpAwarded)} XP under v${String(row.xpRulesVersion)}`)
console.log(`  override on file: ${onFile ? `${onFile.override.kind} (${onFile.key})` : "none"}`)
console.log(`  → ${kind} under ruleset v${registry.version}`)

if (!confirm) {
  console.log("\ndry run — nothing written. Re-run with --confirm.")
  process.exit(0)
}

const blobs: BlobStoreDeps = { s3: s3 as never, bucket, ddb: ddb as never }
const result = await rescoreKind(
  { userId, activityId, kind, setBy: "tools/kind-override" },
  {
    ddb: ddb as never,
    activityTable: tables.Activity,
    ledger: { ledgerTable: tables.XpLedgerEntry, skillStateTable: tables.SkillState, profileTable: tables.Profile },
    overrides: { s3: s3 as never, bucket },
    registry,
    cells: { ddb: ddb as never, table: EXPLORED_CELL_TABLE },
    blobs,
    loadTrace: (activity) => archivedTrace(activity, { s3: s3 as never }, `kind-override:${activity.activityId}`),
  },
)
console.log(JSON.stringify(result, null, 2))
