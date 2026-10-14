import { NextResponse } from "next/server"

import { currentUserId } from "@/lib/auth/owner"
import { defaultFogReadDeps } from "@/lib/fog/server"
import { traceWebRuns } from "@/lib/runs/server"

/**
 * GET /api/runs/web — ticket `0085`, D-299. `06-ui-ux.md` §3.5 rule 2.
 *
 * Every past route of the caller, as the inputs the browser builds the permanent web from. The
 * same posture as `/api/runs/latest`, for the same reasons: the uid comes from the verified
 * session and nowhere else, the key is rebuilt from it, and the body — a precise record of where
 * one person has ever run — is `no-store, private`. `GET` only; its absence is the control.
 */

export const dynamic = "force-dynamic"

const notFound = () => NextResponse.json({ error: "not found" }, { status: 404 })

export async function GET(): Promise<NextResponse> {
  const userId = await currentUserId()
  if (!userId) return notFound()

  const runs = await traceWebRuns(userId, defaultFogReadDeps())
  return NextResponse.json({ runs }, { headers: { "Cache-Control": "no-store, private" } })
}
