#!/usr/bin/env node
// Asserts the DEPLOYED Cognito posture (08-security-privacy.md §5.1, ticket 0014).
//
// Why this exists at all: self-signup and unauthenticated identities are two
// booleans that a console click or a careless defineAuth edit can flip back, and
// a source-code read would never notice. This reads the LIVE pool.
//
// It is not hypothetical. Before ticket 0014 the deployed pool had
// AllowAdminCreateUserOnly=false and AllowUnauthenticatedIdentities=true — both
// holes open on a publicly-served site, from 0012's skeleton deploy onward.
//
// Runs in amplify.yml right after the backend deploys, where AWS credentials
// exist. Per D-163 that makes it a LOCK: a bad posture fails the deploy.
//
//   node scripts/check-auth-posture.mjs              check the pool amplify_outputs.json names
//   node scripts/check-auth-posture.mjs --self-test  prove the assertions FIRE
//   node scripts/check-auth-posture.mjs \
//        --user-pool-id <id> --identity-pool-id <id>  check a NAMED pool
//
// WHICH POOL AM I CHECKING? amplify_outputs.json is environment-specific and
// gitignored: in the Amplify build it is production, but LOCALLY it is usually the
// sandbox's. During 0014 that difference caused a posture read of the sandbox pool
// to be reported as production. The banner below always prints the pool id — read
// it — and the explicit flags exist so a check can name its target unambiguously.
//
// FAILS CLOSED. Missing CLI, missing credentials, missing amplify_outputs.json,
// an unparseable response — every one of those is an exit 1, never a skip. A
// check that quietly passes when it could not run is worse than no check, because
// it produces a green tick that means nothing.

import { execFileSync } from "node:child_process"
import { readFileSync, existsSync } from "node:fs"

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "")
const OUTPUTS = `${ROOT}/amplify_outputs.json`

/**
 * The assertions, as pure functions of the three API responses, so --self-test
 * can drive the real logic with fixtures and no AWS. Each returns a failure
 * string, or null when the posture is correct.
 */
export const ASSERTIONS = [
  {
    name: "self-signup is OFF (AllowAdminCreateUserOnly)",
    why: "§5.1 — a default-on pool IS a public registration endpoint",
    check: ({ pool }) =>
      pool?.AdminCreateUserConfig?.AllowAdminCreateUserOnly === true
        ? null
        : `AllowAdminCreateUserOnly is ${JSON.stringify(
            pool?.AdminCreateUserConfig?.AllowAdminCreateUserOnly,
          )}, expected true — ANYONE ON THE INTERNET CAN MINT AN ACCOUNT`,
  },
  {
    name: "unauthenticated identities are OFF",
    why: "§5.1/§6.2 — no anonymous principal may touch storage",
    check: ({ identityPool }) =>
      identityPool?.AllowUnauthenticatedIdentities === false
        ? null
        : `AllowUnauthenticatedIdentities is ${JSON.stringify(
            identityPool?.AllowUnauthenticatedIdentities,
          )}, expected false — the identity pool is vending guest credentials`,
  },
  {
    name: "no federated identity providers",
    why: "§5.1 — no social IdP, no SAML/OIDC (see ticket 0129 before adding one)",
    check: ({ providers }) =>
      (providers ?? []).length === 0
        ? null
        : `identity providers configured: ${providers.map((p) => p.ProviderName).join(", ")}`,
  },
  {
    name: "no SMS MFA",
    why: "§5.1 — SMS costs real SNS money and is the weakest second factor",
    check: ({ pool }) => {
      const sms = pool?.MfaConfiguration !== "OFF" && pool?.SmsConfiguration
      return sms ? `SMS MFA is configured (MfaConfiguration=${pool.MfaConfiguration})` : null
    },
  },
  {
    name: "Essentials tier",
    why: "D-083 — 10,000 MAU free and non-expiring; a silent tier change is a silent bill",
    check: ({ pool }) =>
      pool?.UserPoolTier === "ESSENTIALS"
        ? null
        : `UserPoolTier is ${JSON.stringify(pool?.UserPoolTier)}, expected ESSENTIALS`,
  },
]

function evaluate(state) {
  return ASSERTIONS.map((a) => ({ ...a, failure: a.check(state) })).filter((a) => a.failure)
}

