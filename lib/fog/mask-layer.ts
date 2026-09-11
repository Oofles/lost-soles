import type {
  CustomLayerInterface,
  CustomRenderMethodInput,
  Map as MapLibreMap,
} from "maplibre-gl"

import { log } from "@/lib/log"

import {
  createCompositeResources,
  disposeCompositeResources,
  noiseFrame,
  runCompositePass,
  type CompositeResources,
  type CompositeRestore,
  type NoiseFrame,
} from "./composite"
import { V1, type FogPalette } from "./fog-uniforms"
import {
  createMaskResources,
  disposeMaskResources,
  resizeMask,
  runDebugBlit,
  runMaskPass,
  uploadInstances,
  type MaskResources,
  type ProjectionLike,
  type RestoreCheck,
} from "./mask"
import type { PackedBucket } from "./instances"
import { EMPTY_CORRIDOR, type CorridorPack } from "./route-corridor"

/**
 * THE CUSTOM LAYER. Tickets `0055` and `0056`. `05-fog-of-war.md` §4.2, §4.3, §6.4.
 *
 * A MapLibre `CustomLayerInterface` with both passes: `prerender` runs §4.2's coverage mask into a
 * half-resolution `R8` framebuffer, and `render` runs §4.3's noisy composite over MapLibre's own.
 * `0055` shipped the first with an empty `render`; `0056` filled it in.
 *
 * `?fog=mask` still swaps the composite for `0055`'s greyscale blit of the raw mask. It is not
 * redundant now that there is something to look at: the composite is a threshold plus noise plus a
 * rim, and when the fog is wrong the first question is always whether the COVERAGE is wrong, which
 * the finished picture cannot answer.
 *
 * ─── RESOURCES ARE BUILT ON FIRST `prerender`, NOT IN `onAdd` ───────────────
 *
 * Forced rather than chosen, and `0118` paid to find out (finding 2): the vertex shader needs
 * `shaderData.vertexShaderPrelude`, which exists only on the render-method input. `onAdd` receives
 * the map and the GL context and nothing else.
 *
 * The prelude also CHANGES WITH THE PROJECTION, and `shaderData.variantName` is MapLibre's own cache
 * key for exactly that. A changed variant rebuilds the program rather than silently rendering with a
 * shader compiled for the other projection — which would not throw, it would just put the fog in the
 * wrong place.
 */

/** What the layer reports upward, for the plinth, the perf harness (`0059`) and tests. */
export interface MaskStats {
  /** §6.4 item 1. *Assertion: <= 6,000 at every zoom, at every dataset size.* */
  visibleInstanceCount: number
  /** The bucket's H3 resolution — 10 until `0058` derives coarser ones. */
  res: number
  /** `maskW x maskH`, i.e. half the drawing buffer. */
  maskSize: string
  /** How many times `prerender` has run the pass. Frames, not rebuilds. */
  passes: number
  /** The last read-back of what the pass restored. `null` until the first pass. */
  restore: RestoreCheck | null
  /** A compile or link failure, verbatim. Its presence means the layer is drawing nothing. */
  shaderError: string | null
  /** `0056`. How many times `render` has run the composite. */
  composites: number
  /** `0056`. What the composite pass restored, read from the driver. `null` before the first one. */
  compositeRestore: CompositeRestore | null
  /**
   * `0056`. The last frame's ground anchoring (D-233). `degenerate` here means `mainMatrix` was
   * singular and that frame fell back to screen-space noise — the one condition under which the
   * fog can crawl under a pan, and therefore the one worth being able to read.
   */
  noise: NoiseFrame | null
  /** `0056`. `u_time` as of the last composite, in seconds. 0 whenever the fog is static. */
  fogTime: number
  /** `0056`. A composite compile or link failure. Its presence means there is no fog on screen. */
  compositeError: string | null
  /**
   * `0057`. How many of `visibleInstanceCount` are optimistic corridor discs rather than cells.
   *
   * The two are drawn by one call and are indistinguishable on screen by design, so this is the
   * only way to answer "is that corridor real ground or a guess" — which is the first question
   * worth asking when the fog looks wrong right after a sync.
   */
  optimisticDiscs: number
}

/**
 * Criterion 10's flag lives in `debug-flags.ts` now, with `0054`'s. Re-exported here because this
 * is where callers look for it, and moved there because the two flags shared one query parameter
 * and silently cancelled each other — see that file's header.
 *
 * A QUERY PARAMETER RATHER THAN A BUILD FLAG OR A SETTING, for one reason: the operator check for
 * this ticket is *"open the map with the debug flag on and look for scalloping"*, and a flag that
 * needs a rebuild or a trip through settings turns a ten-second look into a task. It is also
 * self-clearing — the next normal navigation drops it — so a debug view cannot become the app's
 * quiet default the way a persisted toggle can.
 */
