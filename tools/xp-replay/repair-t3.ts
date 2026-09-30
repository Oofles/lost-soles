import { readFileSync } from "node:fs"

import { DynamoDBClient } from "@aws-sdk/client-dynamodb"
import { S3Client } from "@aws-sdk/client-s3"
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb"

import type { BlobStoreDeps } from "../../src/pipeline/explored-blob-store"
import { auditT3, planT3Repair, type T3Mismatch } from "../../src/pipeline/t3-repair"
import { dynamoReplayStore } from "../../src/pipeline/xp-replay-store"
import { loadRuleSet } from "../../src/rules/load"

import { modelTables } from "./tables"

/**
 * DOES T3 AGREE WITH THE LEDGER — AND THE ONE-OFF REPAIR WHEN IT DOES NOT. Ticket `0226`, D-261.
 *
 *   npx vite-node --config vitest.config.ts tools/xp-replay/repair-t3.ts -- --user <sub>
 *   npx vite-node --config vitest.config.ts tools/xp-replay/repair-t3.ts -- --user <sub> --confirm
 *
 * Without `--confirm` it is THE AUDIT: every activity's `xpAwarded` against its ledger SUM, and
 * its discovery credit against its `cartography` rows' `units`, plus the rows a repair would
 * rewrite. Exits 1 on any mismatch, so it can be run as a check.
 *
 * With `--confirm` it writes those rows through the replay store's `writeActivityScores` — the
 * replay's step 3 without the replay (`src/pipeline/t3-repair.ts`) — then audits again.
 *
 * AWS: the ambient profile. `AWS_PROFILE=devault`, account 286588821906, us-east-1 (CLAUDE.md).
 */

const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "")
const outputs = JSON.parse(readFileSync(`${ROOT}/amplify_outputs.json`, "utf8")) as {
  storage?: { bucket_name?: string; aws_region?: string }
}

const args = process.argv.slice(2)
const at = args.indexOf("--user")
const userId = at >= 0 ? args[at + 1] : undefined
const confirm = args.includes("--confirm")
if (!userId) {
  console.error("usage: repair-t3.ts --user <cognito-sub> [--confirm]")
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
  loadTrace: async () => {
    throw new Error("repair-t3 never rescores, so it never loads a trace")
  },
})

function report(label: string, mismatches: readonly T3Mismatch[], total: number) {
  console.log(`${label}: ${mismatches.length} mismatches over ${total} activities`)
  for (const m of mismatches) {
    console.log(`  ${m.activityId.slice(0, 8)}…  ${m.startedAt.slice(0, 10)}  ${m.field.padEnd(16)} T3 ${m.t3}  ledger ${m.ledger}`)
  }
}

const plan = await planT3Repair(userId, { store, rules: loadRuleSet })
report("audit", auditT3(plan.activities, plan.ledger), plan.activities.length)
console.log(`\nrepair (ground rules v${plan.rulesVersion}): ${plan.writes.length} rows to rewrite`)
for (const w of plan.writes) {
  const award = w.award
    ? `  new ${w.award.newCellCount} rearmed ${w.award.rearmedCellCount} cooled ${w.award.cooledCellCount} deferred ${w.award.deferredCellCount}`
    : ""
  console.log(`  ${w.activityId.slice(0, 8)}…  ${w.xpAwarded} XP v${w.xpRulesVersion}${award}`)
}

if (!confirm) {
  console.log("\ndry run — nothing written. Re-run with --confirm.")
  process.exit(auditT3(plan.activities, plan.ledger).length > 0 ? 1 : 0)
}

await store.writeActivityScores(userId, plan.writes, new Date().toISOString())
const after = await planT3Repair(userId, { store, rules: loadRuleSet })
console.log("")
report("audit after", auditT3(after.activities, after.ledger), after.activities.length)
console.log(`rows still to rewrite: ${after.writes.length}`)
process.exit(auditT3(after.activities, after.ledger).length > 0 || after.writes.length > 0 ? 1 : 0)
