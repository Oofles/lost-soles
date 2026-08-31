import { execFileSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, copyFileSync, symlinkSync } from "node:fs"
import { join, dirname } from "node:path"
import { tmpdir } from "node:os"
import { afterEach, describe, expect, it } from "vitest"

/**
 * Ticket 0125. `.githooks/pre-commit` is the layer that makes an accidental
 * `git add .` survivable, and it is the direct remediation of O-005. Until now it
 * was the only guard in this project with no test — the one whose entire job is to
 * catch a mistake made in a hurry.
 *
 * It had in fact been broken for some time. A scripted edit replaced the FIRST
 * `exit 0` in the file, which was the `[ -z "$staged" ] && exit 0` early return.
 * That swallowed the skill-frontmatter check into the `&&` (so layer 3 ran only
 * when NOTHING was staged — exactly inverted) and left layer 2 below an
 * unconditional `exit 0` as dead code. `bash -n` passed throughout. A staged
 * `-----BEGIN RSA PRIVATE KEY-----` committed cleanly, exit 0.  gitleaks:allow
 *
 * SO THESE TESTS INVOKE THE HOOK THE WAY GIT DOES — stage a real file in a real
 * temporary repository, run the script, check the exit code — rather than
 * grepping its source. 0008's `--force` lesson: a textual test on a script whose
 * own error messages quote the patterns it searches for passes for the wrong
 * reasons. Reachability is proven by BEHAVIOUR here; the structural check at the
 * bottom is a cheap extra, not the proof.
 */

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "")
const HOOK = join(ROOT, ".githooks/pre-commit")

const tmps = []
afterEach(() => {
  while (tmps.length) rmSync(tmps.pop(), { recursive: true, force: true })
})

// `bash -c`, NOT `-lc`. A login shell sources the profile, which can REPLACE
// PATH — and in CI the node that actions/setup-node put on PATH would vanish,
// so `which("node")` would come back empty and the hook's layer-3 check would be
// skipped for an entirely environmental reason. `-c` inherits this process's PATH.
const which = (bin) => execFileSync("/usr/bin/env", ["bash", "-c", `command -v ${bin} || true`]).toString().trim()

/**
 * Resolved once, and used as an ABSOLUTE path below. The hook is run with a
 * deliberately stripped PATH, so `execFileSync("bash", ...)` would resolve bash
 * against that same stripped PATH and fail to spawn at all — the process dies
 * with status null before the hook runs a single line, and every assertion then
 * fails for a reason that has nothing to do with the hook.
 */
const BASH = which("bash") || "/bin/bash"

/**
 * A PATH containing ONLY what the hook needs, so `gitleaks` presence is something
 * the test controls rather than something the machine happens to decide. Without
 * this, "fails closed when gitleaks is missing" is untestable on a developer
 * laptop and "layer 2 blocks" is untestable in CI, where gitleaks is not
 * installed — and a suite that skips its own layers is the failure this ticket
 * is about.
 */
function makeBin(gitleaks) {
  const dir = mkdtempSync(join(tmpdir(), "hookbin-"))
  tmps.push(dir)
  // Everything the hook shells out to. `gitleaks` is deliberately NOT here — its
  // presence is the variable each test controls.
  for (const bin of ["bash", "env", "git", "grep", "node", "sed", "cat"]) {
    const p = which(bin)
    if (p) symlinkSync(p, join(dir, bin))
  }
  if (gitleaks === "pass" || gitleaks === "block") {
    // A stub, so layers 2 and 3 are testable without the real binary, and layer
    // 1's actual contract — "honour whatever gitleaks returns" — is testable at all.
    writeFileSync(join(dir, "gitleaks"), `#!/usr/bin/env bash\nexit ${gitleaks === "block" ? 1 : 0}\n`)
    execFileSync("chmod", ["+x", join(dir, "gitleaks")])
  } else if (gitleaks === "real") {
    const p = which("gitleaks")
    if (!p) return null
    symlinkSync(p, join(dir, "gitleaks"))
  }
  // gitleaks === "absent": simply never linked.
  return dir
}

/** Stage `files` in a fresh repo and run the hook exactly as git would. */
function runHook(files, { gitleaks = "pass", withSkillChecker = false } = {}) {
  const repo = mkdtempSync(join(tmpdir(), "hookrepo-"))
  tmps.push(repo)
  const bin = makeBin(gitleaks)
  if (!bin) return null

  execFileSync("git", ["init", "-q", "."], { cwd: repo })
  for (const [rel, body] of Object.entries(files)) {
    const full = join(repo, rel)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, body)
  }
  if (withSkillChecker) {
    mkdirSync(join(repo, "scripts"), { recursive: true })
    // The hook guards on `[ -f scripts/check-skills.mjs ]`, relative to the repo
    // root. The real script resolves its scan root relative to its own location,
    // so a copy here scans the temp repo's .claude/skills.
    copyFileSync(join(ROOT, "scripts/check-skills.mjs"), join(repo, "scripts/check-skills.mjs"))
  }
  execFileSync("git", ["add", "-A"], { cwd: repo })

  try {
    const stdout = execFileSync(BASH, [HOOK], {
      cwd: repo,
      env: { PATH: bin, HOME: repo },
      stdio: ["ignore", "pipe", "pipe"],
    })
    return { status: 0, out: stdout.toString(), err: "" }
  } catch (e) {
    return { status: e.status, out: (e.stdout ?? "").toString(), err: (e.stderr ?? "").toString() }
  }
}

/**
 * Credential-shaped fixtures, assembled at runtime. gitleaks and GitHub push
 * protection scan committed SOURCE and are right to fire on a realistic
 * credential in a file; the hook receives the joined string either way.
 */
