#!/usr/bin/env node
// No secret reaches built output (01-architecture.md §7, ticket 0017).
//
// gitleaks (0004) scans COMMITTED SOURCE. This scans BUILT OUTPUT. They are
// different surfaces and both are needed: a secret can reach .next/static
// without ever being committed, by being read from SSM into a client component.
//
// Two zones, two different rules:
//
//   CLIENT  .next/static/**            Zero secret literals. No exceptions, no
//                                      allowlist. Anyone who loads the page can
//                                      read this. This is the whole threat model.
//   SERVER  .amplify/artifacts/**      Also zero today. secret() injects into the
//           .next/server/**            Lambda ENVIRONMENT at deploy time, never
//                                      into the bundle, so a literal here means
//                                      someone hardcoded it. SERVER_ALLOWLIST is
//                                      deliberately empty and adding to it
//                                      requires a design citation.
//
// Plain node, no npm dependencies, no ripgrep — it runs in BOTH the GitHub gate
// and the Amplify build container, which has no rg (D-163: a check that runs in
// only one of the two is half a control).
//
// THIS SCRIPT NEVER PRINTS A SECRET VALUE. Findings name the KEY, the FILE and
// the OFFSET, and the excerpt has the value replaced by <KEY>. A leak detector
// that prints the leak into a public CI log is the bug it is looking for.
//
//   node scripts/check-bundle-leak.mjs                  patterns + whatever literals resolve
//   node scripts/check-bundle-leak.mjs --require-literals  fail if no literal resolved (the Amplify build)
//   node scripts/check-bundle-leak.mjs --self-test      prove the rules FIRE

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs"
import { join, relative, sep } from "node:path"
import { pathToFileURL } from "node:url"
import { execFileSync } from "node:child_process"

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "")

/**
 * The registry, from 01-architecture.md §7. Order and wording match the table in
 * docs/capabilities/02-deploy-and-auth.md; if one changes, change both.
 *
 * `store: "ssm"` values are scanned for as literals. TILES_BASE_URL is a plain
 * environment variable and is NOT a secret — it is listed here so that a future
 * reader who finds it in a client bundle knows that is correct and intended,
 * rather than filing an incident. It is never scanned for.
 */
export const REGISTRY = [
  { key: "STRAVA_CLIENT_ID", store: "ssm" },
  { key: "STRAVA_CLIENT_SECRET", store: "ssm" },
  { key: "STRAVA_WEBHOOK_VERIFY_TOKEN", store: "ssm" },
  { key: "INGEST_BEARER_TOKEN", store: "ssm" },
  { key: "TILES_BASE_URL", store: "env" },
]
const SSM_KEYS = REGISTRY.filter((r) => r.store === "ssm").map((r) => r.key)

/**
 * A value shorter than this is not scanned for. Not laziness — STRAVA_CLIENT_ID
 * is a five- or six-digit number, and a six-digit run appears in minified chunk
 * names, timestamps and integer constants many times per bundle. Scanning for it
 * produces noise that trains people to ignore this check, which is worse than
 * not scanning. §7 already records the client id as semi-public by design (it
 * appears in the OAuth authorize URL). Skips are REPORTED BY NAME, never silent.
 */
const MIN_LITERAL_LENGTH = 12

/**
 * Server-side bundles in which a given literal is legitimately baked in, per the
 * design. EMPTY, and it should stay empty: secret() resolves into the Lambda's
 * environment at deploy time, so nothing needs the value at build time. Adding an
 * entry requires a docs citation in the `why`, because the next reader's only
 * defence against an entry added to silence a real leak is that reasoning.
 *
 *   { key: "SOME_KEY", pathIncludes: "asset.abc", why: "docs/NN-x.md §Y says ..." }
 */
export const SERVER_ALLOWLIST = []

/**
 * Generic credential shapes, scanned in every zone regardless of the registry —
 * including vendored third-party assets. `documented` marks a match as a
 * published placeholder rather than a credential.
 *
 * These two exclusions are NARROWED PATTERNS, not a path allowlist, and that
 * distinction was deliberate. CDK vendors the AWS CLI Lambda layer into
 * cdk.out, and `awscli/botocore/data/**\/examples-1.json` is 4,000-odd files of
 * AWS's own API documentation containing both shapes. Allowlisting that path
 * would have been one line, and would have switched the pattern scan OFF inside
 * the largest third-party blob in the build — precisely where a supply-chain
 * problem would sit. Excluding by shape keeps the scan live everywhere.
 */
