import type { CullResult } from "../cull"
import type { DeriveEvent } from "../zoom-buckets"

/**
 * §6.4's SEVEN INSTRUMENTS, IN ONE OBJECT. Ticket `0059`. `05-fog-of-war.md` §6.4.
 *
 * Items 1, 3, 4, 5, 6 and 7 live here; item 2 is `gpu-timer.ts`, because it owns GL objects and a
 * context lifetime and nothing else here touches the GPU.
 *
 * ─── EVERYTHING IS PHASED, AND THAT IS THE DESIGN ──────────────────────────
 *
 * A single p95 over a whole session is a number that cannot fail usefully. Loading a 500k fixture,
 * deriving a cold bucket and panning are three different activities with three different budgets, and
 * §6.4 asserts things about the third that are *expected* to be false during the first two — item 6
 * wants *"zero long tasks attributable to the fog layer **during pan**"*, and a cold res-11 bucket
 * derivation is priced at 30–80 ms in §6.3's own table. Folding them together produces a red number
 * that means nothing, which is how a perf harness becomes a thing people stop reading.
 *
 * So every sample carries the phase it was taken in, `camera-path.ts` names the phases, and the
 * summary reports per phase with the assertion applied only where §6.4 makes it.
 *
 * ─── LONG-TASK ATTRIBUTION IS BY WINDOW, NOT BY STACK, AND THAT IS A LIMIT ──
 *
 * `PerformanceObserver`'s `longtask` entries carry an `attribution` array whose `containerType` is
 * `"window"` for same-document script — it can tell you a long task happened, and that it was not in
 * an iframe, and nothing else. There is no stack, so *"attributable to the fog layer"* cannot be
 * decided from the entry.
 *
 * What makes the assertion meaningful anyway is the phase: during a scripted pan the only JavaScript
 * this page runs is MapLibre's own frame and this layer's cull. So a long task in a pan phase is
 * attributable by **elimination**, and one during the load phase is not attributable at all. That is
 * weaker than a stack and it is stated rather than dressed up — the alternative is a harness that
 * claims an attribution it does not have.
 *
 * ─── HEAP ──────────────────────────────────────────────────────────────────
 *
 * `performance.memory` is non-standard, Chromium-only, and **quantised to 100 KB buckets with a 20 ms
 * update interval** — which is fine, because item 7's assertion is *"low tens of MB"*, a question
 * quantisation at that granularity cannot get wrong. It is absent in Firefox and Safari; the row then
 * reports that rather than a zero.
 */

/** The phases `camera-path.ts` drives, in order. Named here so the summary can assert per phase. */
export type PerfPhase = string

export interface FrameStats {
  phase: PerfPhase
  samples: number
  p50: number
  p95: number
  p99: number
  max: number
  /** Frames per second implied by `p50`. The number a person would say out loud. */
  fps: number
}

export interface InstanceBucket {
  /** The zoom, floored. §6.4 item 1 asks for a histogram *per zoom level*. */
  zoom: number
  samples: number
  max: number
  /** The bucket resolution in force at the peak, so a surprise can be traced to `ZOOM_TO_RES`. */
  resAtMax: number
  /**
   * THE EXACT, UNFLOORED ZOOM AT THE PEAK — and it is not a nicety.
   *
   * MapLibre's zoom is continuous and `ZOOM_TO_RES`'s bands are half-open, so the worst instance
   * count in a band is at its BOTTOM: the finest resolution the band allows, over the largest
   * viewport the band allows. Flooring alone puts that peak in the bucket below and reports it
   * against a resolution the integer zoom does not even use — which reads as an unexplainable
   * number rather than as a band boundary, and cost a debugging round here before it was recorded.
   */
  zoomAtMax: number
}

export interface LongTaskRecord {
  phase: PerfPhase
  durationMs: number
  /** `containerType` from the entry's attribution, verbatim. See the header on what it can mean. */
  attribution: string
}

