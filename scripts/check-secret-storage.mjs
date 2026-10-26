#!/usr/bin/env node
// Every secret is a SecureString in SSM, and none sits in plaintext in a deployed
// Lambda's environment, a stack output or an Amplify app variable
// (08-security-privacy.md §3, ticket 0115).
//
// check-bundle-leak.mjs scans the BUILT bundles and the synthesized cdk.out. This
// reads what is DEPLOYED, which is what an attacker with a read-only foothold meets:
// a console edit to a function's environment, or a value pasted into the Amplify
// app's environment variables, never passes through a build.
//
// Four assertions, against the live account:
//   1. every registry key present in SSM is a SecureString, not a String
//   2. no Lambda in this branch's stacks carries a registry key as an env var
//      NAME, a secret VALUE, or a generic credential shape
//   3. no CloudFormation output of those stacks does either
//   4. no Amplify APP environment variable does either (they are plaintext by design)
//
// Runs in amplify.yml's backend phase, right after the deploy, using only grants the
// build role already holds through AmplifyBackendDeployFullAccess
// (cloudformation:ListStacks/ListStackResources/DescribeStacks on amplify-*,
// lambda:GetFunction on amplify-*, ssm:DescribeParameters, amplify:ListApps) plus the
// ssm:GetParametersByPath read check-bundle-leak.mjs already makes. No new IAM.
//
// THIS SCRIPT NEVER PRINTS A VALUE. Findings name the function, the variable and
// the reason.
//
// FAILS CLOSED (D-176). An AWS error, no stack found, no Lambda found, or (with
// --require-literals) no secret value resolved is an exit 1, never a skip.
//
//   node scripts/check-secret-storage.mjs                      AWS_APP_ID/AWS_BRANCH from env
//   node scripts/check-secret-storage.mjs --require-literals   the Amplify build
//   node scripts/check-secret-storage.mjs --self-test          prove the assertions FIRE

import { execFileSync } from "node:child_process"
import { pathToFileURL } from "node:url"

import { REGISTRY, resolveLiterals, scanText } from "./check-bundle-leak.mjs"

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "")
const SSM_KEYS = REGISTRY.filter((r) => r.store === "ssm").map((r) => r.key)

/**
 * What Amplify's `secret()` writes into a function's environment at deploy time. The
 * real value is fetched from SSM at cold start and lives only in process memory, so a
 * registry NAME carrying exactly this is not plaintext storage. As built nothing uses
 * `secret()` (D-357, D-362; `0290` removed the last user, `secret-smoke-test`). The
 * allowance stays so a future `secret()` is judged correctly rather than flagged.
 */
export const AMPLIFY_RUNTIME_PLACEHOLDER = "<value will be resolved during runtime>"

/* ─── the assertions, pure, so --self-test drives the real logic ──────────── */

/**
 * `params`  [{ Name, Type }]              from ssm describe-parameters
 * `envs`    [{ where, name, value }]     Lambda env vars and Amplify app vars
 * `outputs` [{ where, name, value }]     CloudFormation stack outputs
 * `literals` [{ key, value }]            the real secret values, never printed
 *
 * Returns a list of { where, what } strings, or [] when the posture is correct.
 */
export function evaluate({ params, envs, outputs, literals }) {
  const findings = []
  for (const p of params) {
    const key = p.Name.slice(p.Name.lastIndexOf("/") + 1)
    if (SSM_KEYS.includes(key) && p.Type !== "SecureString") {
      findings.push({ where: p.Name, what: `is a ${p.Type}, not a SecureString — stored unencrypted` })
    }
  }
  for (const { where, name, value } of [...envs, ...outputs]) {
    if (SSM_KEYS.includes(name) && value !== AMPLIFY_RUNTIME_PLACEHOLDER) {
      findings.push({ where: `${where} ${name}`, what: "a registry secret delivered by NAME as plaintext config; §3 reads it from SSM at runtime" })
    }
    for (const f of scanText(String(value ?? ""), `${where} ${name}`, literals)) {
      findings.push({ where: f.label, what: `carries ${f.key} (${f.kind})` })
    }
  }
  return findings
}

/* ─── reading the live account ────────────────────────────────────────────── */

