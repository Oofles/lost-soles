import { readFileSync } from "node:fs"

import { PutObjectCommand } from "@aws-sdk/client-s3"
import { describe, expect, it } from "vitest"

import type { IngestJob, SourceAdapter } from "@/src/adapters/types"
import type { NormalizedIngest, RawArchiveRef } from "@/src/domain/activity"
import { RawArchiveError, type ArchiveS3 } from "@/src/pipeline/archive"
import { fetchArchiveNormalize } from "@/src/pipeline/fetch-archive-normalize"

/**
 * Ticket 0039, criterion 2 — the ordering, which the ticket calls "the whole
 * ticket". These tests exist to fail loudly if anyone ever turns the two awaits in
 * `fetch-archive-normalize.ts` into a `Promise.all`.
 */

const BUCKET = "test-bucket"

/** Source-agnostic (D-100). See `archive.test.ts` and `__fixtures__/README.md`. */
const SOURCE = "gpslogger"
const FIXTURE = readFileSync(new URL("./__fixtures__/verbatim-payload.json", import.meta.url))

const JOB: IngestJob = {
  ingestKey: "k-1",
  userId: "u-1",
  source: SOURCE,
  externalId: "14567890123",
  command: "ingest",
  startedAt: "2026-06-01T02:53:48.000Z",
  meta: null,
  enqueuedAt: "2026-09-06T09:00:00.000Z",
}

const INGEST = { activity: { activityId: "a-1" } } as unknown as NormalizedIngest

/**
 * A recording adapter. Only the two phases this function calls are real; the rest
 * throw, so a step this module has no business running announces itself rather than
 * quietly returning undefined.
 */
function stubAdapter(overrides: { fetchRaw?: () => Promise<never> } = {}) {
  const calls: string[] = []
  let normalizeRef: RawArchiveRef | undefined
  let normalizeBody: Buffer | undefined

  const adapter = {
    id: SOURCE,
    accept: () => Promise.reject(new Error("accept is not part of this pipeline step")),
    async fetchRaw() {
      calls.push("fetchRaw")
      if (overrides.fetchRaw) return overrides.fetchRaw()
      return {
        body: FIXTURE,
        contentType: "application/json",
        ext: "json",
        schemaHint: "gpslogger/raw@1",
      }
    },
    normalize(raw: Buffer, ref: RawArchiveRef) {
      calls.push("normalize")
      normalizeBody = raw
      normalizeRef = ref
      return INGEST
    },
    listSince: () => {
      throw new Error("listSince is not part of this pipeline step")
    },
  } as unknown as SourceAdapter<null>

  return {
    adapter,
    calls,
    get normalizeRef() {
      return normalizeRef
    },
    get normalizeBody() {
      return normalizeBody
    },
  }
}

function stubS3(reply: () => Promise<unknown>): { s3: ArchiveS3; puts: PutObjectCommand[] } {
  const puts: PutObjectCommand[] = []
  const s3 = {
    async send(command: PutObjectCommand) {
      if (command instanceof PutObjectCommand) puts.push(command)
      return reply()
    },
  } as ArchiveS3
  return { s3, puts }
}

describe("fetchArchiveNormalize", () => {
  it("runs fetchRaw, then the archive, then normalize", async () => {
    const a = stubAdapter()
    const { s3, puts } = stubS3(async () => ({}))

    const result = await fetchArchiveNormalize(a.adapter, JOB, null, { s3, bucket: BUCKET })

    expect(a.calls).toEqual(["fetchRaw", "normalize"])
    expect(puts).toHaveLength(1)
    expect(result.ingest).toBe(INGEST)
    expect(result.ref.bucket).toBe(BUCKET)
  })

  /**
   * THE ONE THAT MATTERS (D-101, D-121.2). If the archive PUT fails, nothing has
   * been written down, so normalizing — and everything downstream of it: persistence,
   * cells, XP against a map that never re-fogs — would be acting on bytes that exist
   * nowhere but this Lambda's memory.
   *
   * Asserting `calls` rather than a spy count is deliberate: it fails identically
   * whether normalize ran BEFORE the archive or CONCURRENTLY with it, and the
   * concurrent version is the plausible refactor.
   */
  it("never calls normalize when the archive PUT fails", async () => {
    const a = stubAdapter()
    const { s3 } = stubS3(async () => {
      throw new Error("ServiceUnavailable")
    })

    const error = await fetchArchiveNormalize(a.adapter, JOB, null, {
      s3,
      bucket: BUCKET,
    }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(RawArchiveError)
    expect(a.calls).toEqual(["fetchRaw"])
    expect(a.calls).not.toContain("normalize")
  })

  /** A failed fetch archives nothing — there are no bytes yet to be the record of. */
  it("does not archive when the fetch itself fails", async () => {
    const a = stubAdapter({
      fetchRaw: () => Promise.reject(new Error("upstream 502")),
    })
    const { s3, puts } = stubS3(async () => ({}))

    await expect(
      fetchArchiveNormalize(a.adapter, JOB, null, { s3, bucket: BUCKET }),
    ).rejects.toThrow("upstream 502")

    expect(puts).toHaveLength(0)
    expect(a.calls).toEqual(["fetchRaw"])
  })

  /**
   * `normalize` is handed the SAME buffer that was archived and the ref describing
   * where it went. `Activity.raw` carries that ref, so a row in DynamoDB points at
   * the exact object it was derived from — which is what makes a replay verifiable
   * rather than merely possible.
   */
  it("normalizes the archived bytes, with the ref they were archived under", async () => {
    const a = stubAdapter()
    const { s3, puts } = stubS3(async () => ({}))

    const result = await fetchArchiveNormalize(a.adapter, JOB, null, { s3, bucket: BUCKET })

    expect(a.normalizeBody?.equals(FIXTURE)).toBe(true)
    expect(a.normalizeRef).toEqual(result.ref)
    expect(a.normalizeRef?.key).toBe(puts[0].input.Key)
    expect((puts[0].input.Body as Buffer).equals(a.normalizeBody as Buffer)).toBe(true)
  })
})
