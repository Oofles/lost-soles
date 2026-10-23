/**
 * THE RESPONSE SECURITY HEADERS. Ticket 0143; `08-security-privacy.md` §5.3's Headers row.
 *
 * Read by `next.config.ts` `headers()` at BUILD time, applied to every path the app serves —
 * documents, route handlers, `_next/static`, `/maplibre/` and `/basemap-assets/` alike. That is
 * why it lives in config and not in `middleware.ts`: the middleware matcher deliberately skips the
 * static paths (a worker or glyph PBF must never take the auth redirect), and with no per-request
 * nonce (D-441) nothing here varies by request, so middleware has no reason to own it.
 *
 * Imported by RELATIVE path from `next.config.ts`, so it must not use the `@/` alias and must not
 * import anything that does.
 *
 * ─── WHAT THIS CSP IS, HONESTLY (D-441) ────────────────────────────────────
 *
 * `script-src 'self' 'unsafe-inline'`, no nonce. A nonce reaches only pages rendered per request,
 * and `/log`, `/skills` and `/skills/[skillId]` are static on purpose (D-282: `/log` must render
 * offline from a prefetch). So this policy does NOT stop an injected inline script running. What
 * it does do: no third-party script file can load, and an XSS that does run can send what it reads
 * (the tokens in `localStorage`, the map) only to the origins in `connect-src` — the app, AppSync,
 * the tiles distribution and Cognito — and cannot beacon it out through an image, a frame, a form
 * or a `<base>` rewrite. The other half of §5.3's XSS mitigation, no `dangerouslySetInnerHTML`,
 * is an ESLint error (`eslint.config.mjs`).
 *
 * `style-src 'unsafe-inline'` (D-442): server-rendered `style="…"` attributes cannot carry a
 * nonce or a hash, and the app and Amplify UI both render them. Style injection is not script
 * execution; the exfiltration paths it could open (`url()` fetches) are closed by `img-src`,
 * `font-src` and `connect-src` regardless.
 */

/** The slice of `amplify_outputs.json` the CSP is built from. Structural, like `lib/basemap.ts`. */
export interface CspOutputs {
  auth?: { aws_region?: string }
  data?: { url?: string }
  custom?: { basemapTilesUrl?: string }
}

/** An origin from a URL, or a loud failure: a CSP that silently omits a host breaks the map. */
function originOf(url: string | undefined, what: string): string {
  if (!url) {
    throw new Error(
      `security-headers: amplify_outputs.json has no ${what}. The CSP names every origin the ` +
        "browser talks to (ticket 0143), so it cannot be built without it.",
    )
  }
  return new URL(url).origin
}

/**
 * Every origin the BROWSER calls, named — never a wildcard (0143 criterion 2).
 *
 * - `'self'`: route handlers, server actions, `/basemap-assets/` (D-437), `/maplibre/`.
 * - AppSync: `generateClient` in `lib/{skills,log,runs,run-kind}/transport.ts`. No client code
 *   subscribes, so the `appsync-realtime-api` websocket host is deliberately absent.
 * - The tiles CloudFront distribution: pmtiles range requests (D-226), and `lib/place-names.ts`.
 * - `cognito-idp`: the Authenticator's sign-in, token refresh and `signOut`.
 * - `cognito-identity`: the config carries an identity pool, so Amplify's `fetchAuthSession`
 *   (which every `generateClient` call runs) exchanges the ID token for credentials there.
 */
export function connectSources(outputs: CspOutputs): string[] {
  const region = outputs.auth?.aws_region
  if (!region || !/^[a-z]{2}(-[a-z]+)+-\d$/.test(region)) {
    throw new Error("security-headers: amplify_outputs.json has no usable auth.aws_region.")
  }
  return [
    "'self'",
    originOf(outputs.data?.url, "data.url (the AppSync endpoint)"),
    originOf(outputs.custom?.basemapTilesUrl, "custom.basemapTilesUrl (the tiles distribution)"),
    `https://cognito-idp.${region}.amazonaws.com`,
    `https://cognito-identity.${region}.amazonaws.com`,
  ]
}

/**
 * The Content-Security-Policy value. `dev` adds `'unsafe-eval'`, which `next dev`'s webpack
 * runtime needs and a production build does not.
 */
export function contentSecurityPolicy(outputs: CspOutputs, { dev = false }: { dev?: boolean } = {}): string {
  const directives: [string, string[]][] = [
    ["default-src", ["'self'"]],
    ["script-src", ["'self'", "'unsafe-inline'", ...(dev ? ["'unsafe-eval'"] : [])]],
    ["style-src", ["'self'", "'unsafe-inline'"]],
    // `blob:` and `data:` are never network requests; MapLibre and canvas readback use them.
    ["img-src", ["'self'", "data:", "blob:"]],
    ["font-src", ["'self'"]],
    ["connect-src", connectSources(outputs)],
    // MapLibre's worker is `/maplibre/maplibre-gl-worker.js` (`setWorkerUrl`, ticket 0053).
    ["worker-src", ["'self'"]],
    ["frame-src", ["'none'"]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'self'"]],
    // Server actions (`app/sync-action.ts`) post to the app itself.
    ["form-action", ["'self'"]],
    ["frame-ancestors", ["'none'"]],
  ]
  return directives.map(([name, values]) => `${name} ${values.join(" ")}`).join("; ")
}

/**
 * Two years, subdomains included. No `preload`: the preload list is a commitment for the whole
 * registrable domain (`devaultsecurity.com`), which is not this app's to make.
 */
export const HSTS = "max-age=63072000; includeSubDomains"

/** Every header this module owns, for every response. */
export function securityHeaders(outputs: CspOutputs, opts: { dev?: boolean } = {}): { key: string; value: string }[] {
  return [
    { key: "Strict-Transport-Security", value: HSTS },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Content-Security-Policy", value: contentSecurityPolicy(outputs, opts) },
  ]
}

/** The `headers()` source that covers every path, static assets included. */
export const ALL_PATHS = "/:path*"
