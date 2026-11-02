import { NextResponse } from "next/server"

import { currentUserId } from "@/lib/auth/owner"
import { withNoStore } from "@/lib/http/no-store"
import { notFound } from "@/lib/http/route-params"
import { defaultSkillReadDeps, skillStates } from "@/lib/skills/server"

/**
 * GET /api/skills/state — ticket `0331`, D-472. The user's `SkillState` rows, as `CachedSkill[]`:
 * what `lib/log/transport.ts`'s `fetchSkills` read from AppSync before. `/log`, `/skills`, home and
 * the run page all read their standing from this one call.
 *
 * The uid is `currentUserId()` and nothing else (`08` §5.3): this handler takes no `Request`, so no
 * query string, body or header can name a different one. GET only; anything else is 405.
 */

export const dynamic = "force-dynamic"

async function handleGet(): Promise<NextResponse> {
  const userId = await currentUserId()
  if (!userId) return notFound()
  return NextResponse.json(await skillStates(userId, defaultSkillReadDeps()))
}

/** C-3, `08` §2.4: every response carries `Cache-Control: private, no-store`. */
export const GET = withNoStore(handleGet)
