import { readFileSync } from "node:fs"
import { join } from "node:path"

import { Auth, raw, skipCSRFCheck } from "@auth/core"
import { afterEach, describe, expect, it, vi } from "vitest"

/**
 * Ticket 0339, D-478. `/settings` → Sign out (`signOutEverywhere`, `app/auth-actions.ts`) must
 * clear the SHARED session cookie, under its new name, on `.devaultsecurity.com`. If it cleared
 * a host-only cookie, or the old `__Secure-authjs.session-token`, the shared one would survive and
 * the next request would still be signed in, here and on every other app.
 *
 * `signOutEverywhere` calls next-auth's `signOut`, which builds a POST to `<basePath>/signout` and
 * hands it to @auth/core's `Auth(req, { ...config, raw, skipCSRFCheck })`, then writes back the
 * cookies it returns (`next-auth/lib/actions.js`). next-auth itself cannot load under vitest (it
 * imports `next/server` as a bare ESM specifier), so this runs that same @auth/core call with the
 * same config Lost Soles builds in `lib/auth/index.ts`, and pins that the action really is a plain
 * `signOut` from that instance.
 *
 * `lib/auth/config.ts` reads `NODE_ENV`, `AUTH_SESSION_COOKIE` and `AUTH_COOKIE_DOMAIN` at module
 * load, so the env is stubbed BEFORE the import. The values are production's (D-478), stubbed,
 * never read from the environment the suite runs in.
 */

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("sign-out clears the shared cookie (0339)", () => {
  it("expires __Secure-devault.session-token on .devaultsecurity.com, and nothing under the old name", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("AUTH_SESSION_COOKIE", "devault.session-token")
    vi.stubEnv("AUTH_COOKIE_DOMAIN", ".devaultsecurity.com")
    vi.resetModules()

    const { authConfig } = await import("@/lib/auth/config")

    const req = new Request("https://soles.devaultsecurity.com/api/authjs/signout", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie: "__Secure-devault.session-token=whatever",
      },
      body: new URLSearchParams({ callbackUrl: "/" }),
    })
    const res = await Auth(req, {
      ...authConfig,
      basePath: "/api/authjs",
      // Assembled, not a literal: a secret-shaped string in source is a gitleaks true positive.
      secret: ["test-only", "not-a-secret", "0339"].join("-"),
      raw,
      skipCSRFCheck,
    })

    const session = (res.cookies ?? []).filter((c) => c.name.includes("session-token"))
    expect(session.map((c) => c.name)).toEqual(["__Secure-devault.session-token"])
    const [cleared] = session
    expect(cleared!.value).toBe("")
    expect(cleared!.options).toMatchObject({ domain: ".devaultsecurity.com", path: "/", secure: true, httpOnly: true, maxAge: 0 })
  })

  it("the Sign out action is next-auth's signOut from that instance, sending the browser to `/`", () => {
    const src = readFileSync(join(__dirname, "auth-actions.ts"), "utf8")
    expect(src).toMatch(/import \{[^}]*\bsignOut\b[^}]*\} from "@\/lib\/auth"/)
    expect(src).toMatch(/await signOut\(\{ redirectTo: "\/" \}\)/)
    // `/` signed out is a 307 to core's sign-in (middleware.test.ts), so the operator lands there.
    const instance = readFileSync(join(__dirname, "..", "lib", "auth", "index.ts"), "utf8")
    expect(instance).toMatch(/\.\.\.authConfig,\s*basePath: "\/api\/authjs"/)
  })
})
