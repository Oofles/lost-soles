import { describe, expect, it, vi } from "vitest"

import { fetchLatestRun, RunFetchError } from "./client"
import { RUNS_LATEST_PATH } from "./wire"

/**
 * Ticket `0057` — the browser half of `/api/runs/latest`.
 *
 * `0195` tested the server's answers; this tests how the map reacts to them. The distinction
 * that matters is which non-2xx responses are NORMAL: a signed-out visitor gets a 404 from
 * `middleware.ts` and must see a map with no line, not an error state.
 */

const NEMO = { lat: -48.876, lng: -123.393 }

const collection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: { type: "MultiLineString", coordinates: [[[NEMO.lng, NEMO.lat]]] },
      properties: { activityId: "a-1", startedAt: "2026-09-01T12:00:00Z", name: "morning" },
    },
  ],
}

const respond = (status: number, body: unknown = collection) =>
  vi.fn(async () =>
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  )

describe("fetchLatestRun", () => {
  it("asks the endpoint with the session cookie and no cache", async () => {
    const fetchImpl = respond(200)
    await fetchLatestRun(fetchImpl as never)

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0]! as unknown as [string, RequestInit]
    expect(url).toBe(RUNS_LATEST_PATH)
    // Without the cookie the route re-derives no session and answers 404 to a signed-IN user.
    expect(init.credentials).toBe("same-origin")
    expect(init.cache).toBe("no-store")
  })

  it("returns the collection", async () => {
    await expect(fetchLatestRun(respond(200) as never)).resolves.toEqual(collection)
  })

  /**
   * SIGNED OUT IS NOT AN ERROR. `/` is the signed-out landing route, so this request happening
   * and being refused is a normal path through the app — and the map must render.
   */
  it("treats 404 as no line rather than as a failure", async () => {
    const result = await fetchLatestRun(respond(404, { error: "not found" }) as never)
    expect(result.features).toEqual([])
  })

  it("throws on a real failure, so a broken deploy is not a permanently missing line", async () => {
    await expect(fetchLatestRun(respond(500, { error: "boom" }) as never)).rejects.toBeInstanceOf(
      RunFetchError,
    )
  })

  /**
   * A bad body must never reach MapLibre. A `geojson` source given something it cannot parse
   * throws from inside the render loop and takes the whole map down — the fog with it — which is
   * a far worse outcome than the missing line this returns instead.
   */
  it("treats a malformed body as no line", async () => {
    await expect(fetchLatestRun(respond(200, { nope: true }) as never)).resolves.toEqual({
      type: "FeatureCollection",
      features: [],
    })
    await expect(fetchLatestRun(respond(200, null) as never)).resolves.toEqual({
      type: "FeatureCollection",
      features: [],
    })
  })
})
