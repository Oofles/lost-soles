import { existsSync, writeFileSync } from "node:fs"

import {
  CORRUPT_FIXTURE_DIR,
  EXPECTED_PATH,
  FIXTURE_DIR,
  expectedFromRun,
  readExpected,
  runDrillCi,
  trackedRulesFiles,
} from "./drill-ci"

/**
 * `npm run drill:ci` — the rebuild drill, steps 0–8, against the committed fixture. Ticket `0104`,
 * `02-data-model.md` §8.4. Runs on every build: `amplify.yml`'s build phase (the lock) and
 * `.github/workflows/gate.yml` (the alarm). No AWS, no network, no `amplify_outputs.json`.
 *
 *   npm run drill:ci                       assert; exit non-zero on any failure
 *   npm run drill:ci -- --with-corrupt     also list the corrupt fixture object (exits 11)
 *   npm run drill:ci -- --write-expected   LOCAL ONLY: rewrite expected.json for review
 *
 * Exit: 0 passed; 3 a precondition refused; 4/5 an abort; 10 + n the first failed step-8 check n;
 * 20 an `expected.json` mismatch the six do not see; 21 a registered source with no fixture object.
 */

const args = process.argv.slice(2).filter((a) => a !== "--")
const writeExpected = args.includes("--write-expected")
const withCorrupt = args.includes("--with-corrupt")
const unknown = args.filter((a) => a !== "--write-expected" && a !== "--with-corrupt")
if (unknown.length > 0 || (writeExpected && withCorrupt)) {
  console.error("usage: npm run drill:ci [-- --with-corrupt | --write-expected]")
  process.exit(2)
}

const rules = trackedRulesFiles()
if (rules.from === "tree") console.error("note: git unavailable here — precondition 2 read rules/ from the working tree")

if (writeExpected) {
  // A CI run that could rewrite its own expectations would assert nothing.
  if (process.env.CI || process.env.GITHUB_ACTIONS || process.env.AWS_APP_ID || process.env.CODEBUILD_BUILD_ID) {
    console.error("REFUSED — --write-expected never runs in CI. Regenerate locally and commit the reviewed diff.")
    process.exit(2)
  }
  const result = await runDrillCi({ expected: null, rulesFiles: rules.files, onFailure: (f) => console.error(JSON.stringify(f)) })
  const next = expectedFromRun(result)
  const existed = existsSync(EXPECTED_PATH)
  writeFileSync(EXPECTED_PATH, JSON.stringify(next, null, 2) + "\n")
  console.error("")
  console.error(`WARNING — ${EXPECTED_PATH} ${existed ? "rewritten" : "written"}.`)
  console.error("REVIEW THE DIFF BEFORE COMMITTING IT (git diff tools/drill/__fixtures__/ci/expected.json).")
  console.error("Every changed number is a change in what the drill rebuilds from raw/. If you cannot say")
  console.error("why each one moved, the code regressed and this file is now recording the regression.")
  process.exit(0)
}

const result = await runDrillCi({
  expected: readExpected(),
  fixtureDirs: withCorrupt ? [FIXTURE_DIR, CORRUPT_FIXTURE_DIR] : [FIXTURE_DIR],
  rulesFiles: rules.files,
  onFailure: (f) => console.error(`normalize failure (${f.source}) ${f.key}: ${f.error}`),
  log: (line) => console.error(line),
})

const s = result.front.summary
console.error(`drill:ci — ${s.objectCount} objects, ${s.payloadCount} payloads, rules v${result.back?.rulesVersion ?? "?"}`)
for (const source of [...new Set([...s.sourceIds, ...Object.keys(result.failuresBySource)])].sort()) {
  console.error(`  normalize ${source.padEnd(8)} ${result.normalizedBySource[source] ?? 0} ok, ${result.failuresBySource[source] ?? 0} failed`)
}
for (const c of result.back?.step8 ?? []) {
  console.error(`step 8 check ${c.n} ${c.status.toUpperCase().padEnd(4)} ${c.name} — ${c.detail}`)
}
for (const e of result.expectations) {
  console.error(`expected     ${(e.ok ? "PASS" : "FAIL").padEnd(4)} ${e.name} — ${e.detail}`)
}
if (result.failed) console.error(`FAIL — ${result.failed.reason}: ${result.failed.detail}`)
else console.error(`PASS — six assertions and ${result.expectations.length} expectations in ${result.wallClockMs} ms`)
process.exit(result.failed?.exitCode ?? 0)
