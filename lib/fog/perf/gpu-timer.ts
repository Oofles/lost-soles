/**
 * §6.4 ITEM 2 — GPU PASS TIMINGS, MASK AND COMPOSITE SEPARATELY. Ticket `0059`.
 *
 * *"GPU pass timings via `EXT_disjoint_timer_query_webgl2`, mask and composite separately. Budget:
 * mask < 1 ms, composite < 2 ms. (The extension is not universally available; guard it, and fall back
 * to frame time.)"*
 *
 * ─── THE GUARD IS NOT DEFENSIVE PROGRAMMING, IT IS THE EXPECTED PATH ────────
 *
 * `EXT_disjoint_timer_query_webgl2` is **absent in Chrome on Android** and has been for years — it
 * leaks cross-origin timing information, so it is gated behind the same policy that removed the
 * WebGL1 version from every browser's default configuration. The device this ticket exists to measure
 * is therefore the device least likely to report a per-pass number.
 *
 * That is worth stating plainly rather than discovering at the end: **items 2 and 3 measure different
 * surfaces, and the capability doc records which came from which.** The desktop answers "is the mask
 * under 1 ms and the composite under 2 ms", because those are properties of the shader's arithmetic
 * and its fill rate, and a desktop GPU that cannot hit them means the phone certainly cannot. The
 * phone answers "is p95 under 16.7 ms", which is the number the operator actually feels and the only
 * one §6.3's table is ultimately a means to.
 *
 * `supported` is therefore reported in the summary table as its own row. A missing per-pass number is
 * evidence about the browser; a zero would be evidence about the shader, and printing one for the
 * other is the failure this comment exists to prevent.
 *
 * ─── DISJOINT ──────────────────────────────────────────────────────────────
 *
 * The GPU may preempt, clock down, or otherwise invalidate a timing window, and `GPU_DISJOINT_EXT`
 * is how it says so. A disjoint result is not a slow frame, it is **no measurement** — folding it in
 * as a large number is how a timer harness reports a stall that never happened. Those samples are
 * counted and discarded, and the count is printed, because a run where most samples were disjoint is
 * a run whose per-pass numbers should not be believed.
 */

/** One `TIME_ELAPSED_EXT` query in flight, plus what it was timing. */
interface InFlight {
  query: WebGLQuery
  label: string
}

export interface GpuPassStats {
  label: string
  samples: number
  /** Nanoseconds, summed, so the mean is exact rather than an average of averages. */
  totalNs: number
  maxNs: number
  meanMs: number
  maxMs: number
}

export interface GpuTimerStats {
  supported: boolean
  /** Why not, when `supported` is false. Printed verbatim in the summary table. */
  reason: string | null
  /** Windows the driver invalidated. Discarded, never folded into a mean. */
  disjoint: number
  passes: GpuPassStats[]
}

/** The extension's two constants, which are not on `WebGL2RenderingContext`. */
interface TimerExtension {
  TIME_ELAPSED_EXT: number
  GPU_DISJOINT_EXT: number
}

export class GpuTimer {
  #gl: WebGL2RenderingContext | null = null
  #ext: TimerExtension | null = null
  #reason: string | null = "not attached to a GL context yet"
  #active: InFlight | null = null
  #pending: InFlight[] = []
  #free: WebGLQuery[] = []
  #disjoint = 0
  #totals = new Map<string, { samples: number; totalNs: number; maxNs: number }>()

