"use client"

import { useEffect, useMemo, useRef, useState } from "react"

import { FogAnimator, browserAnimationHost, type AnimationHost } from "@/lib/fog/animation"
import { fogDisabled, maskDebugEnabled } from "@/lib/fog/debug-flags"
import { FogMaskLayer } from "@/lib/fog/mask-layer"
import type { FogHarness } from "@/lib/fog/perf/harness"
import { postRunCells, preRunCells, type RevealCell } from "@/lib/fog/reveal"
import {
  FogViewportController,
  type ControllerMap,
  type RevealStores,
} from "@/lib/fog/viewport-controller"
import { ZoomBucketStore } from "@/lib/fog/zoom-buckets"
import { fogBeforeId } from "@/lib/map-layers"

import { ExploredSet } from "@/lib/fog/explored-set"

import { useExplored } from "./explored-provider"

/**
 * WHERE `0054`'S EXPLORED SET MEETS `0055`'S MASK PASS. `05-fog-of-war.md` §4.2, §6.1, §6.2.
 *
 * `explored-provider.tsx` said this seam was being built ahead of its first consumer. This is that
 * consumer: the decoded `BigUint64Array` becomes a `ZoomBucketStore`, a `FogViewportController` culls
 * whichever bucket the zoom asks for against the padded viewport, and the layer draws the survivors.
 *
 * ─── `0058` REPLACED "PACK EVERYTHING AND DRAW IT" ──────────────────────────
 *
 * Until this ticket the hook packed every stored cell into one res-10 bucket on every data change and
 * handed the lot to the GPU. That was correct and not fast, and this file's own header said so: §6.2
 * is explicit that the 60 fps claim is *"not a property of the GPU; it is a property of the CPU-side
 * data pipeline"*. At 759 cells nobody could tell. At year five it is 657,000 and D-237's res 11
 * multiplied the number by seven on the way.
 *
 * What happens now, and where each piece lives:
 *
 *   `zoom-buckets.ts`        which resolution a zoom wants; the group index; per-group geometry
 *   `cull.ts`                groups against the padded viewport, then their discs
 *   `viewport-controller.ts` when to do that, when not to, and the ~250 ms debounce
 *   `mask-layer.ts`          `maskDirty`, and the upload
 *
 * ─── THREE THINGS THIS FILE STILL OWNS, BECAUSE THEY ARE BROWSER LIFECYCLE ──
 *
 * The animation clock (§4.5's rAF loop), the `visibilitychange` signal, and the wiring between them.
 * `FogAnimator` already owns *"paused entirely when `document.hidden`"*; `0058` adds the other two
 * halves of §6.2's *"skip everything when the layer is hidden"* — the controller detaches its camera
 * handlers and the layer skips both GL passes — and all three are driven from the **same
 * `AnimationHost`**, so there is one subscription and no way for them to disagree about whether the
 * tab is visible.
 */
