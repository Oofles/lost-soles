"use client"

import { useRouter } from "next/navigation"
import { useEffect, useMemo, useState } from "react"

import { rulesForSkills } from "@/lib/log/optimistic"
import { logStore } from "@/lib/log/queue"
import { currentUid } from "@/lib/log/transport"
import { atHref } from "@/lib/map-camera"
import { skillDetail, type DetailLedgerRow, type PlaceMilestone } from "@/lib/skills/detail"
import { loadSkillLedger } from "@/lib/skills/load"
import { fetchReplayInProgress, fetchSkillLedger } from "@/lib/skills/transport"

import { SkillSheet } from "./skill-sheet"
import { useSkills } from "./skills-page"

/**
 * WHERE A SKILL'S PLACE-BOUND MILESTONES COME FROM — nowhere yet. 04 §4.3's landmarks (a cairn
 * where level 50 was earned, a shrine at 99) are not recorded by anything, so every skill has none
 * and `ON THE MAP` is omitted everywhere (operator, 2026-10-07). Recording them is its own ticket;
 * when it lands, this is the one line that changes.
 */
const NO_PLACES: readonly PlaceMilestone[] = []

/** `/skills/:skillId` — loads one skill's ledger and draws the sheet over the panel. Ticket 0074. */
export function SkillSheetRoute({ skillId }: { skillId: string }) {
  const router = useRouter()
  const { state, openedFromPanel } = useSkills()
  const [ledger, setLedger] = useState<DetailLedgerRow[]>()

  useEffect(
    () => loadSkillLedger({ currentUid, store: logStore(), fetchSkillLedger, fetchReplayInProgress }, skillId, setLedger),
    [skillId],
  )

  const detail = useMemo(() => {
    if (!state || !ledger) return undefined
    return skillDetail(rulesForSkills(state.skills), skillId, state.skills, ledger, NO_PLACES, Date.now())
  }, [state, ledger, skillId])

  // A deep link has nothing in the app behind it, so back would leave the app: go to the panel.
  const dismiss = () => (openedFromPanel ? router.back() : router.replace("/skills"))

  // Nothing until the cache has answered (§9.5), as on the panel.
  if (detail === undefined) return null
  return <SkillSheet skillId={skillId} detail={detail} onDismiss={dismiss} onFly={(p) => router.push(atHref(p))} />
}
