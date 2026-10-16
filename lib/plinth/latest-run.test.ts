import { describe, expect, it, vi } from "vitest"

import { memoryLogStore } from "@/lib/log/queue"
import { EMPTY_COLLECTION, type RunFeatureCollection } from "@/lib/runs/wire"

import { latestRunKey, loadLatestRun, type LatestRunDeps } from "./latest-run"

const flush = () => new Promise((r) => setTimeout(r, 0))

const run = (id: string): RunFeatureCollection => ({
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: { type: "MultiLineString", coordinates: [] } as unknown as RunFeatureCollection["features"][0]["geometry"],
      properties: { activityId: id, startedAt: "2026-08-28T11:00:00.000Z", name: null },
    },
  ],
})

function rig(over: Partial<LatestRunDeps> = {}) {
  const order: string[] = []
  const deps: LatestRunDeps = {
    currentUid: async () => "u-1",
    store: memoryLogStore(),
    fetchLatest: vi.fn(async () => {
      order.push("request")
      return run("fresh")
    }),
    ...over,
  }
  const emit = vi.fn<(r: RunFeatureCollection, from: "cache" | "network") => number>((r) => order.push(`emit:${r.features[0]?.properties.activityId ?? "none"}`))
  return { deps, emit, order }
}

describe("loadLatestRun (0087)", () => {
  it("emits the cached run BEFORE the request, then the network's, and writes the network's back", async () => {
    const { deps, emit, order } = rig()
    await deps.store!.setKv(latestRunKey("u-1"), run("cached"))
    loadLatestRun(deps, emit)
    await flush()
    expect(order).toEqual(["emit:cached", "request", "emit:fresh"])
    // `0273`: each answer says where it came from — a cached one vouches only for a cached fog.
    expect(emit.mock.calls.map((c) => c[1])).toEqual(["cache", "network"])
    expect(await deps.store!.getKv(latestRunKey("u-1"))).toEqual(run("fresh"))
  })

  it("offline: the cache stands, the error goes to the log hook, and nothing throws", async () => {
    const onError = vi.fn()
    const { deps, emit } = rig({ fetchLatest: async () => Promise.reject(new TypeError("Failed to fetch")), onError })
    await deps.store!.setKv(latestRunKey("u-1"), run("cached"))
    loadLatestRun(deps, emit)
    await flush()
    expect(emit).toHaveBeenCalledTimes(1)
    expect(emit).toHaveBeenCalledWith(run("cached"), "cache")
    expect(onError).toHaveBeenCalledTimes(1)
  })

  it("caches the empty answer too, so a deleted run does not outlive its delete", async () => {
    const { deps, emit } = rig({ fetchLatest: async () => EMPTY_COLLECTION })
    await deps.store!.setKv(latestRunKey("u-1"), run("cached"))
    loadLatestRun(deps, emit)
    await flush()
    expect(await deps.store!.getKv(latestRunKey("u-1"))).toEqual(EMPTY_COLLECTION)
  })

  it("a refetch (a generation change) does not step the line back to the cache", async () => {
    const { deps, emit, order } = rig()
    await deps.store!.setKv(latestRunKey("u-1"), run("cached"))
    loadLatestRun(deps, emit, false)
    await flush()
    expect(order).toEqual(["request", "emit:fresh"])
  })

  it("is per account: one sub never reads another's cached run", async () => {
    const { deps, emit } = rig({ currentUid: async () => "u-2", fetchLatest: async () => Promise.reject(new Error("offline")) })
    await deps.store!.setKv(latestRunKey("u-1"), run("cached"))
    loadLatestRun(deps, emit)
    await flush()
    expect(emit).not.toHaveBeenCalled()
  })

  it("emits nothing after stop", async () => {
    const { deps, emit } = rig()
    await deps.store!.setKv(latestRunKey("u-1"), run("cached"))
    loadLatestRun(deps, emit)()
    await flush()
    expect(emit).not.toHaveBeenCalled()
  })
})
