import { beforeEach, describe, expect, it } from "vitest"

import { EMPTY_COLLECTION, type RunFeatureCollection } from "@/lib/runs/wire"

import { firstPulse, heldCells, resetPulses } from "./states"

const run = (newCells?: string[] | null): RunFeatureCollection => ({
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: { type: "MultiLineString", coordinates: [] } as unknown as RunFeatureCollection["features"][0]["geometry"],
      properties: { activityId: "a-9", startedAt: "2026-08-28T11:00:00.000Z", name: null, newCells },
    },
  ],
})

beforeEach(() => resetPulses())

describe("the fresh line pulses once (criterion 3)", () => {
  it("pulses the first time a run is asked about, and never again in this page load", () => {
    expect(firstPulse("a-9")).toBe(true)
    expect(firstPulse("a-9")).toBe(false)
    expect(firstPulse("a-9")).toBe(false)
  })

  it("a newer unseen run gets its own one pulse", () => {
    expect(firstPulse("a-9")).toBe(true)
    expect(firstPulse("a-10")).toBe(true)
  })
})

describe("what home holds back (criterion 5)", () => {
  it("holds an unseen run's new cells", () => {
    expect(heldCells(run(["8b1", "8b2"]), false)).toEqual(["8b1", "8b2"])
  })

  it("holds nothing (and keeps the corridor) for a seen run, or while seen is still being read", () => {
    expect(heldCells(run(["8b1"]), true)).toBeNull()
    expect(heldCells(run(["8b1"]), null)).toBeNull()
    expect(heldCells(EMPTY_COLLECTION, false)).toBeNull()
  })

  it("an unseen run never classified holds no cells but still turns the corridor off", () => {
    expect(heldCells(run(null), false)).toEqual([])
    expect(heldCells(run(undefined), false)).toEqual([])
  })
})
