import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * GET /api/runs/latest — ticket `0195`. `08-security-privacy.md` §5.3.
 *
 * The session and the reader are mocked; the status codes, the cache headers and the
 * signed-out behaviour are real. As with `/api/fog`, §5.3's rule is enforced structurally —
 * there is no parameter through which a uid could be supplied — and these tests are mostly
 * about proving that stays true.
 */

let signedInAs: string | undefined

vi.mock("@/lib/auth/owner", () => ({
  currentUserId: async () => signedInAs,
  isOwner: (id: string | undefined) => id !== undefined,
}))

const latestRun = vi.fn()

vi.mock("@/lib/runs/server", () => ({
  defaultRunReadDeps: () => ({ s3: {}, bucket: "bkt", ddb: {}, activityTable: "T" }),
  latestRun: (...args: unknown[]) => latestRun(...args),
  EMPTY_COLLECTION: { type: "FeatureCollection", features: [] },
}))

const { GET } = await import("./route")

const COLLECTION = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: { type: "MultiLineString", coordinates: [[[-123.393, -48.876]]] },
      properties: { activityId: "a-9", startedAt: "2026-09-09T11:00:00.000Z", name: null },
    },
  ],
}

describe("GET /api/runs/latest", () => {
  // The mock is module-scoped, so a stale call from the previous test would satisfy an
  // assertion about this one — which is exactly how a route that stopped reading anything
  // would keep passing.
  beforeEach(() => latestRun.mockReset())

  it("serves the caller's latest run as GeoJSON", async () => {
    signedInAs = "u-1"
    latestRun.mockResolvedValueOnce(COLLECTION)

    const response = await GET()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(COLLECTION)
  })

  /**
   * THE UID COMES FROM THE SESSION, and this asserts which one reached the reader. `GET` takes
   * no `Request` at all, which is the structural half of the same rule: there is nowhere for a
   * query string, a body or a header to put a different one.
   */
  it("reads for the session's uid and passes nothing else through", async () => {
    signedInAs = "u-1"
    latestRun.mockResolvedValueOnce(COLLECTION)
    await GET()
    expect(latestRun.mock.calls.at(-1)![0]).toBe("u-1")
    expect(GET.length).toBe(0)
  })

  /** Byte-identical to what `middleware.ts` returns, so a signed-out probe learns nothing. */
  it("404s a signed-out caller", async () => {
    signedInAs = undefined
    const response = await GET()
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: "not found" })
    expect(latestRun).not.toHaveBeenCalled()
  })

  /**
   * `private` is doing real work: the app sits behind a CDN and this body is a precise record
   * of where one person ran. `no-store` keeps it out of the browser's cache, `private` out of
   * every shared cache in between.
   */
  it("is never cached, by the browser or by anything in between", async () => {
    signedInAs = "u-1"
    latestRun.mockResolvedValueOnce(COLLECTION)
    const response = await GET()
    expect(response.headers.get("cache-control")).toBe("no-store, private")
  })

  /**
   * A NEW ACCOUNT IS A 200, NOT A 404. Three situations reach here — no activities, no traced
   * activities, and (today) rows written before `0195` — and none is a fault. A 404 would make
   * the renderer treat a new user as a broken backend.
   */
  it("200s an empty collection when there is no run to draw", async () => {
    signedInAs = "u-1"
    latestRun.mockResolvedValueOnce({ type: "FeatureCollection", features: [] })
    const response = await GET()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ type: "FeatureCollection", features: [] })
  })

  /** The absence of the other verbs IS the control — a GET-only route file 405s by construction. */
  it("exports no mutating verb", async () => {
    const routeModule = await import("./route")
    expect(Object.keys(routeModule).sort()).toEqual(["GET", "dynamic"])
  })
})
