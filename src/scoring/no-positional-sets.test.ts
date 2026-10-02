import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative, sep } from "node:path"

import { describe, expect, it } from "vitest"

/**
 * Ticket 0070 criterion 4 — no code reads a set POSITIONALLY.
 *
 * `sets` is a list so that the deferred sets editor (D-062) is a longer list, not a migration.
 * That only holds if every reader sums the list. One `sets[0].reps` turns a three-set entry
 * into a third of its work, silently, in a ledger that can never take XP back (D-135).
 *
 * Tests are exempt — asserting on a fixture's first set is not scoring it.
 */

const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "")
const SKIP_DIRS = new Set(["node_modules", ".next", ".amplify", ".git", "dist", "build"])
const EXTS = [".ts", ".tsx", ".mjs"]

/** `sets[0]`, `sets?.[0]`, `sets.at(0)`, `sets.at(-1)`, and destructuring `const [first] = x.sets`. */
const POSITIONAL = [
  /\bsets\??\.?\[\s*-?\d+\s*\]/,
  /\bsets\??\.at\(/,
  /\[\s*\w+[^\]]*\]\s*=\s*[\w.?]*\bsets\b\s*[;\n]?$/,
]

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (EXTS.some((e) => name.endsWith(e))) out.push(full)
  }
  return out
}

const isTest = (rel: string) => /\.test(-d)?\.(tsx?|mjs)$/.test(rel) || rel.includes("__fixtures__/")
const posix = (p: string) => p.split(sep).join("/")

function violationsIn(rel: string, text: string): string[] {
  const out: string[] = []
  text.split("\n").forEach((line, i) => {
    if (POSITIONAL.some((p) => p.test(line))) out.push(`${rel}:${i + 1}  ${line.trim()}`)
  })
  return out
}

describe("no code indexes sets positionally (0070 criterion 4)", () => {
  const files = ["src", "app", "lib", "components", "amplify"]
    .flatMap((d) => walk(join(ROOT, d)))
    .map((f) => posix(relative(ROOT, f)))
    .filter((rel) => !isTest(rel))

  it("scans a non-trivial number of files, so an empty sweep cannot pass silently", () => {
    expect(files.length).toBeGreaterThan(10)
    expect(files).toContain("src/scoring/units.ts")
  })

  it("finds no positional read of sets", () => {
    const violations = files.flatMap((rel) => violationsIn(rel, readFileSync(join(ROOT, rel), "utf8")))
    expect(
      violations,
      "Sum the list instead (see `sumSets` in src/scoring/units.ts) — a set is one of many:\n  " +
        violations.join("\n  "),
    ).toEqual([])
  })

  it("detects a violation when one exists", () => {
    for (const bad of [
      "const n = activity.sets[0].reps",
      "const n = entry.sets?.[0]?.reps",
      "const last = a.sets.at(-1)",
      "const [first] = entry.sets",
    ]) {
      expect(violationsIn("x.ts", bad), bad).toHaveLength(1)
    }
    for (const fine of ["for (const set of a.sets) total += set.reps", "sets: [{ reps: 30 }]", "offsets[0]"]) {
      expect(violationsIn("x.ts", fine), fine).toEqual([])
    }
  })
})
