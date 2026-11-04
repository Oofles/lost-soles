#!/usr/bin/env node
// Asserts the DEPLOYED auth posture (08-security-privacy.md §5.1). Ticket 0014; REWRITTEN, never
// deleted (D-175), by ticket 0334 for the Auth.js cutover (D-472, D-473, D-478).
//
// Why this exists at all: the posture is a handful of facts that a console click or a careless
// backend edit can flip back, and a source-code read would never notice. Before 0014 the Cognito
// pool had self-signup on and guest identities on, both live on a publicly-served site. The
// Cognito pool is gone now, and so are those two switches, but the class of hole is the same:
// something that lets a person in who is not the owner, created outside the code that should own it.
//
// WHAT IS ASSERTED NOW (docs/capabilities/19-authjs-migration.md, "What happens to the named
// artifacts"):
//
//   1. No Cognito USER POOL tagged with this app's `amplify:app-id` exists. A reverted `defineAuth`
//      would mint a new pool, with a new `sub` and a public sign-in endpoint (D-473: there is no
//      rollback to Cognito).
//   2. No Cognito IDENTITY POOL tagged with it exists. An identity pool is what vends AWS
//      credentials to a browser.
//   3. The data API (AppSync) answers exactly one auth mode, `AWS_IAM` (D-472). No user pool, no
//      API key, no OIDC, no Lambda authorizer, as default or additional.
//   4. `AUTH_ALLOWED_EMAILS` in SSM is non-empty. `isAllowedEmail` fails closed on an empty list,
//      so empty means nobody can sign in, which is a broken deploy, not a safe one.
//   5. Google is the only Auth.js provider in the build: every `next-auth/providers/*` import in
//      the app is Google's, and `lib/auth/config.ts` configures exactly one provider, `Google(`.
//      A Credentials provider is a password form; any other IdP is a second front door.
//
// Runs in amplify.yml's backend phase right after the deploy, where AWS credentials exist. Per
// D-163 that makes it a LOCK: a bad posture fails the deploy.
//
//   node scripts/check-auth-posture.mjs              check the deployed account (app d14fhvl4rp79nn)
//   node scripts/check-auth-posture.mjs --self-test  prove every assertion FIRES; no AWS
//
// WHICH ENVIRONMENT AM I CHECKING? The API is chosen by its tags (`amplify:app-id` and
// `amplify:branch-name`, the build's `$AWS_BRANCH`, default `main`), never by amplify_outputs.json,
// which on a laptop names a sandbox (the 0014/0181 mistake). The banner prints the API id.
//
// FAILS CLOSED. Missing CLI, missing credentials, a denied call, a pool whose tags cannot be read,
// no API or two APIs for this branch, an unreadable source file: every one is exit 1, never a skip.
// The build role's grants are listed in docs/capabilities/19-authjs-migration.md (0334).

import { execFileSync } from "node:child_process"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "")
export const APP_ID = "d14fhvl4rp79nn"
export const ALLOWLIST_PARAMETER = `/amplify/shared/${APP_ID}/AUTH_ALLOWED_EMAILS`
const REGION = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1"

/** Where Auth.js could be configured or a provider imported. Tests are excluded; they build nothing. */
const SOURCE_DIRS = ["app", "lib", "components", "src"]
const SOURCE_FILES = ["middleware.ts", "auth.ts", "next.config.ts"]

const tagged = (tags, appId) => tags?.["amplify:app-id"] === appId

/**
 * The assertions, as pure functions of the gathered state, so --self-test drives the real logic
 * with fixtures and no AWS. Each returns a failure string, or null when the posture is correct.
 */
