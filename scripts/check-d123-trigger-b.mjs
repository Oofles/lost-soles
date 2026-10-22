#!/usr/bin/env node
// D-123 TRIGGER B: a share, export or screenshot feature is PROPOSED.
//
// docs/08-security-privacy.md §2.4 TRIGGER B. Ticket 0114. Operator, 2026-10-22: option (c), both
// parts.
//
// §2.4 says Trigger B fires at PROPOSAL time, not implementation time, "because the design of a
// share feature is where the privacy decision actually gets made". Proposals are written in
// tickets and docs, and implementations leave fingerprints in code. So this reads the LINES ADDED
// in the push range, in two parts:
//
//   PART ONE: tickets and docs. Every added line in a changed `tickets/**.md` or `docs/**.md` is
//   searched for §2.4's own phrase list (share button, image export, "export my map", social card,
//   OG image, printable poster, GPX/GeoJSON export, embeddable widget, screenshot helper). A match
//   passes only if that file cites a decision that exists in DECISIONS.md and SUPERSEDES or
//   RE-AFFIRMS D-123 (§2.4: "explicitly superseding or re-affirming D-123"). A decision that
//   merely mentions D-123 in passing does not count; DECISIONS.md already has one of those.
//
//   PART TWO: code. Every added line in a changed non-Markdown file is searched for API-shaped
//   signals: `navigator.share`, `toDataURL`/`toBlob`, `opengraph-image`/`twitter-image`,
//   `Content-Disposition: attachment`, `application/gpx+xml`, `geo+json`. A match passes only
//   through an entry in scripts/d123-acknowledgements.json naming the file, the signal and such a
//   decision.
//
// WHY ADDED LINES ONLY. The §2.5 triage words match 464 of 620 code files and most of the docs,
// and `export` is in nearly every TS file. Scanning whole files would fire on every push forever.
// Scanning additions fires on the push that introduces a proposal, which is when §2.4 wants it.
//
// THE PATTERNS ARE NOT THE WAY OUT. The self-test pins each phrase to §2.4's list. Passing this
// check means recording a decision, not editing the regexes.
//
// THE BASE REF, and failing closed without one (D-176):
//   --base <sha> or D123_BASE_SHA   GitHub passes `github.event.before` (push) or the PR base sha.
//                                   If the shallow checkout lacks it, it is fetched at depth 1.
//   empty or all zeros              a first push or a new branch, which has no `before`. HEAD's
//                                   first parent is used instead. This is also the Amplify path,
//                                   which builds one commit and has no `before`. Amplify clones
//                                   in full, and a shallow clone is deepened by one.
//   no parent at all                a root commit. There is nothing to diff against. FAIL.
//
// Amplify sees HEAD^..HEAD only, and [skip-cd] commits never reach it (D-311). The GitHub gate sees
// the whole push range. Together they are D-163's alarm and lock.
//
//   node scripts/check-d123-trigger-b.mjs [--base <sha>]
//   node scripts/check-d123-trigger-b.mjs --self-test    builds throwaway git repos; no network

import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "")
const ACK_PATH = "scripts/d123-acknowledgements.json"
const REGISTER_PATH = "docs/decisions/DECISIONS.md"

/** This check and its acknowledgements define the signals. Scanning them for the signals is circular. */
const SELF = new Set(["scripts/check-d123-trigger-b.mjs", ACK_PATH])

/** §2.4 TRIGGER B's "Fires when" list, one entry per item, in its order. */
export const PHRASES = [
  { name: "share button", re: /\bshare[- ](button|link|view|url|sheet|card|page|feature)s?\b/i },
  { name: "image export", re: /\bimage[- ]export|\bexport(ing)? (an? |the )?(image|png|jpe?g)\b/i },
  { name: "export my map", re: /\bexport (my|the|your|a) map\b/i },
  { name: "social card", re: /\bsocial[- ]cards?\b/i },
  { name: "OG image", re: /\b(og[- ]?image|open ?graph[- ]image|opengraph)\b/i },
  { name: "printable poster", re: /\bposters?\b/i },
  { name: "GPX/GeoJSON export", re: /\b(gpx|geojson)[- ](export|download)|\bexport(ing)? (to |as |an? )?(gpx|geojson)\b/i },
  { name: "embeddable widget", re: /\bembeddable\b|\bembed(ded)?[- ]widgets?\b/i },
  { name: "screenshot helper", re: /\bscreenshot[- ](helper|button|feature|export|tool)s?\b/i },
]

