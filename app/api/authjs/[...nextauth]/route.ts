import { handlers } from "@/lib/auth"
import { withNoStore } from "@/lib/http/no-store"

/**
 * Auth.js's own routes: providers, csrf, signin, callback, session, signout. Ticket 0330, D-471.
 *
 * Exempt from `middleware.ts`'s matcher, because a signed-out browser must reach signin and the
 * Google callback. That is safe: these routes authenticate themselves (a CSRF token on every
 * POST, OAuth state, PKCE and nonce on the callback, a signed and encrypted JWT for the session)
 * and none of them reads or writes Lost Soles data. Every other `/api/*` path stays gated.
 *
 * Wrapped in `withNoStore` like every route (C-3): the session endpoint returns who is signed in.
 */
export const GET = withNoStore(handlers.GET)
export const POST = withNoStore(handlers.POST)
