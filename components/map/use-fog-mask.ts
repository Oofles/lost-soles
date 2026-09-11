"use client"

import { useEffect, useMemo, useRef, useState } from "react"

import { FogAnimator, browserAnimationHost, type AnimationHost } from "@/lib/fog/animation"
import { fogDisabled, maskDebugEnabled } from "@/lib/fog/debug-flags"
import { FogMaskLayer } from "@/lib/fog/mask-layer"
import { FogViewportController, type ControllerMap } from "@/lib/fog/viewport-controller"
import { ZoomBucketStore } from "@/lib/fog/zoom-buckets"
import { fogBeforeId } from "@/lib/map-layers"

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
export function useFogMask(map: import("maplibre-gl").Map | null): FogMaskLayer | null {
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

  const set = explored.set
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
  const store = useMemo(() => (set ? new ZoomBucketStore(set) : null), [set])

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
    const created = new FogMaskLayer({ debug, timeSource: () => animator.time() })
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
  }, [map, debug, disabled])

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
      onInstances: (instances, _result, res, fromData) =>
        layer.setInstances(instances, res, { supersedesRoute: fromData }),
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
  }, [map, layer, store])

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

  return layer
}
