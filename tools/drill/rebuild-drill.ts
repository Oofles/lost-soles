import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"

import { DynamoDBClient } from "@aws-sdk/client-dynamodb"
import { S3Client } from "@aws-sdk/client-s3"
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb"

import { getAdapter, registeredSources } from "../../src/adapters/registry"
import { runDrillFrontHalf, type DrillPhase } from "../../src/pipeline/rebuild-drill"
import {
  liveNamesFromOutputs,
  runDrillBackHalf,
  targetCollisions,
  type DrillTarget,
  type SpotCheck,
} from "../../src/pipeline/rebuild-drill-back"
import { dynamoDrillStore } from "../../src/pipeline/rebuild-drill-store"
import { existingEntries } from "../../src/pipeline/xp-ledger"
import { loadRuleSet } from "../../src/rules/load"

/**
 * THE REBUILD DRILL. Ticket `0102` (steps 0–3); `0103` (steps 4–8). `02-data-model.md` §8.3.
 *
 *   npm run drill -- --phase=enumerate --uid=<cognito-sub> [--expect-objects=<n>] [--dry-run]
 *   npm run drill -- --phase=normalize --uid=<cognito-sub> [--expect-objects=<n>] [--dry-run]
 *   npm run drill -- --phase=rebuild   --uid=<cognito-sub> --target=<target.json>
 *                    [--rules=<n>] [--spot-check=<activityId>] [--fog-algo-changed] [--dry-run]
 *
 * `enumerate` checks the four preconditions, reads step 0's verification target and lists `raw/`.
 * `normalize` goes on through steps 2 and 3. Neither writes to AWS.
 *
 * `rebuild` runs the front half and then steps 4–8 INTO THE TARGET, which is a JSON file:
 *
 *   { "tables": { "activity": "...", "ledger": "...", "skillState": "...", "profile": "...",
 *                 "exploredCell": "..." },
 *     "bucket": "...", "prefix": "" }
 *
 * — the parallel stack (`0105` creates it). The drill refuses, before any write, a target that names
 * a live table, a table of the live API, or the live bucket without a staging prefix: the live names
 * come from `amplify_outputs.json`. Every write is a create conditioned on absence, so a target that
 * is not empty stops the run at its first collision. `--dry-run` stops after the refusal check and
 * the front half, having written nothing.
 *
 * `--rules` is the target `xpRulesVersion`; it defaults to the snapshot's, which is a same-rules
 * rebuild and the one step 8 check 6 can compare. `--spot-check` names the activity check 6
 * compares against its LIVE ledger rows (a read-only `byActivity` query); by default, the newest
 * rebuilt activity that has any. `--fog-algo-changed` turns check 3 from `==` into `≥` (D-020).
 *
 * stdout is ONE JSON object: the front half's summary, `rebuild` (steps 4–8, with the step-8
 * table), and `wallClockMs` for the whole run (the §8.3 budget is 30 minutes; `0105` measures it at
 * live volume). The step-8 table is also printed to stderr.
 *
 * Exit: 0 passed; 2 bad arguments; 3 a precondition refused; 4 the target is live; 5 an abort
 * (incomplete front half, unreadable cells file, a generation that would not advance, a non-empty
 * target); 10 + n for the first failed step-8 check n — 13 is assertion 3, which aborts before
 * step 7 and never warns. Each failure prints its reason string (`ASSERT_<n>_…`).
 *
 * AWS: the ambient profile. `AWS_PROFILE=devault`, account 286588821906, us-east-1 (CLAUDE.md).
 */

const started = Date.now()
const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "")

const args = process.argv.slice(2).filter((a) => a !== "--")
function flag(name: string): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!
    if (a.startsWith(`--${name}=`)) return a.slice(name.length + 3)
    if (a === `--${name}` && args[i + 1] !== undefined && !args[i + 1]!.startsWith("--")) return args[i + 1]
  }
  return undefined
}

const usage =
  "usage: npm run drill -- --phase=enumerate|normalize|rebuild --uid=<cognito-sub> " +
  "[--expect-objects=<n>] [--out=<dir>] [--concurrency=<n>] [--dry-run] " +
  "[--target=<target.json> --rules=<n> --spot-check=<activityId> --fog-algo-changed]"

type Phase = DrillPhase | "rebuild"
const phase = flag("phase") as Phase | undefined
const userId = flag("uid")
const expectRaw = flag("expect-objects")
const expectObjects = expectRaw === undefined ? undefined : Number(expectRaw)
const concurrency = Number(flag("concurrency") ?? 16)
const targetPath = flag("target")
const rulesRaw = flag("rules")
const dryRun = args.includes("--dry-run")
if (
  (phase !== "enumerate" && phase !== "normalize" && phase !== "rebuild") ||
  !userId ||
  (expectObjects !== undefined && !Number.isInteger(expectObjects)) ||
  !Number.isInteger(concurrency) ||
  concurrency < 1 ||
  (phase === "rebuild" && !targetPath) ||
  (rulesRaw !== undefined && !Number.isInteger(Number(rulesRaw)))
) {
  console.error(usage)
  process.exit(2)
}

