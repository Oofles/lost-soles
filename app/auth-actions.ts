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

/** `/` signed out: one action, Sign in with Google. Back to `/` after the callback. */
export async function signInWithGoogle(): Promise<void> {
  await signIn("google", { redirectTo: "/" })
}

/**
 * `/settings` → Sign out. THE COOKIE IS THE DOMAIN'S (D-471), so this signs out of every app on
 * `.devaultsecurity.com`, `school-hub` included. The settings copy says so.
 */
export async function signOutEverywhere(): Promise<void> {
  await signOut({ redirectTo: "/" })
}
