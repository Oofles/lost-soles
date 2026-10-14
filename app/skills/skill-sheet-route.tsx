"use client"

import { useRouter } from "next/navigation"
import { useEffect, useMemo, useState } from "react"

import { rulesForSkills } from "@/lib/log/optimistic"
import { logStore } from "@/lib/log/queue"
import { currentUid } from "@/lib/log/transport"
import { atHref } from "@/lib/map-camera"
import { placeMilestones, skillDetail, type DetailLedgerRow, type PlaceMilestone } from "@/lib/skills/detail"
import { loadSkillLedger } from "@/lib/skills/load"
import { fetchLandmarks, fetchReplayInProgress, fetchSkillLedger } from "@/lib/skills/transport"

import { SkillSheet } from "./skill-sheet"
import { useSkills } from "./skills-page"

/**
 * WHERE A SKILL'S PLACE-BOUND MILESTONES COME FROM — the `Landmark` rows the pipeline writes as 50
 * and 99 are crossed (`0248`, D-301). Read beside the ledger, not through its cache: two rows at
 * most, and a failed read costs `ON THE MAP` (omitted, as for a skill with none), never the sheet.
 */
const NO_PLACES: readonly PlaceMilestone[] = []

/** `/skills/:skillId` — loads one skill's ledger and draws the sheet over the panel. Ticket 0074. */
export function SkillSheetRoute({ skillId }: { skillId: string }) {
  const router = useRouter()
  const { state, openedFromPanel } = useSkills()
  const [ledger, setLedger] = useState<DetailLedgerRow[]>()
  const [places, setPlaces] = useState<readonly PlaceMilestone[]>(NO_PLACES)

  useEffect(
    () => loadSkillLedger({ currentUid, store: logStore(), fetchSkillLedger, fetchReplayInProgress }, skillId, setLedger),
    [skillId],
  )

  useEffect(() => {
    let live = true
    setPlaces(NO_PLACES)
    currentUid()
      .then((uid) => (uid ? fetchLandmarks(uid, skillId) : []))
      .then((rows) => live && setPlaces(placeMilestones(rows)))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [skillId])

  const detail = useMemo(() => {
    if (!state || !ledger) return undefined
    return skillDetail(rulesForSkills(state.skills), skillId, state.skills, ledger, places, Date.now())
  }, [state, ledger, places, skillId])

  // A deep link has nothing in the app behind it, so back would leave the app: go to the panel.
  const dismiss = () => (openedFromPanel ? router.back() : router.replace("/skills"))

  // Nothing until the cache has answered (§9.5), as on the panel.
  if (detail === undefined) return null
  return <SkillSheet skillId={skillId} detail={detail} onDismiss={dismiss} onFly={(p) => router.push(atHref(p))} />
}
