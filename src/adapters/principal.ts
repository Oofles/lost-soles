/**
 * THE AUTHENTICATED-CALLER HEADER. Ticket 0069.
 *
 * `InboundRequest` carries no principal, because a webhook source authenticates by
 * signature and its user is resolved from its own payload. A source whose caller IS the
 * signed-in user — today only in-app logging — needs the verified Cognito `sub` handed to
 * `accept()`, and this header is how. It is set by trusted server code from the
 * authenticated identity, and never copied from a client's arguments.
 *
 * Its own module because `types.ts` emits no runtime code and an adapter's own directory
 * may not be imported by the code that builds the request (`registry.test.ts`).
 */
export const AUTHENTICATED_SUB_HEADER = "x-authenticated-sub"
