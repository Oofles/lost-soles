/**
 * WHO IS CALLING `log-workout` OR `set-activity-kind`, AND WITH WHAT. Ticket `0331`, D-472;
 * the AppSync branch was removed by `0334` (D-475).
 *
 * One event shape reaches these handlers: a **direct invoke, from the SSR compute**,
 * `{ userId, ...args }`. `userId` is the route's `currentUserId()`. Only the SSR compute role holds
 * `lambda:InvokeFunction` on these functions (`amplify/backend.ts`), so IAM is the trust anchor.
 * The handler then checks the owner list against the uid this returns.
 *
 * There is no AppSync path any more: `0334` deleted the `logWorkout`/`setActivityKind` mutations
 * and with them AppSync's data source and its invoke grant. An event in AppSync's old shape
 * (`{ arguments, identity: { sub } }`) carries no top-level `userId`, so it reads as no user and
 * the handler refuses it. `identity.sub` is never believed.
 */
export interface Caller {
  userId: string | undefined
  args: Record<string, unknown>
}

export function callerOf(event: unknown): Caller {
  const e = (event && typeof event === "object" ? event : {}) as Record<string, unknown>
  const { userId, ...args } = e
  return { userId: typeof userId === "string" && userId ? userId : undefined, args }
}
