#!/usr/bin/env node
// D-123 TRIGGER A: an identity other than the owner's can sign in to Lost Soles.
//
// docs/08-security-privacy.md §2.4 TRIGGER A. Ticket 0114; REWRITTEN by ticket 0334 (D-470, D-479).
//
// D-123 waives home-location masking on the premise "map shown only to the owner". Until 0334 a
// second account meant a second user in the Cognito pool, and this read the pool. Cognito is gone
// (D-473). Sign-in is Auth.js against core's SSO (D-478), and two things decide who is a user here:
//
//   - AUTH_ALLOWED_EMAILS, in SSM: the sign-in gate (`lib/auth/config.ts`'s `isAllowedEmail`).
//   - IDENTITIES, in `lib/auth/owner-ids.ts`: the email -> uid map, the authorization.
//
// Both must pass for a session to become a uid (`lib/auth/identity.ts`). So Trigger A, restated
// (D-470): it fires when the production allowlist or the committed map holds any identity other
// than the owner's. The allowlist is read LIVE, because an SSM edit admits someone without touching
// the repo, and a source check would never see it.
//
// THE RULE. Every IDENTITIES entry maps to a uid that is either
//   - an owner (`OWNER_USER_IDS`, the same list the routes enforce), or
//   - listed in APPROVED_ACCOUNTS below, citing a decision that exists in DECISIONS.md and names
//     D-123 (a successor that supersedes or re-affirms it, §2.4 A-7);
// and the allowlist and the map hold exactly the same emails. An allowlisted email with no map entry
// is signed out today, but it is one commit from being a user, and a mapped email off the allowlist
// is a map nobody is reading: either way the two have drifted, and drift in the control that defines
// "a user" fails. The operator's own addresses may each map to the owner uid (D-479): that is one
// account with two ways in, not a second account, and it passes.
//
// PRIVACY OF THE CHECK ITSELF (D-426). It prints counts and uids, never an email, not even on
// failure. A person's address in a build log is an identity in a log nobody reviews.
//
// FAILS CLOSED (D-176). Missing CLI, missing credentials, a denied or empty SSM read, an unreadable
// owner list, map or DECISIONS.md: every one is exit 1.
//
//   node scripts/check-d123-trigger-a.mjs              read the live allowlist (needs ssm:GetParameter)
//   node scripts/check-d123-trigger-a.mjs --self-test  prove the rule FIRES; no AWS

import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { pathToFileURL } from "node:url"

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "")
const OWNER_IDS = `${ROOT}/lib/auth/owner-ids.ts`
const DECISIONS = `${ROOT}/docs/decisions/DECISIONS.md`

/** The one parameter this reads. `write-authjs-env.mjs` writes it into the build; same path. */
export const ALLOWLIST_PARAMETER = "/amplify/shared/d14fhvl4rp79nn/AUTH_ALLOWED_EMAILS"

/**
 * Uids other than the owner's that a recorded decision admits, as `{ uid, decision }`.
 * EMPTY, and it stays empty until §2.4's Trigger A gate (A-1 to A-7) is complete and a successor
 * to D-123 is recorded. The check refuses an entry whose decision does not exist or does not
 * name D-123.
 */
export const APPROVED_ACCOUNTS = []

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g

/** The owner uids, read from the TS source the routes import. Plain node cannot import TS. */
export function ownerSubs(source) {
  const block = source.match(/OWNER_USER_IDS[^=]*=\s*\[([\s\S]*?)\]/)
  if (!block) return null
  const code = block[1].replace(/\/\/.*$/gm, "")
  return [...code.matchAll(UUID)].map((m) => m[0])
}

/**
 * The IDENTITIES map, read from the same source, as `[email, uid]` pairs in source order. Comments
 * are stripped first so a commented-out entry is not counted. Null when the block cannot be found,
 * or when an entry inside it does not parse: a map this cannot read is not a map that passed.
 */
export function identityEntries(source) {
  const block = source.match(/export const IDENTITIES[^=]*=\s*\{([\s\S]*?)\n\}/)
  if (!block) return null
  const code = block[1].replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "")
  const entries = []
  for (const raw of code.split(",")) {
    const line = raw.trim()
    if (!line) continue
    const m = line.match(/^"([^"]+)"\s*:\s*"([^"]+)"$/)
    if (!m) return null
    entries.push([m[1], m[2]])
  }
  return entries
}