export interface CullStats {
  phase: PerfPhase
  culls: number
  /** Wall clock around `cullBucket`, derivation included. §6.3's two rows, added together. */
  totalMs: number
  maxMs: number
  meanMs: number
  /**
   * THE SAME CULLS WITH FIRST-SIGHT GROUP DERIVATION SUBTRACTED — and this is the number item 4's
   * budget is about.
   *
   * §6.4 lists *"main-thread cull time"* (item 4, < 2 ms) and *"bucket-derivation time"* (item 5,
   * recorded) as two instruments, and §6.3's table budgets them on two rows: 1-5 ms for the cull and
   * VBO upload, 30-80 ms for a cold derivation which it puts *off the frame path* deliberately.
   *
   * **The code does not separate them.** `cullBucket` calls `discsFor(group)`, which materialises
   * that group's ids, fractions, projection and bridges the first time it is asked — so a pan into
   * ground the bucket has not seen yet pays a derivation INSIDE the cull. Measured gross, item 4 is
   * red on every run for doing exactly what §6.1 designed it to do; measured net, it is the number
   * §6.4 named. Both are reported, because the gross figure is what the main thread actually spends
   * and a reader who only saw the net one would be missing a 20 ms hitch.
   */
  netTotalMs: number
  netMaxMs: number
  netMeanMs: number
  /** Milliseconds of group derivation that happened inside a cull, in this phase. */
  deriveInsideMs: number
}

export interface DeriveStats {
  kind: DeriveEvent["kind"]
  res: number
  count: number
  totalMs: number
  maxMs: number
}

export interface HeapStats {
  supported: boolean
  peakMb: number
  /** The reading taken before anything was loaded, so the fixture's own cost is separable. */
  baselineMb: number
}

export interface PerfSnapshot {
  frames: FrameStats[]
  instances: InstanceBucket[]
  longTasks: LongTaskRecord[]
  culls: CullStats[]
  derives: DeriveStats[]
  heap: HeapStats
  /** §6.4 item 5's other half: how often a bucket request was answered from the cache. */
  bucketCacheHitRate: number | null
  /** Camera events the controller saw, and how many of them cost a cull. Item 4's "~0 ms" half. */
  cullsPerCameraEvent: { phase: PerfPhase; cameraEvents: number; culls: number }[]
}

/** What the collector needs from the browser. Injected so the tests drive it without one. */
export interface PerfHost {
  now(): number
  /** `performance.mark`. A no-op host is legal — the marks are for the devtools timeline. */
  mark(name: string): void
  measure(name: string, startMark: string): void
  heapBytes(): number | null
  observeLongTasks(handler: (durationMs: number, attribution: string) => void): () => void
}

export const browserPerfHost: PerfHost = {
  now: () => performance.now(),
  mark: (name) => {
    try {
      performance.mark(name)
    } catch {
      // `mark` throws on a name collision with a legacy timing attribute and on nothing else that
      // matters. A missing devtools mark must never take down the frame it was measuring.
    }
  },
  measure: (name, startMark) => {
    try {
      performance.measure(name, startMark)
    } catch {
      // Same. A `measure` whose start mark was cleared by a buffer overflow is not a finding.
    }
  },
  heapBytes: () => {
    const memory = (performance as unknown as { memory?: { usedJSHeapSize?: number } }).memory
    return typeof memory?.usedJSHeapSize === "number" ? memory.usedJSHeapSize : null
  },
  observeLongTasks: (handler) => {
    if (typeof PerformanceObserver === "undefined") return () => {}
    /**
     * `PerformanceObserver.supportedEntryTypes` rather than a try/catch around `observe`. Safari
     * throws on an unknown `entryTypes` and Firefox silently observes nothing, so the catch would
     * report "supported" on one of the two browsers that does not support it.
     */
    const supported = PerformanceObserver.supportedEntryTypes ?? []
    if (!supported.includes("longtask")) return () => {}
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const attribution = (
          entry as unknown as { attribution?: { containerType?: string }[] }
        ).attribution?.[0]?.containerType
        handler(entry.duration, attribution ?? "unknown")
      }
    })
    observer.observe({ entryTypes: ["longtask"] })
    return () => observer.disconnect()
  },
}

const CULL_MARK = "fog-cull-start"

interface Accumulator {
  frames: number[]
  culls: {
    count: number
    totalMs: number
    maxMs: number
    netTotalMs: number
    netMaxMs: number
    deriveInsideMs: number
  }
  cameraEvents: number
  longTasks: LongTaskRecord[]
}

function emptyAccumulator(): Accumulator {
  return {
    frames: [],
    culls: { count: 0, totalMs: 0, maxMs: 0, netTotalMs: 0, netMaxMs: 0, deriveInsideMs: 0 },
    cameraEvents: 0,
    longTasks: [],
  }
}

