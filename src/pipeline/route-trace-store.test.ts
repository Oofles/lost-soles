import { gunzipSync } from "node:zlib"

import { PutObjectCommand } from "@aws-sdk/client-s3"
import { describe, expect, it } from "vitest"

import type { GeoPoint } from "@/src/domain/activity"

import {
  COORDINATE_DECIMAL_PLACES,
  routeTraceKey,
  segmentsToGeometry,
  writeRouteTrace,
  type RouteTraceGeometry,
} from "./route-trace-store"

/**
 * Ticket `0195`. `02-data-model.md` §5.1 (S-7).
 *
 * GEOMETRY IS SYNTHETIC, near Point Nemo — `08-security-privacy.md` §7.2, D-199.
 */

const p = (lat: number, lng: number, t = 0): GeoPoint => ({ lat, lng, t })

/** Records what was PUT, so a test can read the body rather than trust the call happened. */
function recorder() {
  const puts: Array<{ Bucket?: string; Key?: string; Body?: unknown; [k: string]: unknown }> = []
  return {
    puts,
    s3: {
      async send(command: PutObjectCommand) {
        puts.push(command.input as (typeof puts)[number])
        return {}
      },
    },
  }
}

const bodyOf = (input: { Body?: unknown }): RouteTraceGeometry =>
  JSON.parse(gunzipSync(input.Body as Uint8Array).toString("utf8")) as RouteTraceGeometry

describe("routeTraceKey", () => {
  it("scopes the object to the owning user, under users/", () => {
    expect(routeTraceKey("u-1", "strava#9001")).toBe("users/u-1/traces/strava#9001.segments.json.gz")
  })

  /**
   * The rule `check-boundaries.mjs` enforces, asserted here as well because the name is a
   * DESIGN divergence (D-235) and not an implementation detail. A future session that "fixes"
   * the key back to what `02` §5.1 originally said fails CI — and then fails here, with the
   * reason attached, which is the half CI cannot supply.
   */
  it("does not name the artefact after a degraded Strava trace (D-121, D-235)", () => {
    expect(routeTraceKey("u-1", "a-1")).not.toMatch(/polyline/i)
  })
})

describe("segmentsToGeometry", () => {
  it("emits GeoJSON [lng, lat] order, not [lat, lng]", () => {
    const g = segmentsToGeometry([[p(-48.876, -123.393), p(-48.875, -123.392)]])
    expect(g.coordinates[0]![0]).toEqual([-123.393, -48.876])
  })

  it("is always a MultiLineString, even for a single unsplit run", () => {
    const g = segmentsToGeometry([[p(1, 2), p(3, 4)]])
    expect(g.type).toBe("MultiLineString")
    expect(g.coordinates).toHaveLength(1)
  })

  it("emits one line per segment, in order", () => {
    const g = segmentsToGeometry([
      [p(1, 1), p(1, 2)],
      [p(5, 5), p(5, 6)],
    ])
    expect(g.coordinates).toHaveLength(2)
    expect(g.coordinates[0]![0]).toEqual([1, 1])
    expect(g.coordinates[1]![0]).toEqual([5, 5])
  })

  /**
   * `0057` CRITERION 8, AT THE STORAGE LAYER. The two lines above are stored as two lines, so
   * there is no vertex anywhere joining `[1,2]` to `[5,5]`. A renderer cannot draw a chord it
   * was never given.
   */
  it("puts no vertex between two segments", () => {
    const g = segmentsToGeometry([
      [p(1, 1), p(1, 2)],
      [p(5, 5), p(5, 6)],
    ])
    const flat = g.coordinates.flat()
    expect(flat).toHaveLength(4)
    expect(g.coordinates[0]!.at(-1)).toEqual([2, 1])
    expect(g.coordinates[1]![0]).toEqual([5, 5])
  })

  it("drops a segment too short to be a line", () => {
    const g = segmentsToGeometry([[p(1, 1)], [p(5, 5), p(5, 6)]])
    expect(g.coordinates).toHaveLength(1)
    expect(g.coordinates[0]![0]).toEqual([5, 5])
  })

  it("rounds to the documented precision rather than to whatever float printing gives", () => {
    const g = segmentsToGeometry([[p(-48.87612345678, -123.39387654321), p(1, 2)]])
    const [lng, lat] = g.coordinates[0]![0]!
    expect(lng).toBe(-123.393877)
    expect(lat).toBe(-48.876123)
    expect(COORDINATE_DECIMAL_PLACES).toBe(6)
  })
})

describe("writeRouteTrace", () => {
  const deps = () => {
    const r = recorder()
    return { r, deps: { s3: r.s3, bucket: "bkt" } }
  }

  it("gzips the geometry and declares the encoding", async () => {
    const { r, deps: d } = deps()
    const key = await writeRouteTrace(
      { userId: "u-1", activityId: "a-1", segments: [[p(1, 1), p(1, 2)]] },
      d,
    )

    expect(key).toBe("users/u-1/traces/a-1.segments.json.gz")
    expect(r.puts).toHaveLength(1)
    expect(r.puts[0]!.Bucket).toBe("bkt")
    expect(r.puts[0]!.ContentEncoding).toBe("gzip")
    expect(r.puts[0]!.ContentType).toBe("application/geo+json")
    expect(bodyOf(r.puts[0]!).coordinates).toEqual([[[1, 1], [2, 1]]])
  })

  /**
   * NOT `immutable`, and `02` §5.1 says "one immutable GET". T3 carries a `revision` field
   * precisely because a source-side edit re-ingests the same activity under the same key, and a
   * year-long immutable cache on a rewritable object is the pmtiles trap `lib/basemap.ts` sets
   * out: the stale copy is not detectably stale, it is just wrong.
   */
  it("does not claim a rewritable object is immutable", async () => {
    const { r, deps: d } = deps()
    await writeRouteTrace({ userId: "u", activityId: "a", segments: [[p(1, 1), p(1, 2)]] }, d)
    expect(r.puts[0]!.CacheControl).toBe("no-cache")
  })

  /**
   * `05` §3.6. A treadmill run, a manual entry, a strength session — and a trace so degraded
   * that §2.2 left no segment two points long. None is an error, and none may leave an object
   * behind for `/api/runs/latest` to serve as though it were a route.
   */
  it("writes nothing and returns null when there is no line to store", async () => {
    const { r, deps: d } = deps()
    expect(await writeRouteTrace({ userId: "u", activityId: "a", segments: [] }, d)).toBeNull()
    expect(await writeRouteTrace({ userId: "u", activityId: "a", segments: [[p(1, 1)]] }, d)).toBeNull()
    expect(r.puts).toHaveLength(0)
  })

  /** Deterministic key, deterministic body — which is what lets the phase sit above the transaction. */
  it("is idempotent: the same input writes the same key and the same bytes", async () => {
    const { r, deps: d } = deps()
    const input = { userId: "u-1", activityId: "a-1", segments: [[p(1, 1), p(1, 2)]] }
    await writeRouteTrace(input, d)
    await writeRouteTrace(input, d)
    expect(r.puts[0]!.Key).toBe(r.puts[1]!.Key)
    expect(Buffer.from(r.puts[0]!.Body as Uint8Array)).toEqual(
      Buffer.from(r.puts[1]!.Body as Uint8Array),
    )
  })
})
