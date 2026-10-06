"use client"

import { useEffect, useMemo, useState } from "react"

import { rulesForSkills } from "@/lib/log/optimistic"
import { logStore } from "@/lib/log/queue"
import { currentUid, fetchSkills } from "@/lib/log/transport"
import { loadSkillsPanel, type PanelState } from "@/lib/skills/load"
import { nextLine } from "@/lib/skills/next"
import { skillsPanel } from "@/lib/skills/panel"
import { fetchReplayInProgress, fetchRecentLedger } from "@/lib/skills/transport"

import { SkillsPanel } from "./skills-panel"

/**
 * `/skills` — the container. Ticket 0073. Loading, caching and the replay gate are
 * `loadSkillsPanel`'s; this only holds the state and draws it.
 *
 * Nothing is drawn until the cache has answered: a few milliseconds of nothing, rather than a
 * frame of every skill at level 1 that then jumps into place (§9.5 — no spinner, no empty state).
 */
export function SkillsPage() {
  const [state, setState] = useState<PanelState>()

  useEffect(
    () =>
      loadSkillsPanel(
        {
          currentUid,
          store: logStore(),
          fetchSkills,
          fetchRecentLedger,
          fetchReplayInProgress,
          later: (fn, ms) => {
            const t = setTimeout(fn, ms)
            return () => clearTimeout(t)
          },
        },
        setState,
      ),
    [],
  )

  const view = useMemo(() => {
    if (!state) return undefined
    const rules = rulesForSkills(state.skills)
    const model = skillsPanel(rules, state.skills)
    return { model, next: nextLine(rules, model.activity, state.sessions) }
  }, [state])

  return view ? <SkillsPanel model={view.model} next={view.next} /> : null
}
