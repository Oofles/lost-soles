import { NextResponse, type NextRequest } from "next/server"

import { currentUserId } from "@/lib/auth/owner"
import { chroniclePage, decodeChronicleCursor, defaultRunReadDeps } from "@/lib/runs/server"
import { CHRONICLE_AFTER_PARAM } from "@/lib/runs/wire"
import { chronicleWithBackfill } from "@/lib/backfill/batch"
import { backfillBatchOrNull } from "@/lib/backfill/store"

/**
 * GET /api/runs/chronicle?after=<cursor> — ticket `0088`. `06-ui-ux.md` §2.5.
 *
 * The Chronicle's later pages; the first is rendered on the server with `/chronicle` itself. The
 * same posture as `/api/runs/latest`: the uid comes from the verified session and nowhere else, a
 * signed-out caller gets the same 404 the middleware gives, and the body — when and how far one
 * person ran, for years — is `no-store, private`. The cursor names a position, never an account
 * (`decodeChronicleCursor`). `GET` only.
 */

export const dynamic = "force-dynamic"

const notFound = () => NextResponse.json({ error: "not found" }, { status: 404 })

export async function GET(request: NextRequest): Promise<NextResponse> {
  const userId = await currentUserId()
  if (!userId) return notFound()

  const raw = request.nextUrl.searchParams.get(CHRONICLE_AFTER_PARAM)
  const after = raw === null ? null : decodeChronicleCursor(raw)
  if (raw !== null && after === null) {
    return NextResponse.json({ error: "bad cursor" }, { status: 400 })
  }

  // `0257`: a historical import's rows are marked, so none of them is ever the gold row.
  const deps = defaultRunReadDeps()
  const [unmarked, batch] = await Promise.all([chroniclePage(userId, deps, after), backfillBatchOrNull(userId, deps)])
  const page = chronicleWithBackfill(unmarked, batch)
  return NextResponse.json(page, { headers: { "Cache-Control": "no-store, private" } })
}
