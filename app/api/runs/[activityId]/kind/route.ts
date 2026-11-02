import { NextResponse } from "next/server"

import { customOutput } from "@/lib/aws-server"
import { currentUserId } from "@/lib/auth/owner"
import { defaultLambda, invokeAsUser, outcomeResponse } from "@/lib/http/invoke-as-user"
import { jsonObjectBody } from "@/lib/http/json-body"
import { withNoStore } from "@/lib/http/no-store"
import { hasForeignOrigin } from "@/lib/http/origin"
import { badRequest, notFound, opaqueId } from "@/lib/http/route-params"
import { activityKind, defaultActivityKindDeps } from "@/lib/run-kind/server"

/**
 * /api/runs/[activityId]/kind — ticket `0331`, D-472. The run page's two calls for an activity's
 * kind, which `lib/run-kind/transport.ts` made through AppSync before.
 *
 * - `GET`: the activity's `kind`, `derivedKind` and `kindOverride.kind`, or `null` when there is no
 *   such activity or it is not this user's.
 * - `POST { kind }`: the SSR compute invokes `set-activity-kind` with `{ userId, activityId, kind }`.
 *   Origin first (D-471): a foreign `Origin` is a 403 and the Lambda is not invoked. `rescoreKind`
 *   then refuses an activity that is not `userId`'s.
 *
 * The uid is `currentUserId()` and nothing else (`08` §5.3). The activity id is the path segment;
 * from the body only `kind` is read, so a `userId` (or a different `activityId`) in it goes nowhere.
 */

export const dynamic = "force-dynamic"

type Context = { params: Promise<{ activityId: string }> }

const forbidden = () => NextResponse.json({ error: "forbidden" }, { status: 403 })

async function handleGet(_request: Request, context: Context): Promise<NextResponse> {
  const userId = await currentUserId()
  if (!userId) return notFound()

  const activityId = opaqueId((await context.params).activityId)
  if (!activityId) return badRequest("activityId must be an activity id")
  return NextResponse.json({ activity: await activityKind(userId, activityId, defaultActivityKindDeps()) })
}

async function handlePost(request: Request, context: Context): Promise<NextResponse> {
  if (hasForeignOrigin(request)) return forbidden()
  const userId = await currentUserId()
  if (!userId) return notFound()

  const activityId = opaqueId((await context.params).activityId)
  if (!activityId) return badRequest("activityId must be an activity id")
  const parsed = await jsonObjectBody(request)
  if (!parsed.ok) return badRequest(parsed.reason)

  const outcome = await invokeAsUser(defaultLambda(), customOutput("setActivityKindFunctionName"), userId, {
    activityId,
    kind: parsed.body.kind,
  })
  return outcomeResponse(outcome, "setActivityKind")
}

/** C-3, `08` §2.4: every response carries `Cache-Control: private, no-store`. */
export const GET = withNoStore(handleGet)
export const POST = withNoStore(handlePost)
