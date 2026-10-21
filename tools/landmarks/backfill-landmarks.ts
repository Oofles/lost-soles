import { readFileSync } from "node:fs"

import { DynamoDBClient } from "@aws-sdk/client-dynamodb"
import { S3Client } from "@aws-sdk/client-s3"
import { DynamoDBDocumentClient, UpdateCommand, type UpdateCommandInput } from "@aws-sdk/lib-dynamodb"

import { readStoredRoute, readWalkRows } from "../../src/pipeline/landmark-backfill"
import { backfillLandmarks, landmarkUpdateItem } from "../../src/pipeline/landmarks"
import { liveNamesFromOutputs, targetCollisions, type DrillTarget } from "../../src/pipeline/rebuild-drill-back"
import { dynamoDrillStore } from "../../src/pipeline/rebuild-drill-store"
import { rulesForUser } from "../../src/pipeline/worker-rules"
import { BUNDLED_RULES } from "../../rules/xp-rules.bundled"
import type { RuleSet } from "../../src/rules/schema"
import { modelTables } from "../xp-replay/tables"

/**
 * BACKFILL A USER'S LANDMARKS FROM THEIR LEDGER. Ticket `0248`, D-301; `--target` is `0302`, D-307.
 *
 *   npx vite-node --config vitest.config.ts tools/landmarks/backfill-landmarks.ts -- --user <sub>
 *   npx vite-node --config vitest.config.ts tools/landmarks/backfill-landmarks.ts -- --user <sub> --confirm
 *   npx vite-node --config vitest.config.ts tools/landmarks/backfill-landmarks.ts -- --user <sub> --target <target.json> [--confirm]
 *
 * Walks T4's `byUserAndSeq` in activity order (`landmarksFromLedger`), and for every 50 or 99 a
 * skill has passed, names the activity whose XP carried it there and places the landmark on that
 * activity's stored route (`0195`) at the threshold's arc — the same rule the pipeline writes by.
 * The walk and the placing are `backfillLandmarks`, which the rebuild drill's step 6 runs too.
 *
 * SAFE TO RE-RUN, AND SAFE AFTER A REPLAY (live). Every write is `landmarkUpdateItem`'s
 * `if_not_exists`, so a landmark already recorded — by ingest, or by an earlier run of this — is
 * left exactly where it is. That is also the repair for a replay that newly carries a skill past
 * 50: the replay never writes landmarks, and this picks up what it crossed.
 *
 * `--target` POINTS IT AT A REBUILD DRILL'S PARALLEL STACK (D-406): the same target JSON the drill
 * takes. It reads the target's ledger, rules and routes (behind the target's prefix) and writes
 * only the target's `landmark` table. A target naming anything live is refused before any read,
 * by the drill's own `targetCollisions` (exit 4). Writes are the drill's — creates conditioned on
 * absence (D-408) — so a target that already holds a landmark stops at it (exit 5): the drill
 * normally writes these itself in step 6, and a half-written target is rerun into fresh tables.
 *
 * DRY RUN BY DEFAULT. It prints skill, level, activity and date, and whether a route was found —
 * never the coordinate (`08` §7.2: a landmark is a place near home).
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
const targetPath = flag("target")
const confirm = args.includes("--confirm")
if (!userId || (args.includes("--target") && !targetPath)) {
  console.error("usage: backfill-landmarks.ts --user <cognito-sub> [--target <target.json>] [--confirm]")
  process.exit(2)
}

const region = outputs.storage?.aws_region ?? "us-east-1"
const liveBucket = outputs.storage?.bucket_name
if (!liveBucket) {
  console.error("amplify_outputs.json has no storage.bucket_name — it predates the deploy.")
  process.exit(2)
}

/** Refused before any client exists, exactly as the drill refuses it. */
let target: DrillTarget | undefined
if (targetPath) {
  target = JSON.parse(readFileSync(targetPath, "utf8")) as DrillTarget
  const collisions = targetCollisions(target, liveNamesFromOutputs(outputs))
  for (const c of collisions) console.error(`REFUSED — TARGET_IS_LIVE: ${c}`)
  if (collisions.length > 0) process.exit(4)
}

const raw = new DynamoDBClient({ region })
const ddb = DynamoDBDocumentClient.from(raw, { marshallOptions: { removeUndefinedValues: true } })
const s3 = new S3Client({ region })
const tables = target
  ? { ledger: target.tables.ledger, skillState: target.tables.skillState, profile: target.tables.profile, landmark: target.tables.landmark }
  : await modelTables(raw).then((m) => ({ ledger: m.XpLedgerEntry, skillState: m.SkillState, profile: m.Profile, landmark: m.Landmark }))
const where = target ? { bucket: target.bucket, prefix: target.prefix } : { bucket: liveBucket }

/** Every bundled version, as the worker carries them (`0234`) — never a hard-coded list. */
const bundled = new Map(Object.entries(BUNDLED_RULES).map(([v, r]) => [Number(v), r as RuleSet] as const))
const registry = await rulesForUser(userId, { ddb, table: tables.skillState, profileTable: tables.profile, bundled })

const rows = await readWalkRows(ddb, tables.ledger, userId)
const records = await backfillLandmarks({
  userId,
  rows,
  curve: registry.curve,
  route: (activityId) => readStoredRoute(s3, where, userId, activityId),
})
console.log(
  `${target ? `TARGET ${tables.landmark}` : "LIVE"}: ${rows.length} ledger rows under ruleset v${registry.version}; ` +
    `${records.length} place-bound crossing(s)`,
)
for (const l of records) {
  console.log(`  ${l.skillId} ${l.level} (${l.place}) — ${l.activityId}, ${l.earnedAt.slice(0, 10)}, ${l.lng !== null ? "on its route" : "no route: no location"}`)
}

if (confirm) {
  const recordedAt = new Date().toISOString()
  if (target) {
    try {
      await dynamoDrillStore({ ddb, s3, target }).putLandmarks(records, recordedAt)
    } catch (e) {
      if ((e as Error).name !== "ConditionalCheckFailedException") throw e
      console.error(`ABORT — the target's ${tables.landmark} already holds a landmark: it is not empty (D-408). Rerun into fresh tables.`)
      process.exit(5)
    }
  } else {
    for (const l of records) await ddb.send(new UpdateCommand(landmarkUpdateItem(l, recordedAt, tables.landmark).Update as UpdateCommandInput))
  }
}

console.log(
  !confirm
    ? "\ndry run — nothing written. Re-run with --confirm."
    : target
      ? "written (each a create conditioned on absence)"
      : "written (if_not_exists: an existing landmark was left where it was)",
)
