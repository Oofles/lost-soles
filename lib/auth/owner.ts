import { cookies, headers } from "next/headers"

import { fetchAuthSession } from "aws-amplify/auth/server"

import { runWithAmplifyServerContext } from "@/lib/amplify-server"
import { verifiedBearerSub } from "@/lib/auth/bearer"

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
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A SUB IS POOL-SCOPED, AND THIS PROJECT HAS TWO POOLS. Read this before editing.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Do NOT read the pool id out of `amplify_outputs.json` to look this up. That file
 * is generated per-environment and is rewritten by `ampx sandbox`, so on a laptop it
 * names the SANDBOX pool, whose only user is the `agent@lost-soles.invalid`
 * throwaway from ticket `0130` — an account whose password lives in SSM and which is
 * emphatically not the owner. Allowlisting it would be a hole, and it is one step
 * away from happening because the wrong answer is the convenient one.
 *
 * Tell the pools apart by their tags, not by their ids:
 *
 *   amplify:deployment-type = branch   (branch-name: main)  ← production. THIS one.
 *   amplify:deployment-type = sandbox                       ← throwaway. Never.
 *
 * The consequence to remember: **if the production pool is ever recreated, every sub
 * in it changes and this list silently 404s the owner** — the endpoint will look
 * broken with no error that mentions auth. `0131` already recreated the sandbox pool
 * once, so this is a real sequence, not a hypothetical.
 */
export const OWNER_USER_IDS: readonly string[] = [
  // The operator, in the `main` branch pool us-east-1_3lreDA1d1
  // (amplify:deployment-type = branch). Verified against the pool's tags on
  // 2026-09-02, not inferred from amplify_outputs.json. See the capability doc.
  "5488e4b8-d081-7014-748e-edd1937f8083",
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
