import { NextResponse } from "next/server"

import { currentUserId } from "@/lib/auth/owner"
import { withNoStore } from "@/lib/http/no-store"
import { badRequest, notFound, opaqueId } from "@/lib/http/route-params"
import { defaultSkillReadDeps, landmarks } from "@/lib/skills/server"
import { SKILL_PARAM } from "@/lib/skills/wire"

/**
 * GET /api/skills/landmarks — ticket `0331`, D-472. The user's `Landmark` rows: every one (the home
 * map's cairns, `0260`), or with `?skill=<id>` that skill's (its sheet, `0248`). A landmark is a
 * coordinate near home (`08` §7.2), so this is as private as the map.
 *
 * The uid is `currentUserId()` and nothing else (`08` §5.3). Only the SKILL id is read from the
 * query string.
 */

export const dynamic = "force-dynamic"

async function handleGet(request: Request): Promise<NextResponse> {
  const userId = await currentUserId()
  if (!userId) return notFound()

  const param = new URL(request.url).searchParams.get(SKILL_PARAM)
  const skillId = param === null ? undefined : opaqueId(param)
  if (param !== null && !skillId) return badRequest("skill must be a skill id")
  return NextResponse.json(await landmarks(userId, skillId, defaultSkillReadDeps()))
}

/** C-3, `08` §2.4: every response carries `Cache-Control: private, no-store`. */
export const GET = withNoStore(handleGet)
