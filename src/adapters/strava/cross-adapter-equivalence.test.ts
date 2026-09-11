import { UNITS, getHexagonEdgeLengthAvg } from "h3-js"

import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import type { RawArchiveRef } from "@/src/domain/activity"
import { RES, traceToCells } from "@/src/domain/fog"

import { gpxFixtureAdapter } from "../__fixtures__/gpx-adapter"
import {
  assertEquivalentCellSets,
  compareCellSets,
  MAX_CELL_SET_DIVERGENCE,
} from "../__fixtures__/cell-set-equivalence"
import type { IngestJob } from "../types"
import { normalizeStrava } from "./normalize"

/**
 * CROSS-ADAPTER CELL-SET EQUIVALENCE — `contracts/ingestion-contract.md` §5 check 3.
 * Ticket `0155`, split out of `0027`'s T3.
 *
 * ─── WHY THE DRIVER IS HERE AND THE HARNESS IS NOT ──────────────────────────
 *
 * This file names the primary adapter, so `check-boundaries.mjs` requires it to live inside
 * that adapter's directory — D-188 refuses test files an exemption, and `0027` asked for one
 * and was turned down. `fog-projection.test.ts` beside it is here for the same reason.
 *
 * The consequence is worth stating plainly rather than discovering on migration day: **this
 * file dies with the adapter it names.** Everything that would otherwise have to be re-argued
 * — the tolerance, its justification, the adjacency rule, the failure message — is in
 * `../__fixtures__/cell-set-equivalence.ts`, which does not. A replacement adapter writes a
 * driver this length against a harness that already exists, which is exactly what `0027` meant
 * by *"the difference between a one-week migration and a rewrite."*
 *
 * ─── THE TWO INPUTS ARE ONE PHYSICAL RUN ────────────────────────────────────
 *
 * `real-run-outdoor.json` is a captured response, re-based to Point Nemo per D-199: 2,537
 * fixes, 6,043 m. `../__fixtures__/equivalence-run.gpx` is the same run as GPX at five decimal
 * places — 1.1 m, deliberately coarser than the stream's six, so the comparison runs against a
 * genuine precision disagreement rather than two renderings of identical doubles.
 */
const REF: RawArchiveRef = {
  bucket: "b",
  key: "k",
  contentType: "application/json",
  bytes: 1,
  sha256: "0".repeat(64),
  archivedAt: "2024-03-25T02:30:00.000Z",
}

const job = (source: string): IngestJob => ({
  ingestKey: `k-${source}`,
  userId: "u-equivalence",
  source,
  externalId: "11032320114",
  command: "ingest",
  startedAt: "2024-03-25T01:28:48.000Z",
  enqueuedAt: "2024-03-25T02:30:00.000Z",
  meta: {},
})

const primaryCells = () => {
  const raw = readFileSync(join(import.meta.dirname, "__fixtures__/real-run-outdoor.json"))
  const { trace } = normalizeStrava(raw, REF, job("strava"))
  if (trace === undefined) throw new Error("the primary fixture produced no trace")
  return traceToCells(trace)
}

const fixtureCells = () => {
  const raw = readFileSync(join(import.meta.dirname, "../__fixtures__/equivalence-run.gpx"))
  const { trace } = gpxFixtureAdapter.normalize(raw, REF, job("gpx-fixture"))
  if (trace === undefined) throw new Error("the GPX fixture produced no trace")
  return traceToCells(trace)
}

describe("one physical run, two adapters, the same territory", () => {
  it("both adapters produce a trace at all — the test fails if either is removed", () => {
    const primary = primaryCells()
    const fixture = fixtureCells()
    expect(primary.size).toBeGreaterThan(0)
    expect(fixture.size).toBeGreaterThan(0)
    for (const cell of [...primary, ...fixture]) expect(cell).toHaveLength(15)
  })

  it("projects to the same H3 res-10 cell set, within tolerance", () => {
    const result = assertEquivalentCellSets(primaryCells(), fixtureCells(), {
      a: "strava (JSON streams, 6 dp)",
      b: "gpx-fixture (XML trkpt, 5 dp)",
    })
    expect(result.isolated).toEqual([])
    expect(result.divergence).toBeLessThanOrEqual(MAX_CELL_SET_DIVERGENCE)
  })

  /**
   * THE HONEST HEADLINE, asserted rather than merely permitted by the tolerance. A 65 m reveal
   * radius is not sensitive to metre-scale disagreement, so two independent implementations of
   * the same contract, fed the same run at different precision, agree EXACTLY.
   *
   * Asserted separately from the tolerance on purpose: *"a tolerance wide enough to never fail
   * is a test that has been deleted without anyone noticing"* (`0155`'s Notes). This is what
   * the fixtures actually do today; the tolerance is the bar a future adapter must clear, and
   * `cell-set-equivalence.test.ts` proves that bar has teeth.
   */
  it("in fact agrees EXACTLY — the tolerance is a bar, not a crutch", () => {
    const primary = primaryCells()
    const fixture = fixtureCells()
    const result = compareCellSets(primary, fixture)

    expect(result.onlyA).toEqual([])
    expect(result.onlyB).toEqual([])
    expect(result.divergence).toBe(0)
    expect(primary.size).toBe(fixture.size)
  })

  it("and it is a real run, not a degenerate one that would agree trivially", () => {
    const primary = primaryCells()
    // 6,043 m of run. Two empty sets would also "agree", so this guards the guard. The floor
    // is derived from the grid rather than typed: one cell wide along the route is
    // length / (2 x inradius), which is 46 at res 10 and 122 at res 11 (D-237).
    const spacing = 2 * getHexagonEdgeLengthAvg(RES, UNITS.m) * Math.cos(Math.PI / 6)
    expect(primary.size).toBeGreaterThan((6_043 / spacing) * 0.6)
    expect(RES).toBe(11)
  })

  /**
   * The two normalizers genuinely disagree about the trace — different precision, different
   * sanitation — and still agree about the territory. If this ever starts passing because the
   * two traces became identical, the second adapter has stopped being a second code path.
   */
  it("the two traces are NOT identical, so the agreement is not trivial", () => {
    const stravaTrace = normalizeStrava(
      readFileSync(join(import.meta.dirname, "__fixtures__/real-run-outdoor.json")),
      REF,
      job("strava"),
    ).trace!
    const gpxTrace = gpxFixtureAdapter.normalize(
      readFileSync(join(import.meta.dirname, "../__fixtures__/equivalence-run.gpx")),
      REF,
      job("gpx-fixture"),
    ).trace!

    expect(gpxTrace.points).not.toEqual(stravaTrace.points)
    // …and specifically because the coordinates were rounded, not because points were lost.
    const differing = gpxTrace.points.filter(
      (p, i) => p.lat !== stravaTrace.points[i]?.lat || p.lng !== stravaTrace.points[i]?.lng,
    )
    expect(differing.length).toBeGreaterThan(100)
  })
})
