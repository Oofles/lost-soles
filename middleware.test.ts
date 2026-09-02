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

vi.mock("aws-amplify/auth/server", () => ({
  fetchAuthSession: async () =>
    authenticated ? { tokens: { accessToken: {}, idToken: {} } } : { tokens: undefined },
}))

vi.mock("@/lib/amplify-server", () => ({
  runWithAmplifyServerContext: async ({
    operation,
  }: {
    operation: (spec: unknown) => unknown
  }) => operation({}),
}))

const { middleware } = await import("./middleware")

const get = (pathname: string) =>
  middleware(new NextRequest(new URL(`https://soles.devaultsecurity.com${pathname}`)))

beforeEach(() => {
  authenticated = false
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
