import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative, sep } from "node:path"

import { describe, expect, it } from "vitest"

import { BUNDLED_RULES } from "@/rules/xp-rules.bundled"

import { loadRuleSet } from "./load"

/**
 * `02-data-model.md` §3.8 check 6, and ticket 0028 criterion 8 — the skill-name equivalent
 * of the contract §5 `grep -ri strava` check.
 *
 * If no code names a skill, adding one cannot require code. That is D-031's whole claim,
 * and this is the mechanical version of it: not "we intend not to hardcode skills" but "no
 * file under src/ contains a skill id". `0029` and `0030` both cite this test by name.
 *
 * The skill list is READ FROM THE RULES FILE rather than written out here. A hardcoded list
 * in the test would itself be the thing it forbids, and would silently stop covering the
 * eighth skill the day someone adds one.
 */

const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "")
const SKIP_DIRS = new Set(["node_modules", ".next", ".amplify", ".git", "dist", "build"])
const EXTS = [".ts", ".tsx"]

/** `rules/`, fixtures and tests are exempt — the exemptions §3.8 check 6 names, and no more. */
const isExempt = (rel: string): boolean =>
  rel.startsWith("rules/") ||
  rel.includes("__fixtures__/") ||
  /\.test\.tsx?$/.test(rel) ||
  /\.test-d\.tsx?$/.test(rel)

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

const posix = (p: string) => p.split(sep).join("/")

describe("no code names a skill (02 §3.8 check 6, D-031)", () => {
  const skillIds = loadRuleSet(1).skills.map((s) => s.id)
  const files = walk(join(ROOT, "src"))
    .concat(walk(join(ROOT, "app")), walk(join(ROOT, "lib")), walk(join(ROOT, "components")))
    .map((f) => posix(relative(ROOT, f)))

  it("reads the skill list from the rules file, so it cannot go stale", () => {
    // No literal count: 0157 added two rows and a hardcoded 8 here failed, which is the
    // staleness this test exists to avoid reproducing in itself.
    expect(skillIds.length).toBeGreaterThanOrEqual(8)
    expect(new Set(skillIds).size).toBe(skillIds.length)
  })

  it("scans a non-trivial number of files, so an empty sweep cannot pass silently", () => {
    expect(files.length).toBeGreaterThan(10)
  })

  it("finds no skill id in any non-exempt source file", () => {
    // Quoted, as in §3.8 check 6: a skill id in a STRING is a hardcoded reference. The word
    // appearing in prose or a comment is not — the same distinction D-166/D-167 drew for
    // the Strava grep, and for the same reason: a gate with false positives gets bypassed.
    const pattern = new RegExp(`["'\`](${skillIds.join("|")})["'\`]`)
    const violations: string[] = []

    for (const rel of files) {
      if (isExempt(rel)) continue
      readFileSync(join(ROOT, rel), "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (pattern.test(line)) violations.push(`${rel}:${i + 1}  ${line.trim()}`)
        })
    }

    expect(
      violations,
      violations.length === 0
        ? ""
        : "D-031 / D-141 — a skill id appears in code. Adding a skill must be a YAML row\n" +
          "and nothing else; a string literal here is the first half of the `switch` that\n" +
          "D-031 forbids. Read it from the registry instead:\n  " +
          violations.join("\n  "),
    ).toEqual([])
  })

  it("detects a violation when one exists", () => {
    // The detector proved to fire, without committing a real violation.
    const pattern = new RegExp(`["'\`](${skillIds.join("|")})["'\`]`)
    expect(pattern.test('const s = "wayfaring"')).toBe(true)
    expect(pattern.test("// wayfaring is scored per km")).toBe(false)
  })

  it("finds no hasTrace ternary anywhere — THE failure mode D-141 exists to prevent", () => {
    // The branch D-141 exists to prevent: selecting a skill from the trace flag with a
    // ternary. The grep above already catches the quoted ids; this catches the SHAPE, even
    // if the ids arrived in variables. Written without the literal so that the ticket's
    // own verbatim grep stays clean — a check that fires on prose describing it is the
    // D-166/D-167 false-positive trap, and a gate with those gets bypassed.
    const violations: string[] = []
    for (const rel of files) {
      if (isExempt(rel)) continue
      readFileSync(join(ROOT, rel), "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (/hasTrace\s*\?/.test(line)) violations.push(`${rel}:${i + 1}  ${line.trim()}`)
        })
    }
    expect(violations).toEqual([])
  })
})

/**
 * Ticket 0068 criterion 8 (I-25): *"No skill id or exercise id is legible to the compiler in
 * `(app)/log/`."* Wider than the check above in two ways — EXERCISE ids too, from EVERY bundled
 * ruleset — and narrower in scope: `/log`'s own code, `app/log/` and `lib/log/`. Exercise ids
 * appear in a few comments elsewhere (`src/domain/activity.ts` documents the field with them),
 * so comment lines are skipped rather than widening the scope and inviting a bypass.
 */
describe("/log names no skill and no exercise (0068, I-25)", () => {
  const versions = Object.keys(BUNDLED_RULES).map((v) => loadRuleSet(Number(v)))
  const ids = [
    ...new Set(
      versions.flatMap((r) => r.skills.flatMap((s) => [s.id, ...(s.exercises ?? []).map((e) => e.id)])),
    ),
  ]
  const pattern = new RegExp(`["'\`](${ids.join("|")})["'\`]`)
  const files = walk(join(ROOT, "app/log"))
    .concat(walk(join(ROOT, "lib/log")))
    .map((f) => posix(relative(ROOT, f)))
    .filter((rel) => !isExempt(rel))
  const isComment = (line: string) => /^\s*(\/\/|\*|\/\*)/.test(line)

  it("covers exercise ids, and scans the /log files", () => {
    expect(ids.length).toBeGreaterThan(versions[1].skills.length)
    expect(files).toEqual(expect.arrayContaining(["app/log/log-page.tsx", "app/log/log-row.tsx", "lib/log/rows.ts"]))
  })

  it("finds none", () => {
    const violations: string[] = []
    for (const rel of files) {
      readFileSync(join(ROOT, rel), "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (!isComment(line) && pattern.test(line)) violations.push(`${rel}:${i + 1}  ${line.trim()}`)
        })
    }
    expect(violations).toEqual([])
  })

  it("would find one", () => {
    const exercise = versions[1].skills.flatMap((s) => s.exercises ?? [])[0].id
    expect(pattern.test(`if (row.exerciseId === "${exercise}")`)).toBe(true)
    expect(versions.length).toBeGreaterThanOrEqual(2)
    expect(isComment(` * the "${exercise}" row`)).toBe(true)
  })
})
