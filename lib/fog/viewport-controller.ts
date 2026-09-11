import { log } from "@/lib/log"

import {
  boxContains,
  boxFromLngLat,
  boxTooLarge,
  cullBucket,
  padBox,
  VIEWPORT_PAD,
  type CullResult,
  type MercatorBox,
} from "./cull"
import { mercatorX, mercatorY } from "./instances"
import { prefetchSlice, PREFETCH_PAD } from "./prefetch"
import { resForZoom, type ZoomBucket, type ZoomBucketStore } from "./zoom-buckets"

/**
 * WHAT REBUILDS THE INSTANCE BUFFER, AND WHEN IT DOESN'T. Ticket `0058`. `05-fog-of-war.md` §6.2.
 *
 * §6.2 asks for three behaviours and every one of them is a claim about work **not** happening:
 *
 *   - pad the viewport ~20% and rebuild only when the camera leaves the padded region
 *   - separate `maskDirty` (any camera move — cheap, one draw call) from `bufferDirty`
 *   - skip everything when the layer is hidden: detach the move handlers, cancel the loop
 *
 * ─── THE TWO FLAGS, AND WHY THEY ARE NOT THE SAME FLAG ──────────────────────
 *
 * `maskDirty` lives in `mask-layer.ts` because it is a question about the camera matrix, which only
 * `prerender` can see. It is set by any camera move, and satisfying it costs one instanced draw call
 * against a buffer that is already resident.
 *
 * `bufferDirty` lives here, because it is a question about the *data* on screen: has the camera left
 * the region the buffer was built for, has the zoom crossed a bucket boundary, has a run landed. It
 * costs a cull and a `bufferData`. Conflating the two is what turns a pan into per-frame CPU work.
 *
 * A pan entirely inside the padded region therefore sets `maskDirty` and not `bufferDirty`, and
 * `viewport-controller.test.ts` asserts it as **zero uploads**.
 *
 * ─── THE DEBOUNCE, AND WHAT IT IS ACTUALLY FOR ──────────────────────────────
 *
 * §6.1: *"re-derive only when the bucket index changes, debounced ~250 ms — not on every zoom event.
 * That debounce is the single lesson worth copying wholesale from Dawarich."*
 *
 * Two mechanisms, in order. `resForZoom` collapses the hundreds of `zoom` events a pinch emits into
 * one change per band crossed — that is most of the win, and it is free. The debounce then coalesces
 * *those*: a fast pinch from z17 to z4 crosses seven bands and performs two or three switches, so the
 * work is bounded by how long the gesture lasts rather than by how far it travels.
 *
 * **WHILE A SWITCH IS PENDING, NOTHING IS RE-CULLED.** That is deliberate and it is the opposite of
 * the obvious choice. Re-culling the current bucket for a viewport that is zooming out means drawing
 * a fine bucket over a large area — seven times the instances per band, transiently, which is exactly
 * the spike §6.4's ceiling exists to prevent. Holding the last buffer instead leaves real fog on real
 * ground (the instances are mercator positions, so they stay glued to the map through the gesture);
 * ground that has just scrolled into view waits up to 250 ms to be filled, which is the same trade
 * the padded region already makes for pans.
 */

/** The slice of MapLibre's `Map` this needs. Small on purpose: the tests drive it with an object. */
export interface ControllerMap {
  getZoom(): number
  getBounds(): {
    getWest(): number
    getSouth(): number
    getEast(): number
    getNorth(): number
  }
  on(event: "move" | "zoom", handler: () => void): unknown
  off(event: "move" | "zoom", handler: () => void): unknown
  triggerRepaint(): void
}

/** Injected so a test can drive the debounce frame by frame. `animation.ts` made the same choice. */
export interface ControllerHost {
  setTimeout(handler: () => void, ms: number): number
  clearTimeout(handle: number): void
  now(): number
  /**
   * `0202`. Schedules one prefetch slice for whenever the main thread is free, and returns its own
   * canceller. **Idle, not a timer**: the whole point is that this work happens where it cannot delay
   * a frame, and a `setTimeout(0)` runs on the very next task — which during a pan is between two
   * frames of a gesture, exactly where the derivation was already hurting.
   */
  requestIdle(task: () => void): () => void
}