export const ASSERTIONS = [
  {
    name: "no Cognito user pool tagged with this app",
    why: "D-473 — Cognito was deleted at cutover; a pool here is a second, public sign-in endpoint",
    check: ({ appId, userPools }) => {
      if (!Array.isArray(userPools)) return "the user-pool listing is missing"
      const ours = userPools.filter((p) => tagged(p.tags, appId))
      return ours.length === 0 ? null : `${ours.length} user pool(s) tagged amplify:app-id=${appId}: ${ours.map((p) => p.id).join(", ")}`
    },
  },
  {
    name: "no Cognito identity pool tagged with this app",
    why: "D-473 / §6.2 — an identity pool vends AWS credentials to whoever it admits",
    check: ({ appId, identityPools }) => {
      if (!Array.isArray(identityPools)) return "the identity-pool listing is missing"
      const ours = identityPools.filter((p) => tagged(p.tags, appId))
      return ours.length === 0 ? null : `${ours.length} identity pool(s) tagged amplify:app-id=${appId}: ${ours.map((p) => p.id).join(", ")}`
    },
  },
  {
    name: "the data API's auth modes are exactly AWS_IAM",
    why: "D-472 — AppSync is no client-facing API; no principal holds appsync:GraphQL on it",
    check: ({ api }) => {
      if (!api) return "the data API was not found"
      const extra = (api.additionalAuthenticationProviders ?? []).map((p) => p?.authenticationType)
      const modes = [api.authenticationType, ...extra]
      return modes.length === 1 && modes[0] === "AWS_IAM"
        ? null
        : `auth modes are ${JSON.stringify(modes)}, expected exactly ["AWS_IAM"]`
    },
  },
  {
    name: "AUTH_ALLOWED_EMAILS is non-empty",
    why: "08 §3 / D-471 — the sign-in gate fails closed on an empty list, so empty is a dead deploy",
    check: ({ allowlistCount }) =>
      Number.isInteger(allowlistCount) && allowlistCount > 0
        ? null
        : `AUTH_ALLOWED_EMAILS holds ${JSON.stringify(allowlistCount)} address(es), expected at least 1`,
  },
  {
    name: "Google is the only Auth.js provider",
    why: "§5.1 / D-478 — core does a Google sign-in; any other provider is a second front door",
    check: ({ providers }) => {
      if (!providers) return "the provider scan did not run"
      const problems = []
      const imported = [...new Set(providers.imports.map((i) => i.provider))]
      const foreign = providers.imports.filter((i) => i.provider !== "google")
      if (foreign.length) problems.push(`imports ${foreign.map((i) => `next-auth/providers/${i.provider} (${i.file})`).join(", ")}`)
      if (!imported.includes("google")) problems.push("nothing imports next-auth/providers/google")
      if (JSON.stringify(providers.configured) !== JSON.stringify(["Google"])) {
        problems.push(`lib/auth/config.ts configures ${JSON.stringify(providers.configured)}, expected ["Google"]`)
      }
      if (providers.overrides.length) problems.push(`\`providers\` is also set in ${providers.overrides.join(", ")}`)
      return problems.length ? problems.join("; ") : null
    },
  },
]

export function evaluate(state) {
  return ASSERTIONS.map((a) => ({ ...a, failure: a.check(state) })).filter((a) => a.failure)
}

/** Every non-test .ts/.tsx/.js/.mjs file under the source dirs, relative to `root`. */
function sourceFiles(root) {
  const out = []
  const walk = (rel) => {
    for (const name of readdirSync(join(root, rel))) {
      const r = join(rel, name)
      if (statSync(join(root, r)).isDirectory()) {
        if (name !== "node_modules" && !name.startsWith(".")) walk(r)
      } else if (/\.(m?[jt]sx?)$/.test(name) && !/\.test\./.test(name)) out.push(r)
    }
  }
  for (const d of SOURCE_DIRS) {
    try {
      if (statSync(join(root, d)).isDirectory()) walk(d)
    } catch {
      // An absent directory has no provider in it.
    }
  }
  for (const f of SOURCE_FILES) {
    try {
      if (statSync(join(root, f)).isFile()) out.push(f)
    } catch {
      // Same.
    }
  }
  return out
}

/** The `providers: [ ... ]` array's top-level calls, in order: `[Google(...)]` -> ["Google"]. */
export function configuredProviders(configSource) {
  const at = configSource.indexOf("providers: [")
  if (at === -1) return []
  let depth = 0
  let body = ""
  for (let i = at + "providers: ".length; i < configSource.length; i++) {
    const ch = configSource[i]
    if (ch === "[" || ch === "(" || ch === "{") depth++
    if (ch === "]" || ch === ")" || ch === "}") depth--
    body += ch
    if (depth === 0) break
  }
  // Calls at depth 1 inside the array: walk again, recording an identifier followed by "(".
  const names = []
  let d = 0
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]
    if (d === 1) {
      const m = /^([A-Za-z_$][\w$]*)\s*\(/.exec(body.slice(i))
      if (m && !/[\w$.]/.test(body[i - 1] ?? "")) names.push(m[1])
    }
    if (ch === "[" || ch === "(" || ch === "{") d++
    if (ch === "]" || ch === ")" || ch === "}") d--
  }
  return names
}

/**
 * Pure over `files` (path -> source): every `next-auth/providers/<x>` import, the providers
 * `lib/auth/config.ts` configures, and any OTHER file that sets `providers` on an Auth.js config.
 */
