#!/usr/bin/env node
// THE DELETED-ADAPTER SIMULATION. Ticket 0156 (split from 0027's T2), D-100, D-121.1.
//
//   node scripts/check-adapter-deletion.mjs             check every adapter
//   node scripts/check-adapter-deletion.mjs --self-test prove it FAILS on a second importer
//
// D-121.1 promises that swapping the primary source touches **one directory plus one line
// in `registry.ts`**. `registry.test.ts` already asserts half of that by scanning IMPORT
// STATEMENTS. This is the other half, and it exists because an import scan cannot see a
// dependency that does not go through an import:
//
//   - a structural type duplicated by hand, so the shape is copied rather than imported;
//   - an `as` cast to a shape the adapter owns;
//   - a string-literal branch on a source id.
//
// This check asks the COMPILER instead: if this directory vanished, what breaks? The only
// acceptable answer is one file. That turns D-121.1 from an assertion into a measurement,
// and it is the difference between "we believe the seam holds" and "the seam holds".
//
// ─── WHY A COPY OF THE TREE, AND NOT A tsconfig `paths` OVERRIDE ────────────
//
// `paths` was the obvious approach and it does not work here. TypeScript applies `paths`
// to non-relative specifiers only, and the one importer that matters — `registry.ts` —
// reaches the adapter as `./strava/oauth`. A `paths` override would therefore stub the
// directory for everyone EXCEPT the single file the check is about, and report a clean
// pass while testing nothing.
//
// Deleting the directory in place and restoring it afterwards is the other tempting
// approach, and 0156 explicitly rules it out: a check that mutates the working tree fails
// badly when interrupted and leaves a repo missing its adapter. So the tree is COPIED to a
// scratch directory, `node_modules` is symlinked rather than copied, and the adapter is
// stubbed in the copy. Nothing under the repo is written at any point.

import { execFileSync } from "node:child_process"
import {
  cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync,
  rmSync, statSync, symlinkSync, writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "")
const ADAPTERS_DIR = join(ROOT, "src/adapters")

/** The one file allowed to break. Relative to the repo root, and deliberately a constant. */
const THE_ONE_FILE = "src/adapters/registry.ts"

/**
 * Everything the typecheck needs. `node_modules` is symlinked separately; `.next` and
 * `.amplify` are excluded because tsconfig already excludes them and they are large.
 */
const COPY = [
  "src", "lib", "app", "amplify", "components", "hooks", "types",
  // `rules/` joined the list in 0047: the ingest handler imports `xp-rules-v1.json`
  // (D-217), so the ruleset is now a COMPILE-time dependency and not just a data file.
  // Without it every importer failed to resolve the module and this check reported them
  // as adapter leaks — a true failure with an entirely misleading name.
  "rules",
  "tsconfig.json", "next-env.d.ts", "package.json", "amplify_outputs.json",
  "amplify_outputs.example.json",
]

/** Discovered, never named — criterion 7. A vendor name here would need a boundary exemption. */
export function adapterDirs(base = ADAPTERS_DIR) {
  if (!existsSync(base)) return []
  return readdirSync(base).filter((n) => statSync(join(base, n)).isDirectory())
}

/** Every `.ts`/`.tsx` file under a directory, recursively. */
function sourceFilesUnder(dir) {
  const out = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name)
    if (e.isDirectory()) out.push(...sourceFilesUnder(full))
    else if (/\.tsx?$/.test(e.name)) out.push(full)
  }
  return out
}

/**
 * Builds the scratch tree and returns its root.
 *
 * `amplify_outputs.json` is GITIGNORED and generated per-environment, so it may be absent
 * in a fresh clone — the gate workflow copies the committed example over it for exactly
 * this reason. Missing entries are skipped rather than fatal, and the typecheck below
 * would report the same "cannot find module" the real one does if it mattered.
 */
function stage(base) {
  const scratch = mkdtempSync(join(tmpdir(), "adapter-deletion-"))
  for (const entry of COPY) {
    const from = join(base, entry)
    if (!existsSync(from)) continue
    cpSync(from, join(scratch, entry), { recursive: true })
  }
  const modules = join(base, "node_modules")
  if (existsSync(modules)) symlinkSync(modules, join(scratch, "node_modules"), "dir")
  return scratch
}

