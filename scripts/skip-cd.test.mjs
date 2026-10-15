import { execFileSync } from "node:child_process"
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import { afterEach, describe, expect, it } from "vitest"
import { isNonDeployable, shouldSkip, tagMessage, TAG } from "./skip-cd.mjs"

/**
 * Ticket 0214. Like pre-commit-hook.test.mjs, the hook is exercised the way git
 * runs it — real commits in a real repository with a real upstream — because the
 * interesting cases (an unpushed code commit under a docs commit, a rename, no
 * upstream) are properties of git state, not of a function's input.
 */

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "")
const dirs = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true })
})

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
}

/** A clone of a bare repo holding one pushed commit, with only the commit-msg hook installed. */
function repo({ upstream = true } = {}) {
  const base = mkdtempSync(join(tmpdir(), "skip-cd-"))
  dirs.push(base)
  const work = join(base, "work")
  mkdirSync(work)
  git(work, "init", "-q", "-b", "main")
  git(work, "config", "user.email", "t@example.com")
  git(work, "config", "user.name", "t")
  for (const f of [".githooks/commit-msg", "scripts/skip-cd.mjs"]) {
    mkdirSync(dirname(join(work, f)), { recursive: true })
    copyFileSync(join(ROOT, f), join(work, f))
  }
  chmodSync(join(work, ".githooks/commit-msg"), 0o755)
  git(work, "config", "core.hooksPath", ".githooks")
  git(work, "add", ".")
  git(work, "commit", "-q", "-m", "init")
  if (upstream) {
    git(base, "init", "-q", "--bare", "remote.git")
    git(work, "remote", "add", "origin", join(base, "remote.git"))
    git(work, "push", "-q", "-u", "origin", "main")
  }
  return work
}

function commit(work, files, message = "subject\n\nbody\n\nCo-Authored-By: x <x@example.com>") {
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(work, path)), { recursive: true })
    writeFileSync(join(work, path), body)
  }
  git(work, "add", "-A")
  git(work, "commit", "-q", "-m", message)
  return git(work, "log", "-1", "--format=%B")
}

describe("skip-cd: the path list", () => {
  it("treats root docs/, tickets/ and the root markdown as non-deployable", () => {
    for (const p of ["docs/02-data-model.md", "tickets/closed/0214-x.md", "tickets/index.json", "CLAUDE.md", "README.md"])
      expect(isNonDeployable(p)).toBe(true)
  })
  it("treats app code — including lib/tickets/ and nested markdown — as deployable", () => {
    for (const p of ["lib/tickets/github.ts", "app/page.tsx", "amplify.yml", "package.json", "src/pipeline/__fixtures__/README.md", "scripts/skip-cd.mjs"])
      expect(isNonDeployable(p)).toBe(false)
  })
  it("never skips an empty change set — an empty commit is how a rebuild is forced", () => {
    expect(shouldSkip([])).toBe(false)
  })
  it("tags the subject line and leaves trailers last", () => {
    expect(tagMessage("a\n\nCo-Authored-By: x")).toBe(`a ${TAG}\n\nCo-Authored-By: x`)
    expect(tagMessage(`a ${TAG}\n`)).toBe(`a ${TAG}\n`)
  })
})

describe("skip-cd: the commit-msg hook in a real repository", () => {
  it("tags a docs-only commit", () => {
    const work = repo()
    expect(commit(work, { "docs/a.md": "x" })).toContain(`subject ${TAG}\n`)
  })
  it("tags a tickets-only commit and keeps the trailer as the last paragraph", () => {
    const work = repo()
    const msg = commit(work, { "tickets/closed/0001-x.md": "x" })
    expect(msg.trimEnd().endsWith("Co-Authored-By: x <x@example.com>")).toBe(true)
  })
  it("does not tag a code commit", () => {
    const work = repo()
    expect(commit(work, { "app/page.tsx": "x" })).not.toContain(TAG)
  })
  it("does not tag a docs commit sitting on an UNPUSHED code commit", () => {
    const work = repo()
    commit(work, { "lib/x.ts": "x" })
    expect(commit(work, { "docs/a.md": "x" })).not.toContain(TAG)
  })
  it("tags a docs commit once the code under it has been pushed", () => {
    const work = repo()
    commit(work, { "lib/x.ts": "x" })
    git(work, "push", "-q")
    expect(commit(work, { "docs/a.md": "x" })).toContain(TAG)
  })
  it("does not tag a rename out of app code into docs/", () => {
    const work = repo()
    commit(work, { "lib/moved.ts": "x" })
    git(work, "push", "-q")
    mkdirSync(join(work, "docs"))
    git(work, "mv", "lib/moved.ts", "docs/moved.ts")
    git(work, "commit", "-q", "-m", "move")
    expect(git(work, "log", "-1", "--format=%B")).not.toContain(TAG)
  })
  it("defuses a hand-typed token on a code commit — 0214's own commit skipped its deploy this way", () => {
    const work = repo()
    const msg = commit(work, { "scripts/x.mjs": "x" }, `0214: tag commits ${TAG} so Amplify skips them`)
    expect(msg).not.toContain(TAG)
    expect(msg).toContain("tag commits skip-cd so")
  })
  it("keeps a hand-typed token on a docs-only commit, without doubling it", () => {
    const work = repo()
    const msg = commit(work, { "docs/a.md": "x" }, `docs ${TAG}`)
    expect(msg.split(TAG).length - 1).toBe(1)
  })
  it("defuses a hand-typed token when it cannot decide (no upstream)", () => {
    const work = repo({ upstream: false })
    expect(commit(work, { "docs/a.md": "x" }, `docs ${TAG}`)).not.toContain(TAG)
  })
  it("fails open with no upstream", () => {
    const work = repo({ upstream: false })
    expect(commit(work, { "docs/a.md": "x" })).not.toContain(TAG)
  })
})
