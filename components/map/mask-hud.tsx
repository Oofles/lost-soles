"use client"

import { useEffect, useState } from "react"

import { hudEnabled } from "@/lib/fog/debug-flags"
import type { FogMaskLayer } from "@/lib/fog/mask-layer"

import { useExplored } from "./explored-provider"

/**
 * WHAT `?fog=mask` IS ACTUALLY DRAWING. Ticket `0055` criterion 10, extended by `0056`.
 *
 * Since `0056` it also comes up under `?fog=noise`, over the real fog rather than over the raw
 * mask, and carries the composite's ground anchoring. Same argument as the paragraph below: a
 * screen-anchored noise field and a ground-anchored one look identical until you pan, so the one
 * number that separates them has to be readable without panning.
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

/**
 * `0056`. Two lines, and between them they answer the only two questions the composite raises that
 * looking at it cannot: is it running at all, and is its noise attached to the ground.
 *
 * `origin` is the giveaway. Pan the map and it should tick through whole numbers while the mist
 * stays put; if it is stuck at `0,0` the frame fell back to screen space (`noiseFrame`'s
 * `degenerate` path) and the fog WILL crawl.
 */
function compositeLine(stats: { composites: number; fogTime: number } | null): string {
  if (!stats) return "—"
  if (stats.composites === 0) return "not running (?fog=mask blits the raw mask instead)"
  return `${stats.composites.toLocaleString()} frames · u_time ${stats.fogTime.toFixed(1)}s${
    stats.fogTime === 0 ? " (static)" : ""
  }`
}

function noiseLine(
  stats: { noise: { origin: [number, number]; scale: number; degenerate: boolean } | null } | null,
): string {
  const n = stats?.noise
  if (!n) return "—"
  if (n.degenerate) return "SCREEN SPACE — mainMatrix was singular this frame"
  return `ground · origin ${n.origin[0]},${n.origin[1]} · ${n.scale.toExponential(2)} cells/merc`
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
    setOn(hudEnabled(window.location.search))
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
    /**
     * `0057`. The corridor and the cell field are drawn by one call and look identical, so this
     * is the only way to tell revealed ground from a guess that has not been confirmed yet —
     * the first thing worth knowing when the fog looks wrong just after a sync.
     */
    `optimistic ${(stats?.optimisticDiscs ?? 0).toLocaleString()}`,
    `res        ${stats?.res ?? "—"}`,
    `mask       ${stats?.maskSize ?? "—"}`,
    `fog        ${explored.phase} / ${explored.source}`,
    `composite  ${compositeLine(stats)}`,
    `noise      ${noiseLine(stats)}`,
  ]
  if (stats?.shaderError) lines.push(`SHADER     ${stats.shaderError.slice(0, 120)}`)
  if (stats?.compositeError) lines.push(`COMPOSITE  ${stats.compositeError.slice(0, 120)}`)

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