export function scanProviders(files) {
  const imports = []
  const overrides = []
  for (const [file, src] of Object.entries(files)) {
    for (const m of src.matchAll(/["']next-auth\/providers\/([\w-]+)["']/g)) imports.push({ file, provider: m[1] })
    if (file !== "lib/auth/config.ts" && /\bproviders\s*:\s*\[/.test(src)) overrides.push(file)
  }
  const config = files["lib/auth/config.ts"]
  return { imports, configured: config === undefined ? null : configuredProviders(config), overrides }
}

function aws(args) {
  try {
    return JSON.parse(execFileSync("aws", [...args, "--region", REGION, "--output", "json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 1 << 26,
    }))
  } catch (err) {
    // Fail closed, loudly, and say which call died. Never the output: an SSM read would hold a value.
    const code = /\(([A-Za-z]+(?:Exception|NotFound|Denied)[A-Za-z]*)\)/.exec(String(err.stderr ?? ""))?.[1]
    console.error(`FAILED to run: aws ${args.slice(0, 2).join(" ")} (${code ?? "aws cli failed"})`)
    console.error(
      "\nThis check FAILS CLOSED. Missing AWS CLI, missing credentials or a denied\n" +
        "API call all fail the build rather than silently passing.",
    )
    process.exit(1)
  }
}

function fetchState() {
  const appId = process.env.AWS_APP_ID || APP_ID
  if (appId !== APP_ID) {
    console.error(`AWS_APP_ID is ${appId}, but this check and its SSM path are for ${APP_ID}. Failing rather than guessing.`)
    process.exit(1)
  }
  const branch = process.env.AWS_BRANCH || "main"
  const account = aws(["sts", "get-caller-identity"]).Account

  // The CLI follows NextToken itself; --max-results is the page size.
  const userPools = (aws(["cognito-idp", "list-user-pools", "--max-results", "60"]).UserPools ?? []).map((p) => ({
    id: p.Id,
    tags: aws(["cognito-idp", "list-tags-for-resource", "--resource-arn", `arn:aws:cognito-idp:${REGION}:${account}:userpool/${p.Id}`]).Tags ?? {},
  }))
  const identityPools = (aws(["cognito-identity", "list-identity-pools", "--max-results", "60"]).IdentityPools ?? []).map((p) => ({
    id: p.IdentityPoolId,
    tags: aws(["cognito-identity", "list-tags-for-resource", "--resource-arn", `arn:aws:cognito-identity:${REGION}:${account}:identitypool/${p.IdentityPoolId}`]).Tags ?? {},
  }))

  const apis = (aws(["appsync", "list-graphql-apis"]).graphqlApis ?? []).filter(
    (a) => tagged(a.tags, appId) && a.tags?.["amplify:branch-name"] === branch && a.tags?.["amplify:deployment-type"] === "branch",
  )
  if (apis.length !== 1) {
    console.error(`Expected exactly 1 AppSync API tagged amplify:app-id=${appId}, branch ${branch}; found ${apis.length}.`)
    console.error("This check fails closed rather than picking one.")
    process.exit(1)
  }

  // The value is parsed and COUNTED, never printed (D-426).
  const value = aws(["ssm", "get-parameter", "--name", ALLOWLIST_PARAMETER, "--with-decryption"]).Parameter?.Value ?? ""
  const allowlistCount = value.split(",").map((e) => e.trim()).filter(Boolean).length

  const files = Object.fromEntries(sourceFiles(ROOT).map((f) => [f, readFileSync(join(ROOT, f), "utf8")]))
  return { appId, branch, userPools, identityPools, api: apis[0], allowlistCount, providers: scanProviders(files) }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href

if (isMain && process.argv.includes("--self-test")) {
  // The deployed posture being correct proves only that today is fine; it cannot show the
  // assertions would CATCH anything. These fixtures do (0125's lesson).
  const OTHER = "d3i12qqm1c4kn1"
  const GOOD = {
    appId: APP_ID,
    userPools: [{ id: "us-east-1_other", tags: { "amplify:app-id": OTHER } }, { id: "us-east-1_untagged", tags: {} }],
    identityPools: [{ id: "us-east-1:other", tags: { "amplify:app-id": OTHER } }],
    api: { apiId: "x", authenticationType: "AWS_IAM", additionalAuthenticationProviders: [] },
    allowlistCount: 2,
    providers: {
      imports: [{ file: "lib/auth/config.ts", provider: "google" }],
      configured: ["Google"],
      overrides: [],
    },
  }
  const CASES = [
    ["correct posture (other apps' pools present, untagged pool present)", GOOD, 0],
    ["our user pool is back", { ...GOOD, userPools: [...GOOD.userPools, { id: "us-east-1_ours", tags: { "amplify:app-id": APP_ID } }] }, 1],
    ["our identity pool is back", { ...GOOD, identityPools: [{ id: "us-east-1:ours", tags: { "amplify:app-id": APP_ID } }] }, 1],
    ["the API is back on user pools by default", { ...GOOD, api: { authenticationType: "AMAZON_COGNITO_USER_POOLS", additionalAuthenticationProviders: [{ authenticationType: "AWS_IAM" }] } }, 1],
    ["an API key added beside IAM", { ...GOOD, api: { ...GOOD.api, additionalAuthenticationProviders: [{ authenticationType: "API_KEY" }] } }, 1],
    ["the API not found", { ...GOOD, api: undefined }, 1],
    ["an empty allowlist", { ...GOOD, allowlistCount: 0 }, 1],
    ["a Credentials provider imported", { ...GOOD, providers: { ...GOOD.providers, imports: [...GOOD.providers.imports, { file: "lib/auth/index.ts", provider: "credentials" }] } }, 1],
    ["a second provider configured", { ...GOOD, providers: { ...GOOD.providers, configured: ["Google", "GitHub"] } }, 1],
    ["providers overridden elsewhere", { ...GOOD, providers: { ...GOOD.providers, overrides: ["lib/auth/index.ts"] } }, 1],
    ["no Google import at all", { ...GOOD, providers: { ...GOOD.providers, imports: [] } }, 1],
    ["two holes at once: our pool and a user-pool API", { ...GOOD, userPools: [{ id: "p", tags: { "amplify:app-id": APP_ID } }], api: { authenticationType: "AMAZON_COGNITO_USER_POOLS" } }, 2],
    ["an empty state fails closed on every assertion", {}, 5],
  ]
  let failed = 0
  for (const [label, state, expected] of CASES) {
    const got = evaluate(state).length
    const ok = got === expected
    if (!ok) failed++
    console.log(`  ${ok ? "ok" : "FAIL"}  ${String(got).padStart(2)} failure(s), expected ${expected}  — ${label}`)
  }
  // The provider scan itself, over fixtures and then over this repository.
  const scan = scanProviders({
    // Assembled so this file's own text holds no `from "next-auth…"` import that
    // lib/auth/session-readers.test.ts would read as this script importing next-auth.
    "lib/auth/config.ts": ["import Google from ", '"next-auth/providers/google"', "\nexport const c = { providers: [\n  Google({ a: f(1), authorization: { params: {} } }),\n] }"].join(""),
    "lib/x.ts": "const y = 1",
  })
  const scanChecks = [
    ["the scan reads one Google provider from a fixture", JSON.stringify(scan.configured) === '["Google"]' && scan.imports.length === 1 && scan.overrides.length === 0],
    ["the scan sees a second configured provider", JSON.stringify(configuredProviders("providers: [Google({}), Credentials({ authorize() {} })]")) === '["Google","Credentials"]'],
  ]
  const real = scanProviders(Object.fromEntries(sourceFiles(ROOT).map((f) => [f, readFileSync(join(ROOT, f), "utf8")])))
  scanChecks.push(["this repository passes the provider assertion", ASSERTIONS[4].check({ providers: real }) === null])
  for (const [label, pass] of scanChecks) {
    if (!pass) failed++
    console.log(`  ${pass ? "ok" : "FAIL"}  ${label}`)
  }
  if (failed) {
    console.error(`\n${failed} self-test case(s) failed — the posture check is broken.`)
    process.exit(1)
  }
  console.log(`\nself-test: ${CASES.length + scanChecks.length} cases passed — every assertion fires on a real misconfiguration.`)
  process.exit(0)
}

if (isMain) {
  const state = fetchState()
  const failures = evaluate(state)
  console.log(`Auth posture — app ${state.appId}, branch '${state.branch}'`)
  console.log(`               data API ${state.api.apiId} (selected by its amplify:* tags)`)
  console.log(`               ${state.userPools.length} user pool(s) and ${state.identityPools.length} identity pool(s) in the account read`)
  console.log(`               AUTH_ALLOWED_EMAILS: ${state.allowlistCount} address(es)`)
  for (const a of ASSERTIONS) {
    const bad = failures.find((f) => f.name === a.name)
    console.log(`  ${bad ? "FAIL" : "ok  "}  ${a.name}`)
    if (bad) console.log(`        ${bad.failure}\n        ${a.why}`)
  }
  if (failures.length) {
    console.error(
      `\n${failures.length} posture assertion(s) FAILED. This is the highest-consequence\n` +
        "misconfiguration class in the system (08-security-privacy.md §5.1) — the deploy\n" +
        "is failed deliberately. Fix the backend or the Auth.js config; do not weaken this check.",
    )
    process.exit(1)
  }
  console.log("\nAll posture assertions passed.")
}
