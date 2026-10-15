"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useState } from "react"

import { useExplored } from "@/components/map/explored-provider"
import { MapShell } from "@/components/map/map-shell"
import type { CachedSkill } from "@/lib/log/optimistic"
import { logStore } from "@/lib/log/queue"
import { currentUid, fetchSkills } from "@/lib/log/transport"
import type { Camera } from "@/lib/map-camera"
import { loadStanding } from "@/lib/plinth/load"
import { plinthModel } from "@/lib/plinth/model"
import { EMPTY_COLLECTION, type RunFeatureCollection } from "@/lib/runs/wire"
import { fetchReplayInProgress } from "@/lib/skills/transport"

import { Plinth, PLINTH_CSS } from "./plinth"

/**
 * `/`, IN THE BROWSER. Ticket `0086`, `06-ui-ux.md` §2.
 *
 * The plinth and the map pane, and nothing else (the mode toggle is `0098`'s, `⌖` and fit are
 * `0101`'s). The three inputs the plinth reads:
 *
 * - **Total Level** — `loadStanding`, cache first, re-asked when the explored set's generation
 *   moves (a finished sync is what moves it, §7.4). No timer.
 * - **Cells revealed** — the explored set's size, from the provider the map already reads. Cached
 *   in IndexedDB, so it is there before any network call.
 * - **The last run** — handed up by `MapShell` from the one `/api/runs/latest` fetch the first
 *   camera already uses (`0186`), so the line and the camera always name the same run.
 *
 * DOM order is §2.2's focus order: the plinth's rows, then `⚙`, then the map.
 */
export function HomeScreen({ home }: { home: Camera | null }) {
  const explored = useExplored()
  const [skills, setSkills] = useState<CachedSkill[]>()
  const [latest, setLatest] = useState<RunFeatureCollection>(EMPTY_COLLECTION)
  const onLatestRun = useCallback((runs: RunFeatureCollection) => setLatest(runs), [])

  useEffect(
    () =>
      loadStanding(
        {
          currentUid,
          store: logStore(),
          fetchSkills,
          fetchReplayInProgress,
          later: (fn, ms) => {
            const t = setTimeout(fn, ms)
            return () => clearTimeout(t)
          },
        },
        setSkills,
      ),
    [explored.generation],
  )

  const model = useMemo(
    () => plinthModel({ skills, cells: explored.set ? explored.set.size : null, latest }),
    [skills, explored.set, latest],
  )

  return (
    <>
      <style>{PLINTH_CSS}</style>
      <Plinth model={model} />
      <Link href="/settings" className="home-gear" aria-label="Settings">
        <span aria-hidden="true">⚙</span>
      </Link>
      <MapShell home={home} paneClassName="home-pane" onLatestRun={onLatestRun} />
    </>
  )
}
