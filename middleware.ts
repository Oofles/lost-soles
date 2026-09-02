import { fetchAuthSession } from "aws-amplify/auth/server"
import { NextResponse, type NextRequest } from "next/server"

import { runWithAmplifyServerContext } from "@/lib/amplify-server"
import { verifiedBearerSub } from "@/lib/auth/bearer"

/**
 * Server-side auth (ticket 0016, criterion 2; 08-security-privacy.md §5.3).
 *
 * 0014 shipped the Amplify UI Authenticator, which is a CLIENT-side gate: the
 * markup is served and then replaced on hydration. That is fine for a single-user
 * app whose data is protected by AppSync, but it is not what §5.3 asks for and it
 * is not "behind auth" in the sense criterion 2 means — hence this.
 *
 * A signed-out request for any route other than `/` now never receives that
 * route's markup at all; it gets a 307 to `/`, where the Authenticator renders
 * sign-in. There is deliberately NO /sign-in route: §1.2 says seven routes, and
 * §1.5 says back always returns toward `/`, so `/` doubling as the signed-out
 * landing keeps both true.
 *
 * The session is read here and NEVER trusted from a request body, query string or
 * header — the same rule §5.3 states for API routes and §4 states for the webhook.
 *
 * The runner itself moved to `lib/amplify-server.ts` in ticket 0019, so route
 * handlers read the session through the same configuration this does.
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

export async function middleware(request: NextRequest) {
  const response = NextResponse.next()

  const authenticated = await runWithAmplifyServerContext({
    nextServerContext: { request, response },
    operation: async (contextSpec) => {
      try {
        const session = await fetchAuthSession(contextSpec)
        // Both tokens must be present. An expired or partial session is a
        // signed-out session: fail closed, exactly as the posture check does.
        return session.tokens?.accessToken !== undefined && session.tokens?.idToken !== undefined
      } catch {
        return false
      }
    },
  })

  if (authenticated) return response

  /**
   * No cookie session — so this may be a NON-BROWSER client (ticket 0149).
   * A Tasker HTTP task cannot hold a Cognito session cookie, and without this
   * branch the capture endpoint is unreachable from the phone it exists for.
   *
   * Checked SECOND, deliberately. The app's own requests are the overwhelming
   * majority and carry cookies, so this costs them nothing; and a request that
   * sends both gets the cookie's answer, which keeps the browser's behaviour
   * exactly as it was before this branch existed.
   *
   * This is a real verification, not a presence check: `verifiedBearerSub`
   * validates the signature against the production pool's JWKS and returns a
   * `sub` only from a verified payload. A malformed, expired, wrong-pool or
   * wrong-client token falls through to the same 404 as no credential at all.
   */
  if (await verifiedBearerSub(request.headers.get("authorization"))) return response

  if (isApiPath(request.nextUrl.pathname)) {
    return NextResponse.json({ error: "not found" }, { status: 404 })
  }

  // `/` is the signed-out landing as well as the home screen, so it must not
  // redirect to itself — that is an infinite loop, not a gate.
  if (request.nextUrl.pathname === "/") return response

  const url = request.nextUrl.clone()
  url.pathname = "/"
  // Where they were headed, so a deep link survives sign-in rather than dumping
  // the user on the home screen with no explanation (§1.5 deep-link behaviour).
  url.searchParams.set("next", request.nextUrl.pathname)
  return NextResponse.redirect(url)
}

export const config = {
  /**
   * Everything except Next's own static output and the favicon. Note this
   * deliberately DOES cover `/dev/tickets`: it is owner-only, and with one user
   * (P9) owner-only and authenticated are the same thing — but it must stay
   * behind the gate for the day that stops being true.
   */
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|ico)$).*)"],
}
