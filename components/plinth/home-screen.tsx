"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"

import { BackfillRevealSequence } from "@/components/backfill/backfill-reveal"
import { useBackfillReveal } from "@/components/backfill/use-backfill-reveal"
import { useExplored } from "@/components/map/explored-provider"
import { MapShell, type MapStage } from "@/components/map/map-shell"
import { ModeToggle } from "@/components/map/mode-toggle"
import type { LatestAnswer } from "@/components/map/use-latest-run"
import type { CachedSkill } from "@/lib/log/optimistic"
import { logStore } from "@/lib/log/queue"
import { currentUid, fetchSkills } from "@/lib/log/transport"
import type { Camera } from "@/lib/map-camera"
import type { SourceConnection } from "@/lib/plinth/connections"
import { latestSeen, mergeHolds } from "@/lib/backfill/plan"
import { loadStanding } from "@/lib/plinth/load"
import { plinthModel } from "@/lib/plinth/model"
import { answersFor, firstPulse, homeHold } from "@/lib/plinth/states"
import { isSeen } from "@/lib/run-moment/seen"
import { EMPTY_COLLECTION, type RunFeatureCollection } from "@/lib/runs/wire"
import { lifetimeCells } from "@/lib/stats/derived"
import { fetchReplayInProgress } from "@/lib/skills/transport"

import { Plinth, PLINTH_CSS } from "./plinth"

/**
 * `/`, IN THE BROWSER. Ticket `0086`, `06-ui-ux.md` §2.
 *
 * The plinth, the map pane and `0098`'s mode toggle (`⌖` and fit are `0101`'s). The three inputs the plinth reads:
 *
 * - **Total Level** — `loadStanding`, cache first, re-asked when the explored set's generation
 *   moves (a finished sync is what moves it, §7.4). No timer.
 * - **Cells revealed** — `lifetimeCells` (`0090`'s feed): the loaded explored set's own size, from
 *   the provider the map already reads. Cached in IndexedDB, so it is there before any network
 *   call, and it is never a second fetch or a stored number.
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
  /** `0273`. What `latest` speaks for. Set in the same call as it, so the two never disagree. */
  const [answer, setAnswer] = useState<LatestAnswer | null>(null)
  const onLatestRun = useCallback((runs: RunFeatureCollection, tag: LatestAnswer | null) => {
    setLatest(runs)
    setAnswer(tag)
  }, [])
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
  // `0257`: a run that came in with a historical import is seen on every device (`latestSeen`).
  const seen = latestSeen(latest, latestId === null ? true : seenOf?.id === latestId ? seenOf.seen : null)

  /** `0087`. Decided once per run, so no later render can restart the pulse (`firstPulse`). */
  const pulse = useMemo(() => (latestId && seen === false ? firstPulse(latestId) : false), [latestId, seen])

  /**
   * `0087`. The unseen run's new cells, held off the map until its sequence plays. Stable identity.
   *
   * `0273`: or PENDING, and the fog keeps its last frame, until the latest-run answer speaks for the
   * explored set on screen. A run's delta lands one request before the refetch that names it; this
   * render sees the new generation in the same commit the map does, so no frame draws the delta on
   * an old answer's hold.
   */
  const answered = answersFor(answer, explored)
  const runHold = useMemo(() => homeHold(latest, seen, answered), [latest, seen, answered])

  /**
   * `0257`. THE AGGREGATE REVEAL of a historical import, on the first map visit after it, once per
   * device. Its ground is held back with the unseen run's until it plays (`mergeHolds`), and while
   * home cannot yet say whether one is due, the fog waits (D-333).
   */
  const [stage, setStage] = useState<MapStage>(null)
  const backfill = useBackfillReveal({ latest, answer, stage, enabled: !chronicleOpen })
  const held = useMemo(() => mergeHolds(runHold, backfill.hold), [runHold, backfill.hold])

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
    () => plinthModel({ skills, cells: lifetimeCells(explored.set), latest, seen, pulse, sources, reconnectIds }),
    [skills, explored.set, latest, seen, pulse, sources, reconnectIds],
  )

  return (
    <>
      <style>{PLINTH_CSS}</style>
      {chronicleOpen ? null : <Plinth model={model} onReconnect={onReconnect} veiled={Array.isArray(backfill.hold)} />}
      {children}
      {/* `0098`. Top-left of the map pane (06 §4.2); before `⚙` in §2.2's focus order; `M` from anywhere. */}
      <ModeToggle />
      <Link href="/settings" className="home-gear" aria-label="Settings">
        <span aria-hidden="true">⚙</span>
      </Link>
      <MapShell
        home={home}
        paneClassName="home-pane"
        onLatestRun={onLatestRun}
        held={held}
        reveal={backfill.reveal}
        onStage={setStage}
      />
      {backfill.playing ? (
        <BackfillRevealSequence
          key={backfill.playing.batchId}
          mark={backfill.playing}
          stage={stage}
          cells={backfill.reveal?.length ?? 0}
          onDone={backfill.finish}
        />
      ) : null}
    </>
  )
}
