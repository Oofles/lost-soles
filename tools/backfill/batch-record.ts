import { readFileSync } from "node:fs"

import { DynamoDBClient } from "@aws-sdk/client-dynamodb"
import { S3Client } from "@aws-sdk/client-s3"
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb"

import { readBackfillBatch, buildBackfillBatch, writeBackfillBatch, backfillBatchKey } from "../../lib/backfill/store"
import type { BackfillBatch } from "../../lib/backfill/batch"
import { modelTables } from "../xp-replay/tables"

/**
 * WRITE (OR REWRITE) THE BACKFILL BATCH RECORD. Ticket `0257`.
 *
 *   npx vite-node --config vitest.config.ts tools/backfill/batch-record.ts -- --user <sub> --from <iso> --to <iso>
 *   npx vite-node --config vitest.config.ts tools/backfill/batch-record.ts -- --user <sub> --from <iso> --to <iso> --confirm
 *
 * The record that makes the next map visit, on every device, play ONE aggregate reveal of a
 * historical import, and makes every activity the import brought in count as not new
 * (`lib/backfill/batch.ts`). `tools/backfill/backfill.ts` writes it when an import completes; this
 * writes it for an import that already ran, and rewrites it after the XP replay so `after` is the
 * post-replay standing. The `batchId` is `--from`, so a rewrite never makes a device that has
 * already played the reveal play it again.
 *
 * `--from`/`--to` are the instants the import's activities' `ingestedAt` fall between — the
 * backfill CLI prints them as `this run: <from> → <to>`.
 *
 * WITHOUT `--confirm` it builds the record, prints it and writes nothing (the status-only dry run,
 * as `backfill.ts` has). Everything it reads is immutable or current: T3, SkillState, the SkillState
 * snapshots (D-143) and the generation-named explored blobs.
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
const from = flag("from")
const to = flag("to")
const confirm = args.includes("--confirm")

const iso = (s: string | undefined) => (s && !Number.isNaN(Date.parse(s)) ? new Date(s).toISOString() : undefined)
if (!userId || !iso(from) || !iso(to)) {
  console.error("usage: batch-record.ts --user <cognito-sub> --from <iso instant> --to <iso instant> [--confirm]")
  process.exit(2)
}

const region = outputs.storage?.aws_region ?? "us-east-1"
const bucket = outputs.storage?.bucket_name
if (!bucket) {
  console.error("amplify_outputs.json has no storage.bucket_name — it predates the deploy.")
  process.exit(2)
}

const raw = new DynamoDBClient({ region })
const ddb = DynamoDBDocumentClient.from(raw)
const s3 = new S3Client({ region })
const tables = await modelTables(raw)

function summary(b: BackfillBatch): string {
  const side = (label: string, s: BackfillBatch["before"]) =>
    `  ${label.padEnd(7)} generation ${s.generation} · ${s.cells} cells · ${s.activities} activities · ` +
    `Total Level ${s.totalLevel} · ${s.totalXp} XP`
  const skills = (s: BackfillBatch["before"]) => new Map(s.skills.map((k) => [k.skillId, k.xp]))
  const before = skills(b.before)
  const lines = b.after.skills
    .filter((k) => k.xp > 0 || (before.get(k.skillId) ?? 0) > 0)
    .map((k) => `    ${k.skillId.padEnd(14)} ${String(before.get(k.skillId) ?? 0).padStart(8)} → ${String(k.xp).padStart(8)} XP`)
  return [
    `batch ${b.batchId}`,
    `  window  ${b.window.from} → ${b.window.to}`,
    `  imported ${b.imported.count} activities, started ${b.imported.firstStartedAt ?? "-"} → ${b.imported.lastStartedAt ?? "-"}`,
    side("before", b.before),
    side("after", b.after),
    `  reveal  ${b.after.cells - b.before.cells} cells burn back (generation ${b.before.generation} → ${b.after.generation})`,
    ...lines,
  ].join("\n")
}

const fogDeps = { s3: s3 as never, bucket }
const existing = await readBackfillBatch(userId, fogDeps)
console.log(`user ${userId}`)
console.log(
  existing
    ? `  a record exists: batch ${existing.batchId} (${existing.imported.count} activities, written ${existing.writtenAt})`
    : "  no record yet",
)

const buildDeps = { ddb: ddb as never, s3: s3 as never, bucket, activityTable: tables.Activity, skillStateTable: tables.SkillState }
const batch = await buildBackfillBatch(userId, { from: iso(from)!, to: iso(to)! }, buildDeps)
console.log(`\n${summary(batch)}`)

/**
 * STRAGGLERS. The import's last window is still being processed by the worker when the window
 * closes, so activities can land a few seconds after `--to` (on 2026-10-16, four of the 97 did).
 * Say so rather than silently leave them out: they would then be ordinary "new" runs.
 */
const GRACE_MS = 5 * 60_000
const widened = await buildBackfillBatch(
  userId,
  { from: iso(from)!, to: new Date(Date.parse(iso(to)!) + GRACE_MS).toISOString() },
  buildDeps,
)
const late = widened.imported.count - batch.imported.count
if (late > 0) {
  console.warn(
    `\n  WARNING: ${late} more matching activit${late === 1 ? "y was" : "ies were"} ingested within 5 minutes after --to. ` +
      "They are part of this import; widen --to past them.",
  )
}

if (batch.imported.count === 0) {
  console.error("\nno activity was ingested in that window: nothing to reveal, nothing written.")
  process.exit(1)
}
if (!confirm) {
  console.log(`\ndry run — nothing written. Re-run with --confirm to write s3://${bucket}/${backfillBatchKey(userId)}.`)
  process.exit(0)
}
const key = await writeBackfillBatch(batch, userId, fogDeps)
console.log(
  `\nwritten: s3://${bucket}/${key}` +
    (existing?.batchId === batch.batchId ? " (same batch: a device that has played its reveal will not play it again)" : ""),
)