/** The operator's list of API-shaped signals, 2026-10-22. */
export const SIGNALS = [
  { name: "navigator.share", re: /\bnavigator\s*\.\s*(canS|s)hare\b/ },
  { name: "toDataURL/toBlob", re: /\.(toDataURL|toBlob)\s*\(/ },
  { name: "opengraph-image/twitter-image", re: /\b(opengraph|twitter)-image\b/ },
  { name: "Content-Disposition: attachment", re: /content-disposition[^\n]*attachment/i },
  { name: "application/gpx+xml", re: /application\/gpx\+xml/i },
  { name: "geo+json", re: /geo\+json/i },
]

const SUCCESSOR = /\b(supersed\w*|re-?affirm\w*)\b[^\n]{0,80}\bD-123\b|\bD-123\b[^\n]{0,80}\b(supersed\w*|re-?affirm\w*)/i

/** Ids of decisions, other than D-123 itself, that supersede or re-affirm D-123. */
export function successorDecisions(register) {
  const ids = new Set()
  const lines = register.split("\n")
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^- \*\*(D-\d+)\*\*/)
    if (!m || m[1] === "D-123") continue
    let end = i + 1
    while (end < lines.length && !/^- \*\*[DO]-\d+\*\*/.test(lines[end]) && !/^#{1,3} /.test(lines[end])) end++
    if (SUCCESSOR.test(lines.slice(i, end).join("\n"))) ids.add(m[1])
  }
  return ids
}

const isDoc = (p) => /^(tickets|docs)\/.+\.md$/.test(p) && p !== "docs/INDEX.md"

function git(cwd, args, opts = {}) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts })
}
function gitOk(cwd, args) {
  try { git(cwd, args); return true } catch { return false }
}

/** The base commit, or throws with the reason. See the header for the order. */
export function resolveBase(cwd, requested) {
  const given = (requested ?? "").trim()
  if (given && !/^0+$/.test(given)) {
    if (!gitOk(cwd, ["cat-file", "-e", `${given}^{commit}`])) {
      gitOk(cwd, ["fetch", "--no-tags", "--quiet", "--depth=1", "origin", given])
    }
    if (!gitOk(cwd, ["cat-file", "-e", `${given}^{commit}`])) {
      throw new Error(`base ${given} is not in this clone and could not be fetched from origin`)
    }
    return { base: given, how: "the push's before sha" }
  }
  if (!gitOk(cwd, ["rev-parse", "--verify", "--quiet", "HEAD^"])) {
    if (git(cwd, ["rev-parse", "--is-shallow-repository"]).trim() === "true") {
      gitOk(cwd, ["fetch", "--no-tags", "--quiet", "--deepen=1", "origin"])
    }
  }
  if (!gitOk(cwd, ["rev-parse", "--verify", "--quiet", "HEAD^"])) {
    throw new Error("no base ref was given and HEAD has no parent to diff against")
  }
  return { base: git(cwd, ["rev-parse", "HEAD^"]).trim(), how: given ? "HEAD^ (before sha was all zeros)" : "HEAD^ (no before sha)" }
}