/**
 * Replaces every source file in the adapter directory with an empty module.
 *
 * `export {}` rather than deleting the files, because a deleted module produces "cannot
 * find module" at the IMPORT SITE and stops there, whereas an empty one produces "has no
 * exported member 'X'" for every symbol actually used — the same set of files, with a far
 * more useful message, and it keeps the adapter's own internal imports resolvable so their
 * noise does not drown the signal. The ticket's phrase is "stubbed to `never`"; an empty
 * module is the strongest form of that, since every export is absent rather than unusable.
 */
function stubAdapter(scratch, adapter) {
  const dir = join(scratch, "src/adapters", adapter)
  const files = sourceFilesUnder(dir)
  for (const f of files) {
    writeFileSync(f, "// stubbed by check-adapter-deletion.mjs — the adapter is 'deleted'\nexport {}\n")
  }
  return files.length
}

/** Runs `tsc --noEmit` in the scratch tree and returns the failing repo-relative paths. */
function failingFiles(scratch) {
  let output = ""
  try {
    execFileSync(join(ROOT, "node_modules/.bin/tsc"), ["--noEmit", "--incremental", "false"], {
      cwd: scratch,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    })
    return []
  } catch (err) {
    output = `${err.stdout ?? ""}${err.stderr ?? ""}`
    // A tsc that could not RUN is not a clean tree (D-176). It reports diagnostics on
    // stdout and exits 1or 2; a spawn failure has no stdout at all.
    if (!output.trim()) {
      throw new Error(`tsc produced no output and did not succeed — the check never ran.\n${err.message}`)
    }
  }

  const files = new Set()
  for (const line of output.split("\n")) {
    // `path/to/file.ts(12,34): error TS2305: ...`
    const m = /^(.+?)\((\d+),(\d+)\): error /.exec(line)
    if (m) files.add(m[1].replace(/^\.\//, ""))
  }
  return [...files].sort()
}

/**
 * Finds a real exported VALUE in the adapter directory, so the self-test can import one
 * without naming a vendor.
 *
 * It has to be a named value import. A namespace import (`import * as x`) of a stubbed
 * module succeeds — `export {}` is a perfectly valid empty namespace — so the self-test
 * would plant a violation the check could not possibly detect and then congratulate itself.
 * A type-only export is no good either: `verbatimModuleSyntax` and `isolatedModules` make
 * an unused type import erasable, and it would vanish before it could fail.
 */
function anExportedValueIn(dir) {
  for (const file of sourceFilesUnder(dir)) {
    if (/\.test\.tsx?$/.test(file)) continue
    const body = readFileSync(file, "utf8")
    const m = /^export\s+(?:async\s+)?(?:const|function|class)\s+([A-Za-z_$][\w$]*)/m.exec(body)
    if (m) return { specifier: relative(dir, file).replace(/\.tsx?$/, ""), name: m[1] }
  }
  return null
}

/** The whole simulation for one adapter. */
export function simulate(base, adapter) {
  const scratch = stage(base)
  try {
    const stubbed = stubAdapter(scratch, adapter)
    return { adapter, stubbed, failing: failingFiles(scratch) }
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

function report({ adapter, stubbed, failing }, expected) {
  const ok = failing.length === expected.length && failing.every((f, i) => f === expected[i])

  if (ok) {
    console.log(`  ok   '${adapter}' deleted -> ${failing.length} file fails to compile: ${failing.join(", ") || "(none)"}   [${stubbed} module(s) stubbed]`)
    return true
  }

  console.error("\n" + "=".repeat(72))
  console.error(`THE ADAPTER SEAM HAS LEAKED — '${adapter}'`)
  console.error("=".repeat(72) + "\n")
  console.error(`  With every export of src/adapters/${adapter}/ removed, these files stop compiling:\n`)
  for (const f of failing) {
    console.error(`    ${f}${expected.includes(f) ? "   (expected)" : "   <-- SHOULD NOT DEPEND ON THE ADAPTER"}`)
  }
  const missing = expected.filter((f) => !failing.includes(f))
  if (missing.length) {
    console.error(`\n  And these were expected to fail and did NOT, which means the check is not`)
    console.error(`  measuring what it claims:\n`)
    for (const f of missing) console.error(`    ${f}`)
  }
  console.error(`
  D-100: no Strava-shaped type may exist in the domain or the pipeline.
  D-121.1: swapping the primary source must touch ONE directory plus ONE line in
  ${THE_ONE_FILE}. Every file listed above without "(expected)" is a second line,
  and the promise is only true while this list has one entry.

  Note that an import scan cannot find these on its own — a duplicated structural
  type, an 'as' cast to a shape the adapter owns, or a branch on a source-id string
  literal all create this dependency without an import statement. That is why this
  check asks the compiler instead of reading the source.
`)
  return false
}

// ── CLI ─────────────────────────────────────────────────────────────────────

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href

if (isMain && process.argv.includes("--self-test")) {
  /**
   * Criterion 4: prove the check FAILS when a second file imports the adapter directly.
   *
   * A green check that has never been seen to go red is not evidence. This plants exactly
   * the violation D-121.1 forbids — a second module reaching into the adapter directory —
   * in a COPY of the tree, and asserts the check names it.
   */
  const adapters = adapterDirs()
  if (adapters.length === 0) {
    console.error("  self-test needs at least one adapter directory and found none.")
    process.exit(1)
  }
  const adapter = adapters[0]

  const scratch = mkdtempSync(join(tmpdir(), "adapter-deletion-selftest-"))
  try {
    // A copy of the repo with one extra file that has no business existing.
    for (const entry of COPY) {
      const from = join(ROOT, entry)
      if (existsSync(from)) cpSync(from, join(scratch, entry), { recursive: true })
    }
    symlinkSync(join(ROOT, "node_modules"), join(scratch, "node_modules"), "dir")

    const found = anExportedValueIn(join(ROOT, "src/adapters", adapter))
    if (!found) {
      console.error(`  self-test found no exported value in src/adapters/${adapter}/ to import.`)
      process.exit(1)
    }

    const intruderDir = join(scratch, "lib")
    mkdirSync(intruderDir, { recursive: true })
    const intruder = join(intruderDir, "intruder-selftest.ts")
    writeFileSync(
      intruder,
      `// planted by check-adapter-deletion.mjs --self-test\n` +
        `import { ${found.name} } from "@/src/adapters/${adapter}/${found.specifier}"\n` +
        `export const leaked = ${found.name}\n`,
    )
    console.log(`  planted: lib/intruder-selftest.ts imports { ${found.name} } from ${adapter}/${found.specifier}`)

    const clean = simulate(ROOT, adapter)
    const cleanOk = report(clean, [THE_ONE_FILE])
    console.log(`  ${cleanOk ? "ok  " : "FAIL"}  must pass  the real tree`)

    const leaked = simulate(scratch, adapter)
    const caught = leaked.failing.includes("lib/intruder-selftest.ts")
    console.log(`  ${caught ? "ok  " : "FAIL"}  must fire  a second module importing the adapter directly`)
    if (caught) {
      console.log(`             it named: ${leaked.failing.join(", ")}`)
    }

    if (!cleanOk || !caught) {
      console.error("\nself-test FAILED — the deleted-adapter simulation is not working.")
      process.exit(1)
    }
    console.log("\nself-test: 2 cases passed — the check fires on a real seam leak.")
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
  process.exit(0)
}

if (isMain) {
  const adapters = adapterDirs()
  if (adapters.length === 0) {
    // Zero adapters is not a pass. 0027 split this ticket out precisely because a
    // simulation over zero adapters asserts nothing, and a check that reports success in
    // that state would hide the day the adapter directory got moved or renamed.
    console.error(`
  NO ADAPTER DIRECTORY FOUND under src/adapters/.

  This check exists to prove D-121.1 — that deleting an adapter breaks exactly one
  file — and there is nothing to delete. That is not a clean result; it means the
  layout moved and this check is now measuring nothing.
`)
    process.exit(1)
  }

  let failed = 0
  for (const adapter of adapters) {
    if (!report(simulate(ROOT, adapter), [THE_ONE_FILE])) failed++
  }
  if (failed) process.exit(1)
  console.log(`\nThe adapter seam holds: deleting any of ${adapters.length} adapter(s) breaks only ${THE_ONE_FILE}.`)
}