/**
 * Nearest-rank on a sorted copy, which is the definition that does not invent a value between two
 * samples. At 1,800 frames the difference from a linear interpolation is under a tenth of a
 * millisecond and the arithmetic is one line instead of four.
 */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const rank = Math.ceil((p / 100) * sorted.length) - 1
  return sorted[Math.min(Math.max(rank, 0), sorted.length - 1)]!
}

export class FogPerf {
  #host: PerfHost
  #phase: PerfPhase = "idle"
  #phases = new Map<PerfPhase, Accumulator>()
  #order: PerfPhase[] = []
  #lastFrameAt: number | null = null
  #instances = new Map<number, InstanceBucket>()
  #derives = new Map<string, DeriveStats>()
  #heapPeak = 0
  #heapBaseline = 0
  #heapSupported = false
  #bucketRequests = 0
  #bucketHits = 0
  /** Set between `cullStart` and `cullEnd`, so `derive` knows whose time it is spending. */
  #insideCull = false
  #deriveInsideCull = 0
  #stopLongTasks: (() => void) | null = null

  constructor(host: PerfHost = browserPerfHost) {
    this.#host = host
    const baseline = host.heapBytes()
    this.#heapSupported = baseline !== null
    this.#heapBaseline = (baseline ?? 0) / 1e6
    this.#heapPeak = baseline ?? 0
  }

