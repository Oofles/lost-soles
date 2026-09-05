import { describe, expect, it } from "vitest"

import {
  assertStreamsAligned,
  openRawEnvelope,
  sealRawEnvelope,
  StreamAlignmentError,
  uploadIdOf,
} from "./raw-envelope"

/**
 * Ticket 0035, criteria 6, 8 and 9.
 *
 * The property under test throughout is that NOTHING TOUCHES THE BYTES. D-101 makes the
 * raw archive the system of record and §3.1 rule 2 is absolute about it — "no
 * reformatting, no pretty-printing, no key reordering, no stripping of fields we currently
 * ignore" — because the whole value is that a future adapter finds something in there we
 * did not know we needed.
 */

/** Deliberately ugly: odd whitespace, an unsorted key order, an int64 id. */
const DETAIL = Buffer.from(
  '{  "id":12345678901234567890,\n  "name":"Evening Run",   "sport_type":"Run",\t"upload_id_str":"98765432109876543210"}',
)
const STREAMS = Buffer.from(
  '{"latlng":{"data":[[51.5,-0.12],[51.6,-0.13]],"original_size":2,"resolution":"high"},' +
    '"time":{"data":[0,2],"original_size":2,"resolution":"high"}}',
)

describe("criterion 8 — the archived bytes are unmodified", () => {
  const sealed = sealRawEnvelope(DETAIL, STREAMS)

  it("contains each response contiguously, byte for byte", () => {
    // The strongest form of the assertion available: the original buffers appear as
    // uninterrupted subsequences of the result. Any reformatting anywhere breaks this.
    expect(sealed.includes(DETAIL)).toBe(true)
    expect(sealed.includes(STREAMS)).toBe(true)
  })

  it("preserves the ugly whitespace and the original key order", () => {
    const text = sealed.toString("utf8")
    expect(text).toContain('{  "id":')
    expect(text).toContain('"name":"Evening Run",   "sport_type"')
    expect(text).toContain('\t"upload_id_str"')
  })

  it("leaves an int64 id as digits, never as a number that was rounded", () => {
    // Concatenation cannot corrupt it, because concatenation never parsed it. This is the
    // difference between the envelope and any implementation that parsed and re-serialised.
    expect(sealed.toString("utf8")).toContain("12345678901234567890")
  })

  it("is itself valid JSON, so the archive can be read without a custom scanner", () => {
    expect(() => JSON.parse(sealed.toString("utf8"))).not.toThrow()
  })

  it("records a null streams payload as a FACT, not as an absence", () => {
    /**
     * "We looked and there is no trace" and "we never looked" need different treatment on a
     * replay from the archive. Omitting the key would conflate them.
     */
    const opened = openRawEnvelope(sealRawEnvelope(DETAIL, null))
    expect(opened.streams).toBeNull()
    expect(opened.detail).toMatchObject({ sport_type: "Run" })
  })

  it("stays malformed when Strava's payload was malformed", () => {
    /**
     * Deliberate. The archive's job is to hold what arrived; a wrapper that repaired a bad
     * payload would destroy the only evidence of what went wrong (§3.1 rule 5 — never
     * delete on ingest failure; replay later).
     */
    const broken = Buffer.from('{"id":1,')
    const sealedBroken = sealRawEnvelope(broken, null)
    expect(sealedBroken.includes(broken)).toBe(true)
    expect(() => JSON.parse(sealedBroken.toString("utf8"))).toThrow()
  })
})

describe("reading an envelope back", () => {
  it("keeps ids exact on the way OUT as well as in", () => {
    // Bytes right in S3 and wrong in memory would undo the whole point, so the reader uses
    // `parseWithExactIds` rather than `JSON.parse`.
    const opened = openRawEnvelope(sealRawEnvelope(DETAIL, STREAMS))
    expect((opened.detail as { id: string }).id).toBe("12345678901234567890")
  })

  it("round-trips the streams unchanged", () => {
    const opened = openRawEnvelope(sealRawEnvelope(DETAIL, STREAMS))
    expect(opened.streams).toEqual(JSON.parse(STREAMS.toString("utf8")))
  })

  it("refuses a payload that is not one of ours", () => {
    expect(() => openRawEnvelope(Buffer.from('{"latlng":{}}'))).toThrow(/not a Lost Soles raw envelope/)
  })
})

/** Criterion 6. */
describe("stream alignment", () => {
  const stream = (n: number) => ({ data: Array.from({ length: n }, (_, i) => i) })

  it("accepts equal-length streams", () => {
    expect(() => assertStreamsAligned({ latlng: stream(3), time: stream(3) })).not.toThrow()
  })

  it("raises on a mismatch rather than letting a zip truncate silently", () => {
    /**
     * THE FAILURE THIS PREVENTS IS INVISIBLE. Zipping stops at the shortest array, so a
     * trace would simply END partway through the run — and the fog would stop where the
     * array did, with nothing to indicate why. On a map that never re-fogs, ground the user
     * actually covered stays permanently dark.
     */
    expect(() => assertStreamsAligned({ latlng: stream(1339), time: stream(1200) })).toThrow(
      StreamAlignmentError,
    )
  })

  it("names the lengths, so the report says which stream is short", () => {
    try {
      assertStreamsAligned({ latlng: stream(1339), time: stream(1200) })
      expect.unreachable()
    } catch (err) {
      expect((err as StreamAlignmentError).lengths).toEqual({ latlng: 1339, time: 1200 })
    }
  })

  it("checks EVERY stream present, not just the three that were requested", () => {
    /**
     * Verified live: asking for `latlng,time,altitude` returns FOUR streams — Strava adds
     * `distance` unprompted, which §2.4's example response does not show. A checker that
     * only looked at the requested keys would pass a misaligned `distance` straight through
     * to whichever later ticket starts reading it.
     */
    expect(() =>
      assertStreamsAligned({
        latlng: stream(1339),
        time: stream(1339),
        altitude: stream(1339),
        distance: stream(900),
      }),
    ).toThrow(/not index-aligned/)
  })

  it("raises on a stream carrying no data array", () => {
    expect(() => assertStreamsAligned({ latlng: { original_size: 5 } })).toThrow(/no data array/)
  })

  it("raises on a bare array, which is what key_by_type=false would have returned", () => {
    expect(() => assertStreamsAligned([{ type: "latlng", data: [] }])).toThrow(/key_by_type/)
  })

  it("accepts an empty object — no streams is not a misalignment", () => {
    expect(() => assertStreamsAligned({})).not.toThrow()
  })
})

/** Criterion 9. */
describe("the upload id", () => {
  it("prefers upload_id_str, the form the provider guarantees", () => {
    expect(uploadIdOf({ upload_id_str: "98765432109876543210", upload_id: "1" })).toBe(
      "98765432109876543210",
    )
  })

  it("falls back to upload_id, which the parser has already made an exact string", () => {
    expect(uploadIdOf({ upload_id: "15134912345" })).toBe("15134912345")
  })

  it("returns null rather than a guess when neither is usable", () => {
    expect(uploadIdOf({})).toBeNull()
    expect(uploadIdOf({ upload_id_str: null })).toBeNull()
    expect(uploadIdOf(null)).toBeNull()
  })
})
