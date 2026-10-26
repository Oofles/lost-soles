"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react"

import { useExplored } from "@/components/map/explored-provider"
import { MapShell, type MapStage } from "@/components/map/map-shell"
import { useMapMode } from "@/components/map/use-map-mode"
import { backArrowClick, browserChronicleReturn } from "@/lib/chronicle/return"
import { REDUCED_MOTION_QUERY } from "@/lib/fog/animation"
import { revealCellsForRoute } from "@/lib/fog/reveal"
import type { Camera } from "@/lib/map-camera"
import { basemapPlaceNames } from "@/lib/place-names"
import { frontierOrigin, frontierText, pickFrontier } from "@/lib/run-moment/frontier-line"
import { browserSequenceHistory, wireSequenceExit, type ExitCause, type SequenceExit } from "@/lib/run-moment/exit"
import { runPageFadeMs, runPageMode } from "@/lib/run-moment/mode"
import { routeStill } from "@/lib/run-moment/route-still"
import { markSeen } from "@/lib/run-moment/seen"
import { runDate, runDistance, runDuration, sourceLabel } from "@/lib/runs/format"
import { browserHistoryHost, seedHomeBehind } from "@/lib/runs/history"
import { PLAY_PARAM, type RunSummary } from "@/lib/runs/wire"
import { frontier, FRONTIER_RADIUS_M, type FrontierCluster } from "@/src/domain/frontier"

import { ActivityKind } from "./activity-kind"
import { RunLedger, useRunTally } from "./run-ledger"
import { ChronicleLine, FrontierLine } from "./run-lines"
import { RunSequence } from "./run-sequence"

/**
 * `/run/:activityId` — THE POST-RUN MOMENT. Ticket `0078`. `06-ui-ux.md` §3.1, §3.3.
 *
 * *"The end state is the canonical view of a run. The sequence is a decorated way of arriving at
 * it."* So the end state is what this component always renders; the sequence (`RunSequence`) is
 * mounted on top of it while it plays and unmounted when it finishes or is skipped, and the page
 * underneath never navigates anywhere. No timeout, no auto-navigation, no toast, no title card,
 * no spinner (§3.2) — on either entry.
 *
 * WHETHER IT PLAYS is the entry point's `autoplay` intent and nothing else: not the run's age,
 * not the `seen` flag (`0084`). `⟲ Relive` is the only other way in.
 *
 * `0084`. EVERY WAY OUT is one exit (`lib/run-moment/exit.ts`), installed here for the sequence's
 * lifetime: a click (bar the two sequence controls, D-298), Esc, Back, the sequence finishing, or the
 * GL context being lost. Each lands on the end state underneath, and each marks the run `seen` on this
 * device. A lost context also swaps the map for a drawn still until the browser restores it.
 */

export type Phase = "sequence" | "end"

export interface MomentState {
  phase: Phase
  /** Bumped per play, so a Relive mounts a fresh sequence rather than resuming a finished one. */
  play: number
}

export type MomentAction = { type: "relive" } | { type: "done" }

export function initialMoment(autoplay: boolean): MomentState {
  return { phase: autoplay ? "sequence" : "end", play: autoplay ? 1 : 0 }
}

export function momentReducer(state: MomentState, action: MomentAction): MomentState {
  switch (action.type) {
    case "relive":
      return { phase: "sequence", play: state.play + 1 }
    case "done":
      return state.phase === "end" ? state : { ...state, phase: "end" }
  }
}

const column: React.CSSProperties = {
  maxWidth: "40rem",
  margin: "0 auto",
  padding: "1.5rem 1rem 3rem",
  display: "flex",
  flexDirection: "column",
  gap: "1.5rem",
}

/** A res-8 cluster (~0.7 km²) and the streets around it, framed. */
const FRONTIER_ZOOM = 14.5

const relive: React.CSSProperties = {
  alignSelf: "flex-start",
  padding: ".5rem 1rem",
  borderRadius: ".375rem",
  border: "1px solid var(--accent)",
  background: "var(--surface)",
  color: "var(--text-primary)",
  font: "inherit",
  cursor: "pointer",
}

/**
 * THE END STATE'S LAYOUT, with every part handed in, so a test renders it with the map absent —
 * criterion 8: *"the numbers never depend on the graphics"*. The ledger, both lines and the stats
 * are siblings of the map, never children of it.
 */
