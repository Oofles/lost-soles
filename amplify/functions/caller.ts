/**
 * WHO IS CALLING `log-workout` OR `set-activity-kind`, AND WITH WHAT. Ticket `0331`, D-472.
 *
 * Two event shapes reach these handlers until `0334`:
 *
 * - **Direct invoke, from the SSR compute** (the browser's only path after `0331`):
 *   `{ userId, ...args }`. `userId` is the route's `currentUserId()`. Only the SSR compute role holds
 *   `lambda:InvokeFunction` on these functions (`amplify/backend.ts`), so IAM is the trust anchor.
 * - **AppSync** (`logWorkout`/`setActivityKind`, still compiled until `0334` changes the data
 *   auth): `{ arguments, identity: { sub } }`. Kept for the deploy window only, so a tab loaded
 *   before this deploy does not see its queued log REFUSED and dropped (`lib/log/queue.ts` drops a
 *   refusal for good). `0334` deletes this branch with the mutations.
 *
 * They are told apart by `arguments`, which AppSync always sends and the route never does (it picks
 * the SDL's argument names into a flat payload). A client cannot put a top-level `userId` into an
 * AppSync event: everything a client sends is under `arguments`. Either way, the handler checks the
 * owner list against the uid this returns.
 */
export interface Caller {
  userId: string | undefined
  args: Record<string, unknown>
}

export function callerOf(event: unknown): Caller {
  const e = (event && typeof event === "object" ? event : {}) as Record<string, unknown>
  if (e.arguments && typeof e.arguments === "object") {
    const sub = (e.identity as { sub?: unknown } | null | undefined)?.sub
    return { userId: typeof sub === "string" && sub ? sub : undefined, args: e.arguments as Record<string, unknown> }
  }
  const { userId, ...args } = e
  return { userId: typeof userId === "string" && userId ? userId : undefined, args }
}