  /**
   * Bound to the context on first use rather than in a constructor, because a `CustomLayerInterface`
   * does not own its context and MapLibre may hand it a different one after a context-loss rebuild.
   * A timer holding query objects from a dead context would throw inside `prerender`, which runs
   * inside MapLibre's own frame and would take the map down with it.
   */
  attach(gl: WebGL2RenderingContext): void {
    if (this.#gl === gl) return
    this.#reset()
    this.#gl = gl
    const ext = gl.getExtension("EXT_disjoint_timer_query_webgl2") as TimerExtension | null
    this.#ext = ext
    this.#reason = ext
      ? null
      : "EXT_disjoint_timer_query_webgl2 unavailable — expected on Chrome for Android; " +
        "frame time (item 3) is the measurement that stands on this device"
  }

  get supported(): boolean {
    return this.#ext !== null
  }

  /**
   * Open a timing window. **Silently a no-op when one is already open**, and that is correct rather
   * than lax: WebGL2 permits exactly one active `TIME_ELAPSED_EXT` query at a time, so a nested
   * `begin` is a GL error, and the shape of this layer means the nesting is possible — `prerender`
   * can bail out between `begin` and `end` on a shader error without reaching `end`. Dropping the
   * inner window loses one sample; raising would lose the frame.
   */
  begin(label: string): void {
    const gl = this.#gl
    const ext = this.#ext
    if (!gl || !ext || this.#active) return
    const query = this.#free.pop() ?? gl.createQuery()
    if (!query) return
    gl.beginQuery(ext.TIME_ELAPSED_EXT, query)
    this.#active = { query, label }
  }

  /** Close the open window, if this call owns it. */
  end(): void {
    const gl = this.#gl
    const ext = this.#ext
    const active = this.#active
    if (!gl || !ext || !active) return
    gl.endQuery(ext.TIME_ELAPSED_EXT)
    this.#active = null
    this.#pending.push(active)
  }

  /**
   * Harvest whatever the driver has finished. Call once per frame, OUTSIDE a render hook.
   *
   * Results arrive several frames after the window closes — that is what makes the extension cheap,
   * and it is why nothing here ever blocks on `QUERY_RESULT`. A `getQueryParameter(QUERY_RESULT)`
   * before `QUERY_RESULT_AVAILABLE` stalls the pipeline until the GPU catches up, which would make
   * the harness the slowest thing in the frame it is measuring.
   */
  poll(): void {
    const gl = this.#gl
    const ext = this.#ext
    if (!gl || !ext || this.#pending.length === 0) return

    /**
     * READ ONCE PER POLL, NOT PER QUERY. `GPU_DISJOINT_EXT` is a latch: reading it clears it, and it
     * covers everything since the last read. Reading it inside the loop would clear it on the first
     * query and report every later one in the same batch as clean.
     */
    const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT) === true

    const stillPending: InFlight[] = []
    for (const entry of this.#pending) {
      const available = gl.getQueryParameter(entry.query, gl.QUERY_RESULT_AVAILABLE) === true
      if (!available && !disjoint) {
        stillPending.push(entry)
        continue
      }
      if (disjoint) {
        this.#disjoint++
      } else {
        const ns = Number(gl.getQueryParameter(entry.query, gl.QUERY_RESULT))
        if (Number.isFinite(ns)) this.#record(entry.label, ns)
      }
      this.#free.push(entry.query)
    }
    this.#pending = stillPending
  }

  #record(label: string, ns: number): void {
    const totals = this.#totals.get(label) ?? { samples: 0, totalNs: 0, maxNs: 0 }
    totals.samples++
    totals.totalNs += ns
    if (ns > totals.maxNs) totals.maxNs = ns
    this.#totals.set(label, totals)
  }

  stats(): GpuTimerStats {
    return {
      supported: this.supported,
      reason: this.#reason,
      disjoint: this.#disjoint,
      passes: [...this.#totals.entries()].map(([label, t]) => ({
        label,
        samples: t.samples,
        totalNs: t.totalNs,
        maxNs: t.maxNs,
        meanMs: t.samples === 0 ? 0 : t.totalNs / t.samples / 1e6,
        maxMs: t.maxNs / 1e6,
      })),
    }
  }

  /** Drop every sample, keeping the context binding. The scripted path calls this at its start. */
  clear(): void {
    this.#totals.clear()
    this.#disjoint = 0
  }

  #reset(): void {
    const gl = this.#gl
    if (gl) {
      for (const entry of this.#pending) gl.deleteQuery(entry.query)
      for (const query of this.#free) gl.deleteQuery(query)
      if (this.#active) gl.deleteQuery(this.#active.query)
    }
    this.#pending = []
    this.#free = []
    this.#active = null
    this.#totals.clear()
    this.#disjoint = 0
  }
}
