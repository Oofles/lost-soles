#!/usr/bin/env node
/**
 * Ticket 0214. Tags a commit `[skip-cd]` — which Amplify Hosting reads as "do not
 * build this push" — when nothing about to be pushed can change what is deployed.
 *
 * Every push to `main` ran a ~9.5-minute Amplify build, and D-150's close is two or
 * three pushes, most of them touching only `tickets/` or `docs/`. Build minutes were
 * 88% of the bill (0214). Amplify has no path filter, and an `amplify.yml` cannot
 * end a build early as a success, so the decision is made here, at commit time.
 *
 * WHY THE WHOLE UNPUSHED RANGE, NOT JUST THIS COMMIT. Amplify builds the head of a
 * push and reads only the head's message. A code commit followed by a docs commit,
 * pushed together, would otherwise skip the build and leave the code undeployed.
 * So the docs commit is tagged only if every commit since `@{u}` is docs-only too.
 *
 * FAILS OPEN. No upstream, a git error, an empty commit (the usual way to force a
 * rebuild), any path not on the list below: the message is left alone and the
 * push builds. A wrongly-skipped build is the expensive mistake; a wasted one
 * costs ten cents.
 *
 * Residual: if a code push's BUILD fails and the next push is docs-only, that push
 * is skipped and the code stays undeployed until the next code push. In practice a
 * failed build is always followed by the code fix that makes it pass.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"

export const TAG = "[skip-cd]"

/**
 * Paths that provably cannot change the build output. Nothing in app/, lib/, src/,
 * components/, amplify/ or next.config.ts reads them (checked by grep at 0214).
 * Anchored at the repo root on purpose: `lib/tickets/` is app code.
 *
 * Note the Amplify build's `npm test` DOES read docs/ (e.g. decisions-register,
 * build-index). A docs-only push that breaks one of those tests is caught by the
 * GitHub gate on that push, and by Amplify on the next code push — the deployed
 * output it would have rebuilt is unchanged either way.
 */
const NON_DEPLOYABLE = [/^docs\//, /^tickets\//, /^prompts\//, /^\.claude\//, /^\.github\//, /^README\.md$/, /^CLAUDE\.md$/]

export function isNonDeployable(path) {
  return NON_DEPLOYABLE.some((re) => re.test(path))
}

/** True only when there is at least one path and every path is non-deployable. */
export function shouldSkip(paths) {
  return paths.length > 0 && paths.every(isNonDeployable)
}

export function tagMessage(message) {
  if (message.includes(TAG)) return message
  // On the subject line: the body ends in trailers (Co-Authored-By), which must
  // stay the last paragraph to parse as trailers.
  const nl = message.indexOf("\n")
  return nl === -1 ? `${message.trimEnd()} ${TAG}\n` : `${message.slice(0, nl).trimEnd()} ${TAG}${message.slice(nl)}`
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
}

/** Paths this commit stages plus every path changed by the unpushed commits. Throws if it cannot tell. */
export function pendingPaths() {
  git(["rev-parse", "--verify", "@{u}"]) // no upstream → throw → fail open
  const lines = (s) => s.split("\n").filter(Boolean)
  // --no-renames: a rename app/x.ts → docs/x.ts must show both sides, not just docs/.
  const staged = lines(git(["diff", "--cached", "--name-only", "--no-renames"]))
  const unpushed = lines(git(["log", "--name-only", "--no-renames", "--format=", "@{u}..HEAD"]))
  return [...new Set([...staged, ...unpushed])]
}

/**
 * A token typed by hand is defused too, unless this commit could carry it anyway.
 * Amplify matches it anywhere in the message, so a subject that merely MENTIONS it
 * skips the build: 0214's own code commit did exactly that and never deployed.
 */
export function defuse(message) {
  return message.replaceAll(TAG, TAG.slice(1, -1))
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const file = process.argv[2]
  try {
    let skip = false
    try {
      skip = shouldSkip(pendingPaths())
    } catch {
      // Cannot tell → build (fail open), which also means defusing a typed token.
    }
    const message = readFileSync(file, "utf8")
    const next = skip ? tagMessage(message) : defuse(message)
    if (next !== message) writeFileSync(file, next)
  } catch {
    // Unreadable message file: leave it alone.
  }
}
