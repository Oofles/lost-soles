import { NextResponse } from "next/server"

import { currentUserId } from "@/lib/auth/owner"
import { withNoStore } from "@/lib/http/no-store"
import { badRequest, notFound, opaqueId } from "@/lib/http/route-params"
import { defaultSkillReadDeps, recentLedger, skillLedger } from "@/lib/skills/server"
import { SKILL_PARAM } from "@/lib/skills/wire"

/**
 * GET /api/skills/ledger — ticket `0331`, D-472. Two reads `lib/skills/transport.ts` made through
 * AppSync before:
 *
 * - no parameter: the newest `LEDGER_ROWS` rows across every skill (`byUserAndSeq`), for `NEXT`.
 * - `?skill=<id>`: that one skill's whole ledger (`bySkill`), for its detail sheet.
 *
 * The uid is `currentUserId()` and nothing else (`08` §5.3). The only query parameter read is the
 * SKILL id; a `uid`, `userId` or anything else in the query string is never looked at.
 */

export const dynamic = "force-dynamic"

async function handleGet(request: Request): Promise<NextResponse> {
  const userId = await currentUserId()
  if (!userId) return notFound()

  const deps = defaultSkillReadDeps()
  const param = new URL(request.url).searchParams.get(SKILL_PARAM)
  if (param === null) return NextResponse.json(await recentLedger(userId, deps))
  const skillId = opaqueId(param)
  if (!skillId) return badRequest("skill must be a skill id")
  return NextResponse.json(await skillLedger(userId, skillId, deps))
}

/** C-3, `08` §2.4: every response carries `Cache-Control: private, no-store`. */
export const GET = withNoStore(handleGet)
