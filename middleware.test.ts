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
 * next-auth's cookie decryption is stubbed. What is real is the routing decision —
 * which path gets a 404 and which gets the 307 — because that is the thing 0019
 * changed, and `lib/auth/identity.ts`'s two gates with it. Since 0332 (D-473) an
 * Auth.js session is the only thing that admits.
 */

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

  it("still 307s a PAGE toward `/`, where Sign in with Google renders", async () => {
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

  it("a bearer-only request's 404 carries it too", async () => {
    const res = await get("/api/fog", { authorization: "Bearer forged.token.sig" })
    expect(res.status).toBe(404)
    expect(res.headers.get("cache-control")).toBe(NO_STORE)
  })
})

describe("signed in", () => {
  it("passes an API request through to the route, which does its own owner check", async () => {
    authjsEmail = OWNER_EMAIL
    const res = await get("/api/tickets/capture")
    expect(res.status).toBe(200)
  })
})

/**
 * Ticket 0332, D-NEW-a. `ls-uid` is the browser's copy of the uid, for its IndexedDB keys. The gate
 * WRITES it and never READS it: the uid is not a credential.
 */
describe("the ls-uid cookie (0332)", () => {
  const OWNER_UID = "5488e4b8-d081-7014-748e-edd1937f8083"
  const setCookie = (res: Response) => res.headers.getSetCookie().find((c) => c.startsWith("ls-uid=")) ?? ""

  it.each(["/", "/log", "/api/fog"])("is set on an admitted response to %s", async (path) => {
    authjsEmail = OWNER_EMAIL
    const c = setCookie(await get(path))
    expect(c).toMatch(new RegExp(`^ls-uid=${OWNER_UID};`))
    expect(c).toMatch(/Path=\//)
    expect(c).toMatch(/Secure/)
    expect(c).toMatch(/SameSite=lax/i)
    expect(c).toMatch(/Max-Age=2592000/)
    expect(c).not.toMatch(/HttpOnly/i)
    expect(c).not.toMatch(/Domain=/i)
  })

  it.each(["/", "/log", "/api/fog"])("is deleted, at Path=/, on a signed-out response to %s", async (path) => {
    const c = setCookie(await get(path, { cookie: `ls-uid=${OWNER_UID}` }))
    expect(c).toMatch(/^ls-uid=;/)
    expect(c).toMatch(/Path=\//)
    expect(c).toMatch(/Max-Age=0/)
  })

  it("is deleted for an allowlisted but unmapped email, which is signed out (D-470)", async () => {
    authjsEmail = "someone-else@example.com"
    process.env.AUTH_ALLOWED_EMAILS = `${OWNER_EMAIL},someone-else@example.com`
    expect(setCookie(await get("/"))).toMatch(/^ls-uid=;/)
  })

  it("a FORGED ls-uid with no session is signed out: 404 for an API, 307 for a page", async () => {
    const forged = { cookie: `ls-uid=${OWNER_UID}` }
    const api = await get("/api/tickets/capture", forged)
    expect(api.status).toBe(404)
    expect(await api.text()).toBe(await (await get("/api/tickets/capture")).text())
    expect((await get("/log", forged)).status).toBe(307)
  })

  it("the server never reads it: the gate and the session readers do not name it", async () => {
    const { readFileSync } = await import("node:fs")
    for (const rel of ["./middleware.ts", "./lib/auth/owner.ts", "./lib/auth/identity.ts"]) {
      const src = readFileSync(new URL(rel, import.meta.url), "utf8")
      expect(src, rel).not.toMatch(/cookies\.get\(|uidFromCookieHeader|["']ls-uid["']/)
    }
  })
})

/**
 * Ticket 0332, D-473. The bearer path (D-183, ticket 0149) is gone: its only client,
 * `tools/capture/capture.sh`, was deleted with it. A request carrying only an
 * `Authorization` header is signed out, byte for byte.
 */
describe("bearer token alone (0332)", () => {
  it.each(["/api/tickets/capture", "/api/fog", "/api/log"])(
    "404s %s carrying only a bearer header, exactly as no credential at all",
    async (path) => {
      const bearer = await get(path, { authorization: "Bearer eyJhbGciOiJSUzI1NiJ9.e30.sig" })
      const none = await get(path)
      expect(bearer.status).toBe(404)
      expect(bearer.headers.get("location")).toBeNull()
      expect(await bearer.text()).toBe(await none.text())
    },
  )

  it("307s a PAGE carrying only a bearer header, as signed out", async () => {
    const res = await get("/log", { authorization: "Bearer eyJhbGciOiJSUzI1NiJ9.e30.sig" })
    expect(res.status).toBe(307)
  })

  it("the middleware no longer imports Amplify or a bearer verifier", async () => {
    const { readFileSync } = await import("node:fs")
    const src = readFileSync(new URL("./middleware.ts", import.meta.url), "utf8")
    expect(src).not.toMatch(/from\s*["'][^"']*(?:aws-amplify|amplify-server|bearer)/)
    expect(src).not.toMatch(/headers\.get\(\s*["']authorization/i)
  })
})

/**
 * Ticket 0330, D-471. An Auth.js session admits only through BOTH gates.
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