function aws(args) {
  const full = [...args, "--output", "json"]
  if (process.env.AWS_REGION) full.push("--region", process.env.AWS_REGION)
  try {
    return JSON.parse(execFileSync("aws", full, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }))
  } catch (err) {
    console.error(`FAILED to run: aws ${args.slice(0, 2).join(" ")}`)
    console.error(String(err.stderr || err.message).trim().split("\n").slice(-3).join("\n"))
    console.error("\nThis check FAILS CLOSED: an unreadable account is not a clean one (D-176).")
    process.exit(1)
  }
}

function readParams(app, branch) {
  const prefixes = [`/amplify/shared/${app}/`, branch && `/amplify/${app}/${branch}/`].filter(Boolean)
  return aws(["ssm", "describe-parameters", "--parameter-filters",
    `Key=Name,Option=BeginsWith,Values=${prefixes.join(",")}`]).Parameters ?? []
}

/**
 * The branch's root stack and every nested stack under it. Found through
 * ListStacks rather than amplify:GetBranch, which the build role does not hold.
 * Exactly one live root is required: two would mean this check does not know
 * which environment it is reading, and guessing is a green tick that means nothing.
 */
function readStacks(app, branch) {
  const live = (aws(["cloudformation", "list-stacks"]).StackSummaries ?? [])
    .filter((s) => s.StackStatus !== "DELETE_COMPLETE")
  const prefix = `amplify-${app}-${branch}-branch-`
  const roots = live.filter((s) => s.StackName.startsWith(prefix) && !s.ParentId)
  if (roots.length !== 1) {
    console.error(`Expected exactly 1 live root stack named ${prefix}*, found ${roots.length}.`)
    process.exit(1)
  }
  const root = roots[0].StackId
  return [root, ...live.filter((s) => s.RootId === root).map((s) => s.StackId)]
}

function readDeployed(app, branch) {
  const stacks = readStacks(app, branch)
  const envs = []
  const outputs = []
  const functions = []
  for (const stack of stacks) {
    const short = stack.split("/")[1]
    for (const o of aws(["cloudformation", "describe-stacks", "--stack-name", stack]).Stacks?.[0]?.Outputs ?? []) {
      outputs.push({ where: `output ${short}`, name: o.OutputKey, value: o.OutputValue })
    }
    for (const r of aws(["cloudformation", "list-stack-resources", "--stack-name", stack]).StackResourceSummaries ?? []) {
      if (r.ResourceType === "AWS::Lambda::Function" && r.PhysicalResourceId) functions.push(r.PhysicalResourceId)
    }
  }
  for (const fn of functions) {
    const vars = aws(["lambda", "get-function", "--function-name", fn]).Configuration?.Environment?.Variables ?? {}
    for (const [name, value] of Object.entries(vars)) envs.push({ where: `λ ${fn}`, name, value })
  }
  const appRow = (aws(["amplify", "list-apps"]).apps ?? []).find((a) => a.appId === app)
  if (!appRow) {
    console.error(`Amplify app ${app} is not in list-apps.`)
    process.exit(1)
  }
  for (const [name, value] of Object.entries(appRow.environmentVariables ?? {})) {
    envs.push({ where: "amplify app env", name, value })
  }
  return { stacks, functions, envs, outputs }
}

/* ─── self-test ───────────────────────────────────────────────────────────── */

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href

