import { afterEach, describe, expect, it, vi } from "vitest"

import { APP_ORIGIN, hasForeignOrigin } from "./origin"

/**
 * D-471: the session cookie is on `.devaultsecurity.com`, so a sibling subdomain is same-site and
 * `SameSite=Lax` no longer separates it. A state-changing route refuses any `Origin` but its own.
 */

const req = (origin?: string) =>
  new Request("https://soles.devaultsecurity.com/api/log", { method: "POST", headers: origin === undefined ? {} : { origin } })

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("hasForeignOrigin", () => {
  it("does not refuse a request with no Origin: that is a non-browser client, not CSRF", () => {
    expect(hasForeignOrigin(req())).toBe(false)
  })

  it("accepts the app's own origin", () => {
    expect(APP_ORIGIN).toBe("https://soles.devaultsecurity.com")
    expect(hasForeignOrigin(req(APP_ORIGIN))).toBe(false)
  })

  it("refuses a sibling subdomain, which carries the shared cookie", () => {
    expect(hasForeignOrigin(req("https://school-hub.devaultsecurity.com"))).toBe(true)
  })

  it("refuses the right host on the wrong scheme or port, an opaque origin, and anywhere else", () => {
    for (const o of ["http://soles.devaultsecurity.com", "https://soles.devaultsecurity.com:8443", "null", "https://evil.example"]) {
      expect(hasForeignOrigin(req(o)), o).toBe(true)
    }
  })

  it("accepts localhost:3000 under next dev", () => {
    vi.stubEnv("NODE_ENV", "development")
    expect(hasForeignOrigin(req("http://localhost:3000"))).toBe(false)
    expect(hasForeignOrigin(req("http://localhost:4000"))).toBe(true)
  })

  it("refuses localhost in a production build", () => {
    vi.stubEnv("NODE_ENV", "production")
    expect(hasForeignOrigin(req("http://localhost:3000"))).toBe(true)
    expect(hasForeignOrigin(req(APP_ORIGIN))).toBe(false)
  })
})
