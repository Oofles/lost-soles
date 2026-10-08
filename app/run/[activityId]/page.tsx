import { notFound } from "next/navigation"

import { ExploredProvider } from "@/components/map/explored-provider"
import { currentUserId } from "@/lib/auth/owner"
import { homeCameraForSession } from "@/lib/map-home"
import { defaultRunReadDeps, runById } from "@/lib/runs/server"
import { PLAY_PARAM } from "@/lib/runs/wire"

import { RunMoment } from "./run-moment"

// §3 — "the most important screen in the app, and it is not really a screen".
// Auto-plays on new import, replays on demand. This is where the budget goes (P2).
//
// Ticket 0078: the route, its entry points and the persistent end state (§3.1, §3.3).
//
// SERVER-RENDERED, so a deep link in a new tab renders the run directly — there is no client
// redirect through `/`, and no flash of the home screen first.
//
// 404 for an id the session does not own, and the same 404 for one that does not exist:
// `runById` cannot tell them apart and neither can a caller.
export default async function RunMomentPage({
  params,
  searchParams,
}: {
  params: Promise<{ activityId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const [{ activityId }, query] = await Promise.all([params, searchParams])
  const uid = await currentUserId()
  if (!uid) notFound()

  const summary = await runById(uid, activityId, defaultRunReadDeps())
  if (!summary) notFound()

  // The entry point's autoplay intent (§3.1): the plinth's new-run line asks, the Chronicle does not.
  const autoplay = query[PLAY_PARAM] === "1"
  const home = await homeCameraForSession()

  return (
    <ExploredProvider uid={uid}>
      <RunMoment summary={summary} autoplay={autoplay} home={home} />
    </ExploredProvider>
  )
}
