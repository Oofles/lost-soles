import { readFileSync } from "node:fs"
import { join } from "node:path"

import { GetCommand, QueryCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb"
import { describe, expect, it } from "vitest"

import type { NormalizedIngest } from "@/src/domain/activity"
import { computeDedupeKey } from "@/src/domain/dedupe-key"
import { ACTIVITY_TABLE, JOB, rig } from "@/src/pipeline/__fixtures__/process-rig"
import { processActivity } from "@/src/pipeline/process-activity"

import { gpxFixtureAdapter } from "../__fixtures__/gpx-adapter"
import type { IngestJob, SourceAdapter } from "../types"
import { normalizeStrava } from "./normalize"

/**
 * I-22's CI FIXTURE — one run, two adapters, ONE activity and ONE award. Ticket `0179`.
 *
 * `02-data-model.md` I-22 named this test for months before anything could pass it: the lookup
 * it exercises (pipeline step 3) did not exist. It lives here, not in `src/pipeline`, for the
 * reason `cross-adapter-equivalence.test.ts` gives — a file that names the adapter must sit in
 * its directory (D-188) — and it dies with this adapter for the same reason. The rig it drives
 * is `src/pipeline/__fixtures__/process-rig.ts`, which does not.
 *
 * ─── THE TWO RECORDINGS ──────────────────────────────────────────────────────
 *
 * `real-run-outdoor.json` through the real normalizer, and `equivalence-run.gpx` — the same
 * physical run — through the GPX fixture adapter, under a different `externalId`. The second
 * recording's start, distance and elapsed are then placed JUST ACROSS every bucket boundary of
 * the formula D-211 replaced (`floor(start/60s)`, `round(distance/50)`, `round(elapsed/30)`),
 * which is what a second device does: it disagrees by seconds and metres, and the old key split
 * the run on exactly that. The test asserts the old key WOULD have split it, so it cannot pass
 * against a pair that never exercised the boundary.
 *
 * Overriding the scalars rather than editing the GPX is deliberate: the GPX's points are what
 * the equivalence test compares cell for cell, and a fixture moved to serve two tests serves
 * neither. The trace is untouched; only the three numbers the comparison reads are moved.
 *
 * ─── THE WORLD ───────────────────────────────────────────────────────────────
 *
 * One T3 shared by both deliveries, written by the real transaction and queried by GSI2's
 * real key — the query FILTERS on `dedupeKey`, so a recording whose stored key the lookup does
 * not compute is a miss, which is the property the rig's simpler fake cannot show.
 */

const STRAVA_RAW = readFileSync(join(import.meta.dirname, "__fixtures__/real-run-outdoor.json"))
const GPX_RAW = readFileSync(join(import.meta.dirname, "../__fixtures__/equivalence-run.gpx"))

type Row = { id: string; userId: string; dedupeKey: string; startedAt: string; elapsedS: number; distanceM?: number }

/** The formula D-211 retired, restated ONLY to prove the pair straddles it. Never a key. */
const oldBuckets = (a: { startedAt: string; distanceM?: number; elapsedS: number }) => ({
  minute: Math.floor(Date.parse(a.startedAt) / 60_000),
  distance: Math.round((a.distanceM ?? 0) / 50),
  elapsed: Math.round(a.elapsedS / 30),
})

/** Just past the next rounding edge — at most one bucket away, and well inside D-211's tolerances. */
const acrossRoundEdge = (x: number, step: number) => (Math.round(x / step) + 0.5) * step + 1

function world() {
  const t3 = new Map<string, Row>()
  let transactions = 0

  async function deliver(adapter: SourceAdapter<{ token: string }>, job: IngestJob) {
    const r = rig({ adapter })
    const persist = r.deps.persist.ddb
    r.deps.persist.ddb = {
      async send(command: TransactWriteCommand | GetCommand) {
        const out = await persist.send(command)
        if (command instanceof TransactWriteCommand) {
          transactions += 1
          for (const item of command.input.TransactItems ?? []) {
            if (item.Put?.TableName === ACTIVITY_TABLE) {
              const row = item.Put.Item as Row
              t3.set(row.id, row)
            }
          }
        }
        return out
      },
    }
    r.deps.dedupe = {
      activityTable: ACTIVITY_TABLE,
      ddb: {
        async send(command: QueryCommand | GetCommand) {
          if (command instanceof QueryCommand) {
            const v = command.input.ExpressionAttributeValues!
            return {
              Items: [...t3.values()]
                .filter((row) => row.userId === v[":userId"] && row.dedupeKey === v[":key"])
                .map((row) => ({ id: row.id, userId: row.userId, dedupeKey: row.dedupeKey })),
            }
          }
          return { Item: t3.get(String(command.input.Key?.id)) }
        },
      },
    }
    return { result: await processActivity(job, r.deps), r }
  }

  return { t3, deliver, transactions: () => transactions }
}

const job = (source: string, externalId: string): IngestJob => ({ ...JOB, source, externalId })

describe("I-22 — one run through two sources is one activity and one award", () => {
  const strava = {
    id: "strava",
    fetchRaw: async () => ({ body: STRAVA_RAW, contentType: "application/json", ext: "json", schemaHint: "strava-activity@1" }),
    normalize: normalizeStrava,
  } as unknown as SourceAdapter<{ token: string }>

  /** The second device. Its scalars are set from the first recording's, across each old edge. */
  const secondDevice = (first: NormalizedIngest["activity"]) =>
    ({
      ...gpxFixtureAdapter,
      fetchRaw: async () => ({ body: GPX_RAW, contentType: "application/gpx+xml", ext: "gpx", schemaHint: "gpx@1.1" }),
      normalize(raw, ref, j) {
        const ingest = gpxFixtureAdapter.normalize(raw, ref, j)
        const moved = secondScalars(first)
        return {
          ...ingest,
          activity: { ...ingest.activity, ...moved, dedupeKey: computeDedupeKey(j.userId, Date.parse(moved.startedAt)) },
        }
      },
    }) as SourceAdapter<{ token: string }>

  it("the second recording is a duplicate of the first, and nothing is awarded twice", async () => {
    const w = world()

    const first = await w.deliver(strava, job("strava", "11032320114"))
    expect(first.result.outcome).toBe("persisted")
    const winner = [...w.t3.values()][0]!

    const second = await w.deliver(secondDevice(winner as never), job("gpx-fixture", "equivalence-run"))

    // The pair genuinely straddles every boundary the retired formula had.
    const a = oldBuckets(winner)
    const b = oldBuckets(secondScalars(winner))
    expect(b.minute).not.toBe(a.minute)
    expect(b.distance).not.toBe(a.distance)
    expect(b.elapsed).not.toBe(a.elapsed)

    expect(second.result).toMatchObject({ outcome: "duplicate", duplicateOf: winner.id })
    expect(w.t3.size).toBe(1)
    expect(w.transactions()).toBe(1)
    expect(second.r.cellWrites).toHaveLength(0)
    expect(second.r.pointerPuts[0]!.Key).toBe(`raw/${JOB.userId}/gpx-fixture/equivalence-run.duplicate-of.json`)
  })
})

/** Where the second device's start, distance and elapsed land: one step across each old edge. */
function secondScalars(first: { startedAt: string; distanceM?: number; elapsedS: number }) {
  return {
    startedAt: new Date((Math.floor(Date.parse(first.startedAt) / 60_000) + 1) * 60_000 + 2_000).toISOString(),
    distanceM: acrossRoundEdge(first.distanceM!, 50),
    elapsedS: Math.round(acrossRoundEdge(first.elapsedS, 30)),
  }
}
