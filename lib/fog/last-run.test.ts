import { describe, expect, it, vi } from "vitest"

import { encodeLastRunBlob } from "@/src/domain/explored-blob"
import { lastRunDay } from "@/src/pipeline/explored-cells"

import { ExploredSet } from "./explored-set"
import { httpLastRunFetch, LastRunDays, loadLastRun, todayDay } from "./last-run"

/**
 * TICKET 0100 — the `lastRunDay` sidecar in the browser (operator, 2026-10-20, Q1 = A).
 *
 * The sidecar is parallel to ONE generation's cell array. These hold the two halves of that: it is
 * refused when it does not belong to the set it is asked for, and after a mid-session delta it is
 * still looked up by cell, with the delta's new cells unknown (fresh, never cold — 05 §7.2).
 */

const cells = BigUint64Array.from([10n, 20n, 30n, 40n])
const days = Uint16Array.from([100, 200, 300, 400])

describe("LastRunDays", () => {
  it("is an index while the set still holds the sidecar's own array", () => {
    const lastRun = new LastRunDays(cells, days, 7)
    expect([0, 1, 2, 3].map((i) => lastRun.dayAt(cells, i))).toEqual([100, 200, 300, 400])
  })

  it("is a search after a delta replaced the array, and a delta's new cell is unknown", () => {
    const lastRun = new LastRunDays(cells, days, 7)
    const afterDelta = BigUint64Array.from([10n, 15n, 20n, 30n, 40n])
    expect([0, 1, 2, 3, 4].map((i) => lastRun.dayAt(afterDelta, i))).toEqual([100, undefined, 200, 300, 400])
    expect(lastRun.dayOf(41n)).toBeUndefined()
    expect(lastRun.dayOf(5n)).toBeUndefined()
  })

  it("refuses days that are not parallel to the cells", () => {
    expect(() => new LastRunDays(cells, Uint16Array.from([1, 2, 3]), 7)).toThrow(/parallel/)
  })
})

describe("loadLastRun", () => {
  it("fetches the set's own generation and holds the days beside its cells", async () => {
    const set = ExploredSet.fromCells(cells, 7)
    const fetchBytes = vi.fn(async () => encodeLastRunBlob(days, 7))
    const lastRun = await loadLastRun(set, fetchBytes)
    expect(fetchBytes).toHaveBeenCalledWith(7)
    expect(lastRun.generation).toBe(7)
    expect(lastRun.dayAt(set.cells, 3)).toBe(400)
  })

  it("refuses a sidecar from another generation (D-219)", async () => {
    const set = ExploredSet.fromCells(cells, 7)
    await expect(loadLastRun(set, async () => encodeLastRunBlob(days, 8))).rejects.toThrow(/generation 7/)
  })

  it("refuses a sidecar whose count is not the set's", async () => {
    const set = ExploredSet.fromCells(cells, 7)
    await expect(loadLastRun(set, async () => encodeLastRunBlob([1, 2, 3], 7))).rejects.toThrow(/parallel/)
  })

  it("does not ask for a generation that cannot have a sidecar", async () => {
    const fetchBytes = vi.fn(async () => new Uint8Array(0))
    await expect(loadLastRun(ExploredSet.fromCells(cells, -1), fetchBytes)).rejects.toThrow()
    expect(fetchBytes).not.toHaveBeenCalled()
  })

  it("fetches /api/fog/lastrun/<gen>, cacheable, and surfaces a 404 as an error", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 404 }))
    await expect(httpLastRunFetch(fetchImpl as unknown as typeof fetch)(9)).rejects.toThrow(/404/)
    expect(fetchImpl).toHaveBeenCalledWith("/api/fog/lastrun/9", {
      credentials: "same-origin",
      cache: "default",
      // `0113`: every API call carries the 10 s timeout's abort signal.
      signal: expect.any(AbortSignal),
    })
  })
})

describe("todayDay", () => {
  it("counts days in the sidecar's own unit — the pipeline's lastRunDay", () => {
    for (const iso of ["2020-01-01T00:00:00Z", "2026-10-20T13:45:00Z", "2026-10-20T23:59:59Z"]) {
      expect(todayDay(Date.parse(iso))).toBe(lastRunDay(iso))
    }
  })
})
