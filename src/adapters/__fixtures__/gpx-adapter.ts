import { createHash } from "node:crypto"

import { computeActivityId } from "@/src/domain/activity-id"
import type { Activity, GeoPoint, NormalizedIngest, RawArchiveRef, Trace } from "@/src/domain/activity"
import { MAX_IMPLIED_SPEED_MS, metresBetween } from "@/src/domain/geo"

import type { AckResult, IngestJob, SourceAdapter } from "../types"

/**
 * THE SECOND ADAPTER. A fixture, not a product. Ticket `0155`; `0027`'s T3;
 * `docs/contracts/ingestion-contract.md` §5 check 3.
 *
 * ─── WHY A SYNTHETIC ADAPTER RATHER THAN WAITING FOR A REAL ONE ─────────────
 *
 * `0027` is explicit: *"Only one adapter exists at MVP, so land the harness now with a second,
 * synthetic fixture adapter replaying the same GPX-derived points through a different code
 * path. The test must be real and green, not `test.skip`."*
 *
 * Waiting for a real second adapter means waiting for capability `10`, and the harness is worth
 * more than the realism — its entire value is being ALREADY WRITTEN on the day the primary is
 * swapped. A test authored on migration day is a test written to bless a decision already
 * committed to, under time pressure.
 *
 * This is deliberately NOT `0069`'s `manual` adapter, and when a real second adapter lands it
 * should be added as a second case rather than replacing this one.
 *
 * ─── "A GENUINELY DIFFERENT CODE PATH" IS THE WHOLE REQUIREMENT ─────────────
 *
 * A copy of the primary's parser would prove nothing — the test would compare an
 * implementation with itself and pass forever. So nothing here is shared with it:
 *
 * | | primary | this |
 * |---|---|---|
 * | wire format | JSON, columnar streams | XML, one element per fix |
 * | coordinates | `number` from `JSON.parse` | attribute STRINGS through `Number()` |
 * | time | integer offsets from `start_date` | absolute ISO instants, parsed per point |
 * | ordering | array index | document order |
 * | sanitation | `sanitizeTracePoints`, anchor-corrected | the loop below |
 *
 * **What IS shared is the domain**, and that is the point rather than a compromise:
 * `MAX_IMPLIED_SPEED_MS` (D-197) and `metresBetween` are `src/domain/geo.ts`'s, so the two
 * adapters implement the same RULE by different code. An adapter that invented its own speed
 * gate would be a different contract, not a different implementation of this one.
 *
 * ─── AND IT IS DELIBERATELY LOSSIER ─────────────────────────────────────────
 *
 * `equivalence-run.gpx` carries five decimal places — 1.1 m, a realistic consumer-GPX export
 * precision and the coarsest a real one plausibly uses. The primary's stream carries six. So
 * the comparison is run against a genuine precision disagreement rather than two renderings of
 * identical doubles. It turns out not to matter at all, which is the measurement recorded in
 * `cell-set-equivalence.ts`.
 */

