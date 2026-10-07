"use client"

import { usePathname } from "next/navigation"
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react"

import { rulesForSkills } from "@/lib/log/optimistic"
import { logStore } from "@/lib/log/queue"
import { currentUid, fetchSkills } from "@/lib/log/transport"
import { loadSkillsPanel, type PanelState } from "@/lib/skills/load"
import { nextLine } from "@/lib/skills/next"
import { skillsPanel } from "@/lib/skills/panel"
import { fetchReplayInProgress, fetchRecentLedger } from "@/lib/skills/transport"

import { SkillsPanel } from "./skills-panel"

interface SkillsContext {
  /** The panel's standing, once the cache has answered. The sheet reads the same one (I-15). */
  state: PanelState | undefined
  /**
   * Whether `/skills` itself was on screen before the current route in this mount. A sheet opened
   * from a tile dismisses with `router.back()`; one opened by a deep link has nothing behind it in
   * the app to go back to, and replaces itself with `/skills` instead.
   */
  openedFromPanel: boolean
}

const Ctx = createContext<SkillsContext>({ state: undefined, openedFromPanel: false })
export const useSkills = () => useContext(Ctx)

/**
 * `/skills` — the container, and since 0074 the LAYOUT of `/skills/:skillId` as well. Ticket 0073.
 * Loading, caching and the replay gate are `loadSkillsPanel`'s; this only holds the state and draws
 * it.
 *
 * Living in the layout is what makes the sheet a sheet (§5.5): the panel stays mounted under it,
 * with its state, while the URL is the sheet's — so back and deep links behave (§1.5) and closing
 * the sheet re-reads nothing.
 *
 * Nothing is drawn until the cache has answered: a few milliseconds of nothing, rather than a
 * frame of every skill at level 1 that then jumps into place (§9.5 — no spinner, no empty state).
 */
export function SkillsShell({ children }: { children?: ReactNode }) {
  const [state, setState] = useState<PanelState>()
  const pathname = usePathname()
  const sawPanel = useRef(false)
  const [openedFromPanel, setOpenedFromPanel] = useState(false)

  useEffect(() => {
    if (pathname === "/skills") sawPanel.current = true
    setOpenedFromPanel(sawPanel.current && pathname !== "/skills")
  }, [pathname])

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

  return (
    <Ctx.Provider value={{ state, openedFromPanel }}>
      {view ? <SkillsPanel model={view.model} next={view.next} /> : null}
      {children}
    </Ctx.Provider>
  )
}
