import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import type { GeoPoint, RawArchiveRef } from "@/src/domain/activity"

import type { IngestJob } from "../types"

import { MIN_POINTS_PER_SECOND, fidelityFloorViolation } from "./fidelity"
import { normalizeStrava } from "./normalize"

const FIXTURES = join(import.meta.dirname, "__fixtures__")
const envelope = (name: string) =>
  JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), "utf8")) as {
    detail: Record<string, unknown>
    streams: Record<string, { data: unknown[]; original_size?: number }> | null
  }

const REF: RawArchiveRef = {
  bucket: "lost-soles-raw",
  key: "raw/user-01JQ8Z/strava/11032320114/deadbeef.json",
  contentType: "application/json",
  bytes: 1024,
  sha256: "deadbeef",
  archivedAt: "2026-09-06T00:00:00.482Z",
}

const job = (over: Partial<IngestJob> = {}): IngestJob => ({
  ingestKey: "ingest-key",
  userId: "user-01JQ8Z",
  source: "strava",
  externalId: "11032320114",
  command: "ingest",
  meta: { aspectType: "create", hasGpsHint: true, startedAt: "2024-03-25T01:28:48Z" },
  enqueuedAt: "2026-09-06T00:10:00.000Z",
  ...over,
})

/** A 1 Hz track, `n` points, one metre apart. Point Nemo — see `__fixtures__/README.md`. */
const track = (n: number, everyMs = 1000): GeoPoint[] =>
  Array.from({ length: n }, (_, i) => ({
    lat: -48.876 + i * 0.00001,
    lng: -123.393,
    t: Date.UTC(2026, 0, 1) + i * everyMs,
  }))

describe("the fidelity floor — the threshold", () => {
  it("passes a 1 Hz trace", () => {
    expect(fidelityFloorViolation(track(600), true)).toBeNull()
  })

  it("passes a trace sampled every 3 seconds, just inside the floor", () => {
    expect(fidelityFloorViolation(track(200, 3_000), true)).toBeNull()
  })

  it("REFUSES a trace sampled every 10 seconds", () => {
    expect(fidelityFloorViolation(track(200, 10_000), true)).toMatch(/fidelity floor/)
  })

  it("names the measured rate and the threshold, so the failure is diagnosable", () => {
    const msg = fidelityFloorViolation(track(200, 10_000), true)
    expect(msg).toContain("10.0s")
    expect(msg).toContain("0.10 points/second")
    expect(msg).toContain(String(MIN_POINTS_PER_SECOND))
  })
})

describe("the fidelity floor — what it must NOT reject", () => {
  /**
   * The pause case, and the reason the statistic is a median rather than a mean.
   *
   * A 40-minute run with a 20-minute stop is a full-resolution 1 Hz trace throughout. Its
   * MEAN rate is 0.67 points/second and a long enough stop drives it under any floor —
   * so a mean would refuse to ingest a real run because the operator waited at a level
   * crossing. Every gap this repo already models (D-198) has this shape.
   */
  it("passes a 1 Hz trace containing a two-hour pause", () => {
    // The forgotten watch: 20 minutes of running, a two-hour stop, 20 minutes more. Every
    // sample one second apart, nothing decimated about it.
    const PAUSE_MS = 2 * 60 * 60 * 1000
    const before = track(1200)
    const after = track(1200).map((p) => ({ ...p, t: p.t + 1200_000 + PAUSE_MS }))
    const points = [...before, ...after]

    // The MEAN rate does not merely dip — it falls below the floor outright, so a mean
    // would refuse to ingest a real run because the operator stopped for lunch.
    const meanRate = (points.length * 1000) / (points[points.length - 1].t - points[0].t)
    expect(meanRate).toBeLessThan(MIN_POINTS_PER_SECOND)

    // The median is untouched: one gap moves one interval to the end of a sorted list.
    expect(fidelityFloorViolation(points, true)).toBeNull()
  })

  it("passes a trace too short to measure rather than guessing about it", () => {
    // 20 points over 20 seconds. Under a minute there is not enough of a sample for the
    // ratio to mean anything, and such a trace reveals almost no fog either way.
    expect(fidelityFloorViolation(track(20), true)).toBeNull()
  })

  it("passes a single-point trace", () => {
    expect(fidelityFloorViolation(track(1), true)).toBeNull()
  })
})

