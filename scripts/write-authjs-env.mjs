#!/usr/bin/env node
// AUTH.JS CONFIG, FROM SSM INTO .env.production. Ticket 0330, D-471, 08 §3 S10/S11.
// Ticket 0339, D-478: plus AUTH_SESSION_COOKIE and AUTH_SSO_URL, which join Lost Soles to core's
// SSO (the shared cookie name, and where a signed-out visitor is sent).
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
// Needs `ssm:GetParameter` on exactly the eight parameters below (the Amplify build role), and
// `kms:Decrypt` through SSM for the two SecureStrings (the AWS-managed `aws/ssm` key grants that
// to any principal allowed the SSM read).
//
//   node scripts/write-authjs-env.mjs              append the eight to .env.production
//   node scripts/write-authjs-env.mjs --self-test  prove every failure mode fires

import { execFileSync } from "node:child_process"
import { appendFileSync, readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "")
export const PREFIX = "/amplify/shared/d14fhvl4rp79nn/"

/** The eight, and their SSM type. A SecureString key stored as a String fails too. */
export const PARAMS = [
  { key: "AUTH_SECRET", type: "SecureString" },
  { key: "GOOGLE_CLIENT_ID", type: "SecureString" },
  { key: "GOOGLE_CLIENT_SECRET", type: "SecureString" },
  { key: "AUTH_ALLOWED_EMAILS", type: "String" },
  { key: "AUTH_COOKIE_DOMAIN", type: "String" },
  { key: "AUTH_URL", type: "String" },
  // D-478. The session cookie's name WITHOUT `__Secure-` (config.ts adds it in production). Auth.js
  // uses the name as the JWE salt, so it must be core's exactly: `devault.session-token`.
  { key: "AUTH_SESSION_COOKIE", type: "String" },
  // D-478. Core's origin, `https://core.devaultsecurity.com`. Set, a signed-out page goes there.
  { key: "AUTH_SSO_URL", type: "String" },
]

/** The domain every SSO app lives on (config.ts's SSO_PARENT_DOMAIN). */
const SSO_PARENT_DOMAIN = "devaultsecurity.com"

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
  const cookie = fetched.AUTH_SESSION_COOKIE?.value?.trim()
  if (cookie && SAFE.test(cookie) && /^__(?:Secure|Host)-/.test(cookie)) {
    // config.ts prefixes `__Secure-` itself in production; a stored prefix would double it, and
    // the doubled name is a different JWE salt from core's, so no SSO session would decrypt.
    failures.push("AUTH_SESSION_COOKIE: must be the name without its __Secure-/__Host- prefix")
  }
  const sso = fetched.AUTH_SSO_URL?.value?.trim()
  if (sso && SAFE.test(sso)) {
    // A bare https origin on the parent domain, and not this app: ssoLoginUrl() appends /login, and
    // pointing it at ourselves would send every signed-out visitor round in a loop.
    let u
    try {
      u = new URL(sso)
    } catch {
      failures.push("AUTH_SSO_URL: is not a URL")
    }
    if (u) {
      const onDomain = u.hostname === SSO_PARENT_DOMAIN || u.hostname.endsWith(`.${SSO_PARENT_DOMAIN}`)
      if (u.protocol !== "https:" || !onDomain || u.username || u.password) {
        failures.push(`AUTH_SSO_URL: must be an https origin on ${SSO_PARENT_DOMAIN}`)
      } else if (u.pathname !== "/" || u.search || u.hash) {
        failures.push("AUTH_SSO_URL: must be a bare origin, no path")
      } else {
        let self
        try {
          self = new URL(fetched.AUTH_URL?.value?.trim() ?? "").origin
        } catch {
          self = undefined
        }
        if (u.origin === self) failures.push("AUTH_SSO_URL: is this app's own AUTH_URL, which would loop")
      }
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
    ok("AUTH_SESSION_COOKIE", "devault.session-token", "String"),
    ok("AUTH_SSO_URL", "https://core.devaultsecurity.com", "String"),
  ])
  const cases = [
    ["all eight present", GOOD, 0],
    ["one missing", { ...GOOD, AUTH_SECRET: undefined }, 1],
    ["one unreadable", { ...GOOD, GOOGLE_CLIENT_SECRET: { error: "AccessDeniedException" } }, 1],
    ["one empty", { ...GOOD, AUTH_ALLOWED_EMAILS: { value: " ", type: "String" } }, 1],
    ["a secret stored as String", { ...GOOD, AUTH_SECRET: { value: "x", type: "String" } }, 1],
    ["a `$` that Next would expand", { ...GOOD, AUTH_SECRET: { value: "ab$cd", type: "SecureString" } }, 1],
    ["a `#` that starts a comment", { ...GOOD, GOOGLE_CLIENT_SECRET: { value: "ab #cd", type: "SecureString" } }, 1],
    ["AUTH_URL with a path", { ...GOOD, AUTH_URL: { value: "https://soles.devaultsecurity.com/api/authjs", type: "String" } }, 1],
    // 0339, D-478: the two SSO parameters fail closed like the rest, and refuse a wrong shape.
    ["AUTH_SESSION_COOKIE missing", { ...GOOD, AUTH_SESSION_COOKIE: undefined }, 1],
    ["AUTH_SSO_URL missing", { ...GOOD, AUTH_SSO_URL: undefined }, 1],
    ["AUTH_SSO_URL unreadable", { ...GOOD, AUTH_SSO_URL: { error: "ParameterNotFound" } }, 1],
    ["AUTH_SESSION_COOKIE empty", { ...GOOD, AUTH_SESSION_COOKIE: { value: "", type: "String" } }, 1],
    ["AUTH_SESSION_COOKIE stored with its __Secure- prefix", { ...GOOD, AUTH_SESSION_COOKIE: { value: "__Secure-devault.session-token", type: "String" } }, 1],
    ["AUTH_SSO_URL stored as a SecureString", { ...GOOD, AUTH_SSO_URL: { value: "https://core.devaultsecurity.com", type: "SecureString" } }, 1],
    ["AUTH_SSO_URL over http", { ...GOOD, AUTH_SSO_URL: { value: "http://core.devaultsecurity.com", type: "String" } }, 1],
    ["AUTH_SSO_URL off the domain", { ...GOOD, AUTH_SSO_URL: { value: "https://core.example.com", type: "String" } }, 1],
    ["AUTH_SSO_URL on a look-alike domain", { ...GOOD, AUTH_SSO_URL: { value: "https://core.evildevaultsecurity.com", type: "String" } }, 1],
    ["AUTH_SSO_URL with a path", { ...GOOD, AUTH_SSO_URL: { value: "https://core.devaultsecurity.com/login", type: "String" } }, 1],
    ["AUTH_SSO_URL is this app", { ...GOOD, AUTH_SSO_URL: { value: "https://soles.devaultsecurity.com", type: "String" } }, 1],
    ["AUTH_SSO_URL not a URL", { ...GOOD, AUTH_SSO_URL: { value: "core.devaultsecurity.com", type: "String" } }, 1],
    ["all missing", {}, 8],
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
    console.error(`\nAll eight live under ${PREFIX}. The build role needs ssm:GetParameter on each.`)
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
