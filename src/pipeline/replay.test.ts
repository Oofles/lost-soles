import { GetObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3"
import { describe, expect, it, vi } from "vitest"

import type { IngestJob, SourceAdapter } from "@/src/adapters/types"

import {
  NoArchivedRawError,
  archivePrefix,
  readArchivedRaw,
  replayAdapter,
  type ReplayDeps,
} from "./replay"

/**
 * Ticket `0192`. `01-architecture.md` §3, D-101, D-020.
 *
 * SOURCE ID: `gpslogger`, NOT `strava`, and `check-boundaries.mjs` is why. `src/pipeline` is
 * source-agnostic under D-100/D-121.1, and the guard greps for a Strava-shaped identifier anywhere
 * outside the adapter directory — including in a test. It caught this file on Amplify job 172 after
 * a local run of the same guard was misread. The rule is right: nothing here should care which
 * source it is replaying, and a test that names one is quietly asserting otherwise.
 *
 * The load-bearing assertion in this file is the one that looks negative: **a replay never touches
 * the source**. Everything else is plumbing around it. The reason is in `replay.ts`'s header — a
 * source can return different bytes for the same activity, and ground revealed from bytes the
 * original ingest never saw is permanent on a map that cannot re-fog.
 */

const JOB: IngestJob = {
  ingestKey: "key-1",
  userId: "user-1",
  source: "gpslogger",
  externalId: "555",
  command: "reingest",
  startedAt: "2026-01-01T00:00:00.000Z",
  meta: null,
  enqueuedAt: "2026-01-02T00:00:00.000Z",
}

const KEY = "raw/user-1/gpslogger/555/abc123.json"

function s3({
  objects = [{ Key: KEY, LastModified: new Date("2026-01-01T00:00:00Z") }],
  body = Buffer.from('{"detail":{},"streams":{}}'),
  metadata = { schemahint: "gpslogger/raw-envelope@1" } as Record<string, string> | undefined,
  contentType = "application/json" as string | undefined,
}: {
  objects?: Array<{ Key?: string; LastModified?: Date }>
  body?: Buffer
  metadata?: Record<string, string>
  contentType?: string
} = {}) {
  const gets: string[] = []
  const deps: ReplayDeps = {
    bucket: "bucket-1",
    s3: {
      send: vi.fn(async (command: ListObjectsV2Command | GetObjectCommand) => {
        if (command instanceof ListObjectsV2Command) return { Contents: objects }
        gets.push((command as GetObjectCommand).input.Key!)
        return {
          Body: { transformToByteArray: async () => new Uint8Array(body) },
          ContentType: contentType,
          Metadata: metadata,
        }
      }),
    } as never,
  }
  return { deps, gets }
}

describe("archivePrefix", () => {
  it("is archive.ts's key layout with the digest left off", () => {
    expect(archivePrefix({ userId: "u", source: "gpslogger", externalId: "9" })).toBe(
      "raw/u/gpslogger/9/",
    )
    // The trailing slash is not cosmetic: without it the prefix would also match `/90`, `/91`…
    expect(archivePrefix({ userId: "u", source: "gpslogger", externalId: "9" })).toMatch(/\/$/)
  })
})

describe("readArchivedRaw", () => {
  it("recovers all four of fetchRaw's fields from the object itself", async () => {
    const { deps } = s3()
    const raw = await readArchivedRaw(JOB, deps)
    expect(raw.body.toString()).toBe('{"detail":{},"streams":{}}')
    expect(raw.contentType).toBe("application/json")
    // From the content-addressed key's suffix — `archive.ts` puts the adapter's declared `ext` there.
    expect(raw.ext).toBe("json")
    // From the user metadata `archiveRaw` writes, lower-cased in transit by S3.
    expect(raw.schemaHint).toBe("gpslogger/raw-envelope@1")
    expect(raw.key).toBe(KEY)
  })

  /**
   * `archive.ts`: the store is content-addressed, so a source that re-serialises its own response
   * lands a SECOND object under one activity — "correctly, because those are genuinely different
   * bytes". The newest is the state the map was actually built from.
   */
  it("takes the newest object when an activity has more than one", async () => {
    const { deps, gets } = s3({
      objects: [
        { Key: "raw/user-1/gpslogger/555/old.json", LastModified: new Date("2026-01-01T00:00:00Z") },
        { Key: "raw/user-1/gpslogger/555/new.json", LastModified: new Date("2026-03-01T00:00:00Z") },
      ],
    })
    await readArchivedRaw(JOB, deps)
    expect(gets).toEqual(["raw/user-1/gpslogger/555/new.json"])
  })

  it("breaks a timestamp tie on the key, so the choice is deterministic", async () => {
    const at = new Date("2026-01-01T00:00:00Z")
    const { deps, gets } = s3({
      objects: [
        { Key: "raw/user-1/gpslogger/555/bbb.json", LastModified: at },
        { Key: "raw/user-1/gpslogger/555/aaa.json", LastModified: at },
      ],
    })
    await readArchivedRaw(JOB, deps)
    expect(gets).toEqual(["raw/user-1/gpslogger/555/aaa.json"])
    // Deterministic means the same answer twice, which is what makes a replay a replay.
    const second = s3({
      objects: [
        { Key: "raw/user-1/gpslogger/555/aaa.json", LastModified: at },
        { Key: "raw/user-1/gpslogger/555/bbb.json", LastModified: at },
      ],
    })
    await readArchivedRaw(JOB, second.deps)
    expect(second.gets).toEqual(["raw/user-1/gpslogger/555/aaa.json"])
  })

  it("throws rather than returning nothing when the activity was never archived", async () => {
    const { deps } = s3({ objects: [] })
    await expect(readArchivedRaw(JOB, deps)).rejects.toBeInstanceOf(NoArchivedRawError)
    // The message has to say why there is no fallback, because "just fetch it then" is the obvious
    // next edit and it is the one this module exists to prevent.
    await expect(readArchivedRaw(JOB, deps)).rejects.toThrow(/never re-fogs|D-020/)
  })

  it("refuses an object with no schemaHint instead of inventing one", async () => {
    const { deps } = s3({ metadata: {} })
    // §3 calls the archive self-describing. A default here would put a guess into that record, and
    // the guess would be read years later by a normalizer choosing how to parse the bytes.
    await expect(readArchivedRaw(JOB, deps)).rejects.toBeInstanceOf(NoArchivedRawError)
  })

  it("ignores the prefix placeholder some S3 listings return", async () => {
    const { deps, gets } = s3({
      objects: [
        { Key: "raw/user-1/gpslogger/555/", LastModified: new Date("2027-01-01T00:00:00Z") },
        { Key: KEY, LastModified: new Date("2026-01-01T00:00:00Z") },
      ],
    })
    await readArchivedRaw(JOB, deps)
    expect(gets).toEqual([KEY])
  })
})

describe("replayAdapter", () => {
  function adapter(): SourceAdapter<{ token: string }> & { fetched: number } {
    const stub = {
      id: "gpslogger" as const,
      fetched: 0,
      accept: vi.fn(),
      fetchRaw: vi.fn(async () => {
        stub.fetched++
        return {
          body: Buffer.from("FROM THE NETWORK"),
          contentType: "application/json",
          ext: "json",
          schemaHint: "gpslogger/raw-envelope@1",
        }
      }),
      normalize: vi.fn(() => ({ activity: { marker: "shipped-normalizer" } }) as never),
      listSince: vi.fn(),
    }
    return stub as never
  }

  /** THE ASSERTION THE MODULE EXISTS FOR. */
  it("never calls the source's fetchRaw", async () => {
    const real = adapter()
    const { deps } = s3()
    const replay = replayAdapter(real, deps)

    const raw = await replay.fetchRaw(JOB, { token: "t" })

    expect(real.fetched).toBe(0)
    expect(real.fetchRaw).not.toHaveBeenCalled()
    expect(raw.body.toString()).toBe('{"detail":{},"streams":{}}')
    expect(raw.body.toString()).not.toContain("NETWORK")
  })

  /**
   * ONE NORMALIZER IN THE SYSTEM. A replay path with its own would be a second implementation of the
   * vendor's wire format, and the two would drift the first time either was fixed.
   */
  it("keeps the shipped normalize, id and listSince untouched", async () => {
    const real = adapter()
    const { deps } = s3()
    const replay = replayAdapter(real, deps)

    expect(replay.normalize).toBe(real.normalize)
    expect(replay.listSince).toBe(real.listSince)
    expect(replay.id).toBe(real.id)
    expect(replay.fetchRaw).not.toBe(real.fetchRaw)
  })

  it("propagates a missing archive rather than silently degrading to the network", async () => {
    const real = adapter()
    const { deps } = s3({ objects: [] })
    await expect(replayAdapter(real, deps).fetchRaw(JOB, { token: "t" })).rejects.toBeInstanceOf(
      NoArchivedRawError,
    )
    expect(real.fetched).toBe(0)
  })
})