describe("an absent time stream is the failure, not a reason to skip the check", () => {
  /**
   * THE HALF WITHOUT WHICH THE OTHER HALF IS DECORATIVE.
   *
   * `buildTrace` derives each timestamp as `startedAt + (offsetS ?? i) * 1000`. With no
   * `time` stream that falls back to the array INDEX, fabricating a flawless 1 Hz cadence
   * out of nothing — so a trace decoded from a `summary_polyline`, which carries no time
   * stream at all, would arrive with perfectly spaced synthetic timestamps and clear a
   * sampling-rate floor with room to spare. The check would report "clean" for precisely
   * the input it exists to reject.
   */
  it("REFUSES a trace whose timestamps could only have been synthesised", () => {
    expect(fidelityFloorViolation(track(600), false)).toMatch(/no time stream/)
  })

  it("says why, naming the summary_polyline shape it is catching", () => {
    expect(fidelityFloorViolation(track(600), false)).toMatch(/summary_polyline/)
  })

  it("still ignores a trace too small to be a trace", () => {
    expect(fidelityFloorViolation(track(1), false)).toBeNull()
  })
})

/**
 * Ramer-Douglas-Peucker, the algorithm that produces a `summary_polyline`.
 *
 * Written out here rather than imported because a decimator is not something this
 * repository should own outside a test (D-121, and see `adapter.test.ts`'s decoder guard).
 * It exists to build the adversarial input, nothing else.
 */
function rdp(points: GeoPoint[], epsilonDeg: number): GeoPoint[] {
  if (points.length < 3) return points
  const [first] = points
  const last = points[points.length - 1]

  let worst = 0
  let index = 0
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicular(points[i], first, last)
    if (d > worst) {
      worst = d
      index = i
    }
  }

  if (worst <= epsilonDeg) return [first, last]
  return [
    ...rdp(points.slice(0, index + 1), epsilonDeg).slice(0, -1),
    ...rdp(points.slice(index), epsilonDeg),
  ]
}

function perpendicular(p: GeoPoint, a: GeoPoint, b: GeoPoint): number {
  const dx = b.lng - a.lng
  const dy = b.lat - a.lat
  if (dx === 0 && dy === 0) return Math.hypot(p.lng - a.lng, p.lat - a.lat)
  const t = ((p.lng - a.lng) * dx + (p.lat - a.lat) * dy) / (dx * dx + dy * dy)
  const cx = a.lng + t * dx
  const cy = a.lat + t * dy
  return Math.hypot(p.lng - cx, p.lat - cy)
}

describe("the criterion: a decimated real trace fails the build", () => {
  const NAME = "real-run-outdoor"

  it("normalizes the real captured trace", () => {
    const { trace } = normalizeStrava(Buffer.from(JSON.stringify(envelope(NAME))), REF, job())
    expect(trace?.pointCount).toBeGreaterThan(2000)
    expect(trace?.simplified).toBe(false)
  })

  it("REFUSES the same trace after RDP decimation to summary_polyline density", () => {
    const env = envelope(NAME)
    const streams = env.streams!
    const points = (streams.latlng.data as Array<[number, number]>).map((pair, i) => ({
      lat: pair[0],
      lng: pair[1],
      t: (streams.time.data as number[])[i] * 1000,
    }))

    // ~1e-4 degrees is roughly 11 m of tolerance, which is the order Strava's own
    // summary_polyline uses: it takes this 2,537-point track down to the low hundreds,
    // matching the 20-49 points/km measured off real responses in D-200.
    const kept = rdp(points, 1e-4)
    expect(kept.length).toBeLessThan(points.length / 5)

    const keptIndices = new Set(kept.map((p) => points.findIndex((q) => q.t === p.t)))
    for (const key of Object.keys(streams)) {
      streams[key].data = streams[key].data.filter((_, i) => keptIndices.has(i))
    }

    expect(() => normalizeStrava(Buffer.from(JSON.stringify(env)), REF, job())).toThrow(
      /fidelity floor/,
    )
  })

  it("stops ingestion rather than logging — the throw IS the contract", () => {
    // Criterion: "The floor's failure is an error that stops ingestion for that activity,
    // not a logged warning." normalize() is pure (D-196) and cannot log, so there is no
    // other channel it could have used; this asserts the caller gets nothing back.
    const env = envelope(NAME)
    const streams = env.streams!
    for (const key of Object.keys(streams)) {
      streams[key].data = streams[key].data.filter((_, i) => i % 60 === 0)
    }
    let returned: unknown = "not thrown"
    try {
      returned = normalizeStrava(Buffer.from(JSON.stringify(env)), REF, job())
    } catch (e) {
      returned = e
    }
    expect(returned).toBeInstanceOf(Error)
  })
})
