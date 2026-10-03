import { cookies, headers } from "next/headers"

import { fetchAuthSession } from "aws-amplify/auth/server"

import { runWithAmplifyServerContext } from "@/lib/amplify-server"
import { verifiedBearerSub } from "@/lib/auth/bearer"

export { isOwner, OWNER_USER_IDS } from "@/lib/auth/owner-ids"

/**
 * Owner-only authorization. Ticket 0019, `07-ticketsmith.md` §6.4/1.
 *
 * "IS THE OWNER", NOT "IS LOGGED IN". Today those are the same set, because the
 * pool has one account and `allowAdminCreateUserOnly: true` keeps it that way. They
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
 * `08-security-privacy.md` §5.3: every server route re-derives `sub` from the
 * verified JWT and NEVER takes a uid from a request body, query string or header.
 * That is why this function takes no argument carrying an identity — there is no
 * parameter here for a caller to pass the wrong thing into.
 *
 * Any failure is undefined, i.e. not the owner. An expired, partial or unparseable
 * session is a signed-out session; the same fail-closed reading `middleware.ts` and
 * `check-auth-posture.mjs` both take.
 */
export async function currentUserId(): Promise<string | undefined> {
  const fromCookie = await runWithAmplifyServerContext({
    nextServerContext: { cookies },
    operation: async (contextSpec) => {
      const session = await fetchAuthSession(contextSpec)
      const sub = session.tokens?.idToken?.payload?.sub
      return typeof sub === "string" ? sub : undefined
    },
  }).catch(() => undefined)
  if (fromCookie) return fromCookie

  /**
   * Ticket 0149. The non-browser path, re-derived here rather than trusted from
   * middleware.
   *
   * `middleware.ts` already verified this token, and this verifies it AGAIN. That
   * is deliberate and it is not redundant: the route must be correct on its own
   * terms, because a future change to the middleware matcher — one more exclusion
   * in that regex — would otherwise silently turn the endpoint's authorization
   * off. §6.4/1's check runs in the handler, so its input must be established in
   * the handler. The second verification is a JWKS cache hit.
   *
   * Note this function still takes NO parameter carrying an identity. It reads
   * the header itself, and the value it reads is a signature to be checked, not
   * a uid to be believed — §8's §5.3 rule is intact.
   */
  return verifiedBearerSub((await headers()).get("authorization"))
}
