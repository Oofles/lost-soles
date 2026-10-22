#!/usr/bin/env node
// gitleaks over the FULL git history (08-security-privacy.md §7.3 layer 2, ticket 0115).
//
// Why a script and not `gitleaks/gitleaks-action@v2`: on a `push` event that action
// scans only the pushed commit range, not the history, whatever `fetch-depth` the
// checkout used. secret-scan.yml said "full history" and was scanning one push at a
// time. A secret committed and later removed lives in history, and this repo is
// public (D-165), so history is exactly what an attacker clones.
//
// The command and its scope, recorded here because the ticket asks for both:
//
//   gitleaks detect --source <repo> --log-opts=--all --redact --no-banner --exit-code 1
//
//   --log-opts=--all   every ref the clone holds (every branch and tag), every commit
//   --redact           a finding never prints the secret into a public CI log
//
// FAILS CLOSED (D-176):
//   - gitleaks must PROVE LIVENESS by printing a version, and it must be the pinned
//     one: a 19-byte `exit 0` stub satisfied `command -v` for a whole session once
//     (ticket 0137).
//   - a SHALLOW clone is refused, not scanned. Scanning one commit and calling it
//     history is the exact failure this script replaces. `--unshallow` fetches the
//     rest first; if that fails, so does this.
//   - zero commits is a failure, not a pass.
//
// The binary is version- and checksum-pinned here, ONCE, for both CI surfaces
// (D-163): `--install` downloads it into the OS temp dir and verifies the sha256
// before it is ever executed.
//
//   node scripts/check-history-secrets.mjs                 scan with gitleaks on PATH
//   node scripts/check-history-secrets.mjs --install       fetch the pinned binary, then scan
//   node scripts/check-history-secrets.mjs --unshallow     deepen a shallow clone, then scan
//   node scripts/check-history-secrets.mjs --self-test     prove a REMOVED secret is still found

import { execFileSync, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "")

export const GITLEAKS_VERSION = "8.30.1"
/** sha256 of gitleaks_8.30.1_linux_x64.tar.gz, from the release's checksums.txt. */
const LINUX_X64_SHA256 = "551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb"
/** Outside the repo, so a downloaded binary can never be committed by a wildcard add. */
const CACHE = join(tmpdir(), `lost-soles-gitleaks-${GITLEAKS_VERSION}`)

function die(msg) {
  console.error(`\nHISTORY SECRET SCAN FAILED: ${msg}`)
  process.exit(1)
}

async function install() {
  const bin = join(CACHE, "gitleaks")
  if (existsSync(bin)) return bin
  if (process.platform !== "linux" || process.arch !== "x64") {
    die(`--install supports linux x64 only (this is ${process.platform} ${process.arch}). Install gitleaks ${GITLEAKS_VERSION} yourself.`)
  }
  const url = `https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz`
  let body
  try {
    const res = await fetch(url)
    if (!res.ok) die(`download returned HTTP ${res.status}: ${url}`)
    body = Buffer.from(await res.arrayBuffer())
  } catch (e) {
    die(`could not download ${url}: ${e.message}`)
  }
  const got = createHash("sha256").update(body).digest("hex")
  if (got !== LINUX_X64_SHA256) die(`checksum mismatch for ${url}\n  expected ${LINUX_X64_SHA256}\n  got      ${got}\nNothing was executed.`)
  mkdirSync(CACHE, { recursive: true })
  const tgz = join(CACHE, "gitleaks.tar.gz")
  writeFileSync(tgz, body)
  execFileSync("tar", ["-xzf", tgz, "-C", CACHE, "gitleaks"])
  rmSync(tgz)
  return bin
}

function gitleaksBin() {
  const cached = join(CACHE, "gitleaks")
  return existsSync(cached) ? cached : "gitleaks"
}

/** Liveness, not presence: the binary must run and report the pinned version. */
function assertLive(bin) {
  const r = spawnSync(bin, ["version"], { encoding: "utf8" })
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim()
  if (r.error || r.status !== 0 || !/\d+\.\d+\.\d+/.test(out)) {
    die(`gitleaks did not run (${r.error?.code ?? `exit ${r.status}`}; printed '${out}'). A broken scanner is not an absent finding.`)
  }
  if (!out.includes(GITLEAKS_VERSION)) {
    console.log(`  note: gitleaks ${out} is not the pinned ${GITLEAKS_VERSION}; CI uses --install for the pinned one.`)
  }
  return out
}

function git(repo, args) {
  return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()
}

/** Returns { commits } or exits. Never scans a shallow clone. */
function assertFullHistory(repo, { unshallow }) {
  let shallow
  try {
    shallow = git(repo, ["rev-parse", "--is-shallow-repository"])
  } catch (e) {
    die(`${repo} is not a readable git repository: ${String(e.stderr || e.message).trim()}`)
  }
  if (shallow === "true") {
    if (!unshallow) die(`${repo} is a SHALLOW clone; scanning it would cover a fraction of history. Re-run with --unshallow.`)
    // Amplify clones over SSH and then removes its git credentials, so `origin` may be
    // unreachable from the build. The repo is public (D-165): retry over HTTPS.
    const remotes = ["origin"]
    try {
      const url = git(repo, ["remote", "get-url", "origin"])
      const m = /^git@github\.com:(.+)$/.exec(url)
      if (m) remotes.push(`https://github.com/${m[1]}`)
    } catch { /* no origin: the attempt below reports it */ }
    let last = ""
    for (const remote of remotes) {
      try {
        git(repo, ["fetch", "--unshallow", "--tags", remote])
        last = ""
        break
      } catch (e) {
        last = String(e.stderr || e.message).trim().split("\n").pop()
      }
    }
    if (last) die(`git fetch --unshallow failed: ${last}`)
    if (git(repo, ["rev-parse", "--is-shallow-repository"]) === "true") die("still shallow after --unshallow.")
  }
  const commits = Number(git(repo, ["rev-list", "--all", "--count"]))
  if (!(commits > 0)) die(`${repo} has no commits to scan.`)
  return { commits }
}