export function useFogMask(
  map: import("maplibre-gl").Map | null,
  /**
   * `0059`. `null` in every normal session — `MapShell` builds one only under `?fog=perf`. It is
   * threaded to the three places §6.4's items are actually measurable from: the store (item 5), the
   * controller (item 4) and the layer (item 2). Items 1, 3, 6 and 7 are sampled by the overlay's own
   * loop, which is where the frame clock lives.
   */
  harness: FogHarness | null = null,
  /**
   * `0079`. A run's reveal cells (`reveal.ts`), or `null` for no reveal. Changing it installs the
   * reveal in the controller and the layer; PROGRESS is not here — it is driven imperatively with
   * `layer.setRevealProgress`, because a value that changes sixty times a second must not be React
   * state that re-renders the map shell.
   */
  reveal: readonly RevealCell[] | null = null,
): FogMaskLayer | null {
  const explored = useExplored()
  const [layer, setLayer] = useState<FogMaskLayer | null>(null)
  /**
   * The controller is not state. Putting it in `useState` would re-render the tree every time it was
   * created, and nothing in the tree renders from it — the only things that read it are the effects
   * below, which run after it exists.
   */
  const controller = useRef<FogViewportController | null>(null)
  /**
   * The generation the controller has already drawn, so its own first cull is not repeated by the
   * data-change effect on the same commit. `latest` carries the current generation into the
   * controller's effect without making it a dependency — listing it there would tear the controller
   * down and rebuild it on every run that lands, which is the opposite of what it is for.
   */
  const drawn = useRef<number | null>(null)
  const latest = useRef<number | null>(null)

  /**
   * Read ONCE, on mount, rather than watched. `?fog=mask` is a debug flag; re-reading it on every
   * navigation would mean the layer's rendering mode could change under a running map, which is a
   * behaviour nobody wants to reason about while looking for scalloping.
   */
  const debug = useMemo(
    () => (typeof window === "undefined" ? false : maskDebugEnabled(window.location.search)),
    [],
  )

  /** `0057` criterion 7. Read once, for `debug`'s reason. `?fog=off` adds no layer at all. */
  const disabled = useMemo(
    () => (typeof window === "undefined" ? false : fogDisabled(window.location.search)),
    [],
  )

  /**
   * `0079`. An account with no explored blob yet has no set at all — and that is exactly the
   * account whose first run a reveal must still play over (the "cells not yet persisted" case,
   * literally). With a reveal requested, an EMPTY set stands in, so the store, the controller and
   * the reveal's pre/post stores all exist. Without one, `null` keeps a fogless boot fogless.
   */
  const hasReveal = !!reveal && reveal.length > 0
  const set = useMemo(
    () => explored.set ?? (hasReveal ? ExploredSet.fromCells(new BigUint64Array(0), -1) : null),
    [explored.set, hasReveal],
  )
  const generation = explored.generation
  latest.current = generation

  /**
   * ONE STORE PER SET, and it registers itself as the set's bucket invalidator.
   *
   * `explored-set.ts` declared `BucketInvalidator` for exactly this and `applyDelta` calls it with
   * the res-6 parents one hop touched. Without the registration a run landing mid-session would
   * update the `Set` and leave every cached bucket drawing the ground as it was — §7.4's *"invalidate
   * only what changed"* is the whole reason those parents are returned at all.
   *
   * The dependency is the set's identity, not the generation: `applyDelta` mutates in place and the
   * invalidator is what handles that case. A new identity means a full refetch, which needs a new
   * store because every group index it cached is indexed into the old array.
   */
  const store = useMemo(
    () =>
      set
        ? new ZoomBucketStore(
            set,
            harness
              ? {
                  onDerive: (event) => harness.perf.derive(event),
                  onRequest: (hit) => harness.perf.bucketRequest(hit),
                }
              : {},
          )
        : null,
    [set, harness],
  )

  useEffect(() => {
    if (!set || !store) return
    return set.addInvalidator(store)
  }, [set, store])

  // The layer's lifetime is the map's. A context-loss rebuild constructs a new `Map`, which lands
  // here as a new identity and gets a new layer — the old one's GPU resources went with the lost
  // context and there is nothing to dispose.
  //
  // `0056`: THE ANIMATOR'S LIFETIME IS THE LAYER'S, and it is created here rather than inside the
  // layer for the reason `FogMaskLayer` creates no GL resources in `onAdd` — a custom layer's job
  // is the two render hooks. An animator owns a rAF loop and two `window` listeners, which is a
  // React effect's job. The seam between them is one function: `timeSource`.
  useEffect(() => {
    if (!map || disabled) {
      setLayer(null)
      return
    }
    const host: AnimationHost = browserAnimationHost(() => map.triggerRepaint())
    const animator = new FogAnimator(host)
    const created = new FogMaskLayer({
      debug,
      timeSource: () => animator.time(),
      timer: harness?.timer,
    })
    /**
     * `0057` — UNDER THE ROUTE IF THE ROUTE IS ALREADY THERE, on top of everything otherwise.
     * Either way the fog lands above every symbol layer, which is what keeps unexplored place
     * names hidden (§4.4, criterion 1). `lib/map-layers.ts` owns the rule and the reasoning.
     */
    map.addLayer(created, fogBeforeId(map))
    // Started AFTER the layer is added: the first thing it does is repaint, and a repaint before
    // there is anything to composite is a wasted frame.
    animator.start()
    /**
     * §6.2's hidden switch, all three halves off one subscription. `isHidden` is `document.hidden`;
     * `subscribe` fires on `visibilitychange` and on a reduced-motion change, and the extra call on
     * the latter is a no-op because both setters early-return on an unchanged value.
     */
    const unsubscribe = host.subscribe(() => {
      const hidden = host.isHidden()
      created.setHidden(hidden)
      controller.current?.setHidden(hidden)
    })
    created.setHidden(host.isHidden())
    setLayer(created)
    return () => {
      setLayer(null)
      unsubscribe()
      animator.stop()
      try {
        if (map.getLayer(created.id)) map.removeLayer(created.id)
      } catch {
        // The map may already be torn down — `remove()` on the way out of the shell's effect, or a
        // lost context. `onRemove` has then already run or can never run; either way there is
        // nothing left to free.
      }
    }
  }, [map, debug, disabled, harness])

  /**
   * THE CULL, attached to the camera. One controller per (map, layer, store) triple.
   *
   * `onInstances` hands the layer a **view into the cull's reused scratch buffer**, and the layer
   * copies it — see `setInstances`. The alternative, allocating a right-sized array per rebuild, is a
   * steady drip of garbage during exactly the interaction §6.4 item 6 asserts has no long tasks.
   */
  useEffect(() => {
    if (!map || !layer || !store) return
    const created = new FogViewportController({
      map: map as unknown as ControllerMap,
      store,
      onInstances: (instances, _result, res, fromData, pre) =>
        layer.setInstances(instances, res, { supersedesRoute: fromData, pre }),
      observer: harness?.perf,
    })
    // The subscription that keeps this in step with `document.hidden` belongs to the layer's effect
    // above, which holds the one `AnimationHost`; this is the initial read for a tab that was already
    // in the background when the map mounted.
    created.setHidden(typeof document !== "undefined" && document.hidden)
    controller.current = created
    drawn.current = latest.current
    created.start()
    return () => {
      created.stop()
      if (controller.current === created) controller.current = null
      drawn.current = null
    }
  }, [map, layer, store, harness])

  /**
   * A DATA CHANGE, which is not a camera change and will not be noticed by one.
   *
   * Keyed on `generation` rather than on `set`: `applyDelta` mutates in place and returns the same
   * object, so the identity of `set` does NOT change when a run lands. Keyed on `set` alone, a
   * mid-session delta would never reach the GPU — which is the bug this dependency exists to prevent.
   *
   * The controller re-culls immediately rather than waiting for the next pan, because a run that has
   * just landed is the one thing the operator is watching for. Note the ORDER this depends on: the
   * effect above has already created the controller for this `layer`, because effects run in
   * declaration order within a commit.
   */
  useEffect(() => {
    if (generation === null || drawn.current === generation) return
    drawn.current = generation
    controller.current?.refresh(`generation ${generation}`)
  }, [layer, store, generation])

  /**
   * `0079`. THE REVEAL'S TWO STORES — the explored set without the run's cells and with them.
   *
   * Re-derived on a generation change as well as on a new reveal: `applyDelta` mutates the account's
   * set in place, and stores built from a copy of the old array would animate toward a map that is
   * no longer the map. `post` IS the account's store when the run's cells are already persisted
   * (`postRunCells` returns the same array), so the ordinary `/run/:id` case derives one extra store,
   * not two.
   */
  const revealStores = useMemo<RevealStores | null>(() => {
    if (!set || !store || !reveal || reveal.length === 0) return null
    const pre = new ZoomBucketStore(ExploredSet.fromCells(preRunCells(set.cells, reveal), -1))
    const postCells = postRunCells(set.cells, reveal)
    const post =
      postCells === set.cells ? store : new ZoomBucketStore(ExploredSet.fromCells(postCells, -1))
    // `generation` is read only as a dependency — it is what notices an in-place delta; see above.
    void generation
    return { pre, post }
  }, [set, store, reveal, generation])

  /**
   * CONTROLLER FIRST, THEN THE LAYER, and back out in the reverse order. `setReveal` on the
   * controller re-culls synchronously and hands the layer its pre-run stream; the layer only draws a
   * reveal once it holds one, so this order means there is never a frame with the run's cells
   * missing and nothing to bring them back.
   *
   * Progress starts at 1 — the settled map, which is what the page showed a moment ago — and
   * whoever drives the reveal moves it from there.
   */
  useEffect(() => {
    const active = controller.current
    if (!layer || !active || !revealStores || !reveal) return
    active.setReveal(revealStores)
    layer.setReveal(reveal, 1)
    map?.triggerRepaint()
    return () => {
      layer.setReveal(null)
      active.setReveal(null)
      map?.triggerRepaint()
    }
  }, [map, layer, store, revealStores, reveal])

  return layer
}
