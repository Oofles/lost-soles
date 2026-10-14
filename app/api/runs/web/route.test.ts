import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * GET /api/runs/web — ticket `0085`, D-299. `08-security-privacy.md` §5.3. The same shape as
 * `/api/runs/latest`'s test: the session and the reader are mocked, the posture is real.
 */

let signedInAs: string | undefined

vi.mock("@/lib/auth/owner", () => ({
  currentUserId: async () => signedInAs,
  isOwner: (id: string | undefined) => id !== undefined,
}))

vi.mock("@/lib/fog/server", () => ({ defaultFogReadDeps: () => ({ s3: {}, bucket: "bkt" }) }))

const traceWebRuns = vi.fn()
vi.mock("@/lib/runs/server", () => ({ traceWebRuns: (...args: unknown[]) => traceWebRuns(...args) }))

const { GET } = await import("./route")

const RUNS = [{ activityId: "a-1", startedAt: "2026-09-02T07:00:00Z", lines: [[[-123.393, -48.876], [-123.392, -48.876]]] }]

describe("GET /api/runs/web", () => {
  beforeEach(() => traceWebRuns.mockReset())

  it("serves the session's routes, read for the session's uid", async () => {
    signedInAs = "u-1"
    traceWebRuns.mockResolvedValueOnce(RUNS)
    const response = await GET()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ runs: RUNS })
    expect(traceWebRuns.mock.calls[0]![0]).toBe("u-1")
    expect(GET.length).toBe(0)
  })

  it("404s a signed-out caller, byte-identically to the middleware", async () => {
    signedInAs = undefined
    const response = await GET()
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: "not found" })
    expect(traceWebRuns).not.toHaveBeenCalled()
  })

  it("is never cached", async () => {
    signedInAs = "u-1"
    traceWebRuns.mockResolvedValueOnce([])
    expect((await GET()).headers.get("cache-control")).toBe("no-store, private")
  })

  it("exports no mutating verb", async () => {
    expect(Object.keys(await import("./route")).sort()).toEqual(["GET", "dynamic"])
  })
})
