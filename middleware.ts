import { NextResponse, type NextRequest } from "next/server"

import { auth } from "@/lib/auth"
import { ssoLoginUrl } from "@/lib/auth/config"
import { authjsUid } from "@/lib/auth/identity"
import { UID_COOKIE, UID_COOKIE_OPTIONS } from "@/lib/auth/uid-cookie"
import { NO_STORE } from "@/lib/http/no-store"

/**
 * Server-side auth (ticket 0016, criterion 2; 08-security-privacy.md §5.3).
 *
 * 0014 shipped the Amplify UI Authenticator, which was a CLIENT-side gate: the
 * markup was served and then replaced on hydration. That was not what §5.3 asks for
 * and not "behind auth" in the sense criterion 2 means — hence this. Since 0332
 * (D-473) there is no client gate at all, and this is the only one.
 *
 * SINCE 0339 (D-478), CORE IS THE SIGN-IN POINT. A signed-out request for a page, `/`
 * included, never receives that page's markup: it gets a 307 to
 * `https://core.devaultsecurity.com/login?next=<this page's full public URL>`, and core sends
 * it back here once signed in. A signed-in account that is not admitted HERE gets a 403, never
 * that redirect: core would see its valid session and bounce it straight back, forever. This is
 * `school-hub`'s `middleware.ts` at 7ba7d2e, with Lost Soles' two gates (D-471) as the test.
 *
 * WITHOUT `AUTH_SSO_URL` (locally, where a cookie cannot span localhost and the domain), the
 * gate falls back to what it did before 0339: a 307 to `/`, where the `(home)` layout renders
 * Sign in with Google. There is deliberately NO /sign-in route: §1.2 says seven routes, and
 * §1.5 says back always returns toward `/`.
 *
 * The session is read here and NEVER trusted from a request body, query string or
 * header — the same rule §5.3 states for API routes and §4 states for the webhook.
 */

/**
 * An API route answers a fetch, not a browser navigation, so the 307 below is the
 * wrong answer for one: a client following it gets 200 and the HTML of `/`, which
 * is a signed-out capture silently reported as a success. 0019's criterion is
 * **404, and no commit** — the same status §6.5 requires for a signed-in non-owner,
 * so that neither an outsider nor a redirect-following retry queue can distinguish
 * "you may not" from "there is nothing here".
 */
function isApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/")
}

/**
 * Ticket 0330, D-471; the only session since 0332 (D-473). An Auth.js session admits when its
 * email is allowlisted AND mapped in `IDENTITIES`. The reading comes from next-auth's
 * `auth(handler)` wrapper, which decrypts the cookie and hands the session in as `req.auth` (null
 * on any failure, including a config error). The decision is made HERE, explicitly, as
 * `school-hub`'s middleware does: with a handler, the `authorized` callback's `false` does not
 * refuse anything, so nothing may rely on it.
 *
 * Nothing else admits. The Amplify cookie and the `Authorization: Bearer` path (D-183, ticket
 * 0149) are gone, so a request carrying only a bearer header is signed out. A domain cookie for
 * an email Lost Soles does not map is not a session here either (D-470).
 *
 * The `ls-uid` cookie (D-NEW-a, `lib/auth/uid-cookie.ts`) is an OUTPUT of this decision, never an
 * input: set on every admitted response, deleted on every signed-out one. Nothing here reads it.
 */
function gate(request: NextRequest, authjsEmail: string | null | undefined): NextResponse {
  const uid = authjsUid(authjsEmail)
  if (uid) {
    const admitted = NextResponse.next()
    admitted.cookies.set(UID_COOKIE, uid, UID_COOKIE_OPTIONS)
    return admitted
  }
  const signedOut = refuse(request, Boolean(authjsEmail))
  // Not `cookies.delete(name)`: that omits `Path`, so on `/api/fog` it would clear an `/api`
  // cookie and leave the `Path=/` one standing. Same attributes, expired now.
  signedOut.cookies.set(UID_COOKIE, "", { ...UID_COOKIE_OPTIONS, maxAge: 0 })
  return signedOut
}

/**
 * The not-admitted answer. An API always 404s. A page, under core's SSO (D-478): a 403 for a
 * session this app does not admit, else a 307 to core. Without `AUTH_SSO_URL`: `/` itself, or a
 * 307 to `/`.
 *
 * `hasSession` is "the Auth.js cookie decrypted to an email", whatever that email is worth here.
 * It only chooses between two refusals; it never admits anything (`gate` decided that already).
 */
