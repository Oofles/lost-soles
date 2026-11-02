import { NextResponse } from "next/server"

import { currentUserId } from "@/lib/auth/owner"
import { withNoStore } from "@/lib/http/no-store"
import { notFound } from "@/lib/http/route-params"
import { defaultSkillReadDeps, replayInProgress } from "@/lib/skills/server"
import type { ProfileFlags } from "@/lib/skills/wire"

/**
 * GET /api/skills/profile — ticket `0331`, D-472. `Profile.replayInProgress`, `0066`'s read-side gate
 * (`02` §4.4 step 1), which `lib/skills/transport.ts` read from AppSync before. Only the flag: the
 * rest of the Profile row has no browser reader.
 *
 * The uid is `currentUserId()` and nothing else (`08` §5.3); the handler takes no `Request`.
 */

export const dynamic = "force-dynamic"

async function handleGet(): Promise<NextResponse> {
  const userId = await currentUserId()
  if (!userId) return notFound()
  const body: ProfileFlags = { replayInProgress: await replayInProgress(userId, defaultSkillReadDeps()) }
  return NextResponse.json(body)
}

/** C-3, `08` §2.4: every response carries `Cache-Control: private, no-store`. */
export const GET = withNoStore(handleGet)
