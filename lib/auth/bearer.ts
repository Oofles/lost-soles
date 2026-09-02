import { CognitoJwtVerifier } from "aws-jwt-verify"

/**
 * Bearer-token authentication for NON-BROWSER clients. Ticket 0149, D-183.
 *
 * WHY THIS EXISTS. `0019` authenticates by Cognito session cookie, which is
 * correct for the app and unreachable from a Tasker HTTP task on a phone — and
 * the phone is the entire point of capability `03` (roadmap §4.1). `0020`
 * assumed a "shared auth header" that was never built and that
 * `08-security-privacy.md` §5.3 forbids in the form it implies.
 *
 * SO THE IDENTITY STILL COMES FROM COGNITO, NOT FROM THE HEADER. The header
 * carries a Cognito-signed ID token; this module verifies the signature against
 * the pool's JWKS and returns the `sub` from the VERIFIED payload. §5.3's rule —
 * "never take a uid from a request body, query string or header" — is about
 * trusting an asserted identity. A signature this server checked against a
 * public key it fetched from the issuer is not an assertion, it is proof.
 *
 * A shared secret was the obvious alternative and was rejected: it would be a
 * second auth path to a repository write primitive, the server would be trusting
 * a header value outright, and it could not be revoked for one device without
 * rotating it for every client.
 */

/**
 * The production pool and its app client. HARD-CODED, for the same two reasons
 * `OWNER_USER_IDS` is: these are identifiers rather than credentials — knowing
 * them grants nothing without a signed token — and a control whose failure mode
 * must be closed should not have a runtime dependency that can be unavailable.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DO NOT REPLACE THESE WITH `amplify_outputs.json`. Read `lib/auth/owner.ts`.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * That file is generated per-environment and `ampx sandbox` rewrites it, so on a
 * development machine it names the SANDBOX pool — whose only user is the
 * `agent@lost-soles.invalid` throwaway from `0130`, an account whose password
 * sits in SSM. A verifier pointed at the sandbox pool would accept that account's
 * tokens, and `OWNER_USER_IDS` would not stop it: a `sub` is pool-scoped, so the
 * sandbox could in principle mint one that collides with nothing, but the real
 * failure is simpler — the wrong pool is the wrong trust anchor, and the check
 * silently becomes "signed by someone" instead of "signed by production".
 *
 * Verified against the pools' TAGS on 2026-09-02, not inferred from any file:
 *
 *   us-east-1_3lreDA1d1  amplify:deployment-type = branch (main)  ← production
 *   us-east-1_RV7QIiViX  amplify:deployment-type = sandbox        ← never
 *
 *   aws cognito-idp describe-user-pool --user-pool-id <id> \
 *     --query 'UserPool.UserPoolTags'
 */
const PRODUCTION_USER_POOL_ID = "us-east-1_3lreDA1d1"
const PRODUCTION_APP_CLIENT_ID = "5vc5e8t2ljv1hg3doau5mp0m00"

/**
 * One verifier, module scope, so the JWKS is fetched once per execution
 * environment and reused across warm invocations.
 *
 * `create` does no I/O — it builds the verifier and the JWKS is fetched lazily on
 * the first `verify`. The library caches only SUCCESSFUL fetches, which is the
 * property `lib/tickets/github.ts` spells out for the SSM token and which matters
 * for the same reason: caching a rejection would disable capture for the entire
 * life of a warm environment, which can be hours, on the strength of one
 * transient network error.
 *
 * `tokenUse: "id"` and `clientId` are both enforced by the library, so a valid
 * ACCESS token from the same pool is rejected here — they are different tokens
 * with different audiences and only the ID token carries the identity claims.
 */
const verifier = CognitoJwtVerifier.create({
  userPoolId: PRODUCTION_USER_POOL_ID,
  tokenUse: "id",
  clientId: PRODUCTION_APP_CLIENT_ID,
})

/**
 * `Authorization: Bearer <token>` → the VERIFIED `sub`, or undefined.
 *
 * Takes the raw header rather than reading it itself, so it is testable without a
 * request. That is not the thing `owner.ts` refuses to accept as a parameter:
 * this is untrusted input on its way to being checked, not an identity being
 * passed in. Nothing here returns a value read from the token before
 * verification — `verify()` either resolves with a checked payload or throws.
 *
 * EVERY failure returns undefined rather than throwing: an expired token, a
 * garbage token, a token from the sandbox pool, a token for another client, a
 * JWKS fetch that failed. The caller's job is to treat undefined as signed out,
 * and a signed-out request gets the same 404 as everything else — so a stale
 * device credential is indistinguishable from no credential, which is what §6.5
 * row 1 spends a 404-instead-of-403 to achieve.
 */
export async function verifiedBearerSub(authorization: string | null | undefined): Promise<string | undefined> {
  if (!authorization) return undefined
  // Case-insensitive scheme, exactly one space, non-empty token. Deliberately
  // strict: a header this malformed is a broken client, and guessing at its
  // intent is how a parser becomes an attack surface.
  const match = /^Bearer ([A-Za-z0-9._-]+)$/i.exec(authorization.trim())
  if (!match) return undefined

  try {
    const payload = await verifier.verify(match[1])
    return typeof payload.sub === "string" ? payload.sub : undefined
  } catch {
    // Not logged at error level: an expired token is the ordinary case for a
    // device whose refresh ran late, not an incident.
    return undefined
  }
}
