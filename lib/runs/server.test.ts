import { gzipSync } from "node:zlib"

import { QueryCommand } from "@aws-sdk/lib-dynamodb"
import { describe, expect, it, vi } from "vitest"

import { activityItem } from "@/src/pipeline/persist"

import { EMPTY_COLLECTION, LATEST_SCAN_LIMIT, latestRun, type RunReadDeps } from "./server"

/**
 * Ticket `0195`. `02-data-model.md` §5.1 (S-7); `08-security-privacy.md` §5.3.
 *
 * DynamoDB and S3 are stubbed; the query shape, the traced-row selection, the key
 * reconstruction and every empty case are real.
 *
 * GEOMETRY IS SYNTHETIC, near Point Nemo — §7.2, D-199.
 */

const GEOMETRY = {
  type: "MultiLineString" as const,
  coordinates: [[[-123.393, -48.876], [-123.392, -48.875]]],
}

function rig(rows: Array<Record<string, unknown>>) {
  const queries: QueryCommand["input"][] = []
  const deps: RunReadDeps = {
    bucket: "bkt",
    activityTable: "TestActivity",
    ddb: {
      async send(command: QueryCommand) {
        queries.push(command.input)
        return { Items: rows }
      },
    },
    // `getObject` is what the route reads through; stubbed at the module boundary below.
    s3: {} as RunReadDeps["s3"],
  }
  return { deps, queries }
}

const getObject = vi.fn()
vi.mock("@/lib/fog/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/fog/server")>()),
  getObject: (...args: unknown[]) => getObject(...args),
  defaultFogReadDeps: () => ({ s3: {}, bucket: "bkt" }),
}))

const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))

/**
 * ROWS BUILT BY THE SHIPPED WRITER, NOT BY HAND — and this is the whole reason the file
 * imports from `src/pipeline`.
 *
 * The first draft of this suite hand-wrote `{ activityId: "a-9", … }`. Every test passed and the
 * reader was broken: `persist.ts` writes `id`, not `activityId`, so `latestRun` matched nothing
 * and returned an empty collection over a real row that plainly had geometry. Only the live
 * smoke test found it. A fixture that invents its own column shape is a fixture that certifies
 * the reader against a store that does not exist — so this one is produced by `activityItem`,
 * the same function the ingest worker persists through, and a renamed column breaks the test.
 */
const row = (over: Record<string, unknown> = {}) => ({
  ...activityItem(
    {
      activityId: "a-9",
      userId: "u-1",
      kind: "run",
      hasTrace: true,
      traceRef: "users/u-1/traces/a-9.segments.json.gz",
      source: { source: "manual" },
      startedAt: "2026-09-09T11:00:00.000Z",
      startedAtLocal: "2026-09-09T07:00:00",
      timezone: "America/New_York",
      ingestedAt: "2026-09-09T11:30:00.000Z",
      name: "Morning Run",
      sets: [],
    } as unknown as Parameters<typeof activityItem>[0],
  ),
  ...over,
})

describe("latestRun — the query", () => {
  it("asks byUserAndStart for the caller's rows, newest first", async () => {
    getObject.mockResolvedValueOnce(bytes(GEOMETRY))
    const { deps, queries } = rig([row()])
    await latestRun("u-1", deps)

    expect(queries[0]!.IndexName).toBe("byUserAndStart")
    expect(queries[0]!.ScanIndexForward).toBe(false)
    expect(queries[0]!.Limit).toBe(LATEST_SCAN_LIMIT)
    expect(queries[0]!.ExpressionAttributeValues).toEqual({ ":u": "u-1" })
  })

  /**
   * §5.3, AS AN ASSERTION RATHER THAN A COMMENT. The uid is the partition key of the query and
   * half the S3 key below it, so a caller who could choose it could read another account's map.
   * There is no parameter to smuggle one through — this proves the one that exists is used.
   */
  it("partitions by the uid it was given and by nothing else", async () => {
    getObject.mockResolvedValueOnce(bytes(GEOMETRY))
    const { deps, queries } = rig([row()])
    await latestRun("u-someone-else", deps)
    expect(queries[0]!.ExpressionAttributeValues).toEqual({ ":u": "u-someone-else" })
  })
})