export const PATTERNS = [
  {
    name: "AWS access key id",
    re: /AKIA[0-9A-Z]{16}/g,
    // AKIA…EXAMPLE is AWS's published placeholder convention (AKIAIOSFODNN7EXAMPLE
    // and friends). AWS does not issue key ids ending in EXAMPLE.
    documented: (m) => m.endsWith("EXAMPLE"),
  },
  { name: "GitHub personal access token", re: /ghp_[A-Za-z0-9]{20,}/g },
  { name: "GitHub fine-grained PAT", re: /github_pat_[A-Za-z0-9_]{20,}/g },
  {
    name: "private key block",
    re: /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/g,
    // A header with no key material after it is prose. botocore's examples show
    // `-----BEGIN RSA PRIVATE KEY-----<a very long private key string>`. A real
    // block is followed by base64; require some before calling it a key.
    documented: (m, text, i) =>
      !/[A-Za-z0-9+/=\s]{100,}/.test(text.slice(i + m.length, i + m.length + 400)),
  },
  { name: "Slack token", re: /xox[baprs]-[A-Za-z0-9-]{10,}/g },
]

const BINARY_EXT = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".ico", ".bmp",
  ".woff", ".woff2", ".ttf", ".otf", ".eot", ".pdf", ".mp4", ".webm", ".pmtiles",
])

function walk(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

/** 30 characters either side, with the matched value replaced by its key name. */
function excerpt(text, at, len, label) {
  const before = text.slice(Math.max(0, at - 30), at).replace(/\s+/g, " ")
  const after = text.slice(at + len, at + len + 30).replace(/\s+/g, " ")
  return `...${before}<${label}>${after}...`
}

/**
 * Scan one blob of text. `literals` is [{ key, value }]; `label` is how the blob
 * is named in a finding (a repo-relative path, or `zip!member`).
 */
export function scanText(text, label, literals) {
  const found = []
  for (const { key, value } of literals) {
    let at = text.indexOf(value)
    while (at !== -1) {
      found.push({ label, kind: "literal", key, at, excerpt: excerpt(text, at, value.length, key) })
      if (found.length > 20) return found
      at = text.indexOf(value, at + value.length)
    }
  }
  for (const { name, re, documented } of PATTERNS) {
    for (const m of text.matchAll(re)) {
      if (documented?.(m[0], text, m.index)) continue
      found.push({
        label, kind: "pattern", key: name, at: m.index,
        excerpt: excerpt(text, m.index, m[0].length, name),
      })
      if (found.length > 20) return found
    }
  }
  return found
}

/** `unzip -p` the whole archive first (cheap); only if that hits do we name members. */
function scanZip(file, label, literals) {
  let whole
  try {
    whole = execFileSync("unzip", ["-p", file], { maxBuffer: 512 * 1024 * 1024 }).toString("utf8")
  } catch {
    // Fail loudly rather than silently skipping a Lambda bundle. An archive we
    // cannot open is an archive we cannot clear.
    return [{ label, kind: "unreadable", key: "-", at: 0, excerpt: "could not `unzip -p` this archive" }]
  }
  if (!scanText(whole, label, literals).length) return []
  const members = execFileSync("unzip", ["-Z", "-1", file], { maxBuffer: 32 * 1024 * 1024 })
    .toString("utf8").split("\n").filter(Boolean)
  const found = []
  for (const member of members) {
    if (member.endsWith("/")) continue
    let body
    try {
      body = execFileSync("unzip", ["-p", file, member], { maxBuffer: 256 * 1024 * 1024 }).toString("utf8")
    } catch { continue }
    found.push(...scanText(body, `${label}!${member}`, literals))
  }
  // The whole-archive scan hit but no member did: report it rather than lose it.
  return found.length ? found : [{ label, kind: "literal", key: "unattributed", at: 0, excerpt: "matched in the archive but not attributable to a member" }]
}

export function scanZone(base, dirs, literals) {
  const found = []
  for (const dir of dirs) {
    for (const file of walk(join(base, dir))) {
      const rel = relative(base, file).split(sep).join("/")
      const dot = rel.lastIndexOf(".")
      const ext = dot === -1 ? "" : rel.slice(dot).toLowerCase()
      if (BINARY_EXT.has(ext)) continue
      if (ext === ".zip") { found.push(...scanZip(file, rel, literals)); continue }
      found.push(...scanText(readFileSync(file, "utf8"), rel, literals))
    }
  }
  return found
}

export const CLIENT_DIRS = [".next/static"]
export const SERVER_DIRS = [".next/server", ".amplify/artifacts/cdk.out"]

/** Findings for both zones, with SERVER_ALLOWLIST applied to the server zone only. */
export function scanBuild(base, literals) {
  const client = scanZone(base, CLIENT_DIRS, literals).map((f) => ({ ...f, zone: "CLIENT" }))
  const server = scanZone(base, SERVER_DIRS, literals)
    .filter((f) => !SERVER_ALLOWLIST.some((a) => a.key === f.key && f.label.includes(a.pathIncludes)))
    .map((f) => ({ ...f, zone: "SERVER" }))
  return [...client, ...server]
}

/* ─── resolving the literals ──────────────────────────────────────────────── */

/**
 * Values that are placeholders, not secrets. .env.example ships `replace-me`,
 * and scanning for that string would fire on any file containing it.
 */
const PLACEHOLDER = /^(replace-me|changeme|xxx+|00000|todo)$/i

function fromSsm() {
  // /amplify covers all three layouts: /amplify/shared/<app-id>/<key>,
  // /amplify/<app-id>/<branch>-branch-<hash>/<key>, and the sandbox's own path.
  // One recursive call rather than guessing the branch hash.
  const args = ["ssm", "get-parameters-by-path", "--path", "/amplify", "--recursive",
    "--with-decryption", "--output", "json", "--no-cli-pager"]
  if (process.env.AWS_REGION) args.push("--region", process.env.AWS_REGION)
  const out = execFileSync("aws", args, { maxBuffer: 32 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] })
  const params = JSON.parse(out.toString("utf8")).Parameters ?? []
  const hits = []
  for (const p of params) {
    const key = p.Name.slice(p.Name.lastIndexOf("/") + 1)
    if (SSM_KEYS.includes(key)) hits.push({ key, value: p.Value, from: "ssm" })
  }
  return hits
}

