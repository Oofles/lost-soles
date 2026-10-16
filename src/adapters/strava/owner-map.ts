/**
 * WHICH STRAVA ATHLETE IS WHICH LOST SOLES USER. Ticket 0091, D-343's sibling (Q1 option A).
 *
 * No framework import, and no import at all: the webhook Lambda loads this on a 2-second budget
 * through `registry.ts`, the same reason `lib/auth/owner-ids.ts` was split out of `owner.ts`.
 *
 * ─── WHY A STATIC MAP AND NOT THE `byExternalOwner` LOOKUP ──────────────────
 *
 * The webhook is the only unauthenticated, internet-facing surface in the system, and it holds
 * **no IAM grant on `LostSolesSourceAccount`** — "the public endpoint can never read a token, by
 * policy, not by discipline" (`08-security-privacy.md` §4.5). The `byExternalOwner` index lives
 * on that table. So the one lookup that turns an `owner_id` into a user is the one this function
 * is forbidden to make, and every receipt and job it writes needs the user (`acceptIngest` takes
 * `userId` and `activityId = computeActivityId(userId, …)`; the worker reads `job.userId`).
 *
 * D-014 caps this app at six users, ever, each provisioned by hand (§5.4). A hand-maintained map
 * of at most six rows, beside the allowlist that is already hand-maintained, costs nothing the
 * provisioning flow does not already cost — and an unknown athlete is then dropped at the edge
 * with a 200, before it can cost a queue message.
 *
 * ─── WHY HARD-CODED AND NOT SSM — the same argument `owner-ids.ts` makes ────
 *
 * Both sides are identifiers, not credentials. A Strava athlete id is printed in every public
 * profile URL; a Cognito `sub` grants nothing without a signed session. Hard-coding also means the
 * filter has no runtime dependency that can be unavailable on a cold start.
 *
 * ─── KEEP IN STEP WITH THE CONNECTION, OR WEBHOOKS STOP (and nothing is lost) ─
 *
 * The value is the `externalOwnerId` on the user's `SourceAccount` row, read from that row —
 * not inferred — on 2026-10-16. If a user reconnects as a different athlete, or the production
 * pool is recreated (`owner-ids.ts` explains why every sub would change), this map silently drops
 * their events as "unknown-owner". That failure is LOUD in the log and LOSSLESS: the six-hourly
 * sweep (`0095`) ingests everything the webhook dropped, because webhooks are a latency
 * optimisation and never the path of record (`03-integrations.md` §2.3).
 *
 * AN EMPTY MAP FAILS CLOSED: every event is dropped, nothing is enqueued.
 */
const STRAVA_OWNER_TO_USER: Readonly<Record<string, string>> = {
  // The operator. SourceAccount `U#5488e4b8-…` / `SRC#strava`, main-branch pool (see owner-ids.ts).
  "51449053": "5488e4b8-d081-7014-748e-edd1937f8083",
}

/** The Lost Soles user an athlete id belongs to, or `undefined` for a stranger. */
export function userIdForOwner(ownerId: string): string | undefined {
  return Object.hasOwn(STRAVA_OWNER_TO_USER, ownerId) ? STRAVA_OWNER_TO_USER[ownerId] : undefined
}