/** Exit status of gitleaks: 0 clean, 1 leaks found, anything else = did not scan. */
export function scan(bin, repo) {
  const r = spawnSync(bin, ["detect", "--source", repo, "--log-opts=--all", "--redact", "--no-banner", "--exit-code", "1"], {
    encoding: "utf8",
  })
  return { status: r.status, output: `${r.stdout ?? ""}${r.stderr ?? ""}`, error: r.error }
}

const args = process.argv.slice(2)

if (args.includes("--self-test")) {
  // A secret committed, then deleted in the next commit. The tip is clean; history
  // is not. A tip-only or push-range scan passes this; a full-history scan must not.
  if (args.includes("--install")) await install()
  const bin = gitleaksBin()
  assertLive(bin)
  const base = mkdtempSync(join(tmpdir(), "history-scan-"))
  let failed = 0
  try {
    const repo = join(base, "repo")
    mkdirSync(repo)
    const g = (...a) => git(repo, a)
    g("init", "-q", "-b", "main")
    g("config", "user.email", "selftest@example.invalid")
    g("config", "user.name", "self-test")
    g("config", "commit.gpgsign", "false")
    g("config", "core.hooksPath", "/dev/null")
    writeFileSync(join(repo, "README"), "clean\n")
    g("add", "README")
    g("commit", "-q", "-m", "clean")
    // Assembled at runtime so this source file is not itself a finding.
    const key = ["ghp", "_", "R7mK2pQ9vX4tL8nB3wY6zC1dF5hJ0sA2eG7u"].join("")
    writeFileSync(join(repo, "config.txt"), `token=${key}\n`)
    g("add", "config.txt")
    g("commit", "-q", "-m", "oops")
    g("rm", "-q", "config.txt")
    g("commit", "-q", "-m", "remove it")

    const tipClean = !existsSync(join(repo, "config.txt"))
    const full = scan(bin, repo)
    const caught = tipClean && full.status === 1 && !full.output.includes(key)
    if (!caught) failed++
    console.log(`  ${caught ? "ok" : "FAIL"}  a secret REMOVED from the tip is found in history (exit ${full.status}), and not printed`)

    // The same repo, shallow: must be refused, never scanned as if it were history.
    const shallow = join(base, "shallow")
    execFileSync("git", ["clone", "-q", "--depth", "1", `file://${repo}`, shallow], { stdio: "ignore" })
    const r = spawnSync(process.execPath, [new URL(import.meta.url).pathname, "--repo", shallow], { encoding: "utf8" })
    const refused = r.status === 1 && /SHALLOW/.test(r.stderr)
    if (!refused) failed++
    console.log(`  ${refused ? "ok" : "FAIL"}  a shallow clone is refused, not scanned (exit ${r.status})`)

    // A clean history passes.
    const clean = join(base, "clean")
    mkdirSync(clean)
    git(clean, ["init", "-q", "-b", "main"])
    git(clean, ["config", "user.email", "selftest@example.invalid"])
    git(clean, ["config", "user.name", "self-test"])
    git(clean, ["config", "commit.gpgsign", "false"])
    git(clean, ["config", "core.hooksPath", "/dev/null"])
    writeFileSync(join(clean, "README"), "nothing here\n")
    git(clean, ["add", "README"])
    git(clean, ["commit", "-q", "-m", "clean"])
    const ok = scan(bin, clean).status === 0
    if (!ok) failed++
    console.log(`  ${ok ? "ok" : "FAIL"}  a clean history passes`)
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
  if (failed) die(`${failed} self-test case(s) failed — do not trust a green history scan.`)
  console.log("\nself-test: the scan reads history, not the tip, and refuses a shallow clone.")
  process.exit(0)
}

const repoFlag = args.indexOf("--repo")
const repo = repoFlag !== -1 ? args[repoFlag + 1] : ROOT
if (args.includes("--install")) await install()
const bin = gitleaksBin()
const version = assertLive(bin)
const { commits } = assertFullHistory(repo, { unshallow: args.includes("--unshallow") })
console.log(`History secret scan — gitleaks ${version}, ${commits} commit(s) across all refs`)
const r = scan(bin, repo)
process.stdout.write(r.output)
if (r.error || (r.status !== 0 && r.status !== 1)) die(`gitleaks exited ${r.status ?? r.error?.code} without a verdict.`)
if (r.status === 1) die("a secret is in git history (redacted above). ROTATE IT FIRST (08 §8), then consider a rewrite.")
console.log(`\nNo secret in ${commits} commits of history.`)