function fromEnvFile(base) {
  const file = join(base, ".env.local")
  if (!existsSync(file)) return []
  const hits = []
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line)
    if (!m) continue
    const key = m[1]
    const value = m[2].trim().replace(/^["']|["']$/g, "")
    if (SSM_KEYS.includes(key) && value) hits.push({ key, value, from: ".env.local" })
  }
  return hits
}

/**
 * Returns { literals, resolved, skipped, sources }. Values are never logged —
 * only key names and where they came from.
 */
export function resolveLiterals(base) {
  const found = new Map()
  const sources = []
  try {
    for (const h of fromSsm()) if (!found.has(h.key)) found.set(h.key, h)
    sources.push("ssm")
  } catch (e) {
    sources.push(`ssm unavailable (${String(e.message ?? e).split("\n")[0].slice(0, 80)})`)
  }
  for (const key of SSM_KEYS) {
    if (!found.has(key) && process.env[key]) found.set(key, { key, value: process.env[key], from: "env" })
  }
  if ([...found.values()].some((h) => h.from === "env")) sources.push("process.env")
  for (const h of fromEnvFile(base)) if (!found.has(h.key)) { found.set(h.key, h); }
  if ([...found.values()].some((h) => h.from === ".env.local")) sources.push(".env.local")

  const { literals, skipped } = resolveLiteralsFrom(
    Object.fromEntries([...found.values()].map((h) => [h.key, h.value])),
  )
  const unresolved = SSM_KEYS.filter((k) => !found.has(k))
  return { literals, skipped, unresolved, sources }
}

/**
 * The filtering half, split out so the self-test can drive it directly: which
 * candidate values are worth scanning for, and why the rest were dropped.
 */
export function resolveLiteralsFrom(candidates) {
  const literals = []
  const skipped = []
  for (const [key, value] of Object.entries(candidates)) {
    if (!value) continue
    if (PLACEHOLDER.test(value)) {
      skipped.push(`${key} — placeholder value, not a real secret`)
      continue
    }
    if (value.length < MIN_LITERAL_LENGTH) {
      skipped.push(`${key} — value is ${value.length} chars, under the ${MIN_LITERAL_LENGTH}-char floor that keeps short numeric ids from matching every minified chunk`)
      continue
    }
    literals.push({ key, value })
  }
  return { literals, skipped }
}

/* ─── self-test ───────────────────────────────────────────────────────────── */

/**
 * Everything above is importable; everything below RUNS. The vitest suite in
 * ./check-bundle-leak.test.mjs imports scanText() and resolveLiteralsFrom(), and
 * without this guard that import would execute the whole check as a side effect
 * of collecting the tests.
 */
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href