/** Added lines per changed file, base..HEAD. Binary files contribute their path only. */
function additions(cwd, base) {
  const files = git(cwd, ["diff", "--name-only", "--no-renames", "--diff-filter=AM", base, "HEAD"]).split("\n").filter(Boolean)
  const out = new Map()
  for (const file of files) {
    const patch = git(cwd, ["diff", "--unified=0", "--no-color", "--no-ext-diff", "--no-renames", base, "HEAD", "--", file], { maxBuffer: 256 * 1024 * 1024 })
    out.set(file, patch.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++")).map((l) => l.slice(1)))
  }
  return out
}

/** Both parts over base..HEAD in `cwd`. Returns { base, how, files, failures }. */
export function scan(cwd, requestedBase) {
  const { base, how } = resolveBase(cwd, requestedBase)
  const read = (p) => (existsSync(join(cwd, p)) ? readFileSync(join(cwd, p), "utf8") : null)
  const register = read(REGISTER_PATH)
  if (register === null) throw new Error(`${REGISTER_PATH} is missing; no decision could be checked`)
  const successors = successorDecisions(register)
  const ackText = read(ACK_PATH)
  if (ackText === null) throw new Error(`${ACK_PATH} is missing. It is committed, even when empty`)
  const acks = JSON.parse(ackText).acknowledgements
  if (!Array.isArray(acks)) throw new Error(`${ACK_PATH} has no "acknowledgements" array`)

  const failures = []
  for (const a of acks) {
    if (!successors.has(a.decision)) {
      failures.push(`${ACK_PATH}: the entry for ${a.file} (${a.signal}) cites ${a.decision}, which is not a decision superseding or re-affirming D-123`)
    }
  }

  const added = additions(cwd, base)
  for (const [file, lines] of added) {
    if (SELF.has(file)) continue
    if (file.endsWith(".md")) {
      if (!isDoc(file)) continue
      const hits = [...new Set(lines.flatMap((l) => PHRASES.filter((p) => p.re.test(l)).map((p) => p.name)))]
      if (hits.length === 0) continue
      const cited = [...new Set((read(file) ?? "").match(/\bD-\d+\b/g) ?? [])].filter((d) => successors.has(d))
      if (cited.length === 0) {
        failures.push(`${file}: adds ${hits.map((h) => `"${h}"`).join(", ")} and cites no decision superseding or re-affirming D-123`)
      }
      continue
    }
    const hits = new Set(lines.flatMap((l) => SIGNALS.filter((s) => s.re.test(l)).map((s) => s.name)))
    if (/\b(opengraph|twitter)-image\b/.test(file)) hits.add("opengraph-image/twitter-image")
    for (const signal of hits) {
      const ok = acks.some((a) => a.file === file && a.signal === signal && successors.has(a.decision))
      if (!ok) failures.push(`${file}: adds ${signal} with no entry in ${ACK_PATH} citing a D-123 successor`)
    }
  }
  return { base, how, files: added.size, failures }
}

// ─────────────────────────────────────────────────────────────────── self-test ────

function selfTest() {
  const REGISTER = [
    "# Decisions",
    "- **D-123** **No special home-location privacy handling.** Single user.",
    "- **D-500** **Shares get a masked payload.** Supersedes D-123 with the premise that a share exists.",
    "- **D-501** **Unrelated.** A re-open trigger in the shape §2.4 uses for D-123.",
  ].join("\n")
  const ACK = (entries = []) => JSON.stringify({ acknowledgements: entries })
  const BASE = {
    [REGISTER_PATH]: REGISTER,
    [ACK_PATH]: ACK(),
    "docs/08.md": "Trigger B lists a share button and a printable poster.\n",
    "src/x.ts": "export const x = 1\n",
  }

  const repo = (head, { root = false } = {}) => {
    const dir = mkdtempSync(join(tmpdir(), "d123-b-"))
    const write = (files) => {
      for (const [p, text] of Object.entries(files)) {
        mkdirSync(dirname(join(dir, p)), { recursive: true })
        writeFileSync(join(dir, p), text)
      }
    }
    const commit = (msg) => {
      git(dir, ["add", "-A"])
      git(dir, ["-c", "user.email=t@t", "-c", "user.name=t", "-c", "commit.gpgsign=false", "commit", "-q", "--no-verify", "-m", msg])
    }
    git(dir, ["init", "-q", "-b", "main"])
    git(dir, ["config", "core.hooksPath", "/dev/null"])
    write(BASE)
    commit("base")
    if (!root) { write(head); commit("head") }
    return dir
  }

  const CASES = [
    ["a doc proposing a share button, no decision", { "docs/new.md": "Let's add a share button.\n" }, 1],
    ["the same doc citing the successor D-500", { "docs/new.md": "Let's add a share button, per D-500.\n" }, 0],
    ["citing D-501, which only MENTIONS D-123", { "docs/new.md": "Let's add a share button, per D-501.\n" }, 1],
    ["a ticket proposing an OG image", { "tickets/open/0001-x.md": "Add an OG image to /run.\n" }, 1],
    ["pre-existing phrase, unrelated addition", { "docs/08.md": "Trigger B lists a share button and a printable poster.\nA new unrelated line.\n" }, 0],
    ["docs/INDEX.md is generated and skipped", { "docs/INDEX.md": "| share button | 1-2 |\n" }, 0],
    ["plain `export` in code does not fire", { "src/y.ts": "export function share() { return 1 }\n" }, 0],
    ["navigator.share in code", { "src/y.ts": "await navigator.share({ url })\n" }, 1],
    ["canvas.toDataURL in code", { "src/y.ts": "const png = map.getCanvas().toDataURL()\n" }, 1],
    ["an opengraph-image route FILE", { "app/run/opengraph-image.tsx": "export default function I() {}\n" }, 1],
    ["Content-Disposition attachment", { "app/api/x/route.ts": 'h.set("Content-Disposition", "attachment; filename=map.png")\n' }, 1],
    ["gpx+xml and geo+json together", { "src/y.ts": 'const a = "application/gpx+xml"\nconst b = "application/geo+json"\n' }, 2],
    ["navigator.share acknowledged under D-500", { "src/y.ts": "await navigator.share({ url })\n", [ACK_PATH]: ACK([{ file: "src/y.ts", signal: "navigator.share", decision: "D-500" }]) }, 0],
    ["acknowledged under D-501, which is not a successor", { "src/y.ts": "await navigator.share({ url })\n", [ACK_PATH]: ACK([{ file: "src/y.ts", signal: "navigator.share", decision: "D-501" }]) }, 2],
    ["acknowledged for a different file", { "src/y.ts": "await navigator.share({ url })\n", [ACK_PATH]: ACK([{ file: "src/z.ts", signal: "navigator.share", decision: "D-500" }]) }, 1],
  ]
  let failed = 0
  for (const [label, head, expected] of CASES) {
    const dir = repo(head)
    let got
    try { got = scan(dir, "").failures.length } catch (e) { got = `threw: ${e.message}` }
    rmSync(dir, { recursive: true, force: true })
    if (got !== expected) failed++
    console.log(`  ${got === expected ? "ok" : "FAIL"}  ${got} failure(s), expected ${expected}  — ${label}`)
  }

  // The base-ref paths.
  const dir = repo({ "docs/new.md": "a share button\n" })
  const zeros = scan(dir, "0000000000000000000000000000000000000000")
  const explicit = scan(dir, git(dir, ["rev-parse", "HEAD^"]).trim())
  const zerosOk = zeros.how.startsWith("HEAD^") && zeros.failures.length === 1
  const explicitOk = explicit.how === "the push's before sha" && explicit.failures.length === 1
  let unknownOk = false
  try { scan(dir, "1234567890123456789012345678901234567890") } catch { unknownOk = true }
  rmSync(dir, { recursive: true, force: true })
  const root = repo({}, { root: true })
  let rootOk = false
  try { scan(root, "") } catch { rootOk = true }
  rmSync(root, { recursive: true, force: true })
  for (const [ok, label] of [
    [zerosOk, "an all-zeros before sha falls back to HEAD^"],
    [explicitOk, "an explicit before sha is used as the base"],
    [unknownOk, "an unknown before sha that cannot be fetched FAILS CLOSED"],
    [rootOk, "a root commit with no base FAILS CLOSED"],
  ]) {
    if (!ok) failed++
    console.log(`  ${ok ? "ok" : "FAIL"}  ${label}`)
  }

  // The phrase list is §2.4's. Each item must still fire on its own wording from §2.4.
  const SECTION_2_4 = ["a share button", "an image export", 'an "export my map" download', "a social card", "an OG image",
    "a printable poster", "a GPX/GeoJSON export", "an embeddable widget", "a screenshot helper"]
  SECTION_2_4.forEach((text, i) => {
    const ok = PHRASES[i].re.test(text.replace("GPX/GeoJSON", "GPX"))
    if (!ok) failed++
    if (!ok) console.log(`  FAIL  §2.4 item "${text}" no longer matches its pattern`)
  })
  if (failed) {
    console.error(`\n${failed} self-test case(s) failed. The Trigger B check is broken.`)
    process.exit(1)
  }
  console.log(`\ncheck-d123-trigger-b: self-test passed (${CASES.length + 4 + SECTION_2_4.length} cases)`)
}

// ──────────────────────────────────────────────────────────────────────── main ────

if (process.argv.includes("--self-test")) {
  selfTest()
} else {
  const i = process.argv.indexOf("--base")
  const requested = i !== -1 ? process.argv[i + 1] : process.env.D123_BASE_SHA
  let result
  try {
    result = scan(ROOT, requested)
  } catch (err) {
    console.error(`check-d123-trigger-b: could not run: ${err.message}\nThis check FAILS CLOSED (D-176). An unscanned push is not a pass.`)
    process.exit(1)
  }
  const { base, how, files, failures } = result
  console.log(`D-123 Trigger B — ${files} changed file(s) since ${base.slice(0, 12)} (${how})`)
  if (failures.length) {
    console.error(
      `\n${failures.map((f) => `  ${f}`).join("\n")}\n\n` +
        "08-security-privacy.md §2.4, TRIGGER B: a share, export or screenshot feature has been proposed\n" +
        "or begun. It fires at PROPOSAL time. Before this merges, D-123 is reopened: complete the B-1..B-7\n" +
        "gate and record a decision in docs/decisions/DECISIONS.md that supersedes or re-affirms D-123.\n" +
        `Then cite it in the doc or ticket, or for code add an entry to ${ACK_PATH}.\n` +
        "Editing this check's patterns is not a resolution. A recorded decision is.",
    )
    process.exit(1)
  }
  console.log("Trigger B has not fired.")
}
