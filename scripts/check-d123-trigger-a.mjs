#!/usr/bin/env node
// D-123 TRIGGER A: a second account exists in the production pool.
//
// docs/08-security-privacy.md §2.4 TRIGGER A. Ticket 0114.
//
// D-123 waives home-location masking on the premise "map shown only to the owner". The moment a
// second Cognito account exists, that premise is false, not weakened. §2.4 says the trigger fires
// when the account is PROVISIONED, not when friends are planned, and a shared login is the same
// thing with worse accountability. So this reads the LIVE pool: a console click or an
// `admin-create-user` provisions an account without touching the repo, and a source check would
// never see it.
//
// THE RULE. Every user in the pool is either
//   - an owner (`lib/auth/owner-ids.ts` OWNER_USER_IDS, the same list the routes enforce), or
//   - listed in APPROVED_ACCOUNTS below, citing a decision that exists in
//     docs/decisions/DECISIONS.md and names D-123 (a successor that supersedes or re-affirms it,
//     §2.4 A-7).
// Anything else fails. Adding a sub to APPROVED_ACCOUNTS without that decision also fails, so the
// only way past this check is to record the decision. A disabled user still counts: it exists,
// and re-enabling it is one API call.
//
// PRIVACY OF THE CHECK ITSELF. ListUsers is asked for the `sub` attribute only, and only subs are
// printed. A username or email in a build log is a person's identity in a log nobody reviews.
//
// FAILS CLOSED (D-176). Missing CLI, missing credentials, a denied ListUsers, an unreadable owner
// list or DECISIONS.md, a pool that is not tagged as the deployed branch: every one is exit 1.
//
//   node scripts/check-d123-trigger-a.mjs                         the pool amplify_outputs.json names
//   node scripts/check-d123-trigger-a.mjs --user-pool-id <id>     a NAMED pool
//   node scripts/check-d123-trigger-a.mjs --self-test             prove the rule FIRES; no AWS

import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "")
const OUTPUTS = `${ROOT}/amplify_outputs.json`
const OWNER_IDS = `${ROOT}/lib/auth/owner-ids.ts`
const DECISIONS = `${ROOT}/docs/decisions/DECISIONS.md`

/**
 * Accounts other than the owner that a recorded decision admits, as `{ sub, decision }`.
 * EMPTY, and it stays empty until §2.4's Trigger A gate (A-1 to A-7) is complete and a successor
 * to D-123 is recorded. The check refuses an entry whose decision does not exist or does not
 * name D-123.
 */
export const APPROVED_ACCOUNTS = []

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g

/** The owner subs, read from the TS source the routes import. Plain node cannot import TS. */
export function ownerSubs(source) {
  const block = source.match(/OWNER_USER_IDS[^=]*=\s*\[([\s\S]*?)\]/)
  if (!block) return null
  const code = block[1].replace(/\/\/.*$/gm, "")
  return [...code.matchAll(UUID)].map((m) => m[0])
}

