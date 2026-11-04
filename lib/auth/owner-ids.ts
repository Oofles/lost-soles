/**
 * THE OWNER ALLOWLIST, with no framework import. Split out of `owner.ts` by ticket 0069 so
 * the `logWorkout` Lambda can enforce the same list without bundling `next/headers`.
 * `owner.ts` re-exports both names; nothing that imported them from there changes.
 */

/**
 * The allowlist. Cognito `sub`s, hard-coded per §6.4/1.
 *
 * SINCE `0334` (D-473) THERE IS NO COGNITO POOL. The uid below is the old pool's `sub`, frozen:
 * every partition key and S3 key is it, and `IDENTITIES` (below) maps a Google email onto it. The
 * two-pools warning that follows is history; it explains why the uid is what it is.
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
 * THE IDENTITY MAP: a Google sign-in's email -> the internal uid. Ticket 0330, D-471.
 *
 * The uid is the Cognito `sub` above, forever. Every DynamoDB partition key and every
 * `users/<uid>/` and `raw/<uid>/` key is that `sub`, and re-keying a map that cannot re-fog
 * (D-020) to save one lookup table is the worst available trade. So Auth.js sessions reach the
 * existing uid through this table.
 *
 * THIS IS THE AUTHORIZATION, `AUTH_ALLOWED_EMAILS` (SSM) IS THE SIGN-IN GATE. Both must pass:
 * an allowlisted email with no entry here is signed out (`lib/auth/identity.ts`). Hard-coded for
 * the same reasons as `OWNER_USER_IDS`: identifiers, not credentials, and a fail-closed control
 * with no runtime dependency.
 *
 * EMAIL, NOT GOOGLE'S `sub` (operator, D-471). Both of the operator's addresses are already in
 * this public repository's history, so this publishes nothing new. A changed Google address
 * unmaps, and fails closed; the fix is a one-line commit.
 *
 * D-123 TRIGGER A (D-470, D-479): an entry mapping to any uid other than the owner's fires it.
 * The operator's own addresses may each map to the owner uid; that is one account with two ways
 * in, not a second account (D-479). Keys are lower case.
 */
export const IDENTITIES: Readonly<Record<string, string>> = {
  "amazingbrandon@gmail.com": "5488e4b8-d081-7014-748e-edd1937f8083",
  "brandondevault@gmail.com": "5488e4b8-d081-7014-748e-edd1937f8083", // D-479, signs in via core
}

/** The mapped uid, or undefined. Case-insensitive on the email; no allowlist check here. */
export function uidForEmail(email: string | null | undefined): string | undefined {
  if (!email) return undefined
  const key = email.trim().toLowerCase()
  return Object.hasOwn(IDENTITIES, key) ? IDENTITIES[key] : undefined
}
