import { notFound } from "next/navigation"

import { WorkoutRecord } from "@/components/workouts/workout-record"
import { currentUserId } from "@/lib/auth/owner"
import { exerciseLabels } from "@/lib/chronicle/rows"
import { log } from "@/lib/log"
import { rulesForSkills } from "@/lib/log/optimistic"
import { activityLedger, defaultActivityLedgerDeps } from "@/lib/runs/ledger-server"
import { defaultRunReadDeps, workoutById } from "@/lib/runs/server"
import { workoutRecord } from "@/lib/workouts/record"

// `/workouts/:id` — §2.6, D-486, ticket 0345. A past workout as a plain record: the date, what was
// logged, and the XP each skill earned. In the workout list's column, under the `(home)` layout,
// so the map beside it is the one already mounted and nothing moves it.
//
// 404 for an id the session does not own, the same 404 for one that does not exist, and the same
// again for a traced activity — that is a run, and lives at `/run/:id`. Read-only: the activity row
// and its ledger rows, nothing written (D-135).
export default async function WorkoutRecordPage({ params }: { params: Promise<{ activityId: string }> }) {
  const { activityId } = await params
  const uid = await currentUserId()
  if (!uid) notFound()

  const [item, ledger] = await Promise.all([
    workoutById(uid, activityId, defaultRunReadDeps()),
    // A failed ledger read costs the XP lines, never the record.
    activityLedger(uid, activityId, defaultActivityLedgerDeps()).catch((e: unknown) => {
      log.warn(`workout ${activityId}: ledger read failed: ${e instanceof Error ? e.message : String(e)}`)
      return null
    }),
  ])
  if (!item) notFound()

  // The ruleset this build carries names the skills and exercises; nothing is scored here.
  const rules = rulesForSkills([])
  const skillName = (id: string) => rules.skills.find((s) => s.id === id)?.name ?? id
  return <WorkoutRecord view={workoutRecord(item, ledger, exerciseLabels(rules), skillName)} />
}