describe("latestRun — choosing the row", () => {
  it("returns the newest activity that has geometry", async () => {
    getObject.mockResolvedValueOnce(bytes(GEOMETRY))
    const { deps } = rig([row()])
    const out = await latestRun("u-1", deps)

    expect(out.features).toHaveLength(1)
    expect(out.features[0]!.geometry).toEqual(GEOMETRY)
    expect(out.features[0]!.properties).toEqual({
      activityId: "a-9",
      startedAt: "2026-09-09T11:00:00.000Z",
      name: "Morning Run",
    })
  })

  /**
   * THE INDEX IS ORDERED BY `startedAt`, NOT BY "has a trace". A week of gym sessions logged
   * after Sunday's run sits in front of it, and skipping them is the whole reason this reads a
   * page rather than one row.
   */
  it("skips untraced activities in front of the run", async () => {
    getObject.mockResolvedValueOnce(bytes(GEOMETRY))
    const { deps } = rig([
      row({ id: "gym-2", traceRef: null }),
      row({ id: "gym-1", traceRef: null }),
      row(),
    ])
    const out = await latestRun("u-1", deps)
    expect(out.features[0]!.properties.activityId).toBe("a-9")
  })

  /**
   * THE KEY IS REBUILT FROM THE SESSION'S UID, NOT READ OFF THE ROW. A `traceRef` naming
   * another user's prefix — a future code path, a hand-edited row — must not be able to choose
   * what this session reads. The rebuilt key can only ever address the caller's own prefix.
   */
  it("ignores the traceRef string and addresses the caller's own prefix", async () => {
    getObject.mockResolvedValueOnce(bytes(GEOMETRY))
    const { deps } = rig([row({ traceRef: "users/SOMEONE-ELSE/traces/a-9.segments.json.gz" })])
    await latestRun("u-1", deps)
    expect(getObject.mock.calls[0]![0]).toBe("users/u-1/traces/a-9.segments.json.gz")
  })
})

describe("latestRun — an empty collection is a result, not an error", () => {
  /**
   * THREE SITUATIONS, ONE ANSWER. A brand-new account; an account whose recent activities are
   * all untraced; and — the one that is true of this account today — rows written before `0195`,
   * every one of them carrying `traceRef: null`. A 404 would make the renderer treat a new user
   * as a broken backend.
   */
  it("answers empty for an account with no activities at all", async () => {
    const { deps } = rig([])
    expect(await latestRun("u-1", deps)).toEqual(EMPTY_COLLECTION)
  })

  it("answers empty when every recent activity is untraced", async () => {
    const { deps } = rig([row({ traceRef: null }), row({ traceRef: null })])
    expect(await latestRun("u-1", deps)).toEqual(EMPTY_COLLECTION)
  })

  it("answers empty for rows written before 0195, whose traceRef is null", async () => {
    const { deps } = rig([row({ traceRef: undefined })])
    expect(await latestRun("u-1", deps)).toEqual(EMPTY_COLLECTION)
  })

  /**
   * A row pointing at an object that is not there IS a fault — it means a `traces` phase
   * failure landed a row anyway, which the phase ordering exists to prevent. It still reads as
   * "no line": a map that will not load is a worse answer than a map missing one line.
   */
  it("answers empty when the row names an object that is gone", async () => {
    getObject.mockResolvedValueOnce(undefined)
    const { deps } = rig([row()])
    expect(await latestRun("u-1", deps)).toEqual(EMPTY_COLLECTION)
  })

  it("answers empty for a row with no id to build a key from", async () => {
    const { deps } = rig([row({ id: undefined })])
    expect(await latestRun("u-1", deps)).toEqual(EMPTY_COLLECTION)
  })
})

describe("latestRun — the object comes back gzipped", () => {
  /**
   * `Content-Encoding: gzip` is a promise to the BROWSER; a server-side `GetObject` gets the
   * compressed bytes untouched. `getObject` in `lib/fog/server.ts` already gunzips, and this
   * asserts the route reads through that path rather than around it — a decoder handed a gzip
   * magic number reports a corrupt blob, which is a confusing way to learn this.
   */
  it("parses what getObject returns, having already been gunzipped", async () => {
    getObject.mockResolvedValueOnce(new Uint8Array(gzipSync(JSON.stringify(GEOMETRY))))
    const { deps } = rig([row()])
    // Deliberately handed STILL-GZIPPED bytes: this must throw rather than silently serve
    // garbage, which is what proves the gunzip is `getObject`'s job and not this module's.
    await expect(latestRun("u-1", deps)).rejects.toThrow()
  })
})
