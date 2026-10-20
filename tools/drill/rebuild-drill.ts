import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"

import { S3Client } from "@aws-sdk/client-s3"

import { getAdapter, registeredSources } from "../../src/adapters/registry"
import { runDrillFrontHalf, type DrillPhase } from "../../src/pipeline/rebuild-drill"

/**
 * THE REBUILD DRILL. Ticket `0102` (steps 0–3); `0103` adds 4–7. `02-data-model.md` §8.3.
 *
 *   npm run drill -- --phase=enumerate --uid=<cognito-sub> [--expect-objects=<n>] [--dry-run]
 *   npm run drill -- --phase=normalize --uid=<cognito-sub> [--expect-objects=<n>] [--dry-run]
 *
 * `enumerate` checks the four preconditions, reads step 0's verification target and lists `raw/`.
 * `normalize` goes on through steps 2 and 3. Neither writes to AWS; `--dry-run` is accepted and
 * changes nothing in these phases, so the operator's habit carries over to the phases that do write.
 *
 * stdout is ONE JSON object, the summary — what `0104`/`0105` assert on. Per-object failures go to
 * stderr as JSON lines `{key, source, error}` as they happen. Exit 0 when the run completed (with
 * `normalizeFailures` in the summary, which may be non-zero), 3 when a precondition refused it, 2 on
 * bad arguments.
 *
 * `--expect-objects` is precondition 1's "last known figure": when given, the count under
 * `raw/<uid>/` must equal it exactly. The newest skill-state snapshot (precondition 4) is
 * downloaded to `--out` (default: a `lost-soles-drill/<uid>/` directory under the OS temp dir).
 *
 * AWS: the ambient profile. `AWS_PROFILE=devault`, account 286588821906, us-east-1 (CLAUDE.md).
 */

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
  "usage: npm run drill -- --phase=enumerate|normalize --uid=<cognito-sub> " +
  "[--expect-objects=<n>] [--out=<dir>] [--concurrency=<n>] [--dry-run]"

const phase = flag("phase") as DrillPhase | undefined
const userId = flag("uid")
const expectRaw = flag("expect-objects")
const expectObjects = expectRaw === undefined ? undefined : Number(expectRaw)
const concurrency = Number(flag("concurrency") ?? 16)
if (
  (phase !== "enumerate" && phase !== "normalize") ||
  !userId ||
  (expectObjects !== undefined && !Number.isInteger(expectObjects)) ||
  !Number.isInteger(concurrency) ||
  concurrency < 1
) {
  console.error(usage)
  process.exit(2)
}

const outputs = JSON.parse(readFileSync(`${ROOT}/amplify_outputs.json`, "utf8")) as {
  storage?: { bucket_name?: string; aws_region?: string }
}
const bucket = outputs.storage?.bucket_name
if (!bucket) {
  console.error("amplify_outputs.json has no storage.bucket_name — it predates the deploy.")
  process.exit(2)
}

const outDir = flag("out") ?? join(tmpdir(), "lost-soles-drill", userId)

/** Precondition 2 is about git, not the working tree: an untracked rules file is not "at the commit". */
const rulesFiles = execFileSync("git", ["ls-files", "rules/"], { cwd: ROOT, encoding: "utf8" })
  .split("\n")
  .filter(Boolean)

const { summary } = await runDrillFrontHalf({
  phase,
  userId,
  dryRun: args.includes("--dry-run"),
  expectObjects,
  bucket,
  s3: new S3Client({ region: outputs.storage?.aws_region ?? "us-east-1" }),
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

for (const p of summary.preconditions) {
  if (!p.ok) console.error(`REFUSED — precondition ${p.n} (${p.name}) failed: ${p.detail}`)
}
console.log(JSON.stringify(summary, null, 2))
process.exit(summary.refused ? 3 : 0)
