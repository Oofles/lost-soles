"use client"

import Link from "next/link"
import { useCallback, useEffect, useReducer, type ReactNode } from "react"

import { MapShell } from "@/components/map/map-shell"
import type { Camera } from "@/lib/map-camera"
import { runDate, runDistance, runDuration, sourceLabel } from "@/lib/runs/format"
import { browserHistoryHost, seedHomeBehind } from "@/lib/runs/history"
import { PLAY_PARAM, type RunSummary } from "@/lib/runs/wire"

import { ActivityKind } from "./activity-kind"
import { RunLedger } from "./run-ledger"
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
  kind,
  onRelive,
}: {
  summary: RunSummary
  map: ReactNode
  ledger: ReactNode
  kind: ReactNode
  onRelive: () => void
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
      {/* §7: back is the browser's, and the arrow is there for desktop — never the only path (§1.5). */}
      <header style={{ padding: ".5rem 1rem" }}>
        <Link
          href="/"
          aria-label="Back to the map"
          style={{ color: "var(--text-primary)", textDecoration: "none", fontSize: "1.5rem", padding: ".25rem .5rem" }}
        >
          ←
        </Link>
      </header>
      <div data-slot="map">{map}</div>
      <div style={column}>
        {summary.name ? <h1 style={{ margin: 0, fontSize: "1.25rem", color: "var(--text-primary)" }}>{summary.name}</h1> : null}

        {ledger}

        {/* Beat 4's line (`0083`). A stub until the template table exists. */}
        <p data-slot="chronicle-line" style={{ margin: 0, fontStyle: "italic", textAlign: "center", color: "var(--text-secondary)" }}>
          The chronicle of this run is not yet written.
        </p>

        {/* Beat 5's line (`0083`). Quiet by construction; a stub until the frontier is computed. */}
        <p data-slot="frontier-line" style={{ margin: 0, fontSize: ".875rem", color: "var(--text-muted)" }}>
          ◇ The frontier is not yet charted.
        </p>

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

export function RunMoment({ summary, autoplay, home }: { summary: RunSummary; autoplay: boolean; home: Camera | null }) {
  const [state, dispatch] = useReducer(momentReducer, autoplay, initialMoment)

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

  const onDone = useCallback(() => dispatch({ type: "done" }), [])

  const onRelive = () => {
    window.scrollTo({ top: 0 })
    dispatch({ type: "relive" })
  }

  return (
    <main data-phase={state.phase}>
      <EndState
        summary={summary}
        map={<MapShell home={home} run={summary.route} />}
        ledger={<RunLedger summary={summary} />}
        kind={<ActivityKind activityId={summary.activityId} />}
        onRelive={onRelive}
      />
      {state.phase === "sequence" ? <RunSequence key={state.play} summary={summary} onDone={onDone} /> : null}
    </main>
  )
}
