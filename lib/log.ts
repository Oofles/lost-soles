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
          return JSON.stringify(p)
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
