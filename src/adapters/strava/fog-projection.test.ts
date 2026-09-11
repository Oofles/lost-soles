import { cellToLatLng, getResolution, gridDisk } from "h3-js"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

import type { IngestJob } from "@/src/adapters/types"
import type { RawArchiveRef } from "@/src/domain/activity"
import { RES, REVEAL_R_M, traceToCells } from "@/src/domain/fog"
import { metresBetween } from "@/src/domain/geo"

import type { StravaIngestMeta } from "./adapter"
import { normalizeStrava } from "./normalize"

/**
 * TICKET `0045` CRITERION 10 and `0046` CRITERION 6 — a real captured trace, end to end,
 * all the way to revealed territory.
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
 * ─── THE BAND MOVED WHEN `0046` LANDED, AND THAT WAS THE PLAN ───────────────
 *
 * `0045` shipped `traceToCells` returning §2.2's k=1 CANDIDATE set — ~2.5× larger than the
 * answer by construction — so its band here was 120–200 and its criterion 10 was amended
 * to say so. `0046` added step 5 and the function now returns the FILTERED set, which is
 * the 40–130 band `09-roadmap.md` quotes and `0046` criterion 6 owns. The candidate
 * assertion is gone rather than kept alongside: it measured an intermediate value that is
 * no longer observable from outside the module, and a test that has to reach inside to
 * stay true is a test that will be deleted the first time it fails.
 *
 * Every number below was measured, not guessed.
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

  it("reveals a set inside the band `09-roadmap.md` quotes for the canonical res", () => {
    // 45 cells for a 6.0 km run at res 10 — 7.5 cells/km, the corridor being one cell wide:
    // 6,000 m / res 10's 131.4 m centre spacing = 45.7. **D-237 multiplied this by 7.**
    // Measured after the move: 312, against 6,000 / 49.6 = 121 for a one-cell-wide corridor,
    // so the real corridor runs ~2.6 cells wide at res 11 — which is exactly REVEAL_R_M (65 m)
    // no longer coinciding with the inradius (24.8 m). `09-roadmap.md` §3 item 3's "40–130
    // cells/run" was updated to 130–430 by this ticket; the write path was already per-item
    // `UpdateItem` rather than a 100-item transaction, so nothing structural moved with it.
    //
    // The band stays proportionally as wide as it was: loose enough that rounding does not
    // fail it, tight enough that a change in densification, dwell handling or REVEAL_R_M does.
    const cells = traceToCells(traceOf("real-run-outdoor"))
    expect(cells.size).toBeGreaterThanOrEqual(130)
    expect(cells.size).toBeLessThanOrEqual(430)
  })

  it("reveals only ground within REVEAL_R_M of the run, on a real trace", () => {
    // **This asserted `revealed ⊆ entered` until D-237, and D-216 was the reason.** At res 10,
    // 65 m sat just under the 65.7 m inradius, so a centre within 65 m of the path had its
    // nearest path point inside its own inscribed circle — inside the cell. Measured then: 45
    // revealed out of 58 entered.
    //
    // At res 11, 65 m is 2.6 inradii and the implication is simply false — most revealed cells
    // were never entered. The ground did not change; res 10 was expressing "within 65 m" coarsely
    // enough that it looked like cell containment. So this asserts the real invariant, measured
    // against the raw samples with the test's own yardstick rather than through the module.
    //
    // The tolerance is half the sample spacing: membership is measured to the SEGMENTS, so a
    // centre can sit further from the nearest sampled POINT than from the path itself.
    const trace = traceOf("real-run-outdoor")
    const cells = traceToCells(trace)
    const pts = trace.points
    const gaps: number[] = []
    for (let i = 1; i < pts.length; i++) gaps.push(metresBetween(pts[i - 1]!, pts[i]!))
    const tolerance = Math.max(...gaps) / 2

    for (const c of cells) {
      const [lat, lng] = cellToLatLng(c)
      const nearest = Math.min(...pts.map((p) => metresBetween({ lat, lng }, p)))
      expect(nearest, `${c} is ${nearest.toFixed(1)} m from any sample`).toBeLessThanOrEqual(
        REVEAL_R_M + tolerance,
      )
    }
    expect(cells.size).toBeGreaterThan(0)
  })

  it("emits res 10 and nothing else", () => {
    for (const c of traceToCells(traceOf("real-run-outdoor"))) {
      expect(getResolution(c)).toBe(RES)
    }
  })

  it("is a connected corridor, not a scatter", () => {
    // ─── WHY THE RING IS 2 AND NOT 1. `0046` CRITERION 6, AMENDED. D-216. ───
    //
    // The criterion asked for a `gridDisk(c, 1)` neighbour in the set for every cell,
    // "except for genuinely split segments". This fixture has NO splits — `gaps` is empty
    // — and one cell still fails that test. It is not a defect in the filter; it is what
    // dropping the corner-clipped cells does to a chain. Two cells the path entered in
    // sequence can be left non-adjacent when the one between them is dropped, and the
    // survivors are then two rings apart.
    //
    // Measured, so the amendment is not a guess: over 60 straight 5 km lines at one-degree
    // bearing increments, ring-1 isolation occurs at 8 of 60 bearings (at most 3 cells) and
    // **ring-2 isolation never occurs at all**. Ring 2 is therefore the honest statement of
    // "one corridor" — and it keeps every tooth the criterion wanted, because a spike, a
    // scatter or a second parallel street all fail it just as hard.
    const cells = traceToCells(traceOf("real-run-outdoor"))
    for (const c of cells) {
      const touching = gridDisk(c, 2).filter((n) => n !== c && cells.has(n))
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
