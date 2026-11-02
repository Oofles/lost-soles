import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda"
import { NextResponse } from "next/server"

import { log } from "@/lib/log"

/**
 * THE SSR COMPUTE INVOKES `log-workout` AND `set-activity-kind`. Ticket `0331`, D-472.
 *
 * The browser used to call these as AppSync mutations, and AppSync put the Cognito `sub` in
 * `event.identity`. Now a route handler invokes them directly, as the SSR compute role, with
 * `{ userId, ...args }`. **`userId` is the route's `currentUserId()` and nothing else**: the payload
 * is built here, after the client's fields, so a `userId` in the request body is overwritten
 * rather than believed. IAM on `lambda:InvokeFunction` (this role only, `amplify/backend.ts`) is the
 * trust anchor, and each handler still checks the owner list.
 *
 * ─── ERRORS, IN THE SHAPE THE BROWSER ALREADY READS ─────────────────────────
 *
 * A handler that throws comes back as `FunctionError` with `{ errorMessage }`. The handlers prefix
 * what the caller can act on: `REFUSED:<CODE>:` (drop it, `lib/log/queue.ts`) and `BUSY:` (try again).
 * Those reach the browser as `{ errors: [{ message }] }`, the GraphQL error list the transports'
 * `errorFrom`/`errorText` already parse. Anything else is a crash: it is logged here, and the
 * browser hears only that it failed, which its queue treats as retryable.
 */

/** The client surface used, structural so a test passes a one-method stub. */
export interface InvokeLambda {
  send(command: InvokeCommand): Promise<{ FunctionError?: string; Payload?: Uint8Array }>
}

let cachedLambda: LambdaClient | undefined
export const defaultLambda = (): InvokeLambda => (cachedLambda ??= new LambdaClient({}))

export type InvokeOutcome = { ok: true; result: unknown } | { ok: false; message: string }

/** Invoke `functionName` synchronously with `{ ...args, userId }`, `userId` last so it wins. */
export async function invokeAsUser(
  lambda: InvokeLambda,
  functionName: string,
  userId: string,
  args: Record<string, unknown>,
): Promise<InvokeOutcome> {
  const out = await lambda.send(
    new InvokeCommand({
      FunctionName: functionName,
      InvocationType: "RequestResponse",
      Payload: new TextEncoder().encode(JSON.stringify({ ...args, userId })),
    }),
  )
  const text = out.Payload ? new TextDecoder().decode(out.Payload) : ""
  const body: unknown = text ? JSON.parse(text) : null
  if (out.FunctionError) {
    const message = (body as { errorMessage?: unknown } | null)?.errorMessage
    return { ok: false, message: typeof message === "string" ? message : out.FunctionError }
  }
  return { ok: true, result: body }
}

/** A refusal the caller can act on, as the handlers write it. */
const ACTIONABLE = /^(REFUSED:[A-Z_]+|BUSY):/

/**
 * The outcome as the route's response: `200` with the result, `422` for a refusal, `503` for busy,
 * `502` for anything else. `what` names the function in the log and the generic message.
 */
export function outcomeResponse(outcome: InvokeOutcome, what: string): NextResponse {
  if (outcome.ok) return NextResponse.json(outcome.result)
  const actionable = ACTIONABLE.exec(outcome.message)
  if (actionable) {
    const status = actionable[1] === "BUSY" ? 503 : 422
    return NextResponse.json({ errors: [{ message: outcome.message }] }, { status })
  }
  log.error({ at: `invoke:${what}`, outcome: "failed", detail: outcome.message })
  return NextResponse.json({ errors: [{ message: `${what} failed` }] }, { status: 502 })
}