const fx = (...parts) => parts.join("")
const PEM = fx("-----BEGIN RSA ", "PRIVATE KEY-----")
const SLACK = fx("xoxb", "-1234567890-abcdefghij")
const AKIA = fx("AKIA", "3NPRZQ7XWFTKLMVD")
const PAT = fx("ghp", "_0123456789abcdefghijABCDEFGHIJ0123")

describe("layer 1 — gitleaks", () => {
  it("blocks when gitleaks reports a finding", () => {
    const r = runHook({ "a.txt": "anything at all\n" }, { gitleaks: "block" })
    expect(r.status).toBe(1)
    expect(r.err).toMatch(/gitleaks found a secret/)
  })

  it("FAILS CLOSED when gitleaks is not installed", () => {
    // A missing scanner is a broken guard, not an absent one. If this ever
    // returns 0, every commit on a machine without gitleaks is unscanned.
    const r = runHook({ "a.txt": "ordinary\n" }, { gitleaks: "absent" })
    expect(r.status).toBe(1)
    expect(r.err).toMatch(/gitleaks is not installed/)
  })

  const real = which("gitleaks")
  it.runIf(real)("the real gitleaks blocks a real-shaped GitHub PAT", () => {
    const r = runHook({ "a.txt": `token = "${PAT}"\n` }, { gitleaks: "real" })
    expect(r.status).toBe(1)
  })
  it.skipIf(real)("real-gitleaks case is unavailable on this machine", () => {
    // Recorded rather than silently absent: the stub tests above prove the hook
    // honours gitleaks' verdict, but not that gitleaks detects anything.
    expect(real).toBe("")
  })
})

describe("layer 2 — literal patterns", () => {
  for (const [name, value] of [["a PEM private-key header", PEM], ["a Slack token", SLACK], ["an AWS access key id", AKIA]]) {
    it(`blocks ${name}`, () => {
      const r = runHook({ "leak.py": `x = "${value}"\n` })
      expect(r.status).toBe(1)
      expect(r.err).toMatch(/matches a known credential pattern/)
      expect(r.err).toContain("leak.py")
    })
  }

  it("reports the file it found, not just that something matched", () => {
    const r = runHook({ "nested/deep/config.ts": `const k = "${AKIA}"\n` })
    expect(r.err).toContain("nested/deep/config.ts")
  })
})

describe("gitleaks:allow exempts its own line and no other", () => {
  it("permits a documented pattern carrying the marker", () => {
    const r = runHook({ "docs.md": `An AWS key looks like ${AKIA}  gitleaks:allow\n` })
    expect(r.status).toBe(0)
  })

  it("still blocks a second, unmarked leak in the same file", () => {
    // The marker is per-LINE. A file-level exemption would let one documented
    // pattern shelter a real credential three lines down.
    const r = runHook({
      "docs.md": `An AWS key looks like ${AKIA}  gitleaks:allow\nreal = "${SLACK}"\n`,
    })
    expect(r.status).toBe(1)
    expect(r.err).toContain("docs.md")
  })
})

describe("layer 3 — skill frontmatter", () => {
  const good = '---\nname: demo\ndescription: >\n  Does a thing. Subcommands: a, b\n---\n\nbody\n'
  const bad = '---\nname: demo\ndescription: Does a thing. Subcommands: a, b\n---\n\nbody\n'

  it("blocks a staged SKILL.md whose frontmatter would not parse", () => {
    const r = runHook({ ".claude/skills/demo/SKILL.md": bad }, { withSkillChecker: true })
    expect(r.status).toBe(1)
    expect(r.err).toMatch(/SKILL\.md/)
  })

  it("permits a staged SKILL.md that parses", () => {
    const r = runHook({ ".claude/skills/demo/SKILL.md": good }, { withSkillChecker: true })
    expect(r.status).toBe(0)
  })

  it("runs when files ARE staged — the inversion that caused this ticket", () => {
    // The broken hook read `[ -z "$staged" ] && if ... fi`, so this check ran
    // only when the staging area was EMPTY. A staged bad SKILL.md sailed through.
    const r = runHook(
      { ".claude/skills/demo/SKILL.md": bad, "other.txt": "unrelated\n" },
      { withSkillChecker: true },
    )
    expect(r.status).toBe(1)
  })
})

describe("negative control", () => {
  it("an ordinary file still commits", () => {
    // A hook that blocks everything is as broken as one that blocks nothing, and
    // fails less visibly — it gets bypassed with --no-verify and stays bypassed.
    const r = runHook({ "src/app.ts": "export const x = 1\n", "README.md": "# hi\n" })
    expect(r.status).toBe(0)
    expect(r.err).toBe("")
  })

  it("passes on an empty staging area", () => {
    const r = runHook({})
    expect(r.status).toBe(0)
  })
})

describe("structure — no layer can be stranded after an early exit", () => {
  const src = readFileSync(HOOK, "utf8")

  it("has exactly one top-level `exit 0`, and it is the final line", () => {
    // The specific defect: an edit landing on a bare mid-file `exit 0` orphans
    // everything below it. Cheap to assert, and it names the risk for the next
    // person editing this file.
    const lines = src.split("\n")
    const tops = lines.map((l, i) => [l, i]).filter(([l]) => /^exit 0\s*$/.test(l))
    expect(tops).toHaveLength(1)
    const lastCode = lines.map((l, i) => [l, i]).filter(([l]) => l.trim() !== "").pop()
    expect(tops[0][1]).toBe(lastCode[1])
  })

  it("is syntactically valid bash", () => {
    expect(() => execFileSync(BASH, ["-n", HOOK])).not.toThrow()
  })

  it("scans every pattern the security doc requires", () => {
    for (const p of ["AKIA", "ghp_", "github_pat_", "PRIVATE KEY", "xox"]) {
      expect(src).toContain(p)
    }
  })
})
