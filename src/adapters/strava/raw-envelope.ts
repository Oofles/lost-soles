import { parseWithExactIds } from "./json-ids"

/**
 * THE RAW ARCHIVE ENVELOPE. Ticket 0035.
 *
 * `fetchRaw` makes TWO calls — the activity detail and the streams — and the contract
 * gives it ONE `{ body, contentType, ext }` to return. This module is how two responses
 * become one archivable object without either of them being modified.
 *
 * ─── WHY ONE OBJECT AND NOT THREE ───────────────────────────────────────────
 *
 * The design disagrees with itself, and this is the first ticket where that bites.
 *
 *   `03-integrations.md` §3.2 lays out THREE objects per activity — `manifest.json`,
 *   `summary.json`, `streams.json` — under `raw/v1/user=…/source=…/date=…/<id>/r<rev>/`.
 *
 *   `contracts/ingestion-contract.md` §2 and `src/domain/activity.ts` describe ONE:
 *   `RawArchiveRef` carries a single `key`, a single `sha256`, a single `contentType`,
 *   and `NormalizedIngest.raw` is one ref or null. Ticket 0039, which actually builds the
 *   archive, restates that layout exactly.
 *
 * D-140 settles it: where 01 or 03 disagree with the contract, the contract wins. §3.2's
 * layout is the older design the reconciliation superseded, and nobody noticed because no
 * ticket had built it. Recorded as a divergence in the ticket, not resolved silently.
 *
 * ─── WHY THIS IS NOT A TRANSFORMATION ───────────────────────────────────────
 *
 * §3.1 rule 2 is absolute: *"Archive byte-for-byte, unmodified. No reformatting, no
 * pretty-printing, no key reordering, no stripping of fields we currently ignore."*
 *
 * So the envelope is built by CONCATENATING BUFFERS, never by parsing and re-serialising.
 * Each response's bytes appear contiguously and unchanged inside the result — the same
 * order, the same whitespace, the same key order, the same digits. An int64 id in the
 * archive is the int64 id Strava sent, because nothing ever turned it into a number.
 *
 * The consequence worth stating: if Strava returns malformed JSON, the envelope is
 * malformed JSON too. That is correct. The archive's job is to hold what arrived, and a
 * wrapper that "fixed" a bad payload would destroy the only evidence of what went wrong.
 */

/** Bumped only if the envelope's own shape changes. Never for a change in Strava's. */
const SCHEMA_VERSION = 1

const PREFIX = Buffer.from(`{"schemaVersion":${SCHEMA_VERSION},"source":"strava","detail":`)
const MIDDLE = Buffer.from(`,"streams":`)
const SUFFIX = Buffer.from("}")
const NULL_BYTES = Buffer.from("null")

/**
 * Wraps the two verbatim responses.
 *
 * `streams` is `null` for an activity with no GPS — either because `hasGpsHint` said not
 * to ask, or because Strava answered 404, which for this endpoint means "no streams" and
 * not "error" (§2.5). A null is a FACT worth archiving: it distinguishes "we looked and
 * there is no trace" from "we never looked", and those need different treatment on a
 * replay from the archive.
 */
export function sealRawEnvelope(detail: Buffer, streams: Buffer | null): Buffer {
  return Buffer.concat([PREFIX, detail, MIDDLE, streams ?? NULL_BYTES, SUFFIX])
}

export interface OpenedEnvelope {
  schemaVersion: number
  detail: unknown
  /** `null` when the activity has no trace. */
  streams: unknown
}

/**
 * Reads an archived envelope back. `normalize` (ticket 0036) is the caller.
 *
 * Uses `parseWithExactIds`, so the int64 ids the concatenation preserved survive being
 * read as well as being written. A plain `JSON.parse` here would undo the entire point of
 * the care taken above — the bytes would be right in S3 and wrong in memory.
 */
export function openRawEnvelope(body: Buffer): OpenedEnvelope {
  const parsed = parseWithExactIds(body.toString("utf8")) as Record<string, unknown>

  if (typeof parsed?.schemaVersion !== "number") {
    throw new Error("Archived payload is not a Lost Soles raw envelope")
  }

  return {
    schemaVersion: parsed.schemaVersion,
    detail: parsed.detail,
    streams: parsed.streams ?? null,
  }
}

