"use client"

import { useEffect, useMemo, useState } from "react"

import { FogAnimator, browserAnimationHost } from "@/lib/fog/animation"
import { maskDebugEnabled } from "@/lib/fog/debug-flags"
import { blobCellsToIds, packBucket } from "@/lib/fog/instances"
import { FogMaskLayer } from "@/lib/fog/mask-layer"

import { useExplored } from "./explored-provider"

/**
 * WHERE `0054`'S EXPLORED SET MEETS `0055`'S MASK PASS. `05-fog-of-war.md` §4.2, §6.1.
 *
 * `explored-provider.tsx` said this seam was being built ahead of its first consumer. This is that
 * consumer: the decoded `BigUint64Array` becomes one packed bucket, the bucket goes to the layer,
 * and the layer draws it in `prerender`.
 *
 * ─── ONE BUCKET, RES 10, FRACTION 1.0 — AND THAT IS THE WHOLE OF IT HERE ────
 *
 * `0058` owns zoom bucketing and two-level viewport culling; nothing in this file chooses a
 * resolution for the zoom, culls against the viewport, or caches per-resolution buckets. Until it
 * lands, every stored cell is packed and every stored cell is drawn, which is correct and is not
 * fast: §6.2 is explicit that the 60 fps claim is *"not a property of the GPU; it is a property of
 * the CPU-side data pipeline"*. At the operator's real cell count that is fine, and `0059` is the
 * ticket that measures it rather than assuming.
 *
 * A stored res-10 cell is fully explored by definition (§1.1), so its `fraction` is 1.0 and no
 * aggregate is fetched here. `a_fraction` still ships in the instance layout and still multiplies
 * coverage in the shader — proved by fixture rather than by a coarse bucket that does not exist yet.
 *
 * ─── AND, SINCE `0056`, THE ANIMATION CLOCK ─────────────────────────────────
 *
 * §4.5's rAF loop. It lives here rather than in the layer because it is a browser lifecycle
 * concern — `requestAnimationFrame`, `visibilitychange`, `matchMedia` — and the layer is the part
 * that must stay drivable from a harness with none of those.
 */
export function useFogMask(map: import("maplibre-gl").Map | null): FogMaskLayer | null {
  const explored = useExplored()
  const [layer, setLayer] = useState<FogMaskLayer | null>(null)

  /**
   * Read ONCE, on mount, rather than watched. `?fog=mask` is a debug flag; re-reading it on every
   * navigation would mean the layer's rendering mode could change under a running map, which is a
   * behaviour nobody wants to reason about while looking for scalloping.
   */
  const debug = useMemo(
    () => (typeof window === "undefined" ? false : maskDebugEnabled(window.location.search)),
    [],
  )

  /**
   * PACKED ONCE PER DATA CHANGE, NEVER PER FRAME (criterion 5). The dependency is the generation
   * rather than the set object, because `ExploredSet.applyDelta` mutates in place and returns the
   * same instance — a `useMemo` keyed on the object alone would never re-run after a delta.
   *
   * Synchronous on the main thread, and at 150k cells §6.1 prices this at 30-80 ms. That is a
   * one-off on the boot path, not a frame cost, and §6.2's last bullet already records the exit if
   * it ever shows up as a visible hitch: derive it in a Web Worker. Not needed at MVP volumes.
   */
  const set = explored.set
  const generation = explored.generation
  const bucket = useMemo(
    () => (!set || set.size === 0 ? null : packBucket(blobCellsToIds(set.cells))),
    // `generation` looks unused to the linter and is the load-bearing half: `applyDelta` mutates
    // the set in place and returns the same object, so the identity of `set` does NOT change when
    // a run lands. Keyed on `set` alone, a mid-session delta would never reach the GPU.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [set, generation],
  )

  // The layer's lifetime is the map's. A context-loss rebuild constructs a new `Map`, which lands
  // here as a new identity and gets a new layer — the old one's GPU resources went with the lost
  // context and there is nothing to dispose.
  //
  // `0056`: THE ANIMATOR'S LIFETIME IS THE LAYER'S, and it is created here rather than inside the
  // layer for the reason `FogMaskLayer` creates no GL resources in `onAdd` — a custom layer's job
  // is the two render hooks. An animator owns a rAF loop and two `window` listeners, which is a
  // React effect's job. The seam between them is one function: `timeSource`.
  useEffect(() => {
    if (!map) {
      setLayer(null)
      return
    }
    const animator = new FogAnimator(browserAnimationHost(() => map.triggerRepaint()))
    const created = new FogMaskLayer({ debug, timeSource: () => animator.time() })
    map.addLayer(created)
    // Started AFTER the layer is added: the first thing it does is repaint, and a repaint before
    // there is anything to composite is a wasted frame.
    animator.start()
    setLayer(created)
    return () => {
      setLayer(null)
      animator.stop()
      try {
        if (map.getLayer(created.id)) map.removeLayer(created.id)
      } catch {
        // The map may already be torn down — `remove()` on the way out of the shell's effect, or a
        // lost context. `onRemove` has then already run or can never run; either way there is
        // nothing left to free.
      }
    }
  }, [map, debug])

  useEffect(() => {
    if (!layer || !bucket || !map) return
    layer.setBucket(bucket)
    // The upload happens in the next `prerender`, and MapLibre only renders when something asks it
    // to. Without this a run that lands mid-session would sit in the buffer until the next pan.
    map.triggerRepaint()
  }, [layer, bucket, map])

  return layer
}
