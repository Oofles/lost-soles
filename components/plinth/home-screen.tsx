"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"

import { useExplored } from "@/components/map/explored-provider"
import { MapShell } from "@/components/map/map-shell"
import type { CachedSkill } from "@/lib/log/optimistic"
import { logStore } from "@/lib/log/queue"
import { currentUid, fetchSkills } from "@/lib/log/transport"
import type { Camera } from "@/lib/map-camera"
import type { SourceConnection } from "@/lib/plinth/connections"
import { loadStanding } from "@/lib/plinth/load"
import { plinthModel } from "@/lib/plinth/model"
import { firstPulse, heldCells } from "@/lib/plinth/states"
import { isSeen } from "@/lib/run-moment/seen"
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
 * `0087` adds the states (§2.4): the unseen run (its line, its pulse, and its new ground held back on
 * the map), the connect invitation, and the one reconnect line. Every one of them is DATA into
 * `plinthModel`, never a branch that draws chrome of its own.
 *
 * DOM order is §2.2's focus order: the plinth's rows, then `⚙`, then the map.
 *
 * `0088`. Rendered by the `(home)` LAYOUT, so it is mounted under both `/` and `/chronicle`.
 * `children` is the route's own content: nothing on `/`, the Chronicle panel on `/chronicle`,
 * which takes the rail's column (§2.5, D-313) — so the plinth is not drawn while it is open.
 */
export function HomeScreen({
  home,
  sources,
  children,
}: {
  home: Camera | null
  /** `0087`. From the server; absent for a signed-out visitor. */
  sources?: SourceConnection[]
  /** `0088`. The `(home)` layout's page: null on `/`, the Chronicle on `/chronicle`. */
  children?: ReactNode
}) {
  const chronicleOpen = usePathname() === "/chronicle"
  const explored = useExplored()
  const [skills, setSkills] = useState<CachedSkill[]>()
  const [latest, setLatest] = useState<RunFeatureCollection>(EMPTY_COLLECTION)
  const onLatestRun = useCallback((runs: RunFeatureCollection) => setLatest(runs), [])
  const [reconnectIds, setReconnectIds] = useState<string[]>([])
  const onReconnect = useCallback((ids: string[]) => setReconnectIds(ids), [])

  /**
   * `0087`. THE `seen` FLAG FOR THE LATEST RUN (`0084`, local and per device). `null` while it is
   * read: the row stays empty for those few milliseconds rather than showing one line and swapping
   * to the other. Keyed by id, so a newer run arriving mid-session is asked about afresh.
   */
  const latestId = latest.features[0]?.properties.activityId ?? null
  const [seenOf, setSeenOf] = useState<{ id: string; seen: boolean } | null>(null)
  useEffect(() => {
    if (!latestId) return
    let live = true
    void isSeen(latestId).then((seen) => {
      if (live) setSeenOf({ id: latestId, seen })
    })
    return () => {
      live = false
    }
  }, [latestId])
  const seen = latestId === null ? true : seenOf?.id === latestId ? seenOf.seen : null

  /** `0087`. Decided once per run, so no later render can restart the pulse (`firstPulse`). */
  const pulse = useMemo(() => (latestId && seen === false ? firstPulse(latestId) : false), [latestId, seen])

  /** `0087`. The unseen run's new cells, held off the map until its sequence plays. Stable identity. */
  const held = useMemo(() => heldCells(latest, seen), [latest, seen])

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

  const cells = explored.set ? explored.set.size : null
  const model = useMemo(
    () => plinthModel({ skills, cells, latest, seen, pulse, sources, reconnectIds }),
    [skills, cells, latest, seen, pulse, sources, reconnectIds],
  )

  return (
    <>
      <style>{PLINTH_CSS}</style>
      {chronicleOpen ? null : <Plinth model={model} onReconnect={onReconnect} />}
      {children}
      <Link href="/settings" className="home-gear" aria-label="Settings">
        <span aria-hidden="true">⚙</span>
      </Link>
      <MapShell home={home} paneClassName="home-pane" onLatestRun={onLatestRun} held={held} />
    </>
  )
}
