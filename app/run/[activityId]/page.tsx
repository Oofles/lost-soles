import { notFound } from "next/navigation"

import { ExploredProvider } from "@/components/map/explored-provider"
import { currentUserId } from "@/lib/auth/owner"
import { homeCameraForSession } from "@/lib/map-home"
import { log } from "@/lib/log"
import { chronicleFor, historyUpTo } from "@/lib/runs/chronicle-server"
import { defaultRunReadDeps, runById } from "@/lib/runs/server"
import { ledgerTableName, xpBeforeRun } from "@/lib/runs/tally-server"
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

  const deps = defaultRunReadDeps()
  const summary = await runById(uid, activityId, deps)
  if (!summary) notFound()

  // Beat 2's "before" (`0081`, D-296), as of this run. A failed read costs the bars and the totals,
  // never the page: the tally still shows what the run earned. Inside the promise, so a build with
  // no table name in its outputs degrades the same way.
  const before = Promise.resolve()
    .then(() => xpBeforeRun(uid, summary, { ddb: deps.ddb, ledgerTable: ledgerTableName() }))
    .catch((e: unknown) => {
      log.warn(`run ${activityId}: xp-before read failed: ${e instanceof Error ? e.message : String(e)}`)
      return null
    })

  // Beat 4's facts (`0083`): every earlier activity's distance and new cells. A failed read costs the
  // lifetime lines, never the line — the run's own facts still choose one.
  const history = historyUpTo(uid, summary.startedAt, deps).catch((e: unknown) => {
    log.warn(`run ${activityId}: history read failed: ${e instanceof Error ? e.message : String(e)}`)
    return null
  })

  // The entry point's autoplay intent (§3.1): the plinth's new-run line asks, the Chronicle does not.
  const autoplay = query[PLAY_PARAM] === "1"
  const [xpBefore, home, prior] = await Promise.all([before, homeCameraForSession(), history])
  const chronicle = chronicleFor(summary, prior).text

  return (
    <ExploredProvider uid={uid}>
      <RunMoment summary={summary} xpBefore={xpBefore} autoplay={autoplay} home={home} chronicle={chronicle} />
    </ExploredProvider>
  )
}