export function EndState({
  summary,
  map,
  ledger,
  chronicle,
  frontier,
  kind,
  onRelive,
  veiled = false,
}: {
  summary: RunSummary
  map: ReactNode
  ledger: ReactNode
  /** Beat 4's sentence (`0083`), chosen on the server. Never empty: the table guarantees a fallback. */
  chronicle: string
  /** Beat 5's line (`0083`) — a `FrontierLine`, which draws an empty slot when there is nothing to name. */
  frontier: ReactNode
  kind: ReactNode
  onRelive: () => void
  /**
   * `0080`. WHILE THE SEQUENCE PLAYS, EVERYTHING BELOW THE MAP IS HELD BACK. §3.2: beat 1 *"must
   * never be preceded by a numbers panel, a title card, a loading spinner"* — and on a desktop the
   * ledger and the run's title sit in plain view under a 55vh map. `visibility`, not unmounting or
   * `display: none`: the page keeps its height, so no scrollbar appears or vanishes at 2.9 s and the
   * map does not resize under the lantern. Later beats (`0081`–`0083`) bring their parts in.
   */
  veiled?: boolean
}) {
  const distance = runDistance(summary.distanceM)
  const stats: [string, string][] = [
    ...(distance ? ([["Distance", distance]] as [string, string][]) : []),
    ["Duration", runDuration(summary.movingS ?? summary.elapsedS)],
    ["Date", runDate(summary.startedAtLocal)],
    ["Source", sourceLabel(summary.source)],
  ]

  return (
    <>
      {/* §7: back is the browser's, and the arrow is there for desktop — never the only path (§1.5).
          Opened from the Chronicle, the arrow IS the browser's back (D-321, `0274`); otherwise `/`. */}
      <header style={{ padding: ".5rem 1rem" }}>
        <Link
          href="/"
          aria-label="Back to the map"
          onClick={(e) => backArrowClick(browserChronicleReturn(), () => window.history.back())(e)}
          style={{ color: "var(--text-primary)", textDecoration: "none", fontSize: "1.5rem", padding: ".25rem .5rem" }}
        >
          ←
        </Link>
      </header>
      <div data-slot="map">{map}</div>
      <div
        data-slot="column"
        aria-hidden={veiled || undefined}
        style={veiled ? { ...column, visibility: "hidden" } : column}
      >
        {summary.name ? <h1 style={{ margin: 0, fontFamily: "var(--font-serif)", fontWeight: 600, fontSize: "1.25rem", color: "var(--text-primary)" }}>{summary.name}</h1> : null}

        {ledger}

        <ChronicleLine text={chronicle} air={false} />

        {frontier}

        <button type="button" style={relive} onClick={onRelive}>
          ⟲ Relive
        </button>

        <dl aria-label="Route stats" style={{ display: "grid", gridTemplateColumns: "max-content 1fr", gap: ".25rem 1rem", margin: 0 }}>
          {stats.map(([k, v]) => (
            <div key={k} style={{ display: "contents" }}>
              <dt style={{ color: "var(--text-secondary)" }}>{k}</dt>
              <dd style={{ margin: 0, color: "var(--text-primary)", fontVariantNumeric: "tabular-nums" }}>{v}</dd>
            </div>
          ))}
        </dl>

        {/* `0244`'s kind correction: self-contained, and secondary on purpose (D-051). */}
        {kind}
      </div>
    </>
  )
}

/**
 * `0084`. THE STILL, over the map's box while the GL context is gone (§3.4). The route drawn with
 * the map's own route tokens on the page's ground, and one plain sentence — legibility first (D-051):
 * a blank box would read as a broken page, and the numbers below are complete either way.
 */
function RouteStill({ summary }: { summary: RunSummary }) {
  const still = routeStill(summary.route.features[0]?.geometry)
  return (
    <div
      data-testid="route-still"
      style={{ position: "absolute", inset: 0, background: "var(--bg)", display: "grid", gridTemplateRows: "1fr auto" }}
    >
      {still ? (
        <svg viewBox={still.viewBox} preserveAspectRatio="xMidYMid meet" role="img" aria-label="The run's route" style={{ width: "100%", height: "100%" }}>
          <path d={still.d} fill="none" stroke="var(--route-glow)" strokeWidth={still.stroke * 3} strokeLinecap="round" strokeLinejoin="round" strokeOpacity={0.6} />
          <path d={still.d} fill="none" stroke="var(--route-line)" strokeWidth={still.stroke} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <span />
      )}
      <p style={{ margin: 0, padding: ".5rem 1rem", color: "var(--text-secondary)", textAlign: "center" }}>
        {"The map's graphics reset. Everything below is complete."}
      </p>
    </div>
  )
}

