"use client"

import { useEffect, useState } from "react"

import { decodeStats } from "@/lib/fog/decode"
import { decodeDebugEnabled } from "@/lib/fog/debug-flags"

import { useExplored } from "./explored-provider"

/**
 * WHAT THE MAP DATA IS DOING. Ticket `0054`, criteria 8 and 10.
 *
 * Two surfaces in one component, with deliberately different visibility rules.
 *
 * ─── THE REFUSAL IS ALWAYS VISIBLE ──────────────────────────────────────────
 *
 * Criterion 8: version skew *"discards the cache, refuses to render, and shows a visible
 * message"*. `02` §6.4 explains why it cannot be a console warning: a silent mis-parse of
 * cell ids *"looks like territory teleporting, which is indistinguishable from data loss
 * to the user"*, and a blank map with nothing said is the same failure wearing a
 * different face. So the refusal renders unconditionally, over the map, and it is the one
 * piece of chrome this ticket adds to the shipping app.
 *
 * ─── THE READOUT IS BEHIND `?fog=debug` ─────────────────────────────────────
 *
 * Criterion 10 asks for a decode time *"on the target phone"*, and this ticket's three
 * operator checks are all about things a person has to SEE happen — instant territory in
 * airplane mode, a 304, a new run arriving without the map rebuilding. None of them is
 * observable yet: the fog renderer is `0055`–`0057` and nothing draws a cell today.
 *
 * This is the smallest thing that makes them observable. It is not a feature and it is
 * not the plinth (capability `13`) — a query parameter nobody types by accident, showing
 * numbers rather than an interface. `09-roadmap.md` §2.3's instruction for this milestone
 * is that chrome is deliberately absent, and a permanently visible panel would be
 * something a later capability has to delete.
 */

const notice: React.CSSProperties = {
  position: "fixed",
  top: "1rem",
  left: "1rem",
  right: "1rem",
  zIndex: 2,
  padding: "1rem",
  borderRadius: ".5rem",
  border: "1px solid var(--line)",
  background: "var(--surface-raised)",
  color: "var(--text-primary)",
  font: "500 .9rem/1.45 system-ui, sans-serif",
}

const readout: React.CSSProperties = {
  position: "fixed",
  top: "1rem",
  right: "1rem",
  zIndex: 2,
  padding: ".5rem .75rem",
  borderRadius: ".375rem",
  border: "1px solid var(--line)",
  background: "var(--surface)",
  color: "var(--text-secondary)",
  font: "400 .75rem/1.5 ui-monospace, monospace",
  whiteSpace: "pre",
}

export function FogStatus() {
  const state = useExplored()
  const [debug, setDebug] = useState(false)

  /**
   * Read in an effect rather than from the route's `searchParams`, so that turning the
   * readout on does not make `/` depend on one more dynamic input. `/` is already dynamic
   * for a stronger reason (`lib/map-home.ts`), and adding a second is how a debugging
   * affordance quietly becomes part of the render contract.
   */
  useEffect(() => {
    // `decodeDebugEnabled`, not an equality check on the parameter: `0055` added `?fog=mask` to
    // the same parameter, so `fog=mask,debug` has to show both. See `lib/fog/debug-flags.ts`.
    setDebug(decodeDebugEnabled(window.location.search))
  }, [])

  if (state.phase === "refused") {
    return (
      <div style={notice} role="alert" data-testid="fog-refused">
        {state.message}
      </div>
    )
  }

  if (!debug) return null

  const lines = [
    `phase      ${state.phase}`,
    `source     ${state.source}`,
    `generation ${state.generation ?? "—"}`,
    `cells      ${state.set ? state.set.size.toLocaleString() : "—"}`,
    // Criterion 10's number. Zero on a warm start, which is itself the answer to
    // criterion 3: nothing was parsed.
    `decode     ${decodeStats.lastBlobMs.toFixed(1)} ms (${decodeStats.blobDecodes} parsed)`,
    `deltas     ${decodeStats.deltaDecodes}`,
  ]
  if (state.message) lines.push(`note       ${state.message}`)

  return (
    <div style={readout} data-testid="fog-debug">
      {lines.join("\n")}
    </div>
  )
}
