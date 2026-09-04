import { NextResponse } from "next/server"

import { APP_ORIGIN } from "@/lib/app-origin"
import { currentUserId, isOwner } from "@/lib/auth/owner"
import { getOAuthConnector } from "@/src/adapters/registry"
import type { OAuthConnector } from "@/src/adapters/types"

/**
 * The parts all three OAuth routes share. Ticket 0032.
 *
 * WHY THESE ROUTES ARE `[source]` AND NOT `strava`. `check-boundaries.mjs` scans
 * `app/` for a Strava-shaped identifier, import or string literal, and it is right to:
 * D-100 and D-121.1 say replacing the primary source must produce a diff confined to
 * `src/adapters/<name>/` plus one line in `registry.ts`. A route hard-coded to one
 * vendor is a second place that would have to change.
 *
 * So the segment carries the source id, the registry resolves it, and nothing in this
 * directory knows which provider is on the other end. The URL still renders as
 * `/api/auth/strava/callback` at runtime, which is what the provider's app settings
 * are registered against.
 *
 * TICKET 0032's criterion 9 said every file added would be under
 * `src/adapters/strava/`. That is not buildable — the App Router serves routes from
 * `app/`, and a route handler cannot live in `src/`. The criterion was amended; the
 * reasoning is in the ticket's Resolution.
 */

/**
 * A signed-in non-owner, a signed-out request and an unknown source all get 404 —
 * the same status and the same body. `08-security-privacy.md` §6.5: anyone who can
 * tell one from another has learned something about what exists here.
 */
export const NOT_FOUND = () => new NextResponse(null, { status: 404 })

export interface RouteContext {
  userId: string
  sourceId: string
  connector: OAuthConnector
}

/**
 * Resolves the signed-in owner and the source's connector, or `null` — in which case
 * the caller returns `NOT_FOUND()` and nothing else.
 *
 * The user is re-derived from the verified session here, never taken from a query
 * string, a body or a header (`08-security-privacy.md` §5.3). The middleware has
 * already refused unauthenticated requests; this is the second check, because a route
 * that trusts the middleware is a route that breaks silently the day the matcher
 * changes.
 */
export async function resolveRoute(source: string): Promise<RouteContext | null> {
  const userId = await currentUserId()
  if (userId === undefined || !isOwner(userId)) return null

  try {
    return { userId, sourceId: source, connector: getOAuthConnector(source) }
  } catch {
    return null
  }
}

/**
 * The redirect URI, built from the app's own origin and never from the request.
 *
 * Deriving it from the `Host` header would let anyone who can set that header choose
 * where the provider sends the authorization code. It also has to be STABLE, because
 * the provider matches its host against the callback domain registered in the app
 * settings — a bare domain, no scheme, no path, no port.
 */
export const callbackUri = (sourceId: string) => `${APP_ORIGIN}/api/auth/${sourceId}/callback`

/** Where every one of these routes sends the browser when it is finished. */
export const settingsUrl = (params: Record<string, string>) =>
  `${APP_ORIGIN}/settings?${new URLSearchParams(params).toString()}`

/**
 * Outcomes the callback hands to `/settings`, which turns them into what the operator
 * reads. Kept as a small closed set rather than free text: a message passed through a
 * query string is a message an attacker can choose.
 */
export const CONNECT_OUTCOMES = [
  "connected",
  "scope-refused",
  "denied",
  "failed",
  "disconnected",
  "disconnect-failed",
] as const
export type ConnectOutcome = (typeof CONNECT_OUTCOMES)[number]