/**
 * ONE STREAM, as Strava's `key_by_type=true` response holds it.
 *
 * `resolution` and `series_type` live HERE, on the response — they are metadata, not the
 * request parameters that every blog post and half the client libraries still describe.
 * See the call site in `adapter.ts` for the full trap.
 */
export interface StravaStream {
  data?: unknown[]
  original_size?: number
  resolution?: string
  series_type?: string
}

export class StreamAlignmentError extends Error {
  readonly lengths: Record<string, number>

  constructor(message: string, lengths: Record<string, number>) {
    super(message)
    this.name = "StreamAlignmentError"
    this.lengths = lengths
  }
}

/**
 * ASSERTS THE STREAMS ARE INDEX-ALIGNED AND EQUAL LENGTH, before anything zips them.
 *
 * §2.4: *"All streams for an activity are index-aligned and equal length — element i of
 * `latlng` corresponds to element i of `time` and `altitude`."* Zipping is what makes that
 * assumption load-bearing, and the failure if it is ever false is silent: `Array.prototype`
 * iteration over the shortest stops early, so a trace would simply END partway through the
 * run, and the fog would stop where the array did. On a map that never re-fogs, ground the
 * user covered would be permanently unrevealed with nothing to indicate why.
 *
 * WHY THIS DOES NOT RUN INSIDE `fetchRaw`, which is where the ticket's criterion put it.
 * §3.1 rule 1 says archive BEFORE the parser is trusted, and rule 5 says never delete on
 * ingest failure. A `fetchRaw` that threw on a malformed stream would destroy the very
 * evidence it exists to preserve — the response would never reach S3 and nobody could ever
 * look at what Strava actually sent. So the check ships here, pure and exported, and
 * `normalize` calls it after the archive PUT. The raising still happens; it happens one
 * phase later, where it costs a replay instead of the payload.
 *
 * CHECKS EVERY STREAM PRESENT, not the three that were requested. Verified against the
 * live API: asking for `latlng,time,altitude` returns FOUR streams — Strava adds
 * `distance` unprompted. A checker that only looked at the requested keys would miss a
 * misaligned stream that a later ticket starts reading.
 */
export function assertStreamsAligned(streams: unknown): void {
  if (streams === null || typeof streams !== "object" || Array.isArray(streams)) {
    throw new StreamAlignmentError("Streams payload is not a key_by_type object", {})
  }

  const lengths: Record<string, number> = {}

  for (const [name, stream] of Object.entries(streams as Record<string, StravaStream>)) {
    const data = stream?.data
    if (!Array.isArray(data)) {
      throw new StreamAlignmentError(`Stream "${name}" carries no data array`, lengths)
    }
    lengths[name] = data.length
  }

  const distinct = new Set(Object.values(lengths))
  if (distinct.size > 1) {
    throw new StreamAlignmentError(
      `Strava's streams are not index-aligned: ${JSON.stringify(lengths)}`,
      lengths,
    )
  }
}

/**
 * The upload id, preferring the string form.
 *
 * §2.7: *"`upload_id` is an int64 that exceeds `Number.MAX_SAFE_INTEGER` [...] Use
 * `upload_id_str` where Strava provides it."* Confirmed present and a string on a live
 * detail response.
 *
 * `upload_id_str` is preferred even though `parseWithExactIds` already keeps `upload_id`
 * exact, and the redundancy is deliberate: the string field is what the provider
 * guarantees, the parser is what this codebase guarantees, and a value this hard to notice
 * being wrong deserves both.
 */
export function uploadIdOf(detail: unknown): string | null {
  if (detail === null || typeof detail !== "object") return null
  const record = detail as Record<string, unknown>

  const asString = record.upload_id_str
  if (typeof asString === "string" && /^\d+$/.test(asString)) return asString

  // `parseWithExactIds` has already made this a string if it was a number.
  const parsed = record.upload_id
  if (typeof parsed === "string" && /^\d+$/.test(parsed)) return parsed

  return null
}
