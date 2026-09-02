/**
 * The guards that stand between dictated prose from a phone and a write into the
 * source repository. Ticket 0019 — `07-ticketsmith.md` §6.4/2, §6.4/3, §6.4/5, and
 * the payload secret scan that ticket 0004 added to 0019's Notes.
 *
 * PURE. No network, no clock, no AWS, no request object. Every function here is
 * callable directly from a test with a hostile string, which is what criterion 3
 * asks for: the prefix guard must be provable in isolation, not only through the
 * route that happens to call it today.
 *
 * WHY THREE LAYERS AND NOT ONE. `derivePath` (0018) already makes the path
 * unreachable from input. `isDerivedPath` re-validates its output against an
 * anchored regex. `inboxPathViolation` then re-checks the prefix character by
 * character immediately before the API call. That is §6.4/3's "belt and braces",
 * and the reasoning is about the FUTURE, not the present: layer 2 makes traversal
 * impossible today, layer 3 makes a refactor of layer 2 fail closed tomorrow. The
 * blast radius being defended is `.github/workflows/` and `.claude/` — a write to
 * either is remote code execution against CI or the operator's machine.
 */

/** The complete set of accepted body keys (§6.4). Anything else is a 400. */
export const ALLOWED_KEYS = ["title", "body", "type", "priority", "idempotencyKey"] as const

/**
 * REJECT unknown keys, never strip them (§6.4). A future client bug then surfaces
 * as a loud 400 instead of silently dropping the half of the note it mis-spelled.
 *
 * `path` is the key this exists for, and it is worth naming: it is not a key this
 * endpoint has ever read, under this or any other name. Rejecting it is defence
 * against a client that BELIEVES it can name the path, not against a server that
 * would honour one.
 */
export function unknownKeys(raw: Record<string, unknown>): string[] {
  const allowed = new Set<string>(ALLOWED_KEYS)
  return Object.keys(raw).filter((k) => !allowed.has(k))
}

/**
 * §6.4/2. The path derived by `derivePath` must match this exactly, and anything
 * failing it is a **500, not a fallback**.
 *
 * A fallback path is the bug this is written to prevent. A title of pure emoji
 * slugifies to the empty string, and the tempting repair — substitute "untitled"
 * — means a capture whose filename no longer derives from its content, silently.
 * The design's answer is that a path the server cannot derive is a server fault,
 * surfaced, rather than a file at a name nobody chose.
 */
export const DERIVED_PATH_RE = /^tickets\/inbox\/\d{4}-\d{2}-\d{2}T\d{4}-[a-z0-9-]+\.md$/

export function isDerivedPath(path: string): boolean {
  return DERIVED_PATH_RE.test(path)
}

const INBOX_PREFIX = "tickets/inbox/"

/**
 * §6.4/3, the independent third check. Deliberately does NOT reuse
 * `DERIVED_PATH_RE` — a guard that shares its implementation with the guard it
 * backs up is one guard written twice.
 *
 * Rejects, in order: a missing prefix, `..` anywhere, a backslash, a null byte, a
 * `/` beyond the two in the prefix, and a leading `.` on the filename. Returns the
 * reason rather than a boolean so a rejection can be logged with what tripped it —
 * a guard that fires and cannot say why is D-176's problem in its quieter form.
 *
 * The null byte is written as an ESCAPE. A literal control character in source is
 * invisible to a reader, to grep and to a diff, and 0018 shipped three of them
 * before one of them made a whole test file read as binary and silently disabled
 * the pre-commit scanner over it.
 */
export function inboxPathViolation(path: string): string | null {
  if (!path.startsWith(INBOX_PREFIX)) return "does not begin tickets/inbox/"
  if (path.includes("..")) return "contains .."
  if (path.includes("\\")) return "contains a backslash"
  if (path.includes("\u0000")) return "contains a null byte"

  const rest = path.slice(INBOX_PREFIX.length)
  if (rest.length === 0) return "names no file"
  // Any `/` here is a third path segment: `tickets/inbox/a/b.md` would put the
  // write in a subdirectory this endpoint has no business creating.
  if (rest.includes("/")) return "contains a / beyond tickets/inbox/"
  if (rest.startsWith(".")) return "filename begins with a dot"

  return null
}

/**
 * §6.4/4. On a 422 from a same-minute collision, retry ONCE with a `-2` suffix.
 *
 * The suffix goes before the extension, so the result still satisfies
 * `DERIVED_PATH_RE` and is re-checked by both layers before it is sent. A retry
 * that skipped revalidation would be a hole in the shape of a convenience.
 */
export function withCollisionSuffix(path: string): string {
  return path.replace(/\.md$/, "-2.md")
}

/**
 * The five patterns from `08-security-privacy.md` §7.3, applied to the payload.
 *
 * WHY THIS EXISTS HERE AT ALL (ticket 0004, recorded in 0019's Notes). Every other
 * write to this repository passes `.githooks/pre-commit`. This one does not: it
 * commits through the GitHub API from a Lambda, so the hook never runs. GitHub's
 * push protection would have been the layer that caught a secret arriving this
 * way, and it is unavailable — it needs Advanced Security, which a private
 * personal repo does not have. Without this function there is NO scanner on this
 * path.
 *
 * Reject rather than commit-then-clean. A secret committed and later removed is
 * still in history, and history is what an attacker clones.
 *
 * Kept in step with the hook's PATTERNS and with `lib/log.ts`'s REDACTIONS — three
 * surfaces, one set of shapes. The threat is mundane and real: dictating something
 * read off a screen, or pasting an error message that quotes a token. Nobody
 * re-reads what they dictated at mile six.
 */
const SECRET_PATTERNS: Array<[string, RegExp]> = [
  ["an AWS access key id", /AKIA[0-9A-Z]{16}/],
  ["a GitHub token", /ghp_[A-Za-z0-9]{36}/],
  ["a GitHub fine-grained token", /github_pat_[A-Za-z0-9_]{20,}/],
  ["a private key block", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["a Slack token", /xox[baprs]-[A-Za-z0-9-]+/],
]

/**
 * Returns a human description of what matched, or null. The description names the
 * SHAPE, never the value — a 400 body that echoed the matched text would put the
 * secret into the client's logs, its retry queue, and possibly a screenshot.
 */
export function secretInPayload(...texts: Array<string | undefined>): string | null {
  for (const text of texts) {
    if (!text) continue
    for (const [label, pattern] of SECRET_PATTERNS) {
      if (pattern.test(text)) return label
    }
  }
  return null
}