export function RunMoment({
  summary,
  xpBefore,
  autoplay,
  home,
  chronicle,
}: {
  summary: RunSummary
  /** Each skill's XP before this run (`xpBeforeRun`, D-296); `null` if it could not be read. */
  xpBefore: Record<string, number> | null
  autoplay: boolean
  home: Camera | null
  chronicle: string
}) {
  const [state, dispatch] = useReducer(momentReducer, autoplay, initialMoment)
  /**
   * `0254`. How the last play ended — a skip hands back to the saved mode with no fade, a finish
   * with the 320 ms one (`runPageFadeMs`). Set in the same handler as `done`, so the mode change
   * and its fade reach `MapShell` in one render. `null` until a play ends, and again on Relive.
   */
  const [endCause, setEndCause] = useState<ExitCause | null>(null)
  // Read once, here, so beat 2 and the end state draw the same tally (`0081`).
  const tally = useRunTally(summary, xpBefore)

  useEffect(() => {
    // The intent is spent once read: a reload or a copied link opens the end state, never a replay.
    // Through the router-aware `replaceState`, so Next's own idea of the URL follows.
    const url = new URL(window.location.href)
    if (url.searchParams.has(PLAY_PARAM)) {
      url.searchParams.delete(PLAY_PARAM)
      window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash)
    }
    // Criterion 5: back from a deep link opened cold lands on `/`.
    seedHomeBehind(browserHistoryHost())
  }, [])

  /**
   * `0084`. ONE EXIT PER PLAY. Declared after the seed effect above, and the order is load-bearing:
   * the exit pushes its sentinel history entry, and the seed must already be underneath it.
   */
  const exit = useRef<SequenceExit | null>(null)
  const activityId = summary.activityId
  useEffect(() => {
    if (state.phase !== "sequence") return
    const x = wireSequenceExit({
      host: window,
      history: browserSequenceHistory(),
      onExit: (cause) => {
        setEndCause(cause)
        dispatch({ type: "done" })
        markSeen(activityId)
      },
    })
    exit.current = x
    return () => {
      x.teardown()
      exit.current = null
    }
  }, [state.phase, state.play, activityId])

  const phase = useRef(state.phase)
  phase.current = state.phase
  /** The sequence ended on its own — finished, or aborted. Before the exit is wired, the same thing. */
  const onDone = useCallback(() => {
    if (phase.current !== "sequence") return
    if (exit.current) return exit.current.complete()
    setEndCause("complete")
    dispatch({ type: "done" })
    markSeen(activityId)
  }, [activityId])

  /**
   * `0084`. `prefers-reduced-motion`, read as each play starts. Not a render-time value on the server:
   * nothing it changes is in the markup (the reveal set goes to the GL layer; the beats render after
   * mount), so it cannot cause a hydration mismatch.
   */
  const reduced = useMemo(
    () => state.play > 0 && typeof window !== "undefined" && window.matchMedia?.(REDUCED_MOTION_QUERY).matches === true,
    [state.play],
  )

  /**
   * `0080`. BEAT 1'S REVEAL SET: this run's new and re-armed cells as the server classified them
   * (`0251`), each placed along the route — never every cell the route touches, which would fog
   * familiar ground at `p = 0`. Handed to the map only while the sequence plays; at its end the
   * reveal is uninstalled and the steady state, identical to `p = 1`, is what remains.
   */
  const reveal = useMemo(() => {
    const cells = revealCellsForRoute(summary.route.features[0]?.geometry, summary.reveal)
    // `0084`. Reduced motion: every arc at 0, so the reveal is one cross-fade (`beat1ReducedAt`).
    return reduced ? cells.map((c) => ({ ...c, arc: 0 })) : cells
  }, [summary, reduced])
  const [stage, setStage] = useState<MapStage>(null)
  /**
   * `0098`. The map's mode on this page (`06` §3.2): adventure while the sequence plays, then the
   * saved mode — `MapShell` cross-fades the change — or atlas once the frontier line is clicked.
   */
  const savedMode = useMapMode()
  const [frontierClicked, setFrontierClicked] = useState(false)
  const mapMode = runPageMode({ sequencePlaying: state.phase === "sequence", frontierClicked, saved: savedMode })
  /** `0254`. The fade for the next mode change: none after a skip (`0084`, *"instantly, no fade"*). */
  const mapModeFadeMs = runPageFadeMs({ frontierClicked, endCause })

  /**
   * `0084`. WEBGL LOST: abort to the end state, and hold the still until a rebuilt map is ready. The
   * ledger and both lines are plain DOM and never noticed (§3.4: the numbers never depend on the
   * graphics).
   */
  const [still, setStill] = useState(false)
  useEffect(() => {
    if (stage?.kind === "lost") {
      setStill(true)
      onDone()
    } else if (stage?.kind === "ready") {
      setStill(false)
    }
  }, [stage, onDone])

  /**
   * BEAT 5'S FRONTIER (`0083`). Computed once the explored set is here AND the sequence has reached
   * beat 4 (or is not playing): the scan is ~15–30 ms of main thread, and beat 1's lantern and beat
   * 2's count are the frames that cannot spare it. Recomputed from the current explored set every
   * time — the line remembers nothing, so it has nothing to repeat.
   */
  const explored = useExplored()
  const [linesReached, setLinesReached] = useState(false)
  const onLines = useCallback(() => setLinesReached(true), [])
  const weights = tally.rules.skills.find((s) => s.unitMultipliers)?.unitMultipliers ?? null
  const origin = useMemo(
    () => frontierOrigin(summary.route.features[0]?.geometry, home && { lat: home.lat, lng: home.lng }),
    [summary, home],
  )
  const due = state.phase === "end" || linesReached
  const target = useMemo<FrontierCluster | null>(() => {
    if (!due || !origin || !weights || explored.phase !== "ready" || !explored.set) return null
    return pickFrontier(frontier({ origin, radiusM: FRONTIER_RADIUS_M, explored: explored.set, weights }))
  }, [due, origin, weights, explored])

  /**
   * The frontier's place name (`0256`, D-302), from the basemap's own tiles — the same archive the
   * map is drawing, so no request leaves our CloudFront. Keyed by the cluster, so a recomputed
   * frontier never wears the previous one's name; until the lookup lands, the line reads unnamed.
   */
  const [frontierPlace, setFrontierPlace] = useState<{ parent: string; name: string | null } | null>(null)
  useEffect(() => {
    if (!target) return
    let live = true
    basemapPlaceNames()
      .place(target.centre)
      .catch(() => null)
      .then((name) => live && setFrontierPlace({ parent: target.parent, name }))
    return () => {
      live = false
    }
  }, [target])
  const place = target && frontierPlace?.parent === target.parent ? frontierPlace.name : null

  /** §3.2 beat 5: *"Tapping it recentres the map there in atlas mode."* */
  const onFrontier = () => {
    if (!target) return
    window.scrollTo({ top: 0, behavior: "smooth" })
    // `0098`: honoured — the map cross-fades to atlas (`runPageMode`) while the camera flies.
    setFrontierClicked(true)
    if (stage?.kind === "ready") {
      stage.map.flyTo({ center: [target.centre.lng, target.centre.lat], zoom: FRONTIER_ZOOM, duration: 800 })
    }
  }
  const frontierLine = (opacity?: number) => (
    <FrontierLine text={target ? frontierText(target, place) : null} onSelect={onFrontier} opacity={opacity} />
  )

  const onRelive = () => {
    window.scrollTo({ top: 0 })
    setFrontierClicked(false)
    setEndCause(null)
    dispatch({ type: "relive" })
  }

  return (
    <main data-phase={state.phase}>
      <EndState
        summary={summary}
        map={
          <div style={{ position: "relative" }}>
            <MapShell
              home={home}
              run={summary.route}
              reveal={state.phase === "sequence" ? reveal : null}
              onStage={setStage}
              mode={mapMode}
              modeFadeMs={mapModeFadeMs}
            />
            {still ? <RouteStill summary={summary} /> : null}
          </div>
        }
        ledger={<RunLedger summary={summary} data={tally} />}
        chronicle={chronicle}
        frontier={frontierLine()}
        kind={<ActivityKind activityId={summary.activityId} />}
        onRelive={onRelive}
        veiled={state.phase === "sequence"}
      />
      {state.phase === "sequence" ? (
        <RunSequence
          key={state.play}
          summary={summary}
          stage={stage}
          tally={tally}
          chronicle={chronicle}
          frontier={frontierLine}
          frontierWords={target ? frontierText(target, place) : null}
          onLines={onLines}
          onDone={onDone}
          reduced={reduced}
        />
      ) : null}
    </main>
  )
}
