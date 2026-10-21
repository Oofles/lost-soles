#!/usr/bin/env node
// REBUILD-DRILL REMOVAL CHECK — the drill never removes anything. Ticket 0103, 02 §8.3.
//
// §8.3: "Nothing destructive happens until [cutover]." The drill rebuilds into a parallel stack
// and verifies; cutover is a human pointing the app, and the old tables are retired after it by a
// separate, deliberate act. A drill that could delete would be one bad target name away from the
// only failure D-020 cannot recover from — a map that re-fogs because its table was emptied.
//
// So the drill's own files may not name an S3 or DynamoDB removal at all: not DeleteObject(s),
// DeleteItem, DeleteTable, the document client's DeleteCommand, a BatchWrite DeleteRequest, nor an
// IAM action spelling one. Comments are stripped first: prose explaining the rule is not a call.
// Tests are excluded for the reason check-fog-hot-path.mjs gives — an assertion that no removal
// was sent has to be able to name one.
//
// Plain node, no dependencies: it runs in the GitHub Actions gate and the Amplify build.
//
//   node scripts/check-drill-no-delete.mjs              scan the drill
//   node scripts/check-drill-no-delete.mjs --self-test  prove it FAILS on a drill that deletes

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative, sep } from "node:path"

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "")

/** The drill package: its CLI directory and every `rebuild-drill*` module in the pipeline. */
const DRILL_DIRS = ["tools/drill"]
const DRILL_FILES = { dir: "src/pipeline", match: /^rebuild-drill[\w.-]*\.(ts|mjs|js)$/ }

const FORBIDDEN =
  /\bDelete(Object|Objects|Item|Table|Bucket)(Command)?\b|\bDeleteCommand\b|\bDeleteRequest\b|["'](s3|dynamodb):Delete\w*["']/

const EXTS = /\.(ts|tsx|mjs|js)$/
const TEST = /\.test\.(ts|tsx|mjs|js)$/

const codeOnly = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

function walk(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (EXTS.test(name)) out.push(full)
  }
  return out
}

function drillFiles(base) {
  const files = DRILL_DIRS.flatMap((d) => walk(join(base, d)))
  const pipeline = join(base, DRILL_FILES.dir)
  if (existsSync(pipeline)) {
    for (const name of readdirSync(pipeline)) if (DRILL_FILES.match.test(name)) files.push(join(pipeline, name))
  }
  return files.filter((f) => !TEST.test(f))
}

function scan(base = ROOT) {
  const files = drillFiles(base)
  const hits = []
  for (const file of files) {
    const lines = codeOnly(readFileSync(file, "utf8")).split("\n")
    lines.forEach((line, i) => {
      if (FORBIDDEN.test(line)) hits.push({ rel: relative(base, file).split(sep).join("/"), n: i + 1, line: line.trim() })
    })
  }
  return { hits, scanned: files.length }
}

function report({ hits, scanned }) {
  if (hits.length === 0) {
    console.log(`check-drill-no-delete: ${scanned} drill files, no removal named. OK`)
    return 0
  }
  for (const h of hits) console.error(`${h.rel}:${h.n}: ${h.line}`)
  console.error(
    `\ncheck-drill-no-delete: the rebuild drill names a removal (${hits.length} line${hits.length === 1 ? "" : "s"}). ` +
      "02 §8.3: nothing destructive happens before cutover, and cutover is not the drill's.",
  )
  return 1
}

function selfTest() {
  const base = mkdtempSync(join(tmpdir(), "drill-no-delete-"))
  try {
    mkdirSync(join(base, "tools/drill"), { recursive: true })
    mkdirSync(join(base, "src/pipeline"), { recursive: true })
    writeFileSync(join(base, "tools/drill/ok.ts"), "// a DeleteObjectCommand in a comment is prose\nexport const x = 1\n")
    writeFileSync(join(base, "src/pipeline/rebuild-drill-x.test.ts"), "new DeleteItemCommand({})\n")
    writeFileSync(join(base, "src/pipeline/other.ts"), "new DeleteCommand({})\n")
    const clean = scan(base)
    if (clean.hits.length !== 0) throw new Error(`self-test: false positive ${JSON.stringify(clean.hits)}`)

    const cases = [
      "new DeleteObjectCommand({ Bucket, Key })",
      "await s3.send(new DeleteObjectsCommand(x))",
      "import { DeleteCommand } from '@aws-sdk/lib-dynamodb'",
      "ddb.send(new DeleteItemCommand(k))",
      "new DeleteTableCommand({ TableName })",
      "{ DeleteRequest: { Key } }",
      'actions: ["dynamodb:DeleteItem"]',
    ]
    for (const [i, c] of cases.entries()) {
      const where = i % 2 === 0 ? `src/pipeline/rebuild-drill-case${i}.ts` : `tools/drill/case${i}.ts`
      writeFileSync(join(base, where), `${c}\n`)
      const got = scan(base)
      if (got.hits.length !== 1) throw new Error(`self-test: missed ${JSON.stringify(c)} in ${where}`)
      rmSync(join(base, where))
    }
    console.log(`check-drill-no-delete --self-test: ${cases.length} removals caught, prose and tests ignored. OK`)
    return 0
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
}

process.exit(process.argv.includes("--self-test") ? selfTest() : report(scan()))
