"use client"

import { useEffect, useRef, useState } from "react"

import { packCorridorForCollection } from "@/lib/fog/route-corridor"
import type { FogMaskLayer } from "@/lib/fog/mask-layer"
import { log } from "@/lib/log"
import { logStore } from "@/lib/log/queue"
import { currentUid } from "@/lib/log/transport"
import { loadLatestRun } from "@/lib/plinth/latest-run"
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
/**
 * `0273`. WHICH EXPLORED GENERATION THE LATEST-RUN ANSWER ON SCREEN SPEAKS FOR, and whether it came
 * from the network. Home holds an unseen run's new cells back (D-319), and that hold is only as good
 * as the answer it was read from: an answer for an older generation knows nothing of the run whose
 * delta has just landed. `HomeScreen` compares this with the explored set's own generation and
 * source (`answersFor` in `lib/plinth/states.ts`) and freezes the fog until they agree.
 *
 * `null` until the first answer. A failed request still answers — with the runs already on screen —
 * so an offline open is never frozen waiting on a network that is not there.
 */
export interface LatestAnswer {
  generation: number | null
  network: boolean
}

export function useLatestRun(
  map: (LayerHost & { triggerRepaint(): void }) | null,
  layer: FogMaskLayer | null,
  /**
   * `0078`. A run the page already holds — `/run/:id` reads its own run on the server, ownership
   * checked. When given, there is no fetch: the line drawn is that run, not the latest one.
   */
  fixed?: RunFeatureCollection,
  /**
   * `0087`. `false` while home holds an UNSEEN run back (`06` §2.4): the corridor would clear the
   * run's ground on `/` ahead of its sequence, which is exactly what the hold forbids. The line
   * itself is still drawn — it is a route, not territory.
   */
  corridor = true,
): { runs: RunFeatureCollection; answer: LatestAnswer | null } {
  const { generation, source } = useExplored()
  const [latest, setRuns] = useState<RunFeatureCollection>(EMPTY_COLLECTION)
  const [answer, setAnswer] = useState<LatestAnswer | null>(null)
  /**
   * `0273`. Whether the explored set on screen is still the CACHED one. Read by the fetch effect but
   * not a trigger of it — the generation stays the only trigger — so it is a ref, synced in an
   * effect declared before the one that reads it (effects run in declaration order).
   */
  const exploredFromCache = useRef(false)
  useEffect(() => {
    exploredFromCache.current = source === "cache"
  }, [source])
  const runs = fixed ?? latest
  const fetchLatest = fixed === undefined
  /** `0087`. The cache is read on the FIRST ask only; a refetch already has something newer on screen. */
  const askedOnce = useRef(false)

  useEffect(() => {
    if (!fetchLatest) return
    /**
     * `0273`: also while the explored set is still the cached one. Its generation usually lands
     * after this hook's first ask (both are IndexedDB reads), and the cached run is what vouches for
     * the cached set — without the re-read, every cold start would hold the fog for the network.
     * Never stale: `loadLatestRun` writes the cache before it emits, so it is never behind the screen.
     */
    const fromCache = !askedOnce.current || exploredFromCache.current
    askedOnce.current = true
    /**
     * `0087`: CACHE FIRST, then `fetchLatestRun` (`lib/plinth/latest-run.ts`), so a cold start or
     * an offline open has the line, the first camera and `⌖` before any request — and they still
     * read one value (D-316).
     */
    return loadLatestRun(
      {
        currentUid,
        store: logStore(),
        fetchLatest: () => fetchLatestRun(),
        // A missing line is a degraded map, not a broken one, so this never throws upward. It is
        // logged rather than swallowed because "the route stopped appearing" is otherwise a
        // symptom with no message anywhere — the exact shape of failure `0195`'s empty-collection
        // path was written to stay distinguishable from. Offline lands here too: the console, never
        // the screen (`06` §2.4, "no error chrome").
        onError: (error) => {
          log.error("latest run: fetch failed", error)
          setAnswer({ generation, network: true })
        },
      },
      (runs, from) => {
        setRuns(runs)
        setAnswer({ generation, network: from === "network" })
      },
      fromCache,
    )
  }, [generation, fetchLatest])

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
    if (!corridor) {
      layer.setOptimisticRoute(null)
      map?.triggerRepaint()
      return
    }
    const packed = packCorridorForCollection(runs.features)
    layer.setOptimisticRoute(packed.count === 0 ? null : packed)
    if (packed.truncated) {
      log.info(`latest run: corridor truncated at ${packed.count} discs`)
    }
    map?.triggerRepaint()
  }, [layer, map, runs, corridor])

  return { runs, answer }
}