if (isMain && process.argv.includes("--self-test")) {
  // Assembled at runtime, for the reason check-bundle-leak.mjs's fixtures are.
  const fx = (...p) => p.join("")
  const SECRET = fx("0d1e2f3a4b5c6d7e8f90", "a1b2c3d4e5f60718293a")
  const literals = [{ key: "STRAVA_CLIENT_SECRET", value: SECRET }]
  const GOOD = {
    params: [
      { Name: "/amplify/shared/app/STRAVA_CLIENT_SECRET", Type: "SecureString" },
      { Name: "/amplify/resource_reference/app/main/BUCKET_NAME", Type: "String" },
    ],
    envs: [
      { where: "λ worker", name: "STRAVA_CLIENT_SECRET_PARAM", value: "/amplify/shared/app/STRAVA_CLIENT_SECRET" },
      { where: "λ worker", name: "AMPLIFY_SSM_ENV_CONFIG", value: '{"X":{"path":"/amplify/shared/app/X"}}' },
      { where: "amplify app env", name: "LOST_SOLES_HOME_ZOOM", value: "14" },
      // secret()'s deploy-time placeholder: the name is a registry key, the value is not a secret.
      { where: "λ smoke", name: "STRAVA_WEBHOOK_VERIFY_TOKEN", value: AMPLIFY_RUNTIME_PLACEHOLDER },
    ],
    outputs: [{ where: "output root", name: "QueueUrl", value: "https://sqs.us-east-1.amazonaws.com/123/q" }],
    literals,
  }
  const CASES = [
    ["correct posture (a parameter PATH in env is fine, a non-secret String is fine)", GOOD, 0],
    ["a secret stored as a plain String", { ...GOOD, params: [{ Name: "/amplify/shared/app/STRAVA_CLIENT_SECRET", Type: "String" }] }, 1],
    ["the secret VALUE pasted into a Lambda env var", { ...GOOD, envs: [...GOOD.envs, { where: "λ worker", name: "CS", value: SECRET }] }, 1],
    ["a registry key as an env var NAME", { ...GOOD, envs: [...GOOD.envs, { where: "λ worker", name: "GITHUB_TICKETS_PAT", value: "x" }] }, 1],
    ["a GitHub PAT shape in an Amplify app var", { ...GOOD, envs: [...GOOD.envs, { where: "amplify app env", name: "TOKEN", value: fx("ghp", "_0123456789abcdefghijABCDEFGHIJ") }] }, 1],
    ["an AWS key id in a stack output", { ...GOOD, outputs: [{ where: "output root", name: "Key", value: fx("AKIA", "3NPRZQ7XWFTKLMVD") }] }, 1],
  ]
  let failed = 0
  for (const [label, state, expected] of CASES) {
    const found = evaluate(state)
    const ok = found.length === expected && !JSON.stringify(found).includes(SECRET)
    if (!ok) failed++
    console.log(`  ${ok ? "ok" : "FAIL"}  ${found.length} finding(s), expected ${expected}  — ${label}`)
  }
  if (failed) {
    console.error(`\n${failed} self-test case(s) failed — the secret-storage check is broken.`)
    process.exit(1)
  }
  console.log(`\nself-test: ${CASES.length} cases passed, and no finding carries the secret value.`)
  process.exit(0)
}

/* ─── the check ───────────────────────────────────────────────────────────── */

if (isMain) {
  const app = process.env.AWS_APP_ID
  const branch = process.env.AWS_BRANCH
  if (!app || !branch) {
    console.error("AWS_APP_ID and AWS_BRANCH must be set (Amplify sets both; locally, export them).")
    process.exit(1)
  }
  const { literals, unresolved, sources } = resolveLiterals(ROOT)
  if (!literals.length && process.argv.includes("--require-literals")) {
    console.error("SECRET STORAGE CHECK FAILED: --require-literals and no secret value resolved.")
    for (const s of sources) console.error(`  ${s}`)
    process.exit(1)
  }
  const params = readParams(app, branch)
  const present = params.filter((p) => SSM_KEYS.includes(p.Name.slice(p.Name.lastIndexOf("/") + 1)))
  if (!present.length) {
    console.error(`No registry key found in SSM under /amplify/shared/${app}/ or /amplify/${app}/${branch}/.`)
    console.error("A check with nothing to check fails closed (D-176).")
    process.exit(1)
  }
  const deployed = readDeployed(app, branch)
  if (!deployed.functions.length) {
    console.error(`No AWS::Lambda::Function found in ${deployed.stacks.length} stack(s). Fails closed.`)
    process.exit(1)
  }
  const findings = evaluate({ params, envs: deployed.envs, outputs: deployed.outputs, literals })

  console.log(`Secret storage — app ${app}, branch ${branch}`)
  console.log(`  SSM: ${present.map((p) => `${p.Name.split("/").pop()}=${p.Type}`).join(", ")}`)
  if (unresolved.length) console.log(`  not set in this environment: ${unresolved.join(", ")}`)
  console.log(`  literals scanned for: ${literals.map((l) => l.key).join(", ") || "(none — patterns only)"}`)
  console.log(`  read: ${deployed.stacks.length} stack(s), ${deployed.functions.length} Lambda(s), ` +
    `${deployed.envs.length} env var(s), ${deployed.outputs.length} output(s)`)
  if (findings.length) {
    console.error("\nPLAINTEXT SECRET IN DEPLOYED CONFIGURATION — failed")
    for (const f of findings) console.error(`  ${f.where}: ${f.what}`)
    console.error("\nNo value was printed. Treat a hit as a leak: rotate (08 §8), then move it to SSM.")
    process.exit(1)
  }
  console.log("\nEvery secret is a SecureString, and none is in a Lambda env, a stack output or an app variable.")
}
