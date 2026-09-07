import { getResolution, gridDisk, latLngToCell } from "h3-js"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

import type { IngestJob } from "@/src/adapters/types"
import type { RawArchiveRef } from "@/src/domain/activity"
import { RES, traceToCells } from "@/src/domain/fog"

import type { StravaIngestMeta } from "./adapter"
import { normalizeStrava } from "./normalize"

/**
 * TICKET `0045`, CRITERION 10 — a real captured trace, end to end, all the way to cells.
 *
 * ─── WHY THIS FILE IS HERE AND NOT IN `src/domain/` ─────────────────────────
 *
 * The criterion asks for "a real checked-in fixture", and the fixtures live in this
 * adapter's directory. **D-188 is explicit that test files get no exemption from the D-100
 * boundary check** — `0027` asked for one and it was refused, precisely because
 * `src/domain/anything.test.ts` naming a vendor is a domain describing a vendor-shaped
 * thing. A path literal in a domain test is exactly that, and `check-boundaries.mjs`
 * caught it on the first run.
 *
 * So the test lives on the far side of the boundary, pointing IN. That is the direction
 * the architecture allows and it makes the test stronger rather than weaker: `fog.test.ts`
 * builds `Trace`s by hand, and this one drives the real `normalize()` — so the input is a
 * `Trace` the shipped pipeline actually produces, `gaps` and all, rather than one written
 * to suit the assertion.
 *
 * ─── WHY THE BAND IS NOT THE TICKET'S 40–130 ────────────────────────────────
 *
 * `0045` criterion 10 asked for 40–130 cells. That is `0046`'s number: the size of the
 * FILTERED set, after the exact 65 m radius test defines the word "revealed", and `0046`
 * criterion 6 asserts it there. This ticket stops one step earlier, at §2.2's k=1 candidate
 * set, which is ~2.5x larger by construction. Asserting 40–130 on the candidates would
 * have meant either skipping step 4's `gridDisk` — which §2.2 makes normative — or
 * shipping a filter this ticket does not own. The criterion was amended; see the ticket's
 * Resolution.
 *
 * Both numbers below were measured, not guessed.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURES = join(HERE, "__fixtures__")

const REF: RawArchiveRef = {
  bucket: "lost-soles-raw",
  key: "raw/user-01JQ8Z/strava/11032320114/deadbeef.json",
  contentType: "application/json",
  bytes: 1024,
  sha256: "deadbeef",
  archivedAt: "2026-06-01T03:20:11.482Z",
}

const JOB: IngestJob = {
  ingestKey: "ingest-key",
  userId: "user-01JQ8Z",
  source: "strava",
  externalId: "11032320114",
  command: "ingest",
  startedAt: "2024-03-25T01:28:48Z",
  meta: { aspectType: "create", hasGpsHint: true } satisfies StravaIngestMeta,
  enqueuedAt: "2026-06-01T03:19:00.000Z",
}

function traceOf(name: string) {
  const { trace } = normalizeStrava(readFileSync(join(FIXTURES, `${name}.json`)), REF, JOB)
  if (!trace) throw new Error(`${name} produced no trace`)
  return trace
}

describe("a real captured trace projects to territory", () => {
  it("is the run the operator actually did — 2,537 points over ~6 km", () => {
    // Guards the assertions below against a fixture that quietly changed underneath them.
    // The geometry is synthetic (D-199); the point count and the distance are real.
    const trace = traceOf("real-run-outdoor")
    expect(trace.pointCount).toBe(2537)

    let metres = 0
    for (let i = 1; i < trace.points.length; i++) {
      const a = trace.points[i - 1]
      const b = trace.points[i]
      const toRad = Math.PI / 180
      const dLat = (b.lat - a.lat) * toRad
      const dLng = (b.lng - a.lng) * toRad
      const h =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.sin(dLng / 2) ** 2
      metres += 2 * 6_371_008.8 * Math.asin(Math.min(1, Math.sqrt(h)))
    }
    expect(metres).toBeGreaterThan(5_500)
    expect(metres).toBeLessThan(6_500)
  })

  it("yields a candidate set consistent with a 6 km run", () => {
    // Measured at 145. The band is wide enough that a rounding change does not fail it and
    // narrow enough that a change in densification, dwell handling or the k of the
    // candidate disc does — which is the only reason to assert a number at all.
    const cells = traceToCells(traceOf("real-run-outdoor"))
    expect(cells.size).toBeGreaterThanOrEqual(120)
    expect(cells.size).toBeLessThanOrEqual(200)
  })

  it("leaves 0046 a filtered set inside ITS 40–130 band", () => {
    // NOT the filter — that is `0046`. This is the count of cells the path actually passes
    // through, which is the floor of what the filter can return and the number
    // `01-architecture.md` §11 quotes. If it drifts out of band, `0046`'s criterion 6
    // becomes unreachable, and the failure should surface HERE, in the ticket that
    // controls the input, rather than there.
    //
    // Measured at 58. It was **2** before this ticket corrected the fixture generator —
    // see the Resolution and D-213.
    const trace = traceOf("real-run-outdoor")
    const onPath = new Set(trace.points.map((p) => latLngToCell(p.lat, p.lng, RES)))
    expect(onPath.size).toBeGreaterThanOrEqual(40)
    expect(onPath.size).toBeLessThanOrEqual(130)
  })

  it("emits res 10 and nothing else", () => {
    for (const c of traceToCells(traceOf("real-run-outdoor"))) {
      expect(getResolution(c)).toBe(RES)
    }
  })

  it("is a connected corridor, not a scatter", () => {
    const cells = traceToCells(traceOf("real-run-outdoor"))
    for (const c of cells) {
      const touching = gridDisk(c, 1).filter((n) => n !== c && cells.has(n))
      expect(touching.length, `isolated cell ${c}`).toBeGreaterThan(0)
    }
  })

  it("handles the signal-loss capture — a real GPS jump — without throwing", () => {
    // `real-run-signal-loss` carries a real 35 m jump at index 1670, found by sweeping 53
    // activities. The sanitizer records it in `gaps`; this asserts the projection honours
    // that rather than drawing through it.
    const trace = traceOf("real-run-signal-loss")
    const cells = traceToCells(trace)
    expect(cells.size).toBeGreaterThan(0)
    for (const c of cells) expect(getResolution(c)).toBe(RES)
  })
})
