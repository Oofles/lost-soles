import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * GET /api/runs/chronicle — ticket `0088`. `08-security-privacy.md` §5.3. The shape of
 * `/api/runs/web`'s test: the session and the reader are mocked, the posture and the cursor
 * decoding are real.
 */

let signedInAs: string | undefined

vi.mock("@/lib/auth/owner", () => ({
  currentUserId: async () => signedInAs,
  isOwner: (id: string | undefined) => id !== undefined,
}))

const chroniclePage = vi.fn()
vi.mock("@/lib/runs/server", async () => {
  const { encodeChronicleCursor, decodeChronicleCursor } = await vi.importActual<typeof import("@/lib/runs/server")>(
    "@/lib/runs/server",
  )
  return {
    encodeChronicleCursor,
    decodeChronicleCursor,
    defaultRunReadDeps: () => ({}),
    chroniclePage: (...args: unknown[]) => chroniclePage(...args),
  }
})

const { GET } = await import("./route")
const { encodeChronicleCursor } = await import("@/lib/runs/server")

const req = (qs = "") => new NextRequest(`https://example.test/api/runs/chronicle${qs}`)
const PAGE = { items: [], next: null }

describe("GET /api/runs/chronicle", () => {
  beforeEach(() => {
    chroniclePage.mockReset()
    chroniclePage.mockResolvedValue(PAGE)
  })

  it("serves the first page for the session's uid", async () => {
    signedInAs = "u-1"
    const response = await GET(req())
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(PAGE)
    expect(chroniclePage.mock.calls[0]![0]).toBe("u-1")
    expect(chroniclePage.mock.calls[0]![2]).toBeNull()
  })

  it("passes a cursor through as a position — the account is the session's, always", async () => {
    signedInAs = "u-1"
    const after = encodeChronicleCursor({ startedAt: "2026-08-01T07:00:00Z", id: "a-3" })
    await GET(req(`?after=${after}`))
    expect(chroniclePage.mock.calls[0]![0]).toBe("u-1")
    expect(chroniclePage.mock.calls[0]![2]).toEqual({ startedAt: "2026-08-01T07:00:00Z", id: "a-3" })
  })

  it("400s a cursor that does not decode, and reads nothing", async () => {
    signedInAs = "u-1"
    for (const bad of ["", "%%%", Buffer.from('{"userId":"u-2"}').toString("base64url")]) {
      const response = await GET(req(`?after=${bad}`))
      expect(response.status).toBe(400)
    }
    expect(chroniclePage).not.toHaveBeenCalled()
  })

  it("404s a signed-out caller, byte-identically to the middleware", async () => {
    signedInAs = undefined
    const response = await GET(req())
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: "not found" })
    expect(chroniclePage).not.toHaveBeenCalled()
  })

  it("is never cached", async () => {
    signedInAs = "u-1"
    expect((await GET(req())).headers.get("cache-control")).toBe("no-store, private")
  })
})