if (isMain && process.argv.includes("--self-test")) {
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import("node:fs")
  const { tmpdir } = await import("node:os")

  /**
   * Fixture credentials are ASSEMBLED AT RUNTIME rather than written as literals.
   *
   * This is not evasion — it is the three-layer story working. gitleaks (0004)
   * and GitHub push protection (D-165, this repo is public) both scan committed
   * SOURCE, and a realistic credential sitting in a source file is a TRUE
   * positive for them; they are right to fire on it, and they did, on the first
   * attempt to commit this file. This check scans BUILT OUTPUT, where the
   * assembled string is byte-identical and the fixture loses nothing at all.
   *
   * Three scanners, three surfaces, no layer weakened to accommodate another.
   * Suppressing gitleaks with an inline allowlist would have been the lazier fix
   * and would still have left GitHub push protection to argue with.
   */
  const fixture = (...parts) => parts.join("")

  const SECRET = fixture("cafebabe1234567890", "abcdef1234567890abcdef") // shaped like a Strava client secret
  const literals = [{ key: "STRAVA_CLIENT_SECRET", value: SECRET }]

  // The real committed example, so the "must not fire" case is not a strawman —
  // it is the actual public identifier set that ships in every client bundle.
  const outputs = existsSync(join(ROOT, "amplify_outputs.example.json"))
    ? readFileSync(join(ROOT, "amplify_outputs.example.json"), "utf8")
    : '{"auth":{"user_pool_id":"us-east-1_EXAMPLE00","user_pool_client_id":"1exampleclientid0000000000"}}'

  const FIXTURE = {
    // [ body, must fire? ]
    ".next/static/chunks/leak.js": [`const k="${SECRET}";export{k}`, true],
    ".next/static/chunks/clean.js": ["export const n=1//nothing here", false],
    ".next/static/chunks/outputs.js": [outputs, false],
    ".next/static/chunks/akia.js": [`const a="${fixture("AKIA", "3NPRZQ7XWFTKLMVD")}"`, true],
    // AWS's own published placeholder, and botocore's documentation shape for a
    // key block. Both appear in the vendored AWS CLI layer; neither is a secret.
    ".next/static/chunks/akia-example.js": [`const a="${fixture("AKIA", "IOSFODNN7EXAMPLE")}"`, false],
    ".next/static/chunks/pem-doc.js": [`{"PrivateKey":"${fixture("-----BEGIN RSA ", "PRIVATE KEY-----")}<a very long private key string>","Status":"Active"}`, false],
    ".next/static/chunks/ghp.js": [`const t="${fixture("ghp", "_0123456789abcdefghijABCDEFGHIJ")}"`, true],
    ".next/static/chunks/slack.js": [`const s="${fixture("xoxb", "-1234567890-abcdefghij")}"`, true],
    ".next/static/chunks/pem.js": [fixture("-----BEGIN RSA ", "PRIVATE KEY-----\n") + "MIIEowIBAAKCAQEAx7Kq0vNbWfLmT8yJhQ3dRp9UaZcE2VkGnHsD1oXtBrMwYiPfLu6".repeat(3) + fixture("\n-----END RSA ", "PRIVATE KEY-----"), true],
    ".next/static/css/app.css": ["body{color:var(--text-primary)}", false],
    ".next/server/app/page.js": [`const k="${SECRET}"`, true],
    ".amplify/artifacts/cdk.out/asset.deadbeef/index.js": [`process.env.X="${SECRET}"`, true],
    ".amplify/artifacts/cdk.out/asset.deadbeef/clean.mjs": ["export const ok=1", false],
    // Outside both zones. A secret in the SOURCE tree is gitleaks' job (0004),
    // not this check's — asserting that keeps the two surfaces honestly separate.
    "app/page.tsx": [`const k="${SECRET}"`, false],
  }

  const base = mkdtempSync(join(tmpdir(), "bundle-leak-"))
  let failed = 0
  try {
    for (const [rel, [body]] of Object.entries(FIXTURE)) {
      const full = join(base, rel)
      mkdirSync(full.slice(0, full.lastIndexOf("/")), { recursive: true })
      writeFileSync(full, body + "\n")
    }
    const caught = new Set(scanBuild(base, literals).map((f) => f.label))
    for (const [rel, [, shouldFire]] of Object.entries(FIXTURE)) {
      const ok = caught.has(rel) === shouldFire
      if (!ok) failed++
      console.log(`  ${ok ? "ok" : "FAIL"}  ${shouldFire ? "must fire " : "must pass"}  ${rel}`)
    }

    // The zone rule itself: a literal in .next/static is CLIENT, in cdk.out is SERVER.
    const zones = Object.fromEntries(scanBuild(base, literals).map((f) => [f.label, f.zone]))
    for (const [rel, want] of [[".next/static/chunks/leak.js", "CLIENT"],
                               [".amplify/artifacts/cdk.out/asset.deadbeef/index.js", "SERVER"]]) {
      const ok = zones[rel] === want
      if (!ok) failed++
      console.log(`  ${ok ? "ok" : "FAIL"}  zone ${want.padEnd(6)}  ${rel}`)
    }

    // No finding may carry the secret value. This check is itself a leak surface.
    const printed = JSON.stringify(scanBuild(base, literals))
    const clean = !printed.includes(SECRET)
    if (!clean) failed++
    console.log(`  ${clean ? "ok" : "FAIL"}  findings never contain the secret value itself`)

    // The literal floor: a short id must be skipped, and skipped BY NAME.
    const shortSkip = resolveLiteralsFrom({ STRAVA_CLIENT_ID: "180450" })
    const okShort = shortSkip.literals.length === 0 && shortSkip.skipped.some((s) => s.startsWith("STRAVA_CLIENT_ID"))
    if (!okShort) failed++
    console.log(`  ${okShort ? "ok" : "FAIL"}  a 6-char id is skipped, and the skip is reported by name`)
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
  if (failed) {
    console.error(`\n${failed} self-test case(s) failed — the leak check is broken. Do not trust a green run.`)
    process.exit(1)
  }
  console.log(`\nself-test: every case passed — the check fires on a planted secret in both zones,\nand does NOT fire on amplify_outputs.json's public identifiers.`)
  process.exit(0)
}

/* ─── the check ───────────────────────────────────────────────────────────── */

if (isMain) {

const requireLiterals = process.argv.includes("--require-literals")

const built = [...CLIENT_DIRS, ...SERVER_DIRS].filter((d) => existsSync(join(ROOT, d)))
if (!built.length) {
  console.error("BUNDLE LEAK CHECK: nothing to scan — no .next/ and no .amplify/artifacts/.")
  console.error("This check runs AFTER the build. A pass here would be vacuous, so it fails instead.")
  process.exit(1)
}

const { literals, skipped, unresolved, sources } = resolveLiterals(ROOT)

console.log(`Bundle leak check — zones: ${built.join(", ")}`)
console.log(`  literal sources tried: ${sources.join("; ")}`)
console.log(`  scanning for literals: ${literals.length ? literals.map((l) => l.key).join(", ") : "(none)"}`)
for (const s of skipped) console.log(`  skipped: ${s}`)
if (unresolved.length) console.log(`  not set in this environment: ${unresolved.join(", ")}`)
console.log(`  generic patterns: ${PATTERNS.map((p) => p.name).join(", ")}`)

if (!literals.length && requireLiterals) {
  console.error("\nBUNDLE LEAK CHECK FAILED: --require-literals was passed and NOT ONE secret value")
  console.error("could be resolved. On the deploy path this means the SSM read is broken, and a")
  console.error("pattern-only pass would be a green tick over an unscanned bundle. Failing closed.")
  process.exit(1)
}
if (!literals.length) {
  console.log("\n  NOTE: no literal resolved — this run checks the generic patterns only.")
  console.log("  Expected in the GitHub gate, which holds no AWS credentials by design. The")
  console.log("  literal scan is the Amplify build's job (D-163: that is the lock, this is the alarm).")
}

const findings = scanBuild(ROOT, literals)
if (findings.length) {
  console.error("\n" + "=".repeat(72))
  console.error("SECRET IN BUILT OUTPUT — build failed")
  console.error("=".repeat(72) + "\n")
  for (const f of findings) {
    console.error(`  ${f.zone}  ${f.label}  @${f.at}`)
    console.error(`    key:     ${f.key}   (${f.kind})`)
    console.error(`    context: ${f.excerpt}\n`)
  }
  const client = findings.filter((f) => f.zone === "CLIENT").length
  if (client) {
    console.error(`${client} finding(s) are in .next/static — that output is served to every visitor.`)
    console.error("Treat the key as compromised: rotate it, then find how it reached the client.\n")
  }
  console.error("No value above was printed; <KEY> marks where it sat. 01-architecture.md §7.")
  process.exit(1)
}

console.log(`\nNo secret in built output. ${literals.length} literal(s) and ${PATTERNS.length} patterns checked across ${built.length} zone(s).`)

} // end isMain
