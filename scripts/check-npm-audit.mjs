#!/usr/bin/env node
// FULL-TREE NPM AUDIT GATE: no high or critical advisory outside a reviewed allowlist.
//
// docs/08-security-privacy.md §7.5, ticket 0318. `npm audit --omit=dev --audit-level=high` gates
// the RUNTIME tree and stays at zero with no exceptions; it still runs beside this check. The dev
// tree (Amplify backend CLI, codegen, vitest) cannot reach zero without upstream Amplify releases
// (D-450, 18-mvp-hardening.md's 0308 section), so before this check a new dev-tree critical went
// unnoticed between Dependabot alerts. This gates the full tree and admits only the advisories in
// scripts/npm-audit-allowlist.json.
//
// It judges by ADVISORY, not by path. npm lists every parent of a vulnerable package as its own
// high "vulnerability" (37 of them today) whose `via` is a package name; only the leaves carry an
// advisory object. Counting those parents would make the allowlist a list of Amplify's internals.
//
// Fails, each a non-zero exit:
//   1. a high or critical advisory whose (package, GHSA id) is not on the allowlist
//   2. an allowlisted advisory now rated above the severity its entry admits
//   3. a STALE entry: its advisory no longer appears in the audit at any severity. Exceptions that
//      outlive their reason are how an allowlist rots; removing the entry is the fix
//   4. a malformed allowlist (a missing field, a non-GHSA id, a duplicate)
//   5. an audit it cannot read: unreachable registry, npm error, unparseable output (D-176,
//      fail closed)
//
// Plain node, no dependencies: it runs in the GitHub Actions gate and the Amplify build (D-163).
//
//   node scripts/check-npm-audit.mjs                     run `npm audit --json` over the full tree
//   node scripts/check-npm-audit.mjs --input <file>      judge a saved `npm audit --json` document
//   node scripts/check-npm-audit.mjs --self-test         prove each rule FIRES on the fixture

import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"

const ALLOWLIST_PATH = new URL("./npm-audit-allowlist.json", import.meta.url)
const FIXTURE_PATH = new URL("./fixtures/npm-audit-full-tree.json", import.meta.url)

export const SEVERITIES = ["info", "low", "moderate", "high", "critical"]
const GATE = SEVERITIES.indexOf("high")
const GHSA = /^GHSA-[23456789cfghjmpqrvwx]{4}-[23456789cfghjmpqrvwx]{4}-[23456789cfghjmpqrvwx]{4}$/
const FIELDS = ["package", "advisory", "severity", "owner", "reason", "recheck"]

const rank = (s) => SEVERITIES.indexOf(s)
const key = (pkg, id) => `${pkg} ${id}`

/** The advisory's GHSA id, from its URL. An advisory without one keeps npm's numeric id. */
export function advisoryId(via) {
  const m = /GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}/.exec(via.url ?? "")
  return m ? m[0] : `npm-${via.source}`
}

/**
 * Every advisory in an `npm audit --json` (auditReportVersion 2) document, one per
 * (package, advisory) pair, at its highest reported severity. Parent entries, whose `via` holds
 * only package names, contribute nothing: they are paths to an advisory, not advisories.
 */
export function collectAdvisories(report) {
  if (report === null || typeof report !== "object") throw new Error("audit output is not a JSON object")
  if (report.error) {
    throw new Error(`npm audit reported an error: ${report.error.summary ?? JSON.stringify(report.error)}`)
  }
  if (report.auditReportVersion !== 2 || typeof report.vulnerabilities !== "object" || report.vulnerabilities === null) {
    throw new Error("audit output is not an auditReportVersion 2 document with a `vulnerabilities` object")
  }
  const found = new Map()
  for (const entry of Object.values(report.vulnerabilities)) {
    for (const via of entry.via ?? []) {
      if (typeof via !== "object" || via === null) continue
      if (rank(via.severity) < 0) throw new Error(`advisory ${via.url ?? via.source} has unknown severity "${via.severity}"`)
      const id = advisoryId(via)
      const pkg = via.name ?? entry.name
      const k = key(pkg, id)
      const prev = found.get(k)
      if (!prev || rank(via.severity) > rank(prev.severity)) {
        found.set(k, { package: pkg, advisory: id, severity: via.severity, title: via.title ?? "" })
      }
    }
  }
  return [...found.values()]
}

/** Problems with the allowlist file itself. Empty when well-formed. */
export function validateAllowlist(allowlist) {
  const problems = []
  const entries = allowlist?.advisories
  if (!Array.isArray(entries)) return ["allowlist has no `advisories` array"]
  const seen = new Set()
  entries.forEach((e, i) => {
    const at = `allowlist entry ${i} (${e?.package ?? "?"} ${e?.advisory ?? "?"})`
    for (const f of FIELDS) {
      if (typeof e?.[f] !== "string" || e[f].trim() === "") problems.push(`${at}: missing \`${f}\``)
    }
    if (typeof e?.advisory === "string" && !GHSA.test(e.advisory)) {
      problems.push(`${at}: \`advisory\` must be a full GHSA id, e.g. GHSA-7mx3-vvmw-hjmv`)
    }
    if (typeof e?.severity === "string" && rank(e.severity) < GATE) {
      problems.push(`${at}: severity "${e.severity}" is below the gate; only high or critical belong here`)
    }
    const k = key(e?.package, e?.advisory)
    if (seen.has(k)) problems.push(`${at}: duplicate entry`)
    seen.add(k)
  })
  return problems
}

