/**
 * Ticket 0230 (and 0283). Every test file gets its own private temp directory, and it is
 * removed when the file finishes, pass or fail.
 *
 * WHY. Each `amplify/*.test.ts` suite that calls `Template.fromStack` makes the CDK `App`
 * synthesise into a fresh `mkdtemp(os.tmpdir() + "/cdk.out")` of 30-50 MB that nothing
 * removes. On a 16 GB tmpfs that fills `/tmp` after ~50 full runs, and the failure reads as
 * an Amplify construct error, not a full disk. Other suites (`pre-commit-hook`, `skip-cd`,
 * `build-index`, the ticket tooling) `mkdtemp` under `os.tmpdir()` too.
 *
 * HOW. `setupFiles` (vitest-setup-tmpdir.mjs) points `TMPDIR` at a fresh directory under the
 * REAL temp dir before the test file is imported. `os.tmpdir()` reads `TMPDIR` on every call,
 * so the CDK's `cdk.out`, every suite's own `mkdtemp`, and any child process that inherits the
 * env all land inside it. An `afterAll` removes it. The synth itself is untouched: it still
 * synthesises the real `backend.ts`, it just writes somewhere that gets cleaned.
 *
 * Rejected: `CDK_OUTDIR`. Setting it makes every `App` register a `beforeExit` auto-synth
 * (aws-cdk-lib core/lib/app.js), so each worker would synthesise a second time at exit, and it
 * only covers the CDK, not the other suites' temp dirs. Rejected: a repo-local `TMPDIR`. It
 * moves the growth onto the repo's disk and into the gitignored `tmp/`, which the guard
 * scripts already trip over (ticket 0250).
 *
 * FAILED AND KILLED RUNS. A failing test still runs `afterAll`. A file that throws at module
 * scope (where every CDK suite synthesises, so where an ENOSPC lands) does not, and neither does
 * a worker killed by Ctrl-C. The directory name carries the worker's pid, and `globalSetup`
 * (vitest-global-setup.mjs) removes every one whose pid is no longer alive, both at teardown and
 * at the start of the next run. A leftover from a killed run therefore survives at most until
 * the next `vitest run`, on a tmpfs that a reboot also clears.
 */
import { mkdtempSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

export const PREFIX = "lost-soles-vitest-"

/** `lost-soles-vitest-<pid>-XXXXXX` -> pid, or null for anything else. */
export function ownerPid(name) {
  if (!name.startsWith(PREFIX)) return null
  const m = /^(\d+)-/.exec(name.slice(PREFIX.length))
  return m ? Number(m[1]) : null
}

export function isAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    // EPERM: the pid exists but belongs to someone else. Not ours to sweep.
    return err.code === "EPERM"
  }
}

/** Make this process's per-file temp dir under `root`. */
export function makeFileTmp(root, pid = process.pid) {
  return mkdtempSync(join(root, `${PREFIX}${pid}-`))
}

/** Remove per-file temp dirs under `root` left by processes that no longer exist. */
export function sweepStale(root, alive = isAlive) {
  const removed = []
  for (const name of readdirSync(root)) {
    const pid = ownerPid(name)
    if (pid === null || alive(pid)) continue
    rmSync(join(root, name), { recursive: true, force: true })
    removed.push(name)
  }
  return removed
}

/** Names of `cdk.out*` entries directly under `root`. */
export function cdkOutDirs(root) {
  return readdirSync(root).filter((n) => n.startsWith("cdk.out"))
}

/** The real temp dir, read before any setup file rewrites `TMPDIR`. */
export const REAL_TMPDIR = process.env.LOST_SOLES_REAL_TMPDIR ?? tmpdir()
