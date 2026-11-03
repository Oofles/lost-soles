"use server"

import { signIn, signOut } from "@/lib/auth"

/**
 * SIGNING IN AND OUT. Ticket 0332, the cutover (D-473). The only callers of Auth.js's `signIn` and
 * `signOut`.
 *
 * Server actions, not `next-auth/react`: the client never touches Auth.js, so no session-shaped
 * module reaches the browser bundle (`lib/auth/session-readers.test.ts`). Next refuses a server
 * action whose `Origin` is not this host, which is `08` §5.3's CSRF rule for state-changing calls.
 *
 * Both are full-page redirects. Sign-in goes to Google's account chooser and comes back through
 * `/api/authjs/callback/google`; the page after it is server-rendered fresh with the new session,
 * which is why D-331's held-children guard is gone.
 */

/**
 * `/` signed out: one action, Sign in with Google. Back to `/` after the callback. Since 0339
 * (D-478) production never shows it: core is the sign-in point, and the middleware sends a
 * signed-out `/` there. It stays for local runs without `AUTH_SSO_URL`.
 */
export async function signInWithGoogle(): Promise<void> {
  await signIn("google", { redirectTo: "/" })
}

/**
 * `/settings` → Sign out. THE COOKIE IS THE DOMAIN'S (D-471), so this signs out of every app on
 * `.devaultsecurity.com`, `school-hub` included. The settings copy says so.
 *
 * Since 0339 (D-478) that cookie is `__Secure-devault.session-token`, core's shared name; Auth.js
 * expires it with the configured name and `Domain` (`app/sign-out-cookie.test.ts`). The redirect
 * to `/` then lands on core's sign-in, because the middleware sends a signed-out `/` there.
 */
export async function signOutEverywhere(): Promise<void> {
  await signOut({ redirectTo: "/" })
}
