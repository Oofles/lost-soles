import { NextResponse } from "next/server"

import { customOutput } from "@/lib/aws-server"
import { currentUserId } from "@/lib/auth/owner"
import { defaultLambda, invokeAsUser, outcomeResponse } from "@/lib/http/invoke-as-user"
import { jsonObjectBody, pick } from "@/lib/http/json-body"
import { withNoStore } from "@/lib/http/no-store"
import { hasForeignOrigin } from "@/lib/http/origin"
import { badRequest, notFound } from "@/lib/http/route-params"

/**
 * POST /api/log — ticket `0331`, D-472. A queued `/log` entry leaves the browser here, and the SSR
 * compute invokes `log-workout` with `{ userId, ...entry }`. This replaces the AppSync `logWorkout`
 * mutation's browser path; the mutation itself stays compiled until `0334`.
 *
 * - **Origin first** (D-471). The session cookie is shared across `*.devaultsecurity.com`, so a
 *   sibling app's page could otherwise post here with it. A foreign `Origin` is a 403 and the
 *   Lambda is not invoked.
 * - **The uid is `currentUserId()`** and nothing else (`08` §5.3). The body's fields are picked by
 *   name, exactly the SDL's five arguments, and `userId` is set after them, so a `userId` in the
 *   body neither reaches the Lambda nor overrides the session's.
 * - **Measured work only.** No XP, no skill id, no level is accepted, for the reason
 *   `log-workout-mutation.test.ts` pins the SDL: one optional `xp` would make every number forgeable.
 */

export const dynamic = "force-dynamic"

/** `logWorkout`'s argument list, as the AppSync SDL declares it. */
const LOG_FIELDS = ["exerciseId", "sets", "occurredAt", "idempotencyKey", "timezone"] as const

const forbidden = () => NextResponse.json({ error: "forbidden" }, { status: 403 })

async function handlePost(request: Request): Promise<NextResponse> {
  if (hasForeignOrigin(request)) return forbidden()
  const userId = await currentUserId()
  if (!userId) return notFound()

  const parsed = await jsonObjectBody(request)
  if (!parsed.ok) return badRequest(parsed.reason)

  const outcome = await invokeAsUser(defaultLambda(), customOutput("logWorkoutFunctionName"), userId, pick(parsed.body, LOG_FIELDS))
  return outcomeResponse(outcome, "logWorkout")
}

/** C-3, `08` §2.4: every response carries `Cache-Control: private, no-store`. */
export const POST = withNoStore(handlePost)
