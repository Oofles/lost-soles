import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * GET /api/runs/summary — ticket `0101`. `08-security-privacy.md` §5.3. The shape of
 * `/api/runs/latest`'s test: the session and the reader are mocked; the status codes, the cache
 * headers, the id cap and the signed-out behaviour are real.
 */

let signedInAs: string | undefined

vi.mock("@/lib/auth/owner", () => ({
  currentUserId: async () => signedInAs,
  isOwner: (id: string | undefined) => id !== undefined,
}))

const runFacts = vi.fn()
vi.mock("@/lib/runs/server", () => ({
  defaultRunReadDeps: () => ({}),
  runFacts: (...args: unknown[]) => runFacts(...args),
}))

const { GET } = await import("./route")
const { RUNS_SUMMARY_MAX_IDS } = await import("@/lib/runs/wire")

const req = (qs: string) => new NextRequest(`https://example.test/api/runs/summary${qs}`)
const FACTS = [{ activityId: "a", startedAt: "2026-09-09T11:00:00.000Z", startedAtLocal: "2026-09-09T07:00:00", distanceM: 8400, newCellCount: 21 }]

describe("GET /api/runs/summary", () => {
  beforeEach(() => {
    runFacts.mockReset()
    runFacts.mockResolvedValue(FACTS)
  })

  it("serves the facts for the session's uid and the asked ids", async () => {
    signedInAs = "u-1"
    const response = await GET(req("?ids=a,b"))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ runs: FACTS })
    expect(runFacts.mock.calls.at(-1)!.slice(0, 2)).toEqual(["u-1", ["a", "b"]])
  })

  /** Byte-identical to what `middleware.ts` returns, so a signed-out probe learns nothing. */
  it("404s a signed-out caller and reads nothing", async () => {
    signedInAs = undefined
    const response = await GET(req("?ids=a"))
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: "not found" })
    expect(runFacts).not.toHaveBeenCalled()
  })

  /** A uid cannot ride in on the query string: only `ids` is read, and the session names the user. */
  it("ignores any uid the query string offers", async () => {
    signedInAs = "u-1"
    await GET(req("?ids=a&userId=u-2&uid=u-2"))
    expect(runFacts.mock.calls.at(-1)![0]).toBe("u-1")
  })

  it("400s an absent, empty, malformed or over-long id list, and reads nothing", async () => {
    signedInAs = "u-1"
    const tooMany = Array.from({ length: RUNS_SUMMARY_MAX_IDS + 1 }, (_, i) => `id${i}`).join(",")
    for (const qs of ["", "?ids=", "?ids=a,../b", `?ids=${tooMany}`]) {
      expect((await GET(req(qs))).status).toBe(400)
    }
    expect(runFacts).not.toHaveBeenCalled()
  })

  it("is never cached, by the browser or by anything in between", async () => {
    signedInAs = "u-1"
    const response = await GET(req("?ids=a"))
    expect(response.headers.get("cache-control")).toBe("no-store, private")
  })

  /** The absence of the other verbs IS the control — a GET-only route file 405s by construction. */
  it("exports no mutating verb", async () => {
    const routeModule = await import("./route")
    expect(Object.keys(routeModule).sort()).toEqual(["GET", "dynamic"])
  })
})
