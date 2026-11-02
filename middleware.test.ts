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

/**
 * Ticket 0330. next-auth's `auth(handler)` wrapper, stubbed to hand the handler `req.auth` the way
 * the real one does after decrypting the cookie. What is real is the gate's decision about it,
 * and `lib/auth/identity.ts`'s two gates with it.
 */
let authjsEmail: string | undefined = undefined
vi.mock("@/lib/auth", () => ({
  auth:
    (handler: (req: unknown) => unknown) =>
    (req: Record<string, unknown>) =>
      handler(Object.assign(req, { auth: authjsEmail ? { user: { email: authjsEmail } } : null })),
}))

const OWNER_EMAIL = "amazingbrandon@gmail.com"

const { middleware, config } = await import("./middleware")
const { NO_STORE } = await import("@/lib/http/no-store")

// next-auth types the wrapped middleware's result as `void | Response`; the gate always returns one.
const get = async (pathname: string, headers?: HeadersInit) =>
  (await middleware(new NextRequest(new URL(`https://soles.devaultsecurity.com${pathname}`), { headers }), { params: Promise.resolve({}) })) as Response

beforeEach(() => {
  authenticated = false
  bearerSub = undefined
  authjsEmail = undefined
  process.env.AUTH_ALLOWED_EMAILS = OWNER_EMAIL
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

/**
 * Ticket 0322. D-429 / C-3: every response carries `private, no-store`, 404s and redirects
 * included. `withNoStore` covers route handlers; these two responses are built by the middleware
 * itself and `check-route-cache-control.mjs` cannot see them, so this is their only guard.
 */
describe("Cache-Control on the middleware's own responses (0322)", () => {
  it.each(["/api/fog", "/api/tickets/capture", "/api"])(
    "the signed-out 404 for %s carries no-store",
    async (path) => {
      const res = await get(path)
      expect(res.status).toBe(404)
      expect(res.headers.get("cache-control")).toBe(NO_STORE)
    },
  )

  it("the signed-out 307 for a page carries no-store", async () => {
    const res = await get("/skills")
    expect(res.status).toBe(307)
    expect(res.headers.get("cache-control")).toBe(NO_STORE)
  })

  it("a failed bearer token's 404 carries it too", async () => {
    const res = await get("/api/fog", { authorization: "Bearer forged.token.sig" })
    expect(res.status).toBe(404)
    expect(res.headers.get("cache-control")).toBe(NO_STORE)
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

/**
 * Ticket 0330, D-471. Either session admits; an Auth.js session admits only through BOTH gates.
 */
describe("Auth.js session (0330)", () => {
  it("admits an allowlisted, mapped email to an API route and a page", async () => {
    authjsEmail = OWNER_EMAIL
    expect((await get("/api/tickets/capture")).status).toBe(200)
    expect((await get("/log")).status).toBe(200)
  })

  it("matches the email case-insensitively", async () => {
    authjsEmail = OWNER_EMAIL.toUpperCase()
    expect((await get("/api/fog")).status).toBe(200)
  })

  it("404s an allowlisted email with no IDENTITIES entry, as signed out", async () => {
    // A domain cookie school-hub minted for one of its own users (D-470).
    authjsEmail = "someone-else@example.com"
    process.env.AUTH_ALLOWED_EMAILS = `${OWNER_EMAIL},someone-else@example.com`
    const unmapped = await get("/api/tickets/capture")
    authjsEmail = undefined
    const none = await get("/api/tickets/capture")
    expect(unmapped.status).toBe(404)
    expect(await unmapped.text()).toBe(await none.text())
  })

  it("404s a mapped email that is no longer on the allowlist", async () => {
    authjsEmail = OWNER_EMAIL
    process.env.AUTH_ALLOWED_EMAILS = "someone-else@example.com"
    expect((await get("/api/tickets/capture")).status).toBe(404)
  })

  it("404s a mapped email when the allowlist is empty or unset", async () => {
    authjsEmail = OWNER_EMAIL
    process.env.AUTH_ALLOWED_EMAILS = ""
    expect((await get("/api/tickets/capture")).status).toBe(404)
    delete process.env.AUTH_ALLOWED_EMAILS
    expect((await get("/api/tickets/capture")).status).toBe(404)
  })

  it("still admits the Cognito cookie when there is no Auth.js session", async () => {
    authenticated = true
    expect((await get("/api/tickets/capture")).status).toBe(200)
  })
})

/**
 * THE MATCHER ITSELF, tested as a regex rather than through the handler.
 *
 * Every test above calls `middleware()` directly, which means none of them can see
 * whether a path reaches it at all — that is the matcher's job, and it is a string in
 * `config` that no test touched. Ticket 0053 shipped a bug in exactly that gap: the
 * MapLibre worker at `/maplibre/…` took a 307 to `/`, the browser refused it for a
 * "non-JavaScript MIME type text/html", and the map painted its background layer and
 * no tiles. A worker is fetched as a subresource; a redirect is not an answer.
 */
describe("the matcher (0053)", () => {
  const pattern = new RegExp(`^${config.matcher[0]}$`)

  it.each([
    "/maplibre/maplibre-gl-worker.js",
    "/maplibre/maplibre-gl-shared.js",
    "/_next/static/chunks/main.js",
    "/favicon.ico",
    // 0293: the basemap's glyphs and sprite. A glyph range is fetched with its space unencoded
    // by MapLibre and encoded by the browser; both spellings must pass.
    "/basemap-assets/fonts/Noto%20Sans%20Regular/0-255.pbf",
    "/basemap-assets/fonts/Noto Sans Medium/256-511.pbf",
    "/basemap-assets/sprites/v4/light.json",
    "/basemap-assets/sprites/v4/light@2x.json",
  ])("exempts %s — a static asset must not be redirected", (path) => {
    expect(pattern.test(path)).toBe(false)
  })

  /**
   * 0330. Auth.js's own routes must be reachable signed out (signin, csrf, the Google callback).
   * They authenticate themselves and touch no Lost Soles data. Only the PREFIX with its slash is
   * exempt: every other `/api/*` path, the Strava `/api/auth/*` family included, stays gated.
   */
  it.each([
    "/api/authjs/providers",
    "/api/authjs/csrf",
    "/api/authjs/signin/google",
    "/api/authjs/callback/google",
    "/api/authjs/session",
  ])("exempts Auth.js's own route %s", (path) => {
    expect(pattern.test(path)).toBe(false)
  })

  it.each(["/api/authjs", "/api/authjsx/providers", "/api/auth/strava/start", "/api/auth/strava/disconnect", "/api/fog/authjs/x"])(
    "keeps %s gated: the Auth.js exemption is exactly its prefix",
    (path) => {
      expect(pattern.test(path)).toBe(true)
    },
  )

  it.each(["/", "/settings", "/dev/tickets", "/api/tickets/capture", "/skills/running"])(
    "still covers %s",
    (path) => {
      expect(pattern.test(path)).toBe(true)
    },
  )

  /**
   * The exemption is a PREFIX, not "anything ending in .js". A route that merely looks
   * like an asset must stay behind the gate, or the exemption becomes a way past it.
   */
  it("does not exempt a path that only resembles the worker", () => {
    expect(pattern.test("/not-maplibre/secret.js")).toBe(true)
    expect(pattern.test("/dev/maplibre/worker.js")).toBe(true)
    expect(pattern.test("/dev/basemap-assets/x.json")).toBe(true)
  })
})
