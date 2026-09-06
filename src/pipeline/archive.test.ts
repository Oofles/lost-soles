import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"

import { HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3"
import { describe, expect, it } from "vitest"

import { APP_VERSION } from "@/lib/app-meta"
import {
  archiveRaw,
  RawArchiveError,
  rawArchiveKey,
  type ArchiveS3,
  type RawArchiveInput,
} from "@/src/pipeline/archive"

/**
 * Ticket 0039. The archive is the system of record (D-101), so these tests are
 * mostly about things NOT happening: bytes not being touched, a second write not
 * creating a second object, a failure not being swallowed.
 */

const BUCKET = "test-bucket"

/** Any source but the one this repo happens to ship. See the module comment. */
const SOURCE = "gpslogger"
const SCHEMA_HINT = "gpslogger/raw@1"

/**
 * A payload off disk, byte-for-byte. Not a hand-written `{"a":1}`: the property under
 * test is that mixed indentation, an int64 id past 2^53 and escaped non-ASCII all
 * survive unchanged, and a tidy two-byte payload would round-trip through a
 * reformatter and prove nothing. See `__fixtures__/README.md`.
 *
 * SOURCE-AGNOSTIC, because `src/pipeline` is — `check-boundaries.mjs` fires on a vendor
 * name anywhere under this root (D-100), fixtures and test prose included. The fidelity
 * of a REAL adapter's bytes through this module is asserted in that adapter's own
 * directory, which is the only place allowed to say whose bytes they are:
 * `archive-fidelity.test.ts`.
 */
const FIXTURE = readFileSync(new URL("./__fixtures__/verbatim-payload.json", import.meta.url))

const INPUT: RawArchiveInput = {
  userId: "u-1",
  source: SOURCE,
  externalId: "14567890123",
  body: FIXTURE,
  contentType: "application/json",
  ext: "json",
  schemaHint: SCHEMA_HINT,
}

const FIXTURE_SHA = createHash("sha256").update(FIXTURE).digest("hex")

interface Sent {
  puts: PutObjectCommand[]
  heads: HeadObjectCommand[]
}

/** Records what was sent and answers with `reply`. Two methods, no mocking library. */
function stubS3(
  reply: (command: PutObjectCommand | HeadObjectCommand) => Promise<unknown>,
): { s3: ArchiveS3; sent: Sent } {
  const sent: Sent = { puts: [], heads: [] }
  const s3 = {
    async send(command: PutObjectCommand | HeadObjectCommand) {
      if (command instanceof PutObjectCommand) sent.puts.push(command)
      else sent.heads.push(command)
      return reply(command)
    },
  } as ArchiveS3
  return { s3, sent }
}

/** What S3 answers a refused `IfNoneMatch: "*"` with. */
function preconditionFailed(): Error {
  const error = new Error("At least one of the pre-conditions you specified did not hold")
  error.name = "PreconditionFailed"
  Object.assign(error, { $metadata: { httpStatusCode: 412 } })
  return error
}

describe("rawArchiveKey", () => {
  /**
   * `01-architecture.md` §3. The whole provenance is in the path so a backfill five
   * years from now needs no database to interpret an object.
   */
  it("is raw/<uid>/<source>/<externalId>/<sha256>.<ext>", () => {
    expect(
      rawArchiveKey({
        userId: "u-1",
        source: SOURCE,
        externalId: "14567890123",
        sha256: "abc123",
        ext: "json",
      }),
    ).toBe(`raw/u-1/${SOURCE}/14567890123/abc123.json`)
  })
})

describe("archiveRaw", () => {
  it("PUTs to the content-addressed key and returns the ref", async () => {
    const { s3, sent } = stubS3(async () => ({ ETag: `"${FIXTURE_SHA}"` }))

    const ref = await archiveRaw(INPUT, {
      s3,
      bucket: BUCKET,
      now: () => new Date("2026-09-06T10:00:00.000Z"),
    })

    expect(sent.puts).toHaveLength(1)
    expect(sent.puts[0].input.Bucket).toBe(BUCKET)
    expect(ref).toEqual({
      bucket: BUCKET,
      key: `raw/u-1/${SOURCE}/14567890123/${FIXTURE_SHA}.json`,
      contentType: "application/json",
      bytes: FIXTURE.byteLength,
      sha256: FIXTURE_SHA,
      archivedAt: "2026-09-06T10:00:00.000Z",
    })
  })

  /**
   * §3.1 rule 2, and the reason this ticket exists at all. The assertion is
   * `Buffer.equals`, not a JSON comparison: two payloads can be equivalent JSON and
   * different bytes, and it is the bytes a re-normalization years from now reads.
   */
  it("archives the bytes verbatim — no re-encoding, no reformatting", async () => {
    const { s3, sent } = stubS3(async () => ({}))

    await archiveRaw(INPUT, { s3, bucket: BUCKET })

    const body = sent.puts[0].input.Body as Buffer
    expect(Buffer.isBuffer(body)).toBe(true)
    expect(body.equals(FIXTURE)).toBe(true)
    /** Belt and braces: the digest in the key describes the bytes that were sent. */
    expect(createHash("sha256").update(body).digest("hex")).toBe(FIXTURE_SHA)
  })

  /** `01-architecture.md` §3 "self-describing" names these five exactly. */
  it("stamps adapter, externalId, userId, schemaHint and the app version", async () => {
    const { s3, sent } = stubS3(async () => ({}))

    await archiveRaw(INPUT, { s3, bucket: BUCKET })

    expect(sent.puts[0].input.Metadata).toEqual({
      adapter: SOURCE,
      externalid: "14567890123",
      userid: "u-1",
      schemahint: SCHEMA_HINT,
      appversion: APP_VERSION,
    })
  })

  /**
   * DECLARED, NOT SNIFFED. The bytes here are JSON and the adapter says they are
   * `text/csv.gz`; the archive must believe the adapter. Sniffing would be the
   * plausible "improvement" that quietly makes the archive's description of a
   * malformed payload a guess rather than a record.
   */
  it("copies the declared content type and extension through untouched", async () => {
    const { s3, sent } = stubS3(async () => ({}))

    const ref = await archiveRaw(
      { ...INPUT, contentType: "application/vnd.ant.fit", ext: "fit" },
      { s3, bucket: BUCKET },
    )

    expect(sent.puts[0].input.ContentType).toBe("application/vnd.ant.fit")
    expect(ref.key.endsWith(".fit")).toBe(true)
    expect(ref.contentType).toBe("application/vnd.ant.fit")
  })

  /** The conditional write that makes a re-archive a no-op rather than a version. */
  it("PUTs conditionally on the key not existing", async () => {
    const { s3, sent } = stubS3(async () => ({}))

    await archiveRaw(INPUT, { s3, bucket: BUCKET })

    expect(sent.puts[0].input.IfNoneMatch).toBe("*")
    expect(sent.puts[0].input.ChecksumSHA256).toBe(
      Buffer.from(FIXTURE_SHA, "hex").toString("base64"),
    )
  })

  /**
   * IDEMPOTENCE. An SQS redelivery re-fetches the same payload and lands on the same
   * key; S3 refuses with 412 and that is a SUCCESS. `archivedAt` comes from the
   * existing object, not the clock — the second attempt acquired nothing, and
   * restamping it would rewrite the provenance of an object this call did not write.
   */
  it("treats a refused conditional write as already archived, keeping the original archivedAt", async () => {
    const original = new Date("2026-09-01T08:15:00.000Z")
    const { s3, sent } = stubS3(async (command) => {
      if (command instanceof PutObjectCommand) throw preconditionFailed()
      return { LastModified: original, ETag: `"${FIXTURE_SHA}"` }
    })

    const ref = await archiveRaw(INPUT, {
      s3,
      bucket: BUCKET,
      now: () => new Date("2026-09-06T10:00:00.000Z"),
    })

    expect(sent.puts).toHaveLength(1)
    expect(sent.heads).toHaveLength(1)
    expect(ref.key).toBe(`raw/u-1/${SOURCE}/14567890123/${FIXTURE_SHA}.json`)
    expect(ref.archivedAt).toBe("2026-09-01T08:15:00.000Z")
  })

  /**
   * Two archives of identical bytes address ONE object. Stated as a test rather than
   * left to the key-shape test above because idempotence is the property, and the
   * key shape is only the mechanism that delivers it.
   */
  it("archiving the same payload twice writes one key", async () => {
    let stored: string | undefined
    const { s3 } = stubS3(async (command) => {
      if (command instanceof PutObjectCommand) {
        if (stored === command.input.Key) throw preconditionFailed()
        stored = command.input.Key
        return {}
      }
      return { LastModified: new Date("2026-09-01T08:15:00.000Z") }
    })

    const first = await archiveRaw(INPUT, { s3, bucket: BUCKET })
    const second = await archiveRaw(INPUT, { s3, bucket: BUCKET })

    expect(second.key).toBe(first.key)
    expect(second.sha256).toBe(first.sha256)
  })

  /**
   * FAIL LOUD. The pipeline's correctness rests on this throwing — see
   * `fetch-archive-normalize.test.ts` for the half that proves nothing runs after.
   */
  it("wraps a failed PUT in RawArchiveError, keeping the cause", async () => {
    const cause = new Error("ServiceUnavailable")
    const { s3 } = stubS3(async () => {
      throw cause
    })

    const error = await archiveRaw(INPUT, { s3, bucket: BUCKET }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(RawArchiveError)
    expect((error as RawArchiveError).key).toContain(FIXTURE_SHA)
    expect((error as RawArchiveError).cause).toBe(cause)
  })

  /**
   * A 412 says an object exists; a failed HEAD means we cannot confirm it. That is
   * not a state to normalize from, so it fails rather than falling back to the clock.
   */
  it("fails when the object is claimed to exist but cannot be read back", async () => {
    const { s3 } = stubS3(async (command) => {
      if (command instanceof PutObjectCommand) throw preconditionFailed()
      throw new Error("AccessDenied")
    })

    await expect(archiveRaw(INPUT, { s3, bucket: BUCKET })).rejects.toBeInstanceOf(RawArchiveError)
  })
})
