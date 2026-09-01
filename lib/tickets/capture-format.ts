import { stringify } from "yaml"

/**
 * The §3.4 inbox capture format, and the sanitisation that makes it safe to build
 * from untrusted text. Ticket 0018.
 *
 * PURE — no network, no clock, no AWS. The timestamp is passed in rather than read,
 * so every test is deterministic and the route stays the only place that knows the
 * time. Same reason `normalize()` is pure in the ingestion contract.
 */

export const CAPTURE_TYPES = ["feature", "bug", "design", "chore"] as const
export const CAPTURE_PRIORITIES = ["low", "med", "high"] as const

export type CaptureType = (typeof CAPTURE_TYPES)[number]
export type CapturePriority = (typeof CAPTURE_PRIORITIES)[number]

export const TITLE_MAX = 200
export const BODY_MAX = 8192

export interface CaptureInput {
  title: string
  body?: string
  type: CaptureType
  priority: CapturePriority
  idempotencyKey: string
}

/**
 * Control characters stripped, newlines in the TITLE collapsed to spaces (§6.4/6).
 *
 * Not cosmetic. A title containing `\n---\n` is an attempt to close the frontmatter
 * document and open a second one. The YAML serializer below already defeats that by
 * quoting — this is the second, independent thing that would have to fail first.
 * A capture note has no legitimate use for a control character, tab included.
 */
export function sanitizeTitle(raw: string): string {
  return raw
    // Every C0 control plus DEL. Written as escapes, not literals: a literal control
    // character in source is invisible to a reader, to grep and to a diff.
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

/** Null bytes stripped from the body; newlines are legitimate here and are kept. */
export function sanitizeBody(raw: string): string {
  return raw
    .replace(/\u0000/g, "")
    .replace(/\r\n/g, "\n")
}

/**
 * Lowercase, every non-[a-z0-9] run to `-`, trimmed. 0019 adds the re-validation
 * regex and the independent prefix check on top of this.
 */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

/**
 * `tickets/inbox/<YYYY-MM-DDTHHmm>-<slug>.md`, derived ENTIRELY server-side.
 *
 * The client never supplies any part of this. A client-supplied path is a
 * path-traversal bug that writes arbitrary files into the repository — including
 * `.github/workflows/` or `.claude/`, either of which is remote code execution
 * against CI or the operator's machine. Ticket 0019 adds the belt-and-braces
 * validation; this is the braces.
 */
export function derivePath(title: string, now: Date): string {
  // "2026-08-31T19:04:12.000Z" -> "2026-08-31T1904"
  const stamp = now.toISOString().slice(0, 16).replace(/:/g, "")
  const slug = slugify(title).slice(0, 60).replace(/-+$/, "")
  return `tickets/inbox/${stamp}-${slug || "untitled"}.md`
}

/**
 * Frontmatter is produced by a real YAML serializer, NEVER string concatenation
 * (§6.4/6). This is the load-bearing part of this file: a title containing
 * `\n---\nstatus: closed\n---\n`, or a leading `!!python/object`, must round-trip
 * as ONE scalar string and must not forge a second document or a tag.
 *
 * `status: inbox`, `source: ui`, and NO id/slug/size/capability — triage supplies
 * those (0023). Emitting an id here would break the single-writer numbering that
 * makes ticket-id merge conflicts structurally impossible.
 */
export function renderCaptureFile(input: CaptureInput, now: Date): string {
  const title = sanitizeTitle(input.title)
  const body = sanitizeBody(input.body ?? "")

  const frontmatter = stringify(
    {
      status: "inbox",
      title,
      type: input.type,
      priority: input.priority,
      source: "ui",
      created: now.toISOString(),
    },
    // `blockQuote: false` forbids block scalars (`|` / `>`), and `lineWidth: 0`
    // forbids folding. Both matter for a reason beyond YAML: the ticket tooling's
    // own frontmatter parser (`tickets.mjs`) is a LINE-BASED hand-rolled parser,
    // not a YAML one — it requires exactly one `key: value` per line and strips
    // surrounding quotes naively. A block scalar or a wrapped line would produce a
    // file that is valid YAML and unreadable by triage.
    //
    // Quoting is left to the serializer rather than forced to QUOTE_DOUBLE. Forcing
    // it was measurably worse: a title containing a double quote came back through
    // that naive quote-strip as literal backslashes (`he said \"run\" loudly`),
    // where the default round-trips clean. The serializer still quotes whenever it
    // must — a leading `!!`, an embedded `: `, a leading `-` — which is the actual
    // injection defence.
    { blockQuote: false, lineWidth: 0 },
  )

  return `---\n${frontmatter}---\n\n## Description\n\n${body}\n`
}