export const browserControllerHost: ControllerHost = {
  setTimeout: (handler, ms) => window.setTimeout(handler, ms),
  clearTimeout: (handle) => window.clearTimeout(handle),
  now: () => performance.now(),
  requestIdle: (task) => {
    /**
     * `requestIdleCallback` is absent in Safari before 17 and the fallback matters: without one the
     * prefetch silently never runs and the cull quietly goes back to deriving on the frame path,
     * which is a performance regression with no symptom anyone would attribute to this file. A
     * `setTimeout` at least gets the work off the current task.
     */
    const ric = (globalThis as { requestIdleCallback?: (cb: () => void) => number })
      .requestIdleCallback
    if (typeof ric === "function") {
      const handle = ric(task)
      return () => {
        ;(globalThis as { cancelIdleCallback?: (h: number) => void }).cancelIdleCallback?.(handle)
      }
    }
    const handle = window.setTimeout(task, 1)
    return () => window.clearTimeout(handle)
  },
}

/** §6.1's *"debounced ~250 ms"*. */
export const BUCKET_DEBOUNCE_MS = 250

/**
 * `0059`, §6.4 item 4 — *"main-thread cull time via `performance.mark`/`measure`"*, and its second
 * half, *"~0 ms for pans inside the padded region"*.
 *
 * STRUCTURAL, AND DECLARED HERE RATHER THAN IMPORTED FROM `perf/`. `FogPerf` satisfies it without
 * knowing this file exists, and this file compiles with the harness deleted. That is not tidiness:
 * `cull.ts` and this module are the hot path §6.2 exists to make cheap, and a hard import from the
 * measurement code into the measured code is how an instrument ends up shipped in the frame loop.
 *
 * **The second half is a counter, not a timer.** "~0 ms inside the padded region" is not a fast cull,
 * it is *no cull* — so what proves it is `cameraEvents` climbing while `culls` does not, which is
 * exactly what `viewport-controller.test.ts` already asserts as zero uploads. A millisecond figure
 * there would be measuring work that is supposed to be absent.
 */
export interface CullObserver {
  cullStart(): void
  cullEnd(result: CullResult): void
  cameraEvent(): void
}

export interface ControllerStats {
  /** The resolution the uploaded buffer was built at, or `null` before the first rebuild. */
  res: number | null
  /** How many culls have run. A pan inside the padded region must not move this. */
  culls: number
  /** How many times the bucket resolution actually changed. Criterion 2's spy. */
  bucketSwitches: number
  /** Camera events seen. The denominator that makes `culls` mean something. */
  cameraEvents: number
  /** Camera events that arrived while hidden. Must stay 0 — the handlers are detached. */
  eventsWhileHidden: number
  /** `0202`. Groups materialised off the frame path. The cull's `derive inside` is what this saves. */
  prefetched: number
  /** The last cull's numbers, for the HUD and for `0059`. */
  lastCull: CullResult | null
  hidden: boolean
}

/**
 * Drives the cull off the camera. Owns the padded region, the debounce and the hidden switch; owns no
 * GL and no h3.
 */
