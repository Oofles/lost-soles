import { NextResponse, type NextRequest } from "next/server"

import { currentUserId } from "@/lib/auth/owner"
import { defaultRunReadDeps, runFacts } from "@/lib/runs/server"
import { parseSummaryIds, RUNS_SUMMARY_IDS_PARAM } from "@/lib/runs/wire"
import { withNoStore } from "@/lib/http/no-store"

/**
 * GET /api/runs/summary?ids=a,b,c — ticket `0101`. `06-ui-ux.md` §4.5.
 *
 * The facts a click on a route line shows — date · distance · new cells — for the runs it hit. The
 * same posture as `/api/runs/latest`: the uid comes from the verified session and nowhere else, a
 * signed-out caller gets the same 404 the middleware gives, and the body is `no-store, private`.
 * The ids name runs, never an account: a run that is not the caller's is left out of the answer,
 * exactly as one that does not exist is (`runFacts`), so this is no oracle for which ids exist.
 * The count is capped (`RUNS_SUMMARY_MAX_IDS`) so one request cannot fan out into unbounded reads;
 * a malformed, empty or over-long list is a 400. `GET` only.
 */

export const dynamic = "force-dynamic"

const notFound = () => NextResponse.json({ error: "not found" }, { status: 404 })

async function handleGet(request: NextRequest): Promise<NextResponse> {
  const userId = await currentUserId()
  if (!userId) return notFound()

  const ids = parseSummaryIds(request.nextUrl.searchParams.get(RUNS_SUMMARY_IDS_PARAM))
  if (ids === null) return NextResponse.json({ error: "bad ids" }, { status: 400 })

  const runs = await runFacts(userId, ids, defaultRunReadDeps())
  return NextResponse.json({ runs }, { headers: { "Cache-Control": "no-store, private" } })
}

/** C-3, `08` §2.4 (ticket 0114): every response carries `Cache-Control: private, no-store`. */
export const GET = withNoStore(handleGet)
