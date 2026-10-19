import { describe, expect, it, vi } from "vitest"

import type { Region } from "@/lib/regions"

import { frameRegion, JUMP_MAX_ZOOM, jumpItems, type JumpHost } from "./region-jump"

/** Ticket `0285`. Point Nemo (D-199): synthetic geography only. */
const A: Region = { id: "a", latestAt: "2026-10-01T00:00:00Z", bounds: [[-123.45, -48.9], [-123.35, -48.85]] }
const B: Region = { id: "b", latestAt: "2026-09-01T00:00:00Z", bounds: [[-120.1, -48.1], [-120.0, -48.0]] }

describe("jumpItems", () => {
  it("is null — no control at all — with fewer than two regions (criterion 4)", () => {
    expect(jumpItems([], new Map())).toBeNull()
    expect(jumpItems([A], new Map([["a", "Millbrook"]]))).toBeNull()
  })

  it("labels each region with the basemap's name, falling back to its coordinate area (criterion 5)", () => {
    expect(jumpItems([A, B], new Map([["b", "Saltmarsh"]]))).toEqual([
      { id: "a", label: "48.9°S 123.4°W" },
      { id: "b", label: "Saltmarsh" },
    ])
  })
})

describe("frameRegion (criterion 3)", () => {
  it("fits the region's bounds in the pane with 12% padding and touches nothing else on the map", () => {
    const fitBounds = vi.fn()
    const map: JumpHost = {
      fitBounds,
      getContainer: () => ({ getBoundingClientRect: () => ({ width: 1000, height: 800 }) }) as HTMLElement,
    }
    frameRegion(map, A.bounds)
    expect(fitBounds).toHaveBeenCalledWith(A.bounds, { padding: 96, maxZoom: JUMP_MAX_ZOOM })
  })
})
