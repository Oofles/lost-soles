import { auth } from "@/lib/auth"
import { authjsUid } from "@/lib/auth/identity"

export { isOwner, OWNER_USER_IDS } from "@/lib/auth/owner-ids"

/**
 * Owner-only authorization. Ticket 0019, `07-ticketsmith.md` §6.4/1.
 *
 * "IS THE OWNER", NOT "IS LOGGED IN". Today those are the same set, because
 * `IDENTITIES` maps one email (D-470). They
 * stop being the same set the day D-014 adds friends, and on that day this route
 * must not silently widen from "the operator" to "anyone the operator trusts with
 * their map". A write primitive pointed at the source repository is not a thing to
 * share with a running buddy. So the check is written now, while it is a no-op, and
 * §6.4/1 says so explicitly: "even after D-014 adds friends, this route stays
 * owner-only."
 */


/**
 * Reads the signed-in user's `sub` from the VERIFIED session, or undefined.
 *
 * `08-security-privacy.md` §5.3: every server route re-derives the uid from the
 * verified session and NEVER takes one from a request body, query string or header.
 * That is why this function takes no argument carrying an identity — there is no
 * parameter here for a caller to pass the wrong thing into.
 *
 * Any failure is undefined, i.e. not the owner. An expired, partial or unparseable
 * session is a signed-out session; the same fail-closed reading `middleware.ts` and
 * `check-auth-posture.mjs` both take.
 */
export async function currentUserId(): Promise<string | undefined> {
  /**
   * Ticket 0330, D-471; the only path since 0332 (D-473). A Google sign-in whose email is on
   * `AUTH_ALLOWED_EMAILS` AND in `IDENTITIES` is that uid. Anything else (no session, an unlisted
   * or unmapped email, a config error) is undefined. There is no Cognito fallback and no bearer
   * token: an `Authorization` header is not read at all. next-auth returns null on a non-OK
   * session response (the GHSA-8fpg-xm3f-6cx3 fix), and the catch covers anything that throws, so
   * this cannot fail open: only a mapped email yields a uid.
   *
   * THE ONLY SERVER CALL TO `auth()` OUTSIDE middleware.ts. `lib/map-home.ts` once read the
   * session itself; it asks this function now (`lib/auth/session-readers.test.ts`).
   */
  const session = await auth().catch(() => null)
  return authjsUid(session?.user?.email)
}
