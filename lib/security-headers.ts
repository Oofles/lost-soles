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
 * (the map; the session is an `httpOnly` cookie since 0332, so not that) only to the origins in
 * `connect-src` — the app and the tiles distribution — and cannot beacon it out through an image,
 * a frame, a form or a `<base>` rewrite. The other half of §5.3's XSS mitigation, no `dangerouslySetInnerHTML`,
 * is an ESLint error (`eslint.config.mjs`).
 *
 * `style-src 'unsafe-inline'` (D-442): server-rendered `style="…"` attributes cannot carry a
 * nonce or a hash, and the app renders them. Style injection is not script
 * execution; the exfiltration paths it could open (`url()` fetches) are closed by `img-src`,
 * `font-src` and `connect-src` regardless.
 */

/** The slice of `amplify_outputs.json` the CSP is built from. Structural, like `lib/basemap.ts`. */
export interface CspOutputs {
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
 * - NOT AppSync (D-472, `0331`). The browser's skills, ledger, log and kind calls are same-origin
 *   route handlers, so the AppSync endpoint is no origin the browser talks to, and naming it here
 *   would only widen where an XSS could send what it reads.
 * - The tiles CloudFront distribution: pmtiles range requests (D-226), and `lib/place-names.ts`.
 * - NOT Cognito (D-473, `0332`). Sign-in is a full-page redirect to Google and back through
 *   `/api/authjs/*` on this origin, which is navigation, not `connect-src`. The two Cognito hosts
 *   the Authenticator and Amplify's `fetchAuthSession` called left with them. Nothing here reads
 *   `auth.aws_region` any more, so the CSP survives `0334` deleting the `auth` block.
 */
export function connectSources(outputs: CspOutputs): string[] {
  return ["'self'", originOf(outputs.custom?.basemapTilesUrl, "custom.basemapTilesUrl (the tiles distribution)")]
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