const outputs = JSON.parse(readFileSync(`${ROOT}/amplify_outputs.json`, "utf8")) as {
  storage?: { bucket_name?: string; aws_region?: string }
  custom?: { activityTableName?: string; xpLedgerTableName?: string }
}
const bucket = outputs.storage?.bucket_name
if (!bucket) {
  console.error("amplify_outputs.json has no storage.bucket_name — it predates the deploy.")
  process.exit(2)
}
const region = outputs.storage?.aws_region ?? "us-east-1"

/** Refused before the front half runs, so a live target costs nothing but this check. */
let target: DrillTarget | undefined
const live = phase === "rebuild" ? liveNamesFromOutputs(outputs) : undefined
if (phase === "rebuild") {
  target = JSON.parse(readFileSync(targetPath!, "utf8")) as DrillTarget
  const collisions = targetCollisions(target, live!)
  for (const c of collisions) console.error(`REFUSED — TARGET_IS_LIVE: ${c}`)
  if (collisions.length > 0) process.exit(4)
}

const outDir = flag("out") ?? join(tmpdir(), "lost-soles-drill", userId)

/** Precondition 2 is about git, not the working tree: an untracked rules file is not "at the commit". */
const rulesFiles = execFileSync("git", ["ls-files", "rules/"], { cwd: ROOT, encoding: "utf8" })
  .split("\n")
  .filter(Boolean)

const s3 = new S3Client({ region })
const front = await runDrillFrontHalf({
  phase: phase === "rebuild" ? "normalize" : phase,
  userId,
  dryRun,
  expectObjects,
  bucket,
  s3,
  rulesFiles,
  registeredSources: registeredSources(),
  adapterFor: getAdapter,
  concurrency,
  saveSnapshot: (key, body) => {
    mkdirSync(outDir, { recursive: true })
    const path = join(outDir, basename(key))
    writeFileSync(path, body)
    return path
  },
  onFailure: (f) => console.error(JSON.stringify(f)),
})
const { summary } = front

for (const p of summary.preconditions) {
  if (!p.ok) console.error(`REFUSED — precondition ${p.n} (${p.name}) failed: ${p.detail}`)
}
if (phase !== "rebuild" || summary.refused || dryRun) {
  if (phase === "rebuild" && dryRun && !summary.refused) {
    console.error(`dry run — front half done, target ${JSON.stringify(target)} accepted; nothing written.`)
  }
  console.log(JSON.stringify({ ...summary, wallClockMs: Date.now() - started }, null, 2))
  process.exit(summary.refused ? 3 : 0)
}

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region }), { marshallOptions: { removeUndefinedValues: true } })
const rules = loadRuleSet(rulesRaw === undefined ? front.snapshot!.rulesVersion : Number(rulesRaw))

/** Check 6's pre-drill values: the LIVE ledger, read-only, newest rebuilt activity first. */
async function spotCheck(): Promise<SpotCheck | undefined> {
  const ledgerTable = outputs.custom?.xpLedgerTableName
  if (!ledgerTable) return undefined
  const deps = { ddb: ddb as never, ledgerTable, skillStateTable: "", profileTable: "", landmarkTable: "" }
  const named = flag("spot-check")
  const candidates = named
    ? [named]
    : front.sorted
        .map((e) => e.activity.activityId)
        .filter((id) => !front.duplicatePointers.has(id))
        .reverse()
  for (const activityId of candidates) {
    const expected = await existingEntries(activityId, deps)
    if (expected.length > 0 || named) return { activityId, expected }
  }
  return undefined
}

const rebuild = await runDrillBackHalf(front, {
  target: target!,
  live: live!,
  store: dynamoDrillStore({ ddb, s3, target: target!, concurrency }),
  rules,
  fogAlgoChanged: args.includes("--fog-algo-changed"),
  spotCheck: await spotCheck(),
  log: (line) => console.error(line),
})

for (const c of rebuild.step8) {
  console.error(`step 8 check ${c.n} ${c.status.toUpperCase().padEnd(4)} ${c.name} — ${c.detail}`)
}
if (rebuild.failed) console.error(`FAIL — ${rebuild.failed.reason}: ${rebuild.failed.detail}`)
console.log(JSON.stringify({ ...summary, rebuild, wallClockMs: Date.now() - started }, null, 2))
process.exit(rebuild.failed?.exitCode ?? 0)