export { maskDebugEnabled } from "./debug-flags"

export class FogMaskLayer implements CustomLayerInterface {
  readonly id = "fog-mask"
  readonly type = "custom" as const
  /** 2d: the mask is screen-space and takes no part in MapLibre's depth buffer. */
  readonly renderingMode = "2d" as const

  #resources: MaskResources | null = null
  #variant: string | null = null
  /**
   * THE DESIRED CONTENTS OF THE INSTANCE BUFFER, plus a flag saying it is not there yet.
   *
   * `0055` held a `#pending` bucket that `prerender` consumed and a `#lastBucket` it re-queued
   * whenever the buffer was destroyed. `0057` adds a SECOND source of instances — the optimistic
   * corridor — and two consume-once queues that must be re-queued together on a variant change is
   * a state machine with four ways to be half-uploaded. Holding the desired state and a dirty bit
   * instead makes "re-upload everything" one assignment, which is what a rebuild actually wants.
   *
   * The bucket is kept rather than dropped after upload for `0055`'s reason: a style change
   * removes and re-adds custom layers, and without it the layer comes back holding a bucket it
   * believes is uploaded and draws nothing. 150k `cellToLatLng` calls are not re-derivable cheaply.
   */
  #bucket: PackedBucket | null = null
  /** `0057`. Discarded by `setBucket` — see there. Never a cell, never in the explored set. */
  #corridor: CorridorPack = EMPTY_CORRIDOR
  #uploadDirty = false
  #res = 10
  #passes = 0
  #restore: RestoreCheck | null = null
  #shaderError: string | null = null
  /* ─── 0056, pass 2 ────────────────────────────────────────────────────────── */
  #composite: CompositeResources | null = null
  #compositeError: string | null = null
  #compositeRestore: CompositeRestore | null = null
  #composites = 0
  #noise: NoiseFrame | null = null
  #fogTime = 0

  constructor(
    private readonly options: {
      /** `0055` criterion 10. When set, `render` blits the raw mask instead of compositing. */
      debug?: boolean
      /** Called once per instance-buffer rebuild with the new count. Defaults to `log.info`. */
      onRebuild?: (stats: MaskStats) => void
      /**
       * `0056`. Seconds of animation for `u_time`, read once per composite. Defaults to a frozen
       * 0, which is the correct static fog — a layer with no animator is not a broken animator.
       */
      timeSource?: () => number
      /** `0056`. The six per-mode uniforms. Defaults to `V1`; capability 15 is what passes another. */
      palette?: FogPalette
      /** `0056`. Lever (c): fBm octaves. Defaults to `FBM_OCTAVES`. */
      octaves?: number
    } = {},
  ) {}

  /* ─── The data seam ───────────────────────────────────────────────────────── */

  /**
   * Hand the layer a packed bucket. **Once per bucket, not per frame** (criterion 5).
   *
   * The upload is DEFERRED to the next `prerender` rather than done here, because this is called
   * from a React effect and the only moment a custom layer is entitled to touch the GL context is
   * inside one of its own hooks. Calling `bufferData` from an effect happens to work today and is
   * exactly the kind of thing that stops working when MapLibre changes when it binds what.
   */
  setBucket(bucket: PackedBucket): void {
    this.#bucket = bucket
    /**
     * THE OPTIMISTIC CORRIDOR IS DISCARDED HERE, and that is criterion 5's *"cleared on the next
     * bucket rebuild"* stated as the one line that implements it.
     *
     * A new bucket means the server's cell write has come back, so the guess has been replaced by
     * the record. Keeping it would leave a permanent extra corridor around the newest run that no
     * data supports, drifting further from the truth with every run — the client inventing ground,
     * one sync at a time.
     *
     * `use-latest-run.ts` re-supplies it after a data change if the route is still ahead of the
     * cells. That is a decision for the caller, which can see both; this class only knows that a
     * fresh bucket supersedes whatever was guessed against the old one.
     */
    this.#corridor = EMPTY_CORRIDOR
    this.#uploadDirty = true
  }

  /**
   * `0057` — §4.4's *"optimisation worth taking"*. The latest run's polyline, splatted as discs
   * into the MASK and nowhere else.
   *
   * **This never reaches the explored set.** `route-corridor.ts` produces no H3 id and this class
   * holds the result as four floats per disc in the same vertex buffer D-232's bridges use.
   * `route-corridor.test.ts` runs the whole path over a real `ExploredSet` and asserts both the
   * `Set` and its `BigUint64Array` come out unchanged (criterion 6).
   *
   * Deferred to the next `prerender` for `setBucket`'s reason: a custom layer may only touch the
   * GL context inside its own hooks.
   */
  setOptimisticRoute(corridor: CorridorPack | null): void {
    this.#corridor = corridor ?? EMPTY_CORRIDOR
    this.#uploadDirty = true
  }