/** Judge an audit document against the allowlist. Returns { failures, admitted }. */
export function judge(report, allowlist) {
  const failures = validateAllowlist(allowlist)
  if (failures.length) return { failures, admitted: [] }

  const advisories = collectAdvisories(report)
  const present = new Map(advisories.map((a) => [key(a.package, a.advisory), a]))
  const allowed = new Map(allowlist.advisories.map((e) => [key(e.package, e.advisory), e]))
  const admitted = []

  for (const a of advisories) {
    if (rank(a.severity) < GATE) continue
    const entry = allowed.get(key(a.package, a.advisory))
    if (!entry) {
      failures.push(`NOT ALLOWLISTED: ${a.package} ${a.advisory} (${a.severity}) ${a.title}`)
    } else if (rank(a.severity) > rank(entry.severity)) {
      failures.push(`RE-RATED: ${a.package} ${a.advisory} is now ${a.severity}; its entry admits only ${entry.severity}`)
    } else {
      admitted.push(a)
    }
  }
  for (const e of allowlist.advisories) {
    if (!present.has(key(e.package, e.advisory))) {
      failures.push(`STALE ENTRY: ${e.package} ${e.advisory} no longer appears in the audit; remove it from scripts/npm-audit-allowlist.json`)
    }
  }
  return { failures, admitted }
}

function runAudit() {
  const r = spawnSync("npm", ["audit", "--json"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  if (r.error) throw new Error(`could not run npm audit: ${r.error.message}`)
  // npm audit exits 1 whenever it finds anything, so the exit code says nothing here. The JSON does.
  try {
    return JSON.parse(r.stdout)
  } catch {
    throw new Error(`npm audit printed no parseable JSON (exit ${r.status}): ${(r.stderr || r.stdout).slice(0, 500)}`)
  }
}

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"))

/** A copy of the fixture with one more leaf advisory, as npm would report it. */
export function withAdvisory(report, { name, ghsa, severity, source = 9999999 }) {
  const copy = structuredClone(report)
  copy.vulnerabilities[name] = {
    name,
    severity,
    isDirect: false,
    via: [{ source, name, dependency: name, title: "planted", url: `https://github.com/advisories/${ghsa}`, severity, range: "<1.0.0" }],
    effects: [],
    range: "<1.0.0",
    nodes: [`node_modules/${name}`],
    fixAvailable: false,
  }
  return copy
}

function selfTest() {
  const fixture = readJson(FIXTURE_PATH)
  const allowlist = readJson(ALLOWLIST_PATH)
  const without = (r, name) => {
    const c = structuredClone(r)
    delete c.vulnerabilities[name]
    return c
  }
  const rerated = structuredClone(fixture)
  rerated.vulnerabilities.zod.via[0].severity = "critical"

  const cases = [
    ["the committed fixture passes", fixture, allowlist, 0],
    ["an unlisted high fails", withAdvisory(fixture, { name: "left-pad", ghsa: "GHSA-2222-3333-4444", severity: "high" }), allowlist, 1],
    ["an unlisted critical fails", withAdvisory(fixture, { name: "left-pad", ghsa: "GHSA-2222-3333-4444", severity: "critical" }), allowlist, 1],
    ["an unlisted moderate passes", withAdvisory(fixture, { name: "left-pad", ghsa: "GHSA-2222-3333-4444", severity: "moderate" }), allowlist, 0],
    ["a re-rated allowlisted advisory fails", rerated, allowlist, 1],
    ["a stale entry fails", without(fixture, "zod"), allowlist, 1],
    ["a malformed entry fails", fixture, { advisories: [{ ...allowlist.advisories[0], advisory: "1241230" }, allowlist.advisories[1]] }, 1],
  ]
  for (const [name, report, list, expected] of cases) {
    const { failures } = judge(report, list)
    if ((failures.length > 0 ? 1 : 0) !== expected) {
      console.error(`check-npm-audit: self-test FAILED: ${name} (failures: ${JSON.stringify(failures)})`)
      process.exit(1)
    }
  }
  let threw = false
  try {
    judge({ error: { code: "ENOTFOUND", summary: "registry unreachable" } }, allowlist)
  } catch {
    threw = true
  }
  if (!threw) {
    console.error("check-npm-audit: self-test FAILED: an npm error document did not fail closed")
    process.exit(1)
  }
  console.log(`check-npm-audit: self-test passed (${cases.length + 1} cases)`)
}

function main() {
  if (process.argv.includes("--self-test")) return selfTest()
  const i = process.argv.indexOf("--input")
  let failures, admitted
  try {
    const report = i >= 0 ? readJson(process.argv[i + 1]) : runAudit()
    ;({ failures, admitted } = judge(report, readJson(ALLOWLIST_PATH)))
  } catch (err) {
    console.error(`check-npm-audit: FAILED CLOSED: ${err.message}`)
    process.exit(1)
  }
  if (failures.length) {
    console.error(`check-npm-audit: ${failures.length} problem(s) in the full-tree audit:`)
    for (const f of failures) console.error(`  - ${f}`)
    process.exit(1)
  }
  const list = admitted.map((a) => `${a.package} ${a.advisory}`).join(", ") || "none"
  console.log(`check-npm-audit: full tree OK. No high/critical advisory outside the allowlist (admitted: ${list})`)
}

if (import.meta.url === `file://${process.argv[1]}`) main()
