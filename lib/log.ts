/**
 * Logging with credential redaction. Ticket 0018, criterion 5.
 *
 * CloudWatch is a second, un-audited copy of whatever you write to it — the O-005
 * class exactly (`08-security-privacy.md` §7.4). A token that reaches a log line has
 * leaked, whether or not anyone reads it, and log retention outlives incident
 * response. So redaction lives at the log call, not at each call site: relying on
 * every future caller to remember is relying on the thing that already failed.
 *
 * This is the LAST line of defence, not the first. Nothing should be logging a
 * credential in the first place. It exists because "should" is not a control.
 */

/**
 * Credential shapes, redacted anywhere they appear in a logged value — including
 * nested inside an object or an error message, which is how they actually escape
 * (a thrown fetch error quoting a request header, say).
 *
 * Kept deliberately in step with `scripts/check-bundle-leak.mjs`'s PATTERNS: that
 * one scans build output, this one scans log output. Same shapes, two surfaces.
 */
const REDACTIONS: Array<[RegExp, string]> = [
  [/github_pat_[A-Za-z0-9_]{20,}/g, "github_pat_<redacted>"],
  [/ghp_[A-Za-z0-9]{20,}/g, "ghp_<redacted>"],
  [/gh[opsu]_[A-Za-z0-9]{20,}/g, "gh*_<redacted>"],
  [/AKIA[0-9A-Z]{16}/g, "AKIA<redacted>"],
  [/xox[baprs]-[A-Za-z0-9-]{10,}/g, "xox<redacted>"],
  [/-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/g, "<redacted private key>"],
  // Bearer tokens in a header dump, whatever their shape.
  [/(Bearer\s+)[A-Za-z0-9_\-.~+/]{16,}/gi, "$1<redacted>"],
]

export function redact(value: string): string {
  let out = value
  for (const [pattern, replacement] of REDACTIONS) out = out.replace(pattern, replacement)
  return out
}

/**
 * ─── REDACTION BY KEY NAME ───────────────────────────────────────────────────
 * Ticket 0033, criterion 4.
 *
 * THE PATTERNS ABOVE CANNOT CATCH AN OAUTH TOKEN, and that is not a gap in the list —
 * it is a property of the token. A Strava access token is a bare 40-character
 * hexadecimal string. So is a git commit id, a SHA-1, and half the opaque identifiers
 * in any system. There is no pattern that matches one and not the others, and a
 * pattern loose enough to try would redact the ids we log deliberately.
 *
 * So the second mechanism keys off the ATTRIBUTE NAME instead of the value. The name
 * is the thing that is actually reliable: an OAuth credential reaches a log line as a
 * field called `accessToken`, `refresh_token`, `client_secret` or `authorization` —
 * because it is carried in an object that came from a token response, a DynamoDB item
 * or a header bag, and every one of those names its fields.
 *
 * DELIBERATELY BROAD, and false positives here are cheap. Redacting a `tokenUrl` costs
 * a debugging session a URL that is in the source anyway. Not redacting a refresh token
 * costs a credential that lives in CloudWatch for as long as retention says, in a
 * system where T7 is the one thing that cannot be rebuilt (`02-data-model.md` §1.1).
 * The asymmetry is total, so the list is written to over-match.
 */
const SENSITIVE_KEY = /token|secret|password|passwd|credential|authorization|api[-_]?key|private[-_]?key/i

/**
 * Names that MATCH the pattern above but are not credentials, and would make a log
 * line actively misleading if blanked. Kept as an explicit short list rather than by
 * narrowing the pattern, so that adding a safe name is a deliberate act with a reason
 * next to it and not a quiet loosening of the rule.
 */
const NOT_SENSITIVE = new Set(["tokentype", "token_type", "scopesource", "scope_source"])

const REDACTED = "<redacted>"

/**
 * Walks a value and replaces anything under a credential-shaped key. Returns a NEW
 * structure — the caller's object is never mutated, because a logger that edits what
 * it is handed is a logger that changes program behaviour.
 *
 * `seen` breaks cycles, and the depth cap stops a pathological structure from turning
 * a log call into a stack overflow. Both matter because this runs on values that came
 * from a third party's JSON.
 */
function scrubKeys(value: unknown, seen: WeakSet<object>, depth = 0): unknown {
  if (depth > 8 || value === null || typeof value !== "object") return value
  if (seen.has(value as object)) return "<circular>"
  seen.add(value as object)

  if (Array.isArray(value)) return value.map((v) => scrubKeys(v, seen, depth + 1))
  // A DynamoDB string set arrives as a Set, and `JSON.stringify` renders one as `{}`.
  // Rendering it as an array is both more useful and keeps the scrub uniform.
  if (value instanceof Set) return [...value].map((v) => scrubKeys(v, seen, depth + 1))
  if (value instanceof Map) {
    return Object.fromEntries(
      [...value].map(([k, v]) => [
        String(k),
        isSensitiveKey(String(k)) ? REDACTED : scrubKeys(v, seen, depth + 1),
      ]),
    )
  }

  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = isSensitiveKey(k) ? REDACTED : scrubKeys(v, seen, depth + 1)
  }
  return out
}

function isSensitiveKey(key: string): boolean {
  return !NOT_SENSITIVE.has(key.toLowerCase()) && SENSITIVE_KEY.test(key)
}

/**
 * Serialise then redact. Serialising first matters: a token nested three levels
 * deep in an object is invisible to a string-only scrub, and `console.log(obj)`
 * would print it via the runtime's own formatter, bypassing us entirely.
 */
function render(parts: unknown[]): string {
  return redact(
    parts
      .map((p) => {
        if (typeof p === "string") return p
        if (p instanceof Error) return `${p.name}: ${p.message}`
        try {
          // Scrub by key BEFORE serialising. Afterwards the structure is gone and a
          // token is indistinguishable from any other quoted string.
          return JSON.stringify(scrubKeys(p, new WeakSet()))
        } catch {
          return String(p)
        }
      })
      .join(" "),
  )
}

export const log = {
  info: (...parts: unknown[]) => console.log(render(parts)),
  warn: (...parts: unknown[]) => console.warn(render(parts)),
  error: (...parts: unknown[]) => console.error(render(parts)),
}