  /** §6.4 item 1, sampled by `0059`'s scripted camera path. */
  stats(): MaskStats {
    return {
      /**
       * WHAT THE PASS WILL DRAW, cells and corridor together — they are one `drawArraysInstanced`
       * and §6.4 item 1's budget is on the draw, not on the cells. Before the first `prerender`
       * the buffer does not exist yet, so it reports what has been handed in.
       */
      visibleInstanceCount:
        this.#resources?.instanceCount ?? (this.#bucket?.count ?? 0) + this.#corridor.count,
      optimisticDiscs: this.#corridor.count,
      res: this.#res,
      maskSize: this.#resources ? `${this.#resources.maskW}x${this.#resources.maskH}` : "-",
      passes: this.#passes,
      restore: this.#restore,
      shaderError: this.#shaderError,
      composites: this.#composites,
      compositeRestore: this.#compositeRestore,
      noise: this.#noise,
      fogTime: this.#fogTime,
      compositeError: this.#compositeError,
    }
  }

  /** The mask texture, for `0056`'s composite to sample. `null` before the first `prerender`. */
  maskTexture(): WebGLTexture | null {
    return this.#resources?.texture ?? null
  }

  /* ─── MapLibre's hooks ────────────────────────────────────────────────────── */

  /**
   * Deliberately empty, and it takes no arguments for the same reason the header gives: everything
   * this layer needs to build its program arrives on the render-method input, not here. MapLibre
   * passes the map and the context; there is nothing useful to do with either one yet.
   */
  onAdd(): void {}