function refuse(request: NextRequest, hasSession: boolean): NextResponse {
  /**
   * The responses below are built HERE, not by a route handler, so `withNoStore` never sees
   * them. D-429 / C-3 say EVERY response carries `private, no-store`, 404s, 403s and redirects
   * included, so each sets it itself (ticket 0322). The `NextResponse.next()` path falls through
   * to a page, which sets its own.
   */
  if (isApiPath(request.nextUrl.pathname)) {
    // Signed out and signed in-but-not-here alike: §6.5's 404, so neither can tell "you may not"
    // from "there is nothing here". school-hub answers 401 JSON; Lost Soles keeps its 404 (0019).
    return NextResponse.json(
      { error: "not found" },
      { status: 404, headers: { "Cache-Control": NO_STORE } },
    )
  }

  /**
   * Core's SSO (ticket 0339, D-478). `ssoLoginUrl` is `school-hub`'s, verbatim in
   * `lib/auth/config.ts`: null unless BOTH `AUTH_SSO_URL` and `AUTH_URL` are set, and the return
   * address is built from `AUTH_URL`, the public origin, because the request URL behind Amplify
   * can be an internal host. Path AND query, so a deep link survives the round trip.
   */
  const sso = ssoLoginUrl(request.nextUrl.pathname + request.nextUrl.search)
  if (sso) {
    if (hasSession) return forbidden()
    const toCore = NextResponse.redirect(sso)
    toCore.headers.set("Cache-Control", NO_STORE)
    return toCore
  }

  // `/` is the signed-out landing as well as the home screen, so it must not
  // redirect to itself — that is an infinite loop, not a gate.
  if (request.nextUrl.pathname === "/") return NextResponse.next()

  const url = request.nextUrl.clone()
  url.pathname = "/"
  // Where they were headed, so a deep link survives sign-in rather than dumping
  // the user on the home screen with no explanation (§1.5 deep-link behaviour).
  url.searchParams.set("next", request.nextUrl.pathname)
  const redirect = NextResponse.redirect(url)
  redirect.headers.set("Cache-Control", NO_STORE)
  return redirect
}

/**
 * Signed in on the domain, not admitted here: an allowlisted account of another app, or one that
 * fails Lost Soles' `AUTH_ALLOWED_EMAILS` or `IDENTITIES` (D-471). Static text, the same for every
 * such account: it names no email and nothing about the owner.
 */
function forbidden(): NextResponse {
  return new NextResponse(
    "<!doctype html><meta charset=utf-8><title>Not permitted</title>" +
      "<p>You are signed in, but this account does not have access to Lost Soles.</p>",
    { status: 403, headers: { "content-type": "text/html; charset=utf-8", "Cache-Control": NO_STORE } },
  )
}

export const middleware = auth((req) => gate(req, req.auth?.user?.email))

export const config = {
  /**
   * Everything except Next's own static output, the favicon, and `/maplibre/`. Every
   * route is owner-only: with one user (P9) owner-only and authenticated are the same
   * thing, but it must stay behind the gate for the day that stops being true. (The
   * `/dev/tickets` stubs this once named are gone, D-252 and ticket 0216.)
   *
   * `/maplibre/` is MapLibre's own worker, copied out of node_modules at prebuild by
   * `scripts/copy-maplibre-worker.mjs` (ticket 0053). It is exempt for the same reason
   * `_next/static` is: it is a vendored, BSD-licensed library file that Next would
   * serve from `_next/static` itself if MapLibre could be bundled normally, and it
   * carries nothing about the operator.
   *
   * IT IS NOT COSMETIC. A worker is fetched as a subresource, so without this exemption
   * it takes a 307 to `/` and the browser refuses it — "non-JavaScript MIME type
   * text/html" — leaving a map that paints its background layer and no tiles. That is
   * the second half of the bug 0053 shipped: fixing only the worker URL would still
   * have failed here.
   *
   * `/basemap-assets/` is the same case (ticket 0293): the basemap's glyph PBFs and sprite,
   * copied from Protomaps' OFL/MIT-licensed assets. MapLibre fetches them as subresources, so
   * a 307 to `/` is an HTML body where a PBF should be and every label vanishes. The sprite's
   * `.png` was already exempt by extension; its `.json` and every `.pbf` were not.
   *
   * `/api/authjs/` is Auth.js's own route family (ticket 0330, D-471). A signed-out browser must
   * reach signin, csrf and the Google callback, and this gate 404s every signed-out API request.
   * Safe to exempt: those routes authenticate themselves (CSRF token, OAuth state/PKCE/nonce, an
   * encrypted session JWT) and touch no Lost Soles data. The exemption is the PREFIX with its
   * slash, so `/api/authjs` itself and every other `/api/*` path stay gated.
   */
  matcher: [
    "/((?!_next/static|_next/image|maplibre/|basemap-assets/|api/authjs/|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|ico)$).*)",
  ],
}
