"use client"

import { useEffect, useState } from "react"

import { maskDebugEnabled } from "@/lib/fog/debug-flags"
import type { FogMaskLayer } from "@/lib/fog/mask-layer"

import { useExplored } from "./explored-provider"

/**
 * WHAT `?fog=mask` IS ACTUALLY DRAWING. Ticket `0055`, criterion 10.
 *
 * ─── WHY THIS EXISTS, WRITTEN DOWN BECAUSE IT WAS LEARNED THE EXPENSIVE WAY ─
 *
 * The greyscale blit alone satisfies criterion 10's words and fails its purpose. **An empty mask
 * and a broken mask look exactly the same**: nothing on screen. The first time `?fog=mask` was
 * opened it showed nothing, and the honest answer — *there are zero explored cells in the account* —
 * took an hour of DynamoDB and S3 spelunking to establish, when the layer had been reporting
 * `visibleInstanceCount = 0` to itself the whole time.
 *
 * A debug view that cannot distinguish "no data" from "no renderer" is not a debug view. This is the
 * smallest thing that fixes it, and every line of it is a number the layer already had.
 *
 * ─── AND IT CARRIES THE ZOOM ────────────────────────────────────────────────
 *
 * The operator validation for this ticket asked for checks "at zoom 16" and "at zoom 18". Those are
 * web-map zoom levels — a MapLibre concept with no presence anywhere in this UI — so the instruction
 * was unfollowable as written: there was nothing on screen to compare against. A validation step
 * that names a quantity the operator cannot read is a step that cannot be performed, however
 * carefully it is worded.
 *
 * Roughly, for anyone reading this without a map in front of them: **z10** is a whole metro area,
 * **z14** a neighbourhood, **z16** a few streets with building footprints starting to show, and
 * **z18** one street filling the screen.
 */

const hud: React.CSSProperties = {
  position: "fixed",
  bottom: "1rem",
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

const empty: React.CSSProperties = {
  ...hud,
  color: "var(--text-primary)",
  borderColor: "var(--accent)",
}

export function MaskHud({
  map,
  layer,
}: {
  map: import("maplibre-gl").Map | null
  layer: FogMaskLayer | null
}) {
  const explored = useExplored()
  const [on, setOn] = useState(false)
  const [zoom, setZoom] = useState<number | null>(null)
  /** Bumped on every camera move, purely to re-read `layer.stats()` — which is not React state. */
  const [, setTick] = useState(0)

  useEffect(() => {
    setOn(maskDebugEnabled(window.location.search))
  }, [])

  /**
   * `move`, not `moveend`. The zoom readout exists so the operator can be at a stated zoom while
   * looking at the mask, and a number that only settles after the gesture ends is a number you have
   * to stop and wait for.
   */
  useEffect(() => {
    if (!map || !on) return
    const update = () => {
      setZoom(map.getZoom())
      setTick((n) => n + 1)
    }
    update()
    map.on("move", update)
    return () => {
      map.off("move", update)
    }
  }, [map, on])

  if (!on) return null

  const stats = layer?.stats() ?? null
  const cells = stats?.visibleInstanceCount ?? 0

  const lines = [
    `zoom       ${zoom === null ? "—" : zoom.toFixed(1)}`,
    `instances  ${cells.toLocaleString()}`,
    `res        ${stats?.res ?? "—"}`,
    `mask       ${stats?.maskSize ?? "—"}`,
    `fog        ${explored.phase} / ${explored.source}`,
  ]
  if (stats?.shaderError) lines.push(`SHADER     ${stats.shaderError.slice(0, 120)}`)

  /**
   * THE EMPTY CASE GETS A SENTENCE, NOT A ZERO. `instances 0` is the correct number and it still
   * reads as a bug to anyone who did not write this file. Saying what zero MEANS is the difference
   * between a debug view and a debug view that works.
   */
  return (
    <div style={cells === 0 ? empty : hud} data-testid="fog-mask-hud">
      {lines.join("\n")}
      {cells === 0 && (
        <>
          {"\n\n"}
          {explored.phase === "ready"
            ? "Nothing to draw: this account has no explored cells.\nThe mask is working; there is no territory yet."
            : "Nothing to draw yet: the explored set has not loaded."}
        </>
      )}
    </div>
  )
}
