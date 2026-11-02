#!/usr/bin/env node
// AUTH.JS CONFIG, FROM SSM INTO .env.production. Ticket 0330, D-471, 08 §3 S10/S11.
//
// Amplify's SSR compute has no runtime environment of its own, so the build writes what the
// server needs into `.env.production`, which Next loads on the server at request time
// (`school-hub`'s mechanism, sourced from SSM rather than Amplify console variables, matching
// 08 §3's single store). Server-only names, never `NEXT_PUBLIC_`, so Next never inlines them
// into a client bundle; `check-bundle-leak.mjs` proves that after the build.
//
// FAILS CLOSED. Any parameter missing, empty, unreadable, or holding a character `.env` parsing
// could mangle (Next expands `$`, and `#` starts a comment) fails the build with the parameter's
// NAME. A build without them would deploy an Auth.js that cannot sign anyone in, and a build with
// a silently truncated AUTH_SECRET would deploy one that rejects every school-hub session.
//
// VALUES ARE NEVER PRINTED. Not on success, not on failure. The log names keys and a count.
//
// Needs `ssm:GetParameter` on exactly the six parameters below (the Amplify build role), and
// `kms:Decrypt` through SSM for the two SecureStrings (the AWS-managed `aws/ssm` key grants that
// to any principal allowed the SSM read).
//
//   node scripts/write-authjs-env.mjs              append the six to .env.production
//   node scripts/write-authjs-env.mjs --self-test  prove every failure mode fires

import { execFileSync } from "node:child_process"
import { appendFileSync, readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "")
export const PREFIX = "/amplify/shared/d14fhvl4rp79nn/"

/** The six, and their SSM type. A SecureString key stored as a String fails too. */
export const PARAMS = [
  { key: "AUTH_SECRET", type: "SecureString" },
  { key: "GOOGLE_CLIENT_ID", type: "SecureString" },
  { key: "GOOGLE_CLIENT_SECRET", type: "SecureString" },
  { key: "AUTH_ALLOWED_EMAILS", type: "String" },
  { key: "AUTH_COOKIE_DOMAIN", type: "String" },
  { key: "AUTH_URL", type: "String" },
]

/** Characters a `.env` value may hold unquoted without Next's parser changing it. */
const SAFE = /^[A-Za-z0-9+/=._@,:-]+$/

/**
 * Pure: given what SSM returned per key, the `.env` lines or the failures. `fetched` maps key ->
 * { value, type } or { error }. Failures carry key names only.
 */
export function plan(fetched) {
  const failures = []
  const lines = []
  for (const { key, type } of PARAMS) {
    const got = fetched[key]
    if (!got || got.error) {
      failures.push(`${key}: not readable (${got?.error ?? "missing"})`)
      continue
    }
    if (got.type !== type) failures.push(`${key}: is a ${got.type}, expected ${type}`)
    const value = (got.value ?? "").trim()
    if (value === "") failures.push(`${key}: is empty`)
    else if (!SAFE.test(value)) failures.push(`${key}: holds a character .env parsing would change ($, #, quote, space...)`)
    else lines.push(`${key}=${value}`)
  }
  if (fetched.AUTH_URL?.value && SAFE.test(fetched.AUTH_URL.value.trim())) {
    // next-auth derives a basePath from AUTH_URL when it has a path; lib/auth/index.ts sets
    // /api/authjs explicitly, and a bare origin keeps the two from disagreeing.
    try {
      if (new URL(fetched.AUTH_URL.value.trim()).pathname !== "/") failures.push("AUTH_URL: must be a bare origin, no path")
    } catch {
      failures.push("AUTH_URL: is not a URL")
    }
  }
  return failures.length ? { failures } : { lines }
}

