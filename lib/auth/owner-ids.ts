/**
 * THE OWNER ALLOWLIST, with no framework import. Split out of `owner.ts` by ticket 0069 so
 * the `logWorkout` Lambda can enforce the same list without bundling `next/headers`.
 * `owner.ts` re-exports both names; nothing that imported them from there changes.
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