  onRemove(_map: MapLibreMap, gl: WebGL2RenderingContext): void {
    if (this.#resources) disposeMaskResources(gl, this.#resources)
    this.#resources = null
    this.#variant = null
    // The composite is independent of the projection prelude, so it survives a variant change —
    // but not the context going away. A style change removes and re-adds custom layers, and its
    // program and VAO belong to the context that is being torn down.
    if (this.#composite) disposeCompositeResources(gl, this.#composite)
    this.#composite = null
    this.#compositeError = null
    // The bucket and the corridor are not dropped, they are marked for re-upload. A style change
    // removes and re-adds custom layers, and the GPU buffer goes with the resources — so without
    // this the layer comes back believing its instances are uploaded and draws nothing.
    this.#uploadDirty = true
  }

  prerender(gl: WebGL2RenderingContext, options: CustomRenderMethodInput): void {
    const { vertexShaderPrelude, define, variantName } = options.shaderData

    if (this.#variant !== variantName) {
      if (this.#resources) disposeMaskResources(gl, this.#resources)
      this.#resources = null
      // A different projection means a different prelude, which may well compile where the last one
      // did not — so a variant change is the one thing that earns a retry.
      this.#shaderError = null
    }

    if (!this.#resources) {
      // ONE ATTEMPT PER VARIANT. `prerender` runs every frame, so retrying a failed compile here
      // would be sixty identical console lines a second, and the finding would be unreadable inside
      // the flood it caused. `stats().shaderError` keeps the message available to whoever asks.
      if (this.#shaderError !== null) return
      try {
        this.#resources = createMaskResources(gl, {
          prelude: vertexShaderPrelude,
          define,
          width: gl.drawingBufferWidth,
          height: gl.drawingBufferHeight,
        })
        this.#variant = variantName
        this.#shaderError = null
        // A rebuilt program means a new instance buffer, so whatever is current has to be
        // re-uploaded — without this a projection change silently empties the mask.
        this.#uploadDirty = true
      } catch (error) {
        // Surface it once and stop trying every frame, which would bury the message in a flood of
        // sixty identical lines a second. A compile failure here IS the finding.
        this.#shaderError = error instanceof Error ? error.message : String(error)
        this.#variant = variantName
        log.error("fog mask: shader build failed", this.#shaderError)
        return
      }
    }

    // Criterion 2 — the FBO tracks the drawing buffer. `resize` fires on rotation, on the Android
    // URL bar collapsing, and on any window change; a mask left at the old size would be sampled
    // with the wrong UVs by `0056` and read as the fog sliding away from the ground.
    resizeMask(gl, this.#resources, gl.drawingBufferWidth, gl.drawingBufferHeight)

    if (this.#uploadDirty) {
      this.#uploadDirty = false
      const floats = this.#instanceFloats()
      /**
       * Nothing to say when there is nothing to upload INTO AN ALREADY-EMPTY BUFFER. A fogless
       * boot — signed out, or an account with no runs — would otherwise log a
       * `visibleInstanceCount=0` line per resource build, which is noise that looks like a
       * finding. An empty upload over a non-empty buffer is a different thing and must happen:
       * it is how an emptied set clears a stale mask rather than leaving the last one on screen.
       */
      if (floats.length > 0 || this.#resources.instanceCount > 0) {
        this.#res = this.#bucket?.res ?? this.#res
        uploadInstances(gl, this.#resources, floats)
        this.#report()
      }
    }

    this.#restore = runMaskPass(
      gl,
      this.#resources,
      options.defaultProjectionData as unknown as ProjectionLike,
    )
    this.#passes++
  }

  /**
   * `0056` criterion 1 — the noisy composite. §4.3.
   *
   * ONE `render`, TWO THINGS IT CAN DRAW, and the debug blit wins. `?fog=mask` exists to answer
   * "is the coverage right", which is a different question from "does the fog look right" and is
   * always the first one worth asking. Compositing underneath the blit would put both on screen
   * and answer neither.
   *
   * THE NOISE FRAME IS REBUILT EVERY FRAME, and it is nine floats of double-precision arithmetic
   * on the CPU — not a per-cell cost, and not something that can be cached: it is a function of the
   * camera, and the camera is what changes. `05` §6.1's rule is about projecting CELLS per frame,
   * and nothing here touches a cell.
   */
  render(gl: WebGL2RenderingContext, options: CustomRenderMethodInput): void {
    if (!this.#resources) return
    if (this.options.debug) {
      runDebugBlit(gl, this.#resources)
      return
    }

    if (!this.#composite) {
      // ONE ATTEMPT, for `prerender`'s reason: `render` runs every frame, and a compile failure
      // retried per frame is sixty identical console lines a second with the finding buried in
      // them. Unlike the mask's, this program does not depend on the projection prelude, so there
      // is no variant change that could make a second attempt succeed.
      if (this.#compositeError !== null) return
      try {
        this.#composite = createCompositeResources(gl, { octaves: this.options.octaves })
      } catch (error) {
        this.#compositeError = error instanceof Error ? error.message : String(error)
        log.error("fog composite: shader build failed", this.#compositeError)
        return
      }
    }

    this.#noise = noiseFrame(
      (options.defaultProjectionData as unknown as ProjectionLike).mainMatrix,
      gl.drawingBufferWidth,
      gl.drawingBufferHeight,
    )
    this.#fogTime = this.options.timeSource?.() ?? 0
    this.#compositeRestore = runCompositePass(gl, this.#composite, {
      mask: this.#resources.texture,
      noise: this.#noise,
      time: this.#fogTime,
      palette: this.options.palette ?? V1,
    })
    this.#composites++
  }

  /**
   * The bucket's instances and the corridor's, back to back — ONE array, because `mask.ts` draws
   * one `drawArraysInstanced` and §4 rules out a call per group as firmly as it rules out a call
   * per cell. The two are the same four-float layout, so a concatenation is all the merge needs.
   *
   * The common case is no corridor at all, and it returns the bucket's own array with no copy:
   * this runs on a data change, and at 150k cells an unnecessary 2.4 MB copy on the boot path is
   * exactly the kind of cost §6.1 budgets for and then loses to a convenience.
   */
  #instanceFloats(): Float32Array {
    const bucket = this.#bucket?.instances ?? new Float32Array(0)
    if (this.#corridor.count === 0) return bucket
    const merged = new Float32Array(bucket.length + this.#corridor.instances.length)
    merged.set(bucket, 0)
    merged.set(this.#corridor.instances, bucket.length)
    return merged
  }

  /* ─── Instrumentation ─────────────────────────────────────────────────────── */

  /**
   * §6.4 item 1, logged **per instance-buffer rebuild** — which is what "per mask rebuild" means
   * here, and the distinction is worth stating because the obvious reading is wrong.
   *
   * The mask *pass* runs every frame: it is screen-space, so a pan re-renders it even when nothing
   * about the data changed (§6.2 separates `maskDirty` from `bufferDirty` for exactly this). Logging
   * a line per frame would be sixty a second of identical output — not evidence, and it would push
   * anything else out of the console. What actually changes, and what §6.4 wants a histogram of, is
   * the count that the pass draws, and that changes only when the buffer is rebuilt.
   *
   * `stats()` is the other half: `0059`'s scripted camera path samples it per frame, where a
   * histogram is the point rather than a flood.
   */
  #report(): void {
    const stats = this.stats()
    if (this.options.onRebuild) {
      this.options.onRebuild(stats)
      return
    }
    log.info(
      `fog mask: visibleInstanceCount=${stats.visibleInstanceCount} res=${stats.res} ` +
        `optimistic=${stats.optimisticDiscs} mask=${stats.maskSize}`,
    )
  }
}
