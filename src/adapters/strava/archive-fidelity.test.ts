import { createHash } from "node:crypto"

import { PutObjectCommand } from "@aws-sdk/client-s3"
import { describe, expect, it } from "vitest"

import type { IngestJob } from "@/src/adapters/types"
import type { NormalizedIngest, RawArchiveRef } from "@/src/domain/activity"
import { type ArchiveS3 } from "@/src/pipeline/archive"
import { fetchArchiveNormalize } from "@/src/pipeline/fetch-archive-normalize"

import { stravaAdapter, type StravaCreds } from "./adapter"
import { RAW_ENVELOPE_SCHEMA_HINT } from "./raw-envelope"

/**
 * TICKET 0039, criterion 3 — the archived bytes are byte-identical to what the
 * adapter's fetch returned.
 *
 * ─── WHY THIS TEST LIVES HERE AND NOT IN `src/pipeline` ─────────────────────
 *
 * The pipeline's own tests cannot name a source. `check-boundaries.mjs` treats
 * `src/pipeline` as source-agnostic down to the prose in its comments (D-100,
 * `01-architecture.md` §3 T1), so they run against a neutral fixture — which proves
 * the archive does not touch bytes, but not that these particular bytes are the ones
 * the real adapter produced.
 *
 * That gap matters, because the failure this criterion guards against is not in
 * `archive.ts` at all. It is a `JSON.parse`/`JSON.stringify` creeping in ANYWHERE on
 * the path from the wire to the PUT — and the damage is silent and permanent: an
 * int64 activity id rounded past 2^53 (§2.7), a `latlng` array re-encoded at a
 * different precision. The archive would look fine, parse fine, and hold different
 * numbers from the ones Strava sent, on a map that never re-fogs (D-020).
 *
 * So this test runs the REAL adapter against a stubbed transport and compares the
 * bytes that reach S3 against the bytes the transport handed out. Nothing here is
 * mocked except the network and S3.
 */

const USER = "b3f1c2d4-0000-4000-8000-000000000001"
const NOW = new Date("2026-09-10T12:00:00.000Z")

/**
 * DELIBERATELY HOSTILE JSON, written as a string rather than built with
 * `JSON.stringify` — a stringified object could not carry any of this.
 *
 * `id` and `upload_id` are past 2^53, so `JSON.parse` alone corrupts them. The
 * whitespace is irregular and the non-ASCII is escaped. Every one of these is
 * something a round trip through parse-and-re-encode would quietly normalise, which
 * is exactly what makes them the assertion.
 */
const DETAIL_BODY = `{"resource_state":3,\t"id": 18736594040123457,
  "upload_id":20014448765123457, "external_id":"garmin_push_9\\u2011a",
   "name": "Abendlauf \\u2014 K\\u00f6ln", "sport_type":"Run","type":"Run",
"distance":3310.4,"elapsed_time":1380,"moving_time":1350,
 "start_date":"2026-06-01T00:53:48Z","start_date_local":"2026-05-31T20:53:48Z",
\t"timezone":"(GMT-04:00) America/New_York","utc_offset":-14400,
  "manual":false,"trainer":false,"total_elevation_gain":2.9}`

const STREAMS_BODY = `{"latlng":{"data":[[-48.876000,-123.393000],[-48.876010,-123.393000]],
 "original_size":2,\t"resolution":"high","series_type":"distance"},
"time":{"data":[0,1],"original_size":2,"resolution":"high"},
"altitude":{"data":[12.40,12.40],"original_size":2,"resolution":"high"}}`

const JOB: IngestJob = {
  ingestKey: "k",
  userId: USER,
  source: "strava",
  externalId: "18736594040123457",
  command: "ingest",
  startedAt: "2026-06-01T00:53:48.000Z",
  meta: {
    aspectType: "create",
    hasGpsHint: true,
    sportType: "Run",
  },
  enqueuedAt: NOW.toISOString(),
}

/** Hands out the two bodies above and keeps the exact bytes it served. */
function transport(): { creds: StravaCreds; served: Buffer[] } {
  const bodies = [DETAIL_BODY, STREAMS_BODY]
  const served: Buffer[] = []
  const creds: StravaCreds = {
    accessToken: async () => "access-v1",
    markNeedsReauth: async () => {},
    now: () => NOW,
    fetch: (async () => {
      const body = bodies.shift() ?? "{}"
      served.push(Buffer.from(body, "utf8"))
      return new Response(body, { status: 200 })
    }) as unknown as typeof fetch,
  }
  return { creds, served }
}

