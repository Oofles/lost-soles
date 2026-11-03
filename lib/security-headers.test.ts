import { readFileSync } from "node:fs"
import { join } from "node:path"

import { pathToRegexp } from "next/dist/compiled/path-to-regexp"
import { describe, expect, it } from "vitest"

import nextConfig from "@/next.config"

import { connectSources, contentSecurityPolicy, securityHeaders, type CspOutputs } from "./security-headers"

/** Ticket 0143, 08 §5.3's Headers row. */

const OUTPUTS: CspOutputs = {
  custom: { basemapTilesUrl: "https://d1example.cloudfront.net" },
}

const directive = (csp: string, name: string) =>
  csp
    .split(";")
    .map((d) => d.trim().split(/\s+/))
    .find(([n]) => n === name)
    ?.slice(1)

describe("the CSP (criterion 2)", () => {
  const csp = contentSecurityPolicy(OUTPUTS)

  it("connect-src names exactly the app and the tiles host — no wildcard", () => {
    expect(directive(csp, "connect-src")).toEqual(["'self'", "https://d1example.cloudfront.net"])
    expect(csp).not.toContain("*")
  })

  /**
   * D-473, `0332`. The browser no longer talks to Cognito: sign-in is a redirect to Google and back
   * to `/api/authjs/*` on this origin. `amplify_outputs.json` still carries `auth` until `0334`, and
   * nothing in the CSP may be built from it.
   */
  it("names no cognito-idp or cognito-identity host, even though the outputs still carry auth", () => {
    const withAuth = { ...OUTPUTS, auth: { aws_region: "us-east-1" } } as CspOutputs
    expect(contentSecurityPolicy(withAuth)).not.toMatch(/cognito/)
    expect(connectSources({ custom: OUTPUTS.custom })).toEqual(connectSources(withAuth))
  })

  /**
   * D-472, `0331`. `amplify_outputs.json` still carries `data.url` until `0334`, and the browser no
   * longer talks to it. An AppSync host here would only widen where an XSS could send what it reads.
   */
  it("never names the AppSync endpoint, even though the outputs still carry it", () => {
    const withData = { ...OUTPUTS, data: { url: "https://abc123.appsync-api.us-east-1.amazonaws.com/graphql" } } as CspOutputs
    expect(connectSources(withData).join(" ")).not.toMatch(/appsync/)
    expect(contentSecurityPolicy(withData)).not.toMatch(/appsync/)
  })

  it("carries frame-ancestors 'none' and closes the non-fetch exfiltration paths", () => {
    expect(directive(csp, "frame-ancestors")).toEqual(["'none'"])
    expect(directive(csp, "object-src")).toEqual(["'none'"])
    expect(directive(csp, "frame-src")).toEqual(["'none'"])
    expect(directive(csp, "img-src")).toEqual(["'self'", "data:", "blob:"])
    expect(directive(csp, "default-src")).toEqual(["'self'"])
  })

  it("allows no eval outside `next dev`", () => {
    expect(directive(csp, "script-src")).toEqual(["'self'", "'unsafe-inline'"])
    expect(directive(contentSecurityPolicy(OUTPUTS, { dev: true }), "script-src")).toContain("'unsafe-eval'")
  })

  it("fails loudly rather than omit a host the map needs", () => {
    expect(() => connectSources({ ...OUTPUTS, custom: {} })).toThrow(/basemapTilesUrl/)
  })
})

describe("next.config.ts sends them on every response (criteria 1 and 5)", async () => {
  const rules = (await nextConfig.headers?.()) ?? []
  const headersFor = (path: string) =>
    Object.fromEntries(
      rules.filter((r) => pathToRegexp(r.source).test(path)).flatMap((r) => r.headers.map((h) => [h.key.toLowerCase(), h.value])),
    )

  // `/settings` is the representative authed route; the rest are the paths the middleware matcher
  // skips, which is why the headers live in config and not in middleware.ts.
  for (const path of ["/settings", "/", "/run/a-1", "/api/fog", "/_next/static/chunks/main.js", "/maplibre/maplibre-gl-worker.js", "/basemap-assets/fonts/x/0-255.pbf"]) {
    it(path, () => {
      const h = headersFor(path)
      expect(h["strict-transport-security"]).toMatch(/^max-age=\d{8,}; includeSubDomains$/)
      expect(h["x-content-type-options"]).toBe("nosniff")
      expect(h["content-security-policy"]).toContain("frame-ancestors 'none'")
      expect(h["content-security-policy"]).toContain("connect-src 'self' https://")
    })
  }

  it("matches what the module builds", () => {
    expect(rules.flatMap((r) => r.headers).map((h) => h.key)).toEqual(securityHeaders(OUTPUTS).map((h) => h.key))
  })
})

describe("no dangerouslySetInnerHTML (criterion 4)", () => {
  // `npm run lint` is the check; this only keeps the rule from being deleted quietly. The config
  // cannot be imported here (eslint-config-next patches ESLint's loader and refuses vitest).
  it("is an ESLint error", () => {
    const config = readFileSync(join(process.cwd(), "eslint.config.mjs"), "utf8")
    expect(config).toMatch(/"react\/no-danger":\s*"error"/)
  })
})
