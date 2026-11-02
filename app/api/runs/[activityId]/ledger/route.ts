import { NextResponse } from "next/server"

import { currentUserId } from "@/lib/auth/owner"
import { withNoStore } from "@/lib/http/no-store"
import { badRequest, notFound, opaqueId } from "@/lib/http/route-params"
import { activityLedger, defaultActivityLedgerDeps } from "@/lib/runs/ledger-server"

/**
 * GET /api/runs/[activityId]/ledger — ticket `0331`, D-472. Every ledger row one activity earned,
 * for the run page's card: what `lib/runs/ledger-transport.ts` read from AppSync before.
 *
 * The uid is `currentUserId()` and nothing else (`08` §5.3). The index is keyed by the activity, so
 * `lib/runs/ledger-server.ts` filters on the session's uid: another user's activity id reads as no
 * rows, which is what AppSync's owner rule answered.
 */

export const dynamic = "force-dynamic"

async function handleGet(_request: Request, context: { params: Promise<{ activityId: string }> }): Promise<NextResponse> {
  const userId = await currentUserId()
  if (!userId) return notFound()

  const activityId = opaqueId((await context.params).activityId)
  if (!activityId) return badRequest("activityId must be an activity id")
  return NextResponse.json(await activityLedger(userId, activityId, defaultActivityLedgerDeps()))
}

/** C-3, `08` §2.4: every response carries `Cache-Control: private, no-store`. */
export const GET = withNoStore(handleGet)