/** The body of decision `id` in DECISIONS.md, or null. Entries are `- **D-NNN** ...` blocks. */
export function decisionText(register, id) {
  const lines = register.split("\n")
  const start = lines.findIndex((l) => l.startsWith(`- **${id}**`))
  if (start === -1) return null
  let end = start + 1
  while (end < lines.length && !/^- \*\*[DO]-\d+\*\*/.test(lines[end]) && !/^#{1,3} /.test(lines[end])) end++
  return lines.slice(start, end).join("\n")
}

/** The rule, as a pure function. Returns failure strings; [] means Trigger A has not fired. */
export function evaluate({ subs, owners, approved, register }) {
  const failures = []
  if (!Array.isArray(subs) || subs.length === 0) {
    return ["the pool returned NO users. The owner must exist; an empty listing is not a pass"]
  }
  if (!Array.isArray(owners) || owners.length === 0) {
    return ["no owner sub could be read from lib/auth/owner-ids.ts"]
  }
  // Only an entry whose decision exists AND names D-123 admits anyone.
  const admitted = new Set()
  for (const { sub, decision } of approved) {
    const text = decisionText(register, decision)
    if (text === null) failures.push(`APPROVED_ACCOUNTS admits ${sub} under ${decision}, which is not in DECISIONS.md`)
    else if (!/\bD-123\b/.test(text)) failures.push(`APPROVED_ACCOUNTS admits ${sub} under ${decision}, which does not name D-123`)
    else admitted.add(sub)
  }
  for (const sub of subs) {
    if (sub === undefined) failures.push("a user with no readable sub")
    else if (!owners.includes(sub) && !admitted.has(sub)) failures.push(`account ${sub} is not the owner and no decision admits it`)
  }
  if (!subs.some((s) => owners.includes(s))) failures.push("the owner is not in this pool. Wrong pool, or the pool was recreated")
  return failures
}

function aws(args) {
  try {
    return JSON.parse(execFileSync("aws", [...args, "--output", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }))
  } catch (err) {
    console.error(`FAILED to run: aws ${args.join(" ")}`)
    console.error(String(err.stderr || err.message).trim().split("\n").slice(0, 6).join("\n"))
    console.error("\nThis check FAILS CLOSED. Missing CLI, missing credentials or a denied call fail the build.")
    process.exit(1)
  }
}

function flag(name) {
  const i = process.argv.indexOf(`--${name}`)
  return i !== -1 ? process.argv[i + 1] : null
}

function targetPool() {
  const explicit = flag("user-pool-id")
  if (explicit) return { userPoolId: explicit, source: "explicit --user-pool-id flag" }
  if (!existsSync(OUTPUTS)) {
    console.error(`amplify_outputs.json not found at ${OUTPUTS}. Run this after the backend deploys, or pass --user-pool-id.`)
    process.exit(1)
  }
  const userPoolId = JSON.parse(readFileSync(OUTPUTS, "utf8")).auth?.user_pool_id
  if (!userPoolId) {
    console.error("amplify_outputs.json has no auth.user_pool_id.")
    process.exit(1)
  }
  return { userPoolId, source: "amplify_outputs.json" }
}

function selfTest() {
  const OWNER = "5488e4b8-d081-7014-748e-edd1937f8083"
  const FRIEND = "00000000-0000-4000-8000-000000000001"
  const REGISTER = [
    "- **D-500** **Friends get a masked map.** Supersedes D-123 with the premise ...",
    "  - continued text",
    "- **D-501** **Something unrelated.** No mention of the home decision.",
  ].join("\n")
  const ok = { subs: [OWNER], owners: [OWNER], approved: [], register: REGISTER }
  const CASES = [
    ["only the owner", ok, 0],
    ["a second account, no decision", { ...ok, subs: [OWNER, FRIEND] }, 1],
    ["a second account admitted under a decision naming D-123", { ...ok, subs: [OWNER, FRIEND], approved: [{ sub: FRIEND, decision: "D-500" }] }, 0],
    ["admitted under a decision that does not name D-123", { ...ok, subs: [OWNER, FRIEND], approved: [{ sub: FRIEND, decision: "D-501" }] }, 2],
    ["admitted under a decision that does not exist", { ...ok, subs: [OWNER, FRIEND], approved: [{ sub: FRIEND, decision: "D-999" }] }, 2],
    ["an empty listing fails closed", { ...ok, subs: [] }, 1],
    ["an unreadable owner list fails closed", { ...ok, owners: [] }, 1],
    ["the owner missing (wrong or recreated pool)", { ...ok, subs: [FRIEND] }, 2],
    ["a user with no sub", { ...ok, subs: [OWNER, undefined] }, 1],
  ]
  let failed = 0
  for (const [label, state, expected] of CASES) {
    const got = evaluate(state).length
    if (got !== expected) failed++
    console.log(`  ${got === expected ? "ok" : "FAIL"}  ${got} failure(s), expected ${expected}  — ${label}`)
  }
  const parsed = ownerSubs(`export const OWNER_USER_IDS: readonly string[] = [\n  // note ${FRIEND}\n  "${OWNER}",\n]`)
  if (JSON.stringify(parsed) !== JSON.stringify([OWNER])) {
    failed++
    console.log(`  FAIL  owner-list parse read ${JSON.stringify(parsed)}`)
  }
  const real = ownerSubs(readFileSync(OWNER_IDS, "utf8"))
  if (!real || real.length === 0) {
    failed++
    console.log("  FAIL  the real lib/auth/owner-ids.ts yields no owner sub")
  }
  if (decisionText(readFileSync(DECISIONS, "utf8"), "D-123") === null) {
    failed++
    console.log("  FAIL  D-123 itself cannot be found in the real DECISIONS.md, so no successor could be either")
  }
  if (failed) {
    console.error(`\n${failed} self-test case(s) failed. The Trigger A check is broken.`)
    process.exit(1)
  }
  console.log(`\ncheck-d123-trigger-a: self-test passed (${CASES.length + 3} cases)`)
}

if (process.argv.includes("--self-test")) {
  selfTest()
} else {
  const { userPoolId, source } = targetPool()
  const region = userPoolId.split("_")[0]
  const pool = aws(["cognito-idp", "describe-user-pool", "--user-pool-id", userPoolId, "--region", region]).UserPool
  const tags = pool?.UserPoolTags ?? {}
  console.log(`D-123 Trigger A — user pool ${userPoolId} (target from ${source})`)
  console.log(`                  environment: ${tags["amplify:deployment-type"] ?? "untagged"} ${tags["amplify:branch-name"] ?? ""}`)
  if (tags["amplify:deployment-type"] !== "branch") {
    console.error("\nThis pool is not the deployed branch's. Trigger A is about the PRODUCTION pool; a sandbox's throwaway\n" +
      "users say nothing about it. Pass --user-pool-id for the branch pool. Failing rather than guessing.")
    process.exit(1)
  }
  // The CLI follows PaginationToken itself. `sub` only: no username or email is fetched.
  const users = aws(["cognito-idp", "list-users", "--user-pool-id", userPoolId, "--region", region, "--attributes-to-get", "sub"]).Users ?? []
  const subs = users.map((u) => u.Attributes?.find((a) => a.Name === "sub")?.Value)
  const failures = evaluate({
    subs,
    owners: ownerSubs(readFileSync(OWNER_IDS, "utf8")) ?? [],
    approved: APPROVED_ACCOUNTS,
    register: readFileSync(DECISIONS, "utf8"),
  })
  console.log(`                  ${users.length} account(s) in the pool`)
  if (failures.length) {
    console.error(
      `\n${failures.map((f) => `  ${f}`).join("\n")}\n\n` +
        "08-security-privacy.md §2.4, TRIGGER A: a second account exists. D-123's premise, \"map shown\n" +
        "only to the owner\", is now false. Before that account may sign in, the A-1..A-7 gate must be\n" +
        "complete and a decision recorded in docs/decisions/DECISIONS.md that supersedes or re-affirms\n" +
        "D-123. Then list the sub in APPROVED_ACCOUNTS citing that decision. Do not weaken this check.",
    )
    process.exit(1)
  }
  console.log("\nTrigger A has not fired: every account in the pool is the owner or admitted by a recorded decision.")
}
