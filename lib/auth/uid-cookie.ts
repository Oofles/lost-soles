/**
 * THE BROWSER'S COPY OF THE UID. Ticket 0332, D-476 ("how the browser learns the uid after the
 * cutover").
 *
 * The Auth.js session is an `httpOnly` cookie, so no script can read it. The browser still needs
 * the uid as the key of its IndexedDB stores (the `/log` queue, the skills cache, the latest run,
 * `02` §6.4), and `/log` must read them OFFLINE, with no network (D-282). Amplify's
 * `getCurrentUser()` used to answer that from the Cognito tokens. This cookie answers it now:
 * `middleware.ts` sets it on every admitted request and deletes it on every signed-out one.
 *
 * NOT A CREDENTIAL. The server authorizes from the Auth.js session alone and never reads this
 * cookie: `currentUserId()` and the middleware gate look only at the session
 * (`middleware.test.ts`, "a forged ls-uid"). A forged value changes nothing but which local cache
 * this browser opens. The uid identifies an account, not a place, and the browser held the same
 * `sub` inside Amplify's tokens before the cutover.
 *
 * Imported by the edge middleware and by browser code, so it imports nothing.
 */
export const UID_COOKIE = "ls-uid"

/** As long as the Auth.js session it shadows (`lib/auth/config.ts`, 30 days). */
export const UID_COOKIE_MAX_AGE = 30 * 24 * 60 * 60

/**
 * Set on the response: `Secure`, `SameSite=Lax`, host-only (no `Domain`), `Path=/`, and readable
 * by script on purpose (`httpOnly: false`), because reading it is its whole job.
 */
export const UID_COOKIE_OPTIONS = {
  httpOnly: false,
  secure: true,
  sameSite: "lax",
  path: "/",
  maxAge: UID_COOKIE_MAX_AGE,
} as const

/** The uid in a `document.cookie` string, or undefined. */
export function uidFromCookieHeader(cookie: string | null | undefined): string | undefined {
  if (!cookie) return undefined
  for (const part of cookie.split(";")) {
    const eq = part.indexOf("=")
    if (eq === -1) continue
    if (part.slice(0, eq).trim() !== UID_COOKIE) continue
    let value: string
    try {
      value = decodeURIComponent(part.slice(eq + 1).trim())
    } catch {
      return undefined
    }
    return value === "" ? undefined : value
  }
  return undefined
}