export class FogViewportController {
  #map: ControllerMap
  #store: ZoomBucketStore
  #host: ControllerHost
  #debounceMs: number
  #onInstances: (
    instances: Float32Array,
    result: CullResult,
    res: number,
    fromData: boolean,
  ) => void

  #running = false
  #hidden = false
  /** The region the current buffer was built for. `null` means "there is no buffer". */
  #built: MercatorBox | null = null
  #builtRes: number | null = null
  #buffer: Float32Array | null = null
  #pending: number | null = null
  #lastSwitchAt = -Infinity

  /** `0202`. The slice in flight, and where the walk over the prefetch region got to. */
  #cancelPrefetch: (() => void) | null = null
  #prefetchAt = 0
  #prefetchBox: MercatorBox | null = null
  #prefetchRes: number | null = null
  #prefetched = 0

  #culls = 0
  #switches = 0
  #cameraEvents = 0
  #eventsWhileHidden = 0
  #lastCull: CullResult | null = null

  #observer: CullObserver | undefined

  #onCamera = () => this.#camera()

  constructor(options: {
    map: ControllerMap
    store: ZoomBucketStore
    /**
     * Called with the survivors whenever the buffer is rebuilt. `instances` is a view into a reused
     * scratch buffer and must be uploaded (or copied) before the next cull.
     */
    onInstances: (
      instances: Float32Array,
      result: CullResult,
      res: number,
      /**
       * True when this rebuild came from new DATA rather than from the camera. `0057`'s optimistic
       * corridor is superseded by the former and must survive the latter — see
       * `FogMaskLayer.setInstances`.
       */
      fromData: boolean,
    ) => void
    host?: ControllerHost
    debounceMs?: number
    /** `0059`. Absent in every normal session; `?fog=perf` is the only thing that passes one. */
    observer?: CullObserver
  }) {
    this.#map = options.map
    this.#store = options.store
    this.#onInstances = options.onInstances
    this.#host = options.host ?? browserControllerHost
    this.#debounceMs = options.debounceMs ?? BUCKET_DEBOUNCE_MS
    this.#observer = options.observer
  }

  stats(): ControllerStats {
    return {
      res: this.#builtRes,
      culls: this.#culls,
      bucketSwitches: this.#switches,
      cameraEvents: this.#cameraEvents,
      eventsWhileHidden: this.#eventsWhileHidden,
      lastCull: this.#lastCull,
      prefetched: this.#prefetched,
      hidden: this.#hidden,
    }
  }

  /** Attach and do the first rebuild. Idempotent. */
  start(): void {
    if (this.#running) return
    this.#running = true
    if (!this.#hidden) this.#attach()
    this.#rebuild("start")
  }

  stop(): void {
    this.#running = false
    this.#detach()
    this.#cancelPending()
    this.#stopPrefetch()
  }

  /**
   * §6.2's *"skip everything when the layer is hidden"*, and it is implemented as **detaching the
   * handlers** rather than as an early return inside them.
   *
   * The difference matters: an early return still pays MapLibre's event dispatch and still keeps this
   * object reachable from the map's listener list, and the criterion is *"a test asserts zero work
   * while hidden"* — which a counter incremented inside a handler cannot prove. Detached, a camera
   * move cannot reach this class at all, and `eventsWhileHidden` staying 0 is evidence rather than a
   * restatement.
   */
  setHidden(hidden: boolean): void {
    if (this.#hidden === hidden) return
    this.#hidden = hidden
    if (hidden) {
      this.#detach()
      this.#cancelPending()
      // §6.2's *"skip everything when the layer is hidden"* includes this: a background tab
      // materialising geometry for a map nobody is looking at is the opposite of the point.
      this.#stopPrefetch()
      return
    }
    if (!this.#running) return
    this.#attach()
    // The camera has almost certainly moved while nobody was listening.
    this.#rebuild("shown")
  }

  /**
   * New data — a delta applied, or a full refetch. Rebuilds now rather than on the next camera move,
   * because a run that has just landed is the one thing the operator is watching for.
   */
  refresh(reason = "data"): void {
    if (!this.#running || this.#hidden) return
    this.#cancelPending()
    this.#rebuild(reason, true)
  }

  /* ─── The camera ─────────────────────────────────────────────────────────── */

  #camera(): void {
    if (this.#hidden) {
      this.#eventsWhileHidden++
      return
    }
    this.#cameraEvents++
    this.#observer?.cameraEvent()

    const res = resForZoom(this.#map.getZoom())
    if (res !== this.#builtRes) {
      this.#scheduleSwitch(res)
      return
    }
    // A pending switch owns the next rebuild; re-culling the old bucket for a viewport that is still
    // zooming is the instance spike the header describes.
    if (this.#pending !== null) return

    const box = this.#viewport()
    /**
     * `0207` — TWO WAYS A BUFFER STOPS SERVING THE VIEWPORT, not one. It can be left behind, which is
     * what §6.2 describes; or the viewport can shrink so far inside it that it is sized for a
     * different map, which zooming in does on every level and which containment can never notice.
     */
    if (this.#built && boxContains(this.#built, box) && !boxTooLarge(this.#built, box)) return
    this.#rebuild(this.#built && boxContains(this.#built, box) ? "zoomed in" : "padded-region exit")
  }

  /**
   * Leading edge when the last switch is old enough, trailing edge otherwise. A gesture that crosses
   * several bands inside one window collapses to a single switch, at the band it ends on.
   */
  #scheduleSwitch(res: number): void {
    if (this.#pending !== null) {
      /**
       * `0202`. THE PENDING SWITCH OWNS THE REBUILD, BUT NOT THE PREFETCH TARGET.
       *
       * A pinch that crosses several bands inside one debounce window schedules exactly one rebuild —
       * that is §6.1's whole point — and `#rebuild` resolves the resolution at FIRE time, from
       * wherever the camera ended up. So a prefetch aimed at the first band crossed warms a bucket
       * the rebuild will not use, which is worse than not prefetching: the work is spent and the
       * derivation still lands on the frame path.
       *
       * Re-aiming costs one index derivation per band actually crossed, in idle time, and only when
       * the band changes — not per zoom event. That is the same bound the debounce already accepts.
       */
      if (res !== this.#prefetchRes) this.#prefetchTarget(res)
      return
    }
    const since = this.#host.now() - this.#lastSwitchAt
    if (since >= this.#debounceMs) {
      this.#rebuild("bucket change")
      return
    }
    this.#pending = this.#host.setTimeout(() => {
      this.#pending = null
      if (!this.#running || this.#hidden) return
      this.#rebuild("bucket change (debounced)")
    }, this.#debounceMs - since)

    /**
     * `0202`. THE DEBOUNCE WINDOW IS FREE TIME, AND IT IS EXACTLY THE TIME THE NEW BUCKET NEEDS.
     *
     * A band crossing is the expensive case — a bucket with no index and no group geometry, priced at
     * 30-80 ms cold in §6.3 and measured at up to 246 ms inside a single cull. The prefetch that runs
     * after a rebuild cannot help here: the incoming bucket did not exist when the last rebuild ran.
     *
     * But §6.1 already makes the camera wait ~250 ms before switching, and that window is otherwise
     * spent doing nothing at all. Warming the target inside it means the rebuild that ends the
     * debounce finds its groups cached. If the gesture keeps going the work is discarded — bounded at
     * one wasted bucket per debounce window, which is a bound the debounce already accepts.
     */
    this.#prefetchTarget(res)
  }

  /**
   * Derive the incoming bucket's index and the groups under the current viewport, in idle time.
   *
   * `bucketFor` is itself ~5 ms at 150k cells and sits INSIDE the idle task rather than outside it:
   * this is reached from a `zoom` handler, and the point of the whole mechanism is that nothing here
   * runs on the frame path.
   */
  #prefetchTarget(res: number): void {
    const box = padBox(this.#viewport(), PREFETCH_PAD)
    this.#stopPrefetch()
    this.#prefetchAt = 0
    this.#prefetchBox = box
    this.#prefetchRes = res
    this.#cancelPrefetch = this.#host.requestIdle(() => {
      this.#cancelPrefetch = null
      if (!this.#running || this.#hidden) return
      try {
        this.#scheduleSlice(this.#store.bucketFor(res), box)
      } catch (error) {
        // A derivation that throws must not take the idle callback with it. The rebuild will do the
        // work on the frame path instead — slow, and still correct.
        log.error("fog prefetch: bucket derivation failed", error)
      }
    })
  }

  /* ─── 0202 — prefetch ────────────────────────────────────────────────────── */

  /**
   * THE WALK RESTARTS FROM 0 whenever the region or the resolution changes, and CONTINUES otherwise.
   *
   * A rebuild that only shifted the padded box a little should not re-walk the groups it already
   * materialised — `discsFor` is idempotent so it would be correct, but at 150k cells the compare
   * loop over every group is real work to repeat on every padded-region exit. The box identity is the
   * cheapest honest key: a new box means new ground, and new ground means start again.
   */
  #startPrefetch(bucket: ZoomBucket, padded: MercatorBox, res: number): void {
    const box = padBox(padded, PREFETCH_PAD - VIEWPORT_PAD)
    const sameRegion =
      this.#prefetchRes === res &&
      this.#prefetchBox !== null &&
      this.#prefetchBox.minX === box.minX &&
      this.#prefetchBox.maxX === box.maxX &&
      this.#prefetchBox.minY === box.minY &&
      this.#prefetchBox.maxY === box.maxY

    this.#stopPrefetch()
    if (!sameRegion) this.#prefetchAt = 0
    this.#prefetchBox = box
    this.#prefetchRes = res
    this.#scheduleSlice(bucket, box)
  }

  #scheduleSlice(bucket: ZoomBucket, box: MercatorBox): void {
    this.#cancelPrefetch = this.#host.requestIdle(() => {
      this.#cancelPrefetch = null
      if (!this.#running || this.#hidden) return
      let progress
      try {
        progress = prefetchSlice(bucket, box, this.#prefetchAt)
      } catch (error) {
        // A derivation that throws must not take the idle callback — and therefore the page — with
        // it. The cull will derive it on the frame path instead, which is slow and still correct.
        log.error("fog prefetch: group derivation failed", error)
        return
      }
      this.#prefetchAt = progress.next
      this.#prefetched += progress.derived
      // One slice per callback, re-scheduled until the region is warm. Chaining rather than looping
      // is what keeps each visit to the main thread short.
      if (!progress.done) this.#scheduleSlice(bucket, box)
    })
  }

  #stopPrefetch(): void {
    this.#cancelPrefetch?.()
    this.#cancelPrefetch = null
  }

  #cancelPending(): void {
    if (this.#pending === null) return
    this.#host.clearTimeout(this.#pending)
    this.#pending = null
  }

  #attach(): void {
    this.#map.on("move", this.#onCamera)
    this.#map.on("zoom", this.#onCamera)
  }

  #detach(): void {
    this.#map.off("move", this.#onCamera)
    this.#map.off("zoom", this.#onCamera)
  }

  /* ─── The rebuild ────────────────────────────────────────────────────────── */

  #viewport(): MercatorBox {
    const bounds = this.#map.getBounds()
    return boxFromLngLat(
      bounds.getWest(),
      bounds.getSouth(),
      bounds.getEast(),
      bounds.getNorth(),
      (lng, lat) => ({ x: mercatorX(lng), y: mercatorY(lat) }),
    )
  }

  #rebuild(reason: string, fromData = false): void {
    const zoom = this.#map.getZoom()
    const res = resForZoom(zoom)
    let bucket: ZoomBucket
    try {
      bucket = this.#store.bucketFor(res)
    } catch (error) {
      // A bucket derivation that throws would otherwise take the whole move handler with it, and
      // MapLibre dispatches those inside its own frame. One line, and the fog stops updating rather
      // than the map stopping.
      log.error("fog cull: bucket derivation failed", error)
      return
    }

    if (res !== this.#builtRes) {
      this.#switches++
      this.#lastSwitchAt = this.#host.now()
    }

    const padded = padBox(this.#viewport())
    this.#observer?.cullStart()
    const result = cullBucket(bucket, padded, this.#buffer)
    this.#observer?.cullEnd(result)
    this.#buffer = result.buffer
    this.#built = padded
    this.#builtRes = res
    this.#culls++
    this.#lastCull = result

    this.#onInstances(result.instances, result, res, fromData)
    this.#map.triggerRepaint()

    /**
     * `0202`. Warm the ground AROUND what was just drawn, in idle time, so the next pan into it is a
     * cache read rather than a 20 ms derivation inside a `move` handler.
     */
    this.#startPrefetch(bucket, padded, res)

    if (reason !== "padded-region exit") {
      log.info(
        `fog cull: ${reason} — res=${res} zoom=${zoom.toFixed(1)} ` +
          `instances=${result.count} groups=${result.groupsKept}/${result.groupsTested} ` +
          `${result.ms.toFixed(2)} ms`,
      )
    }
  }
}
