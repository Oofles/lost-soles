import { describe, expect, it, vi } from "vitest"

import { loadPerfDataset, parsePerfDataset } from "./dataset-source"
import { perfDataset, perfEnabled } from "../debug-flags"
import { DATASETS, syntheticBlob } from "./synthetic"

/** Ticket `0059`. `05-fog-of-war.md` §6.4; the flag's own reasoning is in `debug-flags.ts`. */

describe("the flag", () => {
  it("defaults to 150k, which is the size §6.4 quotes its kill criteria at", () => {
    expect(perfDataset("?fog=perf")).toBe("150k")
    expect(perfEnabled("?fog=perf")).toBe(true)
  })

  it("takes a value after a colon, and composes with the other flags", () => {
    expect(perfDataset("?fog=perf:500k")).toBe("500k")
    expect(perfDataset("?fog=noise,perf:here")).toBe("here")
    expect(perfDataset("?fog=perf:here:500k")).toBe("here:500k")
  })

  /**
   * The collision `debug-flags.ts` exists to prevent: `?fog=perf` must not silently disable
   * `?fog=mask`, and neither must turn the other off.
   */
  it("leaves the other flags alone", () => {
    expect(perfDataset("?fog=mask")).toBeNull()
    expect(perfEnabled("?fog=mask,debug,noise,off")).toBe(false)
  })
})

describe("parsing a dataset", () => {
  it.each([
    ["50k", { label: "50k", here: false }],
    ["500k", { label: "500k", here: false }],
    ["here", { label: "150k", here: true }],
    ["here:500k", { label: "500k", here: true }],
  ])("%s", (value, expected) => {
    const parsed = parsePerfDataset(value)!
    expect(parsed.dataset.label).toBe(expected.label)
    expect(parsed.here).toBe(expected.here)
  })

  it("refuses a size that has no fixture rather than guessing one", () => {
    expect(parsePerfDataset("1m")).toBeNull()
    expect(parsePerfDataset("here:1m")).toBeNull()
  })
})

describe("loading", () => {
  const CENTRE = { lat: 12.5, lng: -60.25 }

  it("fetches the checked-in fixture and decodes it with the shipped reader", async () => {
    const dataset = DATASETS[0]!
    const bytes = syntheticBlob(dataset)
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => bytes.buffer.slice(0) as ArrayBuffer,
    })) as unknown as typeof fetch

    const loaded = await loadPerfDataset("50k", CENTRE, fetchImpl)
    expect(loaded.origin).toBe("fixture")
    expect(loaded.set.size).toBe(dataset.cells)
    expect(loaded.dataset.label).toBe("50k")
  })

  it("says which URL 404ed and how to regenerate it", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 404 })) as unknown as typeof fetch
    await expect(loadPerfDataset("50k", CENTRE, fetchImpl)).rejects.toThrow(
      /\/fog-fixtures\/fog-50k\.bin → 404.*FOG_FIXTURES=write/s,
    )
  })

  /**
   * `here` COMMITS NO COORDINATE and fetches nothing — that is the point of it. The centre comes from
   * the caller (the operator's own last camera), so the fog lands over ground the basemap extract
   * actually has, which is the only way item 3's frame time includes MapLibre's own work.
   */
  it("regenerates around the caller's centre without touching the network", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch
    const loaded = await loadPerfDataset("here:50k", CENTRE, fetchImpl)
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(loaded.origin).toBe("here")
    expect(loaded.set.size).toBe(DATASETS[0]!.cells)

    // Somewhere else entirely produces a different set of cells for the same size.
    const elsewhere = await loadPerfDataset("here:50k", { lat: -12.5, lng: 60.25 }, fetchImpl)
    expect(elsewhere.set.cells[0]).not.toBe(loaded.set.cells[0])
  })

  it("names the flag it could not understand", async () => {
    await expect(loadPerfDataset("enormous", CENTRE)).rejects.toThrow(/unknown dataset/)
  })
})
