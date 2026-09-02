import { cookies } from "next/headers"

import { fetchAuthSession } from "aws-amplify/auth/server"

import { runWithAmplifyServerContext } from "@/lib/amplify-server"

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
 * The allowlist. Cognito `sub`s, hard-coded per §6.4/1.
 *
 * WHY THE SUB AND NOT THE EMAIL. A sub is immutable and Cognito-assigned; an email
 * is a mutable user attribute. Allowlisting something the account holder can change
 * is allowlisting the wrong thing, even when the account holder is the operator.
 *
 * WHY HARD-CODED AND NOT SSM. It is an identifier, not a credential — knowing it
 * grants nothing without a signed session, which is why it can sit in source beside
 * `REPO_OWNER`. Hard-coding also means the check has no runtime dependency that can
 * be unavailable, which matters for a control whose failure mode must be closed.
 *
 * AN EMPTY LIST FAILS CLOSED — every request 404s. That is deliberate: an allowlist
 * that defaults to permitting is not an allowlist, and a deploy that forgot to fill
 * this in should be visibly dead rather than quietly open.
 */
export const OWNER_USER_IDS: readonly string[] = [
  // Populated from the deployed pool (us-east-1_RV7QIiViX). See the capability doc.
]

export function isOwner(userId: string | undefined): boolean {
  if (!userId) return false
  return OWNER_USER_IDS.includes(userId)
}

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
  try {
    return await runWithAmplifyServerContext({
      nextServerContext: { cookies },
      operation: async (contextSpec) => {
        const session = await fetchAuthSession(contextSpec)
        const sub = session.tokens?.idToken?.payload?.sub
        return typeof sub === "string" ? sub : undefined
      },
    })
  } catch {
    return undefined
  }
}