function aws(args) {
  try {
    return JSON.parse(execFileSync("aws", [...args, "--output", "json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }))
  } catch (err) {
    // Fail closed, loudly, and say which call died — an unreadable posture is
    // not a passing posture.
    console.error(`FAILED to run: aws ${args.join(" ")}`)
    console.error(String(err.stderr || err.message).trim().split("\n").slice(0, 6).join("\n"))
    console.error(
      "\nThis check FAILS CLOSED. Missing AWS CLI, missing credentials or a denied\n" +
      "API call all fail the build rather than silently passing.",
    )
    process.exit(1)
  }
}

function flag(name) {
  const i = process.argv.indexOf(`--${name}`)
  return i !== -1 ? process.argv[i + 1] : null
}

function fetchState() {
  // Explicit flags win over amplify_outputs.json, and must be given as a pair so
  // a half-override cannot silently mix two environments.
  const overrideUser = flag("user-pool-id")
  const overrideIdentity = flag("identity-pool-id")
  if (overrideUser || overrideIdentity) {
    if (!overrideUser || !overrideIdentity) {
      console.error("--user-pool-id and --identity-pool-id must be given together.")
      process.exit(1)
    }
    return read(overrideUser, overrideIdentity, "explicit --user-pool-id flag")
  }
  if (!existsSync(OUTPUTS)) {
    console.error(`amplify_outputs.json not found at ${OUTPUTS}.`)
    console.error("It is generated by the backend deploy; run this AFTER `ampx pipeline-deploy`.")
    process.exit(1)
  }
  const { auth } = JSON.parse(readFileSync(OUTPUTS, "utf8"))
  const userPoolId = auth?.user_pool_id
  const identityPoolId = auth?.identity_pool_id
  if (!userPoolId || !identityPoolId) {
    console.error("amplify_outputs.json has no user_pool_id / identity_pool_id.")
    process.exit(1)
  }
  return read(userPoolId, identityPoolId, "amplify_outputs.json")
}

function read(userPoolId, identityPoolId, source) {
  const region = userPoolId.split("_")[0]
  const R = ["--region", region]

  return {
    userPoolId,
    identityPoolId,
    source,
    pool: aws(["cognito-idp", "describe-user-pool", "--user-pool-id", userPoolId, ...R]).UserPool,
    identityPool: aws([
      "cognito-identity", "describe-identity-pool",
      "--identity-pool-id", identityPoolId, ...R,
    ]),
    providers: aws([
      "cognito-idp", "list-identity-providers",
      "--user-pool-id", userPoolId, ...R,
    ]).Providers,
  }
}

if (process.argv.includes("--self-test")) {
  // The deployed pool being correct proves only that today is fine; it cannot
  // show the assertions would CATCH anything. These fixtures do (0125's lesson).
  const GOOD = {
    pool: {
      AdminCreateUserConfig: { AllowAdminCreateUserOnly: true },
      MfaConfiguration: "OFF",
      UserPoolTier: "ESSENTIALS",
    },
    identityPool: { AllowUnauthenticatedIdentities: false },
    providers: [],
  }
  const CASES = [
    ["correct posture", GOOD, 0],
    ["self-signup ON", { ...GOOD, pool: { ...GOOD.pool, AdminCreateUserConfig: { AllowAdminCreateUserOnly: false } } }, 1],
    ["AdminCreateUserConfig absent", { ...GOOD, pool: { ...GOOD.pool, AdminCreateUserConfig: undefined } }, 1],
    ["guest identities ON", { ...GOOD, identityPool: { AllowUnauthenticatedIdentities: true } }, 1],
    ["a Google IdP appears", { ...GOOD, providers: [{ ProviderName: "Google" }] }, 1],
    ["SMS MFA switched on", { ...GOOD, pool: { ...GOOD.pool, MfaConfiguration: "ON", SmsConfiguration: { SnsCallerArn: "arn:…" } } }, 1],
    ["tier silently downgraded", { ...GOOD, pool: { ...GOOD.pool, UserPoolTier: "LITE" } }, 1],
    ["both holes open at once", { pool: { ...GOOD.pool, AdminCreateUserConfig: { AllowAdminCreateUserOnly: false } }, identityPool: { AllowUnauthenticatedIdentities: true }, providers: [] }, 2],
    ["an empty response fails closed", {}, 3],
  ]
  let failed = 0
  for (const [label, state, expected] of CASES) {
    const got = evaluate(state).length
    const ok = got === expected
    if (!ok) failed++
    console.log(`  ${ok ? "ok" : "FAIL"}  ${String(got).padStart(2)} failure(s), expected ${expected}  — ${label}`)
  }
  if (failed) {
    console.error(`\n${failed} self-test case(s) failed — the posture check is broken.`)
    process.exit(1)
  }
  console.log(`\nself-test: ${CASES.length} cases passed — the assertions fire on a real misconfiguration.`)
  process.exit(0)
}

const state = fetchState()
const failures = evaluate(state)

console.log(`Cognito posture — user pool ${state.userPoolId}`)
console.log(`                identity pool ${state.identityPoolId}`)
console.log(`                (target from ${state.source})`)
for (const a of ASSERTIONS) {
  const bad = failures.find((f) => f.name === a.name)
  console.log(`  ${bad ? "FAIL" : "ok  "}  ${a.name}`)
  if (bad) console.log(`        ${bad.failure}\n        ${a.why}`)
}

if (failures.length) {
  console.error(
    `\n${failures.length} posture assertion(s) FAILED. This is the highest-consequence\n` +
    "misconfiguration class in the system (08-security-privacy.md §5.1) — the deploy\n" +
    "is failed deliberately. Fix amplify/backend.ts; do not weaken this check.",
  )
  process.exit(1)
}
console.log("\nAll posture assertions passed.")