/** `config.ts`'s parse of the allowlist, exactly: comma-split, trimmed, lower-cased, non-empty. */
export function allowlistEmails(value) {
  return String(value ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
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

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/**
 * The rule, as a pure function. Returns failure strings; [] means Trigger A has not fired.
 * NO FAILURE STRING NAMES AN EMAIL: they carry counts and uids only (the self-test proves it).
 */
export function evaluate({ identities, allowlist, owners, approved, register }) {
  if (!Array.isArray(owners) || owners.length === 0) return ["no owner uid could be read from lib/auth/owner-ids.ts"]
  if (!Array.isArray(identities)) return ["the IDENTITIES map in lib/auth/owner-ids.ts could not be parsed"]
  if (identities.length === 0) return ["IDENTITIES is empty. The owner must be mapped; an empty map is not a pass"]
  if (!Array.isArray(allowlist) || allowlist.length === 0) {
    return ["AUTH_ALLOWED_EMAILS is empty or unreadable. The owner must be on it; an empty allowlist is not a pass"]
  }
  const failures = []

  // Only an entry whose decision exists AND names D-123 admits anyone.
  const admitted = new Set()
  for (const { uid, decision } of approved) {
    const text = decisionText(register, decision)
    if (text === null) failures.push(`APPROVED_ACCOUNTS admits ${uid} under ${decision}, which is not in DECISIONS.md`)
    else if (!/\bD-123\b/.test(text)) failures.push(`APPROVED_ACCOUNTS admits ${uid} under ${decision}, which does not name D-123`)
    else admitted.add(uid)
  }

  const nonLower = identities.filter(([email]) => email !== email.trim().toLowerCase()).length
  if (nonLower) failures.push(`${plural(nonLower, "IDENTITIES key")} not trimmed lower case, which uidForEmail() can never match`)

  const strangers = [...new Set(identities.map(([, uid]) => uid).filter((uid) => !owners.includes(uid) && !admitted.has(uid)))]
  for (const uid of strangers) failures.push(`IDENTITIES maps an email to ${uid}, which is not the owner, and no decision admits it`)

  if (!identities.some(([, uid]) => owners.includes(uid))) failures.push("no IDENTITIES entry maps to the owner uid")

  const mapped = new Set(identities.map(([email]) => email.trim().toLowerCase()))
  const allowed = new Set(allowlist)
  const unmapped = [...allowed].filter((e) => !mapped.has(e)).length
  const unlisted = [...mapped].filter((e) => !allowed.has(e)).length
  if (unmapped) failures.push(`${plural(unmapped, "allowlisted email")} with no IDENTITIES entry: the allowlist and the map disagree`)
  if (unlisted) failures.push(`${plural(unlisted, "IDENTITIES email")} not on AUTH_ALLOWED_EMAILS: the allowlist and the map disagree`)
  return failures
}

function readAllowlist() {
  try {
    const raw = execFileSync(
      "aws",
      ["ssm", "get-parameter", "--name", ALLOWLIST_PARAMETER, "--with-decryption", "--output", "json"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    )
    return JSON.parse(raw).Parameter?.Value ?? ""
  } catch (err) {
    // The AWS error code only: the command's output would hold the value.
    const code = /\(([A-Za-z]+(?:Exception|NotFound|Denied)[A-Za-z]*)\)/.exec(String(err.stderr ?? ""))?.[1]
    console.error(`FAILED to read ${ALLOWLIST_PARAMETER}: ${code ?? "aws cli failed"}`)
    console.error("\nThis check FAILS CLOSED. Missing CLI, missing credentials or a denied call fail the build.")
    process.exit(1)
  }
}

function selfTest() {
  const OWNER = "5488e4b8-d081-7014-748e-edd1937f8083"
  const FRIEND = "00000000-0000-4000-8000-000000000001"
  // Fixture addresses on the reserved example domain, never a real one.
  const A = "owner-a@example.com"
  const B = "owner-b@example.com"
  const F = "friend@example.com"
  const REGISTER = [
    "- **D-500** **Friends get a masked map.** Supersedes D-123 with the premise ...",
    "  - continued text",
    "- **D-501** **Something unrelated.** No mention of the home decision.",
  ].join("\n")
  const ok = { identities: [[A, OWNER]], allowlist: [A], owners: [OWNER], approved: [], register: REGISTER }
  const two = { ...ok, identities: [[A, OWNER], [B, OWNER]], allowlist: [A, B] }
  const CASES = [
    ["only the owner, one address", ok, 0],
    // D-479: the operator's two addresses, both on the owner uid, both allowlisted. One account.
    ["two addresses, both mapped to the owner uid, both allowlisted (D-479)", two, 0],
    ["an entry mapping to a second uid, no decision", { ...two, identities: [...two.identities, [F, FRIEND]], allowlist: [A, B, F] }, 1],
    ["a second uid admitted under a decision naming D-123", { ...ok, identities: [[A, OWNER], [F, FRIEND]], allowlist: [A, F], approved: [{ uid: FRIEND, decision: "D-500" }] }, 0],
    ["admitted under a decision that does not name D-123", { ...ok, identities: [[A, OWNER], [F, FRIEND]], allowlist: [A, F], approved: [{ uid: FRIEND, decision: "D-501" }] }, 2],
    ["admitted under a decision that does not exist", { ...ok, identities: [[A, OWNER], [F, FRIEND]], allowlist: [A, F], approved: [{ uid: FRIEND, decision: "D-999" }] }, 2],
    ["an allowlisted email absent from IDENTITIES", { ...two, allowlist: [A, B, F] }, 1],
    ["an IDENTITIES email absent from the allowlist", { ...two, allowlist: [A] }, 1],
    ["the allowlist and the map share nothing", { ...ok, allowlist: [F] }, 2],
    ["a mixed-case IDENTITIES key", { ...ok, identities: [["Owner-A@example.com", OWNER]] }, 1],
    ["the owner mapped by no entry", { ...ok, identities: [[A, FRIEND]] }, 2],
    ["an empty allowlist fails closed", { ...ok, allowlist: [] }, 1],
    ["an empty map fails closed", { ...ok, identities: [] }, 1],
    ["an unparseable map fails closed", { ...ok, identities: null }, 1],
    ["an unreadable owner list fails closed", { ...ok, owners: [] }, 1],
  ]
  let failed = 0
  for (const [label, state, expected] of CASES) {
    const got = evaluate(state)
    // D-426: no failure may name an email. Every fixture address contains "@"; no uid does.
    const leaks = got.some((f) => f.includes("@"))
    const pass = got.length === expected && !leaks
    if (!pass) failed++
    console.log(`  ${pass ? "ok" : "FAIL"}  ${got.length} failure(s), expected ${expected}${leaks ? ", AND A FAILURE NAMES AN EMAIL" : ""}  — ${label}`)
  }

  const src = [
    `export const OWNER_USER_IDS: readonly string[] = [\n  // note ${FRIEND}\n  "${OWNER}",\n]`,
    `export const IDENTITIES: Readonly<Record<string, string>> = {`,
    `  "${A}": "${OWNER}",`,
    `  // "${F}": "${FRIEND}",`,
    `  "${B}": "${OWNER}", // D-479`,
    `}`,
  ].join("\n")
  const checks = [
    ["owner-list parse", JSON.stringify(ownerSubs(src)) === JSON.stringify([OWNER])],
    ["IDENTITIES parse skips a commented-out entry", JSON.stringify(identityEntries(src)) === JSON.stringify([[A, OWNER], [B, OWNER]])],
    ["IDENTITIES parse refuses an entry it cannot read", identityEntries(`export const IDENTITIES = {\n  [key]: "${OWNER}",\n}`) === null],
    ["allowlist parse matches config.ts", JSON.stringify(allowlistEmails(` ${A.toUpperCase()} ,,${B} `)) === JSON.stringify([A, B])],
  ]
  const realSource = readFileSync(OWNER_IDS, "utf8")
  const real = ownerSubs(realSource)
  const realMap = identityEntries(realSource)
  checks.push(["the real lib/auth/owner-ids.ts yields an owner uid", Boolean(real && real.length)])
  checks.push(["the real IDENTITIES parses and maps only to owner uids", Boolean(realMap && realMap.length && realMap.every(([, uid]) => real?.includes(uid)))])
  checks.push(["D-123 itself is in the real DECISIONS.md", decisionText(readFileSync(DECISIONS, "utf8"), "D-123") !== null])
  for (const [label, pass] of checks) {
    if (!pass) failed++
    console.log(`  ${pass ? "ok" : "FAIL"}  ${label}`)
  }
  if (failed) {
    console.error(`\n${failed} self-test case(s) failed. The Trigger A check is broken.`)
    process.exit(1)
  }
  console.log(`\ncheck-d123-trigger-a: self-test passed (${CASES.length + checks.length} cases)`)
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href

if (isMain && process.argv.includes("--self-test")) {
  selfTest()
} else if (isMain) {
  const source = readFileSync(OWNER_IDS, "utf8")
  const identities = identityEntries(source)
  const owners = ownerSubs(source) ?? []
  const allowlist = allowlistEmails(readAllowlist())
  const failures = evaluate({
    identities,
    allowlist,
    owners,
    approved: APPROVED_ACCOUNTS,
    register: readFileSync(DECISIONS, "utf8"),
  })
  const uids = [...new Set((identities ?? []).map(([, uid]) => uid))]
  console.log(`D-123 Trigger A — AUTH_ALLOWED_EMAILS (SSM ${ALLOWLIST_PARAMETER}) and IDENTITIES (lib/auth/owner-ids.ts)`)
  console.log(`                  ${plural(allowlist.length, "allowlisted email")}, ${plural(identities?.length ?? 0, "IDENTITIES entry", "IDENTITIES entries")}`)
  console.log(`                  mapped uid(s): ${uids.join(", ") || "none"}; owner uid(s): ${owners.join(", ") || "none"}`)
  if (failures.length) {
    console.error(
      `\n${failures.map((f) => `  ${f}`).join("\n")}\n\n` +
        "08-security-privacy.md §2.4, TRIGGER A: an identity other than the owner's can become a user here,\n" +
        "or the control that decides who can has drifted. D-123's premise, \"map shown only to the owner\",\n" +
        "may now be false. Before a second identity may sign in, the A-1..A-7 gate must be complete and a\n" +
        "decision recorded in docs/decisions/DECISIONS.md that supersedes or re-affirms D-123. Then list the\n" +
        "uid in APPROVED_ACCOUNTS citing that decision. Do not weaken this check.",
    )
    process.exit(1)
  }
  console.log("\nTrigger A has not fired: every mapped identity is the owner's, and the allowlist and the map agree.")
}