/** Every fix in document order. Attribute strings, parsed exactly once, here. */
function parseTrackPoints(gpx: string): GeoPoint[] {
  const points: GeoPoint[] = []
  /**
   * A regex rather than an XML parser, and that is not laziness: this file must not add a
   * dependency to the project (D-214 keeps even the domain to one), and the fixture is a
   * document this repo generates. A real GPX adapter would parse properly; a fixture that
   * reads its own fixture does not need to.
   */
  const trkpt = /<trkpt\s+lat="([^"]+)"\s+lon="([^"]+)"\s*>([\s\S]*?)<\/trkpt>/g
  let match: RegExpExecArray | null

  while ((match = trkpt.exec(gpx)) !== null) {
    const lat = Number(match[1])
    const lng = Number(match[2])
    const time = /<time>([^<]+)<\/time>/.exec(match[3] ?? "")?.[1]
    if (time === undefined) continue

    // ABSOLUTE instants, converted to the contract's milliseconds-from-start at the end —
    // the opposite direction from the primary, which is handed offsets and adds a base.
    points.push({ lat, lng, t: Date.parse(time) })
  }
  return points
}

/**
 * The speed gate, D-197's rule by a different implementation.
 *
 * Compares each candidate against the last ACCEPTED fix, like the primary, because that is
 * what the rule says — but it has no anchor correction (`0172`), keeps no `brokeSinceLastAccepted`
 * flag, and records its breaks by scanning afterwards rather than during. If those differences
 * ever start mattering, the equivalence test is exactly where that shows up.
 */
function sanitize(points: readonly GeoPoint[], gate: number): { kept: GeoPoint[]; gaps: Array<[number, number]> } {
  const kept: GeoPoint[] = []
  const brokeBefore = new Set<number>()

  for (const point of points) {
    const previous = kept[kept.length - 1]
    if (previous === undefined) {
      kept.push(point)
      continue
    }
    const seconds = (point.t - previous.t) / 1000
    const speed = seconds > 0 ? metresBetween(previous, point) / seconds : Number.POSITIVE_INFINITY
    if (speed > gate) {
      brokeBefore.add(kept.length)
      continue
    }
    kept.push(point)
  }

  const gaps: Array<[number, number]> = []
  for (const index of [...brokeBefore].sort((a, b) => a - b)) {
    if (index > 0 && index < kept.length) gaps.push([index - 1, index])
  }
  return { kept, gaps }
}

/** Turns the parsed fixes into the contract's `Trace`. */
export function gpxToTrace(gpx: string, kind: string): Trace | undefined {
  const parsed = parseTrackPoints(gpx)
  if (parsed.length === 0) return undefined

  const gate = MAX_IMPLIED_SPEED_MS[kind as keyof typeof MAX_IMPLIED_SPEED_MS] ?? MAX_IMPLIED_SPEED_MS.other
  const { kept, gaps } = sanitize(parsed, gate)
  if (kept.length === 0) return undefined

  const base = kept[0]!.t
  const points = kept.map((p) => ({ lat: p.lat, lng: p.lng, t: p.t - base }))
  const lats = points.map((p) => p.lat)
  const lngs = points.map((p) => p.lng)

  return {
    points,
    gaps,
    /** A GPX is what the device recorded, not a decimation of it. */
    simplified: false,
    bbox: [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)],
    pointCount: points.length,
  }
}

/**
 * The adapter. Only `normalize` is implemented, and the other three throw rather than
 * returning something plausible: this adapter is never registered, never reaches the queue and
 * never touches the network, and a silent no-op would be a way for it to end up somewhere real.
 */
export const gpxFixtureAdapter: SourceAdapter<never> = {
  id: "gpx-fixture",

  accept(): Promise<AckResult> {
    throw new Error("gpxFixtureAdapter is a test fixture — it has no inbound path")
  },

  fetchRaw(): Promise<{ body: Buffer; contentType: string; ext: string; schemaHint: string }> {
    throw new Error("gpxFixtureAdapter is a test fixture — its bytes are checked in")
  },

  listSince(): AsyncIterable<IngestJob> {
    throw new Error("gpxFixtureAdapter is a test fixture — it has nothing to sweep")
  },

  normalize(raw: Buffer, ref: RawArchiveRef, job: IngestJob): NormalizedIngest {
    const gpx = raw.toString("utf8")
    const startedAt = /<metadata>\s*<time>([^<]+)<\/time>/.exec(gpx)?.[1]
    if (startedAt === undefined) throw new Error("gpxFixtureAdapter: no <metadata><time>")

    const trace = gpxToTrace(gpx, "run")
    const elapsed = trace ? Math.round((trace.points[trace.points.length - 1]?.t ?? 0) / 1000) : 0

    const activity: Activity = {
      activityId: computeActivityId(job.userId, job.source, job.externalId),
      userId: job.userId,
      kind: "run",
      startedAt: new Date(startedAt).toISOString(),
      /** No offset, per I-13 — the fixture's instants are UTC and the local clock matches. */
      startedAtLocal: new Date(startedAt).toISOString().slice(0, 19),
      timezone: "UTC",
      elapsedS: elapsed,
      hasTrace: trace !== undefined,
      dedupeKey: createHash("sha256").update(`${job.userId}:${startedAt}`).digest("hex"),
      ingestedAt: ref.archivedAt,
      revision: 1,
      source: {
        source: job.source,
        externalId: job.externalId,
        sourceTypeRaw: "run",
        fetchedAt: ref.archivedAt,
      },
      raw: ref,
    } as Activity

    return { activity, trace }
  },
}
