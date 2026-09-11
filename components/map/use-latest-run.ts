"use client"

import { useEffect, useState } from "react"

import { packCorridorForCollection } from "@/lib/fog/route-corridor"
import type { FogMaskLayer } from "@/lib/fog/mask-layer"
import { log } from "@/lib/log"
import { documentRoutePalette, setRunGeometry, type LayerHost } from "@/lib/map-layers"
import { fetchLatestRun } from "@/lib/runs/client"
import { EMPTY_COLLECTION, type RunFeatureCollection } from "@/lib/runs/wire"

import { useExplored } from "./explored-provider"

/**
 * THE ROUTE ON THE MAP, AND THE OPTIMISTIC CORRIDOR UNDER IT. Ticket `0057`.
 * `05-fog-of-war.md` §4.4.
 *
 * One fetch and two consumers of its result:
 *
 *   1. `run-glow` / `run-core` — the visible line, added ABOVE the fog.
 *   2. the coverage mask — the same polyline splatted as discs, so the corridor reads as clear
 *      the instant the run appears rather than when the server's cell write comes back.
 *
 * ─── WHEN IT ASKS ───────────────────────────────────────────────────────────
 *
 * On mount, and again whenever the explored set's GENERATION changes. There is no polling and no
 * second trigger, and the generation is the right one because it is already the app's answer to
 * "something about this account's map has changed" (§7.4) — `boot.ts` bumps it on a delta, which
 * is what a finished sync produces. Adding a timer here would mean two mechanisms disagreeing
 * about when the map is stale.
 *
 * A signed-out visitor never asks: `uid` is null, and `/` is a real signed-out route.
 */
export function useLatestRun(
  map: (LayerHost & { triggerRepaint(): void }) | null,
  layer: FogMaskLayer | null,
): RunFeatureCollection {
  const { generation } = useExplored()
  const [runs, setRuns] = useState<RunFeatureCollection>(EMPTY_COLLECTION)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const collection = await fetchLatestRun()
        if (!cancelled) setRuns(collection)
      } catch (error) {
        // A missing line is a degraded map, not a broken one, so this never throws upward. It is
        // logged rather than swallowed because "the route stopped appearing" is otherwise a
        // symptom with no message anywhere — the exact shape of failure `0195`'s empty-collection
        // path was written to stay distinguishable from.
        log.error("latest run: fetch failed", error)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [generation])

  /**
   * THE VISIBLE LINE. Appended, never with a `beforeId` — `lib/map-layers.ts` explains why the
   * fog is the layer that moves and the route is the layer that stays on top.
   *
   * Runs even for the empty collection, and that is deliberate: it creates the source and both
   * layers on first load, so the ordering is settled before there is anything to draw. A source
   * added later — after the fog, from a different effect — is where the order goes wrong.
   */
  useEffect(() => {
    if (!map) return
    try {
      /**
       * Resolved from `app/tokens.css` on every data change, which is a handful of times per
       * session and never per frame. `getComputedStyle` is cheap for a custom property and
       * re-reading it means a theme switch or capability 15's parchment fork reaches the route
       * without this hook knowing either exists.
       */
      setRunGeometry(map, runs, documentRoutePalette())
      map.triggerRepaint()
    } catch (error) {
      // A palette that will not resolve costs the LINE, not the map. `routePaletteFrom` throws
      // rather than substituting a literal, and this is the caller that decision relies on.
      log.error("latest run: route palette unavailable", error)
    }
  }, [map, runs])

  /**
   * THE OPTIMISTIC CORRIDOR. `05` §4.4's *"optimisation worth taking"*.
   *
   * ─── WHY THIS EFFECT IS DECLARED AFTER `useFogMask` IS CALLED ───────────────
   *
   * `FogMaskLayer.setBucket` DISCARDS the corridor — that is criterion 5's "cleared on the next
   * bucket rebuild". Effects run in declaration order within a commit, and `MapShell` calls
   * `useFogMask` before this hook, so on any commit that carries both a new bucket and route data
   * the clear happens first and the corridor survives. Reverse the two calls and the corridor is
   * wiped on the frame it was set, intermittently, depending on what else re-rendered.
   *
   * ─── AND WHY RE-SUPPLYING IT AFTER THE CELLS LAND IS HARMLESS ───────────────
   *
   * The fetch above re-runs on a generation change, so a new collection can arrive just after the
   * cells it describes were written, and this re-draws a corridor for ground that is already
   * revealed. Under `gl.MAX` that is a no-op: the corridor is a near-subset of the cell field it
   * duplicates (`route-corridor.ts` derives why), so it can only ever write coverage that is
   * already there. Testing for "is this run newer than the bucket" would need a shared clock
   * between DynamoDB and the blob generation, to save nothing.
   */
  useEffect(() => {
    if (!layer) return
    const corridor = packCorridorForCollection(runs.features)
    layer.setOptimisticRoute(corridor.count === 0 ? null : corridor)
    if (corridor.truncated) {
      log.info(`latest run: corridor truncated at ${corridor.count} discs`)
    }
    map?.triggerRepaint()
  }, [layer, map, runs])

  return runs
}