function stubS3(): { s3: ArchiveS3; puts: PutObjectCommand[] } {
  const puts: PutObjectCommand[] = []
  const s3 = {
    async send(command: PutObjectCommand) {
      if (command instanceof PutObjectCommand) puts.push(command)
      return {}
    },
  } as ArchiveS3
  return { s3, puts }
}

describe("what reaches S3 is what Strava sent", () => {
  it("contains each response's bytes contiguously and unchanged", async () => {
    const { creds, served } = transport()
    const { s3, puts } = stubS3()

    await fetchArchiveNormalize(stravaAdapter, JOB, creds, { s3, bucket: "b" })

    const archived = puts[0].input.Body as Buffer
    expect(served).toHaveLength(2)
    for (const response of served) {
      /**
       * `includes` on the raw buffers. Not a parsed comparison: two payloads can be
       * equivalent JSON and different bytes, and it is the bytes that get replayed.
       */
      expect(archived.includes(response)).toBe(true)
    }
  })

  /**
   * THE INT64 ASSERTION, and it is the one worth having.
   *
   * Both ids are ODD and above 2^53, so they are not representable as doubles:
   * `JSON.parse` rounds `18736594040123457` down to `…456`. Chosen deliberately —
   * plenty of large ids happen to be exactly representable and would round-trip
   * cleanly, making a test built on one green for no reason. If anything on this path
   * parsed and re-encoded, the final digits below would change, and nothing
   * downstream could ever detect it.
   */
  it("preserves int64 ids exactly, digit for digit", async () => {
    const { creds } = transport()
    const { s3, puts } = stubS3()

    await fetchArchiveNormalize(stravaAdapter, JOB, creds, { s3, bucket: "b" })

    const text = (puts[0].input.Body as Buffer).toString("utf8")
    expect(text).toContain('"id": 18736594040123457')
    expect(text).toContain('"upload_id":20014448765123457')
    /** The escaped forms survive too — a re-encode would emit the literal characters. */
    expect(text).toContain("K\\u00f6ln")
  })

  /** The key's digest describes the bytes, and the ref hands `normalize` the same object. */
  it("addresses the object by the sha256 of exactly those bytes", async () => {
    const { creds } = transport()
    const { s3, puts } = stubS3()

    const { ref } = await fetchArchiveNormalize(stravaAdapter, JOB, creds, {
      s3,
      bucket: "b",
    })

    const archived = puts[0].input.Body as Buffer
    const digest = createHash("sha256").update(archived).digest("hex")
    expect(ref.sha256).toBe(digest)
    expect(ref.key).toBe(`raw/${USER}/strava/18736594040123457/${digest}.json`)
    expect(ref.bytes).toBe(archived.byteLength)
  })

  /** Criterion 7 — the descriptors the archive writes are the adapter's, not sniffed. */
  it("stamps the adapter's declared schema hint, versioned with the envelope", async () => {
    const { creds } = transport()
    const { s3, puts } = stubS3()

    await fetchArchiveNormalize(stravaAdapter, JOB, creds, { s3, bucket: "b" })

    expect(puts[0].input.Metadata?.schemahint).toBe(RAW_ENVELOPE_SCHEMA_HINT)
    expect(RAW_ENVELOPE_SCHEMA_HINT).toBe("strava/raw-envelope@1")
    expect(puts[0].input.ContentType).toBe("application/json")
  })

  /**
   * The archived object is the normalizer's real input, so it must be readable by the
   * function that will replay it. This is the round trip stated end to end: wire →
   * archive → `normalize`, with no step in between allowed to touch the bytes.
   */
  it("archives something normalize can read back", async () => {
    const { creds } = transport()
    const { s3 } = stubS3()

    const { ingest }: { ingest: NormalizedIngest; ref: RawArchiveRef } =
      await fetchArchiveNormalize(stravaAdapter, JOB, creds, { s3, bucket: "b" })

    /** The int64 id survived all the way into the domain, as a string (§2.7). */
    expect(ingest.activity.source.externalId).toBe("18736594040123457")
    expect(ingest.activity.hasTrace).toBe(true)
  })
})