function fetchFromSsm() {
  const out = {}
  for (const { key } of PARAMS) {
    try {
      const raw = execFileSync(
        "aws",
        ["ssm", "get-parameter", "--name", PREFIX + key, "--with-decryption", "--output", "json"],
        { stdio: ["ignore", "pipe", "pipe"] },
      ).toString()
      const p = JSON.parse(raw).Parameter
      out[key] = { value: p.Value, type: p.Type }
    } catch (err) {
      // The AWS error's code only: never the command output, which would hold the value.
      const code = /\(([A-Za-z]+(?:Exception|NotFound|Denied)[A-Za-z]*)\)/.exec(String(err.stderr ?? ""))?.[1]
      out[key] = { error: code ?? "aws cli failed" }
    }
  }
  return out
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href

if (isMain && process.argv.includes("--self-test")) {
  const ok = (key, value, type) => [key, { value, type }]
  // Fixture values are assembled at runtime, as in check-bundle-leak.mjs: a secret-shaped literal
  // in source is a true positive for gitleaks, and the assembled string tests the same thing.
  const fixture = (...parts) => parts.join("")
  const GOOD = Object.fromEntries([
    ok("AUTH_SECRET", fixture("c2VsZi10ZXN0", "LW9ubHktbm90LWEtc2VjcmV0"), "SecureString"),
    ok("GOOGLE_CLIENT_ID", "123-abc.apps.googleusercontent.com", "SecureString"),
    ok("GOOGLE_CLIENT_SECRET", "self-test-not-a-secret", "SecureString"),
    ok("AUTH_ALLOWED_EMAILS", "owner@example.com", "String"),
    ok("AUTH_COOKIE_DOMAIN", ".devaultsecurity.com", "String"),
    ok("AUTH_URL", "https://soles.devaultsecurity.com", "String"),
  ])
  const cases = [
    ["all six present", GOOD, 0],
    ["one missing", { ...GOOD, AUTH_SECRET: undefined }, 1],
    ["one unreadable", { ...GOOD, GOOGLE_CLIENT_SECRET: { error: "AccessDeniedException" } }, 1],
    ["one empty", { ...GOOD, AUTH_ALLOWED_EMAILS: { value: " ", type: "String" } }, 1],
    ["a secret stored as String", { ...GOOD, AUTH_SECRET: { value: "x", type: "String" } }, 1],
    ["a `$` that Next would expand", { ...GOOD, AUTH_SECRET: { value: "ab$cd", type: "SecureString" } }, 1],
    ["a `#` that starts a comment", { ...GOOD, GOOGLE_CLIENT_SECRET: { value: "ab #cd", type: "SecureString" } }, 1],
    ["AUTH_URL with a path", { ...GOOD, AUTH_URL: { value: "https://soles.devaultsecurity.com/api/authjs", type: "String" } }, 1],
    ["all missing", {}, 6],
  ]
  let failed = 0
  for (const [name, fetched, want] of cases) {
    const r = plan(fetched)
    const got = r.failures?.length ?? 0
    const leak = JSON.stringify(r.failures ?? []).includes("self-test-not-a-secret")
    const pass = got === want && !leak && (want > 0 || r.lines.length === PARAMS.length)
    if (!pass) failed++
    console.log(`  ${pass ? "ok" : "FAIL"}  ${got} failure(s), expected ${want}  — ${name}`)
  }
  if (failed) {
    console.error(`\n${failed} self-test case(s) failed. Do not trust this step.`)
    process.exit(1)
  }
  console.log("\nself-test: every failure mode fails closed, and no failure names a value.")
  process.exit(0)
}

if (isMain) {
  const result = plan(fetchFromSsm())
  if (result.failures) {
    console.error("AUTH.JS ENV FAILED — not writing .env.production, failing the build (ticket 0330):")
    for (const f of result.failures) console.error(`  ${f}`)
    console.error(`\nAll six live under ${PREFIX}. The build role needs ssm:GetParameter on each.`)
    process.exit(1)
  }
  const file = join(ROOT, ".env.production")
  const existing = existsSync(file) ? readFileSync(file, "utf8") : ""
  const clash = PARAMS.filter(({ key }) => new RegExp(`^${key}=`, "m").test(existing)).map((p) => p.key)
  if (clash.length) {
    console.error(`AUTH.JS ENV FAILED — .env.production already sets ${clash.join(", ")}. One source only.`)
    process.exit(1)
  }
  appendFileSync(file, (existing === "" || existing.endsWith("\n") ? "" : "\n") + result.lines.join("\n") + "\n")
  console.log(`Auth.js env written to .env.production: ${result.lines.length} of ${PARAMS.length} (${PARAMS.map((p) => p.key).join(", ")})`)
}
