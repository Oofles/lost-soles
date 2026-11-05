import { NextResponse, type NextRequest } from "next/server"

import { currentUserId } from "@/lib/auth/owner"
import { withNoStore } from "@/lib/http/no-store"
import { chroniclePage, decodeChronicleCursor, defaultRunReadDeps } from "@/lib/runs/server"
import { CHRONICLE_AFTER_PARAM } from "@/lib/runs/wire"

/**
 * GET /api/runs/workouts?after=<cursor> — ticket `0345`. `06-ui-ux.md` §2.6, D-486.
 *
 * `/workouts`' later pages: every traceless activity, newest first. `/api/runs/chronicle`'s posture
 * exactly — the uid from the verified session and nowhere else, the middleware's 404 for a
 * signed-out caller, a cursor that names a position and never an account, `no-store, private`.
 * No backfill marking: that only keeps an imported run from being the gold row, and this list has
 * no gold row. `GET` only.
 */

export const dynamic = "force-dynamic"

const notFound = () => NextResponse.json({ error: "not found" }, { status: 404 })

async function handleGet(request: NextRequest): Promise<NextResponse> {
  const userId = await currentUserId()
  if (!userId) return notFound()

  const raw = request.nextUrl.searchParams.get(CHRONICLE_AFTER_PARAM)
  const after = raw === null ? null : decodeChronicleCursor(raw)
  if (raw !== null && after === null) {
    return NextResponse.json({ error: "bad cursor" }, { status: 400 })
  }

  const page = await chroniclePage(userId, defaultRunReadDeps(), after, "untraced")
  return NextResponse.json(page, { headers: { "Cache-Control": "no-store, private" } })
}

/** C-3, `08` §2.4: every response carries `Cache-Control: private, no-store`. */
export const GET = withNoStore(handleGet)
