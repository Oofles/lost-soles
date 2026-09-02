import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Ticket 0019. The middleware half of "an unauthenticated request receives 404"
 * (criterion 6).
 *
 * The route has its own owner check and its own 404, tested in
 * `app/api/tickets/capture/route.test.ts`. This is the OTHER layer, and it is tested
 * separately for the same reason the two path guards are: a layer only exercised
 * through the layer it backs up is not independently proven.
 *
 * Amplify's session read is stubbed. What is real is the routing decision — which
 * path gets a 404 and which gets the 307 — because that is the thing 0019 changed.
 */

let authenticated = false
/** The verified `sub` a bearer token yields, or undefined for "not verified". */
let bearerSub: string | undefined = undefined

vi.mock("aws-amplify/auth/server", () => ({
  fetchAuthSession: async () =>
    authenticated ? { tokens: { accessToken: {}, idToken: {} } } : { tokens: undefined },
}))

/**
 * Ticket 0149. The verification itself is proved against real RSA signatures in
 * `lib/auth/bearer.test.ts`; stubbed here because what this file tests is the
 * ROUTING decision — which credential shape gets through the gate and which gets
 * the 404 — not the cryptography.
 */
vi.mock("@/lib/auth/bearer", () => ({
  verifiedBearerSub: async (header: string | null | undefined) =>
    header ? bearerSub : undefined,
}))

vi.mock("@/lib/amplify-server", () => ({
  runWithAmplifyServerContext: async ({
    operation,
  }: {
    operation: (spec: unknown) => unknown
  }) => operation({}),
}))

const { middleware } = await import("./middleware")

const get = (pathname: string, headers?: HeadersInit) =>
  middleware(new NextRequest(new URL(`https://soles.devaultsecurity.com${pathname}`), { headers }))

beforeEach(() => {
  authenticated = false
  bearerSub = undefined
})

describe("signed out", () => {
  it.each(["/api/tickets/capture", "/api/anything", "/api"])(
    "404s %s rather than redirecting it",
    async (path) => {
      // A 307 is the wrong answer to a fetch: the client follows it, gets 200 and
      // the HTML of `/`, and a signed-out capture is reported as a success. Worse,
      // 0022's retry queue would see a 2xx and drop the note it was holding.
      const res = await get(path)
      expect(res.status).toBe(404)
      expect(res.headers.get("location")).toBeNull()
    },
  )

  it("still 307s a PAGE toward `/`, where the Authenticator renders", async () => {
    const res = await get("/log")
    expect(res.status).toBe(307)
    expect(res.headers.get("location")).toContain("/?next=%2Flog")
  })

  it("does not redirect `/` to itself", async () => {
    const res = await get("/")
    expect(res.status).toBe(200)
  })

  it("does not treat a page whose name merely starts with `api` as an API path", async () => {
    // `/apiary` is not `/api`. A `startsWith("/api")` would have sent a real page a
    // 404 that reads as a broken route rather than as a sign-in prompt.
    const res = await get("/apiary")
    expect(res.status).toBe(307)
  })
})

describe("signed in", () => {
  it("passes an API request through to the route, which does its own owner check", async () => {
    authenticated = true
    const res = await get("/api/tickets/capture")
    expect(res.status).toBe(200)
  })
})

/**
 * Ticket 0149 — the non-browser path.
 *
 * Without this branch the capture endpoint is unreachable from a Tasker task,
 * which is the whole of capability `03`'s value. With it, the gate must still be
 * a gate: only a VERIFIED token opens it, and everything else is byte-identical
 * to being signed out.
 */
describe("bearer token (0149)", () => {
  it("admits an API request carrying a verified bearer token and no cookie", async () => {
    bearerSub = "5488e4b8-d081-7014-748e-edd1937f8083"
    const res = await get("/api/tickets/capture", { authorization: "Bearer good.token.sig" })
    expect(res.status).toBe(200)
  })

  it("404s a bearer token that does NOT verify", async () => {
    bearerSub = undefined
    const res = await get("/api/tickets/capture", { authorization: "Bearer forged.token.sig" })
    expect(res.status).toBe(404)
    expect(res.headers.get("location")).toBeNull()
  })

  it("404s a request with neither a cookie nor a bearer token", async () => {
    const res = await get("/api/tickets/capture")
    expect(res.status).toBe(404)
  })

  it("gives a failed bearer token the SAME response as no credential at all", async () => {
    // A stale device credential must be indistinguishable from no credential —
    // otherwise the gate tells an outsider that the route exists (§6.5 row 1).
    bearerSub = undefined
    const forged = await get("/api/tickets/capture", { authorization: "Bearer forged.token.sig" })
    const none = await get("/api/tickets/capture")
    expect(forged.status).toBe(none.status)
    expect(await forged.text()).toBe(await none.text())
  })

  it("lets a bearer token reach a PAGE too, rather than 307ing it", async () => {
    // Nothing needs this today — the tile posts to an API route — but the gate
    // must not be inconsistent about what a valid credential means.
    bearerSub = "5488e4b8-d081-7014-748e-edd1937f8083"
    const res = await get("/log", { authorization: "Bearer good.token.sig" })
    expect(res.status).toBe(200)
  })

  it("prefers the COOKIE when a request somehow carries both", async () => {
    // The browser's behaviour must be exactly what it was before 0149 existed.
    authenticated = true
    bearerSub = undefined
    const res = await get("/api/tickets/capture", { authorization: "Bearer forged.token.sig" })
    expect(res.status).toBe(200)
  })
})