  /** Starts the long-task observer. Returns its own teardown, for a React effect's cleanup. */
  start(): () => void {
    this.#stopLongTasks?.()
    this.#stopLongTasks = this.#host.observeLongTasks((durationMs, attribution) => {
      this.#current().longTasks.push({ phase: this.#phase, durationMs, attribution })
    })
    return () => this.stop()
  }

  stop(): void {
    this.#stopLongTasks?.()
    this.#stopLongTasks = null
  }

  get phase(): PerfPhase {
    return this.#phase
  }

  /**
   * Enter a phase. **The frame clock is reset**, and it has to be: the first rAF delta after a phase
   * boundary spans the gap between two phases, so keeping it would charge every phase with the tail
   * of the one before — most visibly as a 300 ms "frame" at the top of the first pan, which is the
   * fixture load.
   */
  beginPhase(phase: PerfPhase): void {
    this.#phase = phase
    this.#lastFrameAt = null
    if (!this.#phases.has(phase)) {
      this.#phases.set(phase, emptyAccumulator())
      this.#order.push(phase)
    }
  }

  /** §6.4 item 3. Called from the rAF loop with `performance.now()`. */
  frame(now: number): void {
    const last = this.#lastFrameAt
    this.#lastFrameAt = now
    if (last !== null) this.#current().frames.push(now - last)

    const heap = this.#host.heapBytes()
    if (heap !== null && heap > this.#heapPeak) this.#heapPeak = heap
  }

  /** §6.4 item 1, sampled per mask rebuild rather than per frame. */
  instances(zoom: number, count: number, res: number): void {
    const key = Math.floor(zoom)
    const bucket = this.#instances.get(key) ?? {
      zoom: key,
      samples: 0,
      max: 0,
      resAtMax: res,
      zoomAtMax: zoom,
    }
    bucket.samples++
    if (count > bucket.max) {
      bucket.max = count
      bucket.resAtMax = res
      bucket.zoomAtMax = zoom
    }
    this.#instances.set(key, bucket)
  }

  /* ─── §6.4 item 4 — the cull, with real marks ────────────────────────────── */

  cullStart(): void {
    this.#host.mark(CULL_MARK)
    this.#deriveInsideCull = 0
    this.#insideCull = true
  }

  /**
   * `result.ms` is the cull's own measurement and is what the statistics use; the `measure` call
   * beside it exists so the same work shows up as a named span in the devtools performance timeline,
   * which is how this gets looked at on the phone over remote debugging. Two clocks for one
   * quantity, and the one in the table is the one the code already had.
   */
  cullEnd(result: CullResult): void {
    this.#host.measure("fog-cull", CULL_MARK)
    this.#insideCull = false
    // Never negative: the two clocks are the same `performance.now()`, but a derivation that started
    // before `cullStart` (there is none today, and a future caller could) must not produce one.
    const net = Math.max(result.ms - this.#deriveInsideCull, 0)
    const culls = this.#current().culls
    culls.count++
    culls.totalMs += result.ms
    culls.netTotalMs += net
    culls.deriveInsideMs += this.#deriveInsideCull
    if (result.ms > culls.maxMs) culls.maxMs = result.ms
    if (net > culls.netMaxMs) culls.netMaxMs = net
    this.#deriveInsideCull = 0
  }

  /** Item 4's other half: a pan inside the padded region must produce events and no culls. */
  cameraEvent(): void {
    this.#current().cameraEvents++
  }

  /* ─── §6.4 item 5 — bucket derivation and cache hit rate ─────────────────── */

  derive(event: DeriveEvent): void {
    if (this.#insideCull) this.#deriveInsideCull += event.ms
    const key = `${event.kind}:${event.res}`
    const stats = this.#derives.get(key) ?? {
      kind: event.kind,
      res: event.res,
      count: 0,
      totalMs: 0,
      maxMs: 0,
    }
    stats.count++
    stats.totalMs += event.ms
    if (event.ms > stats.maxMs) stats.maxMs = event.ms
    this.#derives.set(key, stats)
  }

  /** Called once per `bucketFor`, with whether the store answered from its cache. */
  bucketRequest(hit: boolean): void {
    this.#bucketRequests++
    if (hit) this.#bucketHits++
  }

  snapshot(): PerfSnapshot {
    const frames: FrameStats[] = []
    const culls: CullStats[] = []
    const longTasks: LongTaskRecord[] = []
    const cullsPerCameraEvent: PerfSnapshot["cullsPerCameraEvent"] = []

    for (const phase of this.#order) {
      const acc = this.#phases.get(phase)!
      const sorted = [...acc.frames].sort((a, b) => a - b)
      const p50 = percentile(sorted, 50)
      frames.push({
        phase,
        samples: sorted.length,
        p50,
        p95: percentile(sorted, 95),
        p99: percentile(sorted, 99),
        max: sorted.length === 0 ? 0 : sorted[sorted.length - 1]!,
        fps: p50 === 0 ? 0 : 1000 / p50,
      })
      culls.push({
        phase,
        culls: acc.culls.count,
        totalMs: acc.culls.totalMs,
        maxMs: acc.culls.maxMs,
        meanMs: acc.culls.count === 0 ? 0 : acc.culls.totalMs / acc.culls.count,
        netTotalMs: acc.culls.netTotalMs,
        netMaxMs: acc.culls.netMaxMs,
        netMeanMs: acc.culls.count === 0 ? 0 : acc.culls.netTotalMs / acc.culls.count,
        deriveInsideMs: acc.culls.deriveInsideMs,
      })
      longTasks.push(...acc.longTasks)
      cullsPerCameraEvent.push({
        phase,
        cameraEvents: acc.cameraEvents,
        culls: acc.culls.count,
      })
    }

    return {
      frames,
      instances: [...this.#instances.values()].sort((a, b) => a.zoom - b.zoom),
      longTasks,
      culls,
      derives: [...this.#derives.values()].sort((a, b) =>
        a.kind === b.kind ? a.res - b.res : a.kind < b.kind ? -1 : 1,
      ),
      heap: {
        supported: this.#heapSupported,
        peakMb: this.#heapPeak / 1e6,
        baselineMb: this.#heapBaseline,
      },
      bucketCacheHitRate:
        this.#bucketRequests === 0 ? null : this.#bucketHits / this.#bucketRequests,
      cullsPerCameraEvent,
    }
  }

  /**
   * The current phase's accumulator, created on demand so a sample taken before any `beginPhase`
   * lands somewhere rather than throwing.
   *
   * **It was called `#acc` and `scripts/check-design-tokens.mjs` read that as the CSS colour
   * `#acc`** — three hex digits, `#` not preceded by a word character because it is preceded by a
   * dot. The guard is wrong and `0204` carries the narrowing; this name is not a workaround kept
   * quiet, it is a better name that also happens not to be hex, and the finding is filed rather
   * than absorbed.
   */
  #current(): Accumulator {
    let acc = this.#phases.get(this.#phase)
    if (!acc) {
      acc = emptyAccumulator()
      this.#phases.set(this.#phase, acc)
      this.#order.push(this.#phase)
    }
    return acc
  }
}
