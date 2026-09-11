import { describe, expect, it, vi } from "vitest"

import { FogPerf, type PerfHost } from "./collector"
import { EMPTY_CULL } from "../cull"

/**
 * Ticket `0059`, §6.4 items 1, 3, 4, 5, 6 and 7.
 *
 * The host is faked throughout, which is the only way most of this is testable at all: `performance.
 * memory` is Chromium-only, `longtask` entries cannot be synthesised, and a real rAF clock would make
 * every percentile assertion a race. What the fake CANNOT hide is the arithmetic and the phase
 * bookkeeping, and those are the two things that have been wrong in every perf harness anyone has
 * ever written.
 */

function fakeHost(overrides: Partial<PerfHost> = {}): PerfHost & {
  emitLongTask: (ms: number, attribution?: string) => void
  marks: string[]
  measures: string[]
} {
  let handler: ((ms: number, attribution: string) => void) | null = null
  const marks: string[] = []
  const measures: string[] = []
  return {
    now: () => 0,
    mark: (name) => marks.push(name),
    measure: (name) => measures.push(name),
    heapBytes: () => null,
    observeLongTasks: (h) => {
      handler = h
      return () => {
        handler = null
      }
    },
    emitLongTask: (ms, attribution = "window") => handler?.(ms, attribution),
    marks,
    measures,
    ...overrides,
  }
}

const cull = (ms: number) => ({ ...EMPTY_CULL, ms })

describe("frame time — item 3", () => {
  it("reports nearest-rank percentiles over the deltas, not over the timestamps", () => {
    const perf = new FogPerf(fakeHost())
    perf.beginPhase("pan-across")
    // Deltas of 10, 10, 10, 10, 100 ms — one stall in five frames.
    let t = 0
    for (const delta of [0, 10, 10, 10, 10, 100]) {
      t += delta
      perf.frame(t)
    }
    const [phase] = perf.snapshot().frames
    expect(phase!.samples).toBe(5)
    expect(phase!.p50).toBe(10)
    expect(phase!.max).toBe(100)
    // p95 of five samples is the fifth, nearest-rank: the stall is not smoothed away.
    expect(phase!.p95).toBe(100)
    expect(phase!.fps).toBeCloseTo(100, 0)
  })

  /**
   * THE ONE THAT WOULD HAVE BEEN WRONG. Without the clock reset in `beginPhase`, the first delta of
   * every phase spans the gap since the previous phase's last frame — so `pan-across` would open
   * with the entire fixture load as one "frame" and report a p95 of several hundred milliseconds.
   */
  it("does not charge a phase with the gap since the previous phase", () => {
    const perf = new FogPerf(fakeHost())
    perf.beginPhase("load")
    perf.frame(0)
    perf.frame(16)

    perf.beginPhase("pan-across")
    // 4,000 ms later — a fixture decode happened in between.
    perf.frame(4_016)
    perf.frame(4_032)

    const pan = perf.snapshot().frames.find((f) => f.phase === "pan-across")!
    expect(pan.samples).toBe(1)
    expect(pan.max).toBe(16)
  })

  it("keeps phases in the order they were entered, so the table reads as the path ran", () => {
    const perf = new FogPerf(fakeHost())
    for (const phase of ["load", "settle", "pan-inside"]) perf.beginPhase(phase)
    expect(perf.snapshot().frames.map((f) => f.phase)).toEqual(["load", "settle", "pan-inside"])
  })
})

describe("instance histogram — item 1", () => {
  it("keeps the peak per zoom, with the resolution that produced it", () => {
    const perf = new FogPerf(fakeHost())
    perf.instances(14.2, 3_000, 11)
    perf.instances(14.9, 5_271, 11)
    perf.instances(9.1, 900, 7)

    const buckets = perf.snapshot().instances
    expect(buckets.map((b) => b.zoom)).toEqual([9, 14])
    const z14 = buckets.find((b) => b.zoom === 14)!
    expect(z14.max).toBe(5_271)
    expect(z14.samples).toBe(2)
    expect(z14.resAtMax).toBe(11)
    /**
     * The UNFLOORED zoom at the peak. A band's worst count is at its bottom — the finest resolution
     * over the largest viewport the band allows — and flooring alone files that peak under the
     * integer below, against a resolution that zoom does not use.
     */
    expect(z14.zoomAtMax).toBe(14.9)
  })
})

describe("cull time and the padded region — item 4", () => {
  it("emits a real mark/measure pair around each cull", () => {
    const host = fakeHost()
    const perf = new FogPerf(host)
    perf.beginPhase("pan-across")
    perf.cullStart()
    perf.cullEnd(cull(1.2))
    expect(host.marks).toEqual(["fog-cull-start"])
    expect(host.measures).toEqual(["fog-cull"])
  })

  it("counts camera events and culls separately, which is what proves the padded region works", () => {
    const perf = new FogPerf(fakeHost())
    perf.beginPhase("pan-inside")
    for (let i = 0; i < 30; i++) perf.cameraEvent()

    perf.beginPhase("pan-across")
    for (let i = 0; i < 30; i++) perf.cameraEvent()
    perf.cullStart()
    perf.cullEnd(cull(0.8))
    perf.cullStart()
    perf.cullEnd(cull(1.6))

    const snapshot = perf.snapshot()
    const inside = snapshot.cullsPerCameraEvent.find((p) => p.phase === "pan-inside")!
    expect(inside).toEqual({ phase: "pan-inside", cameraEvents: 30, culls: 0 })

    const across = snapshot.culls.find((c) => c.phase === "pan-across")!
    expect(across.culls).toBe(2)
    expect(across.maxMs).toBeCloseTo(1.6)
    expect(across.meanMs).toBeCloseTo(1.2)
  })
})

describe("bucket derivation and cache — item 5", () => {
  it("groups derivations by kind and resolution and keeps the worst", () => {
    const perf = new FogPerf(fakeHost())
    perf.derive({ kind: "index", res: 11, size: 100, ms: 42 })
    perf.derive({ kind: "group", res: 11, size: 900, ms: 3 })
    perf.derive({ kind: "group", res: 11, size: 900, ms: 7 })

    const derives = perf.snapshot().derives
    expect(derives).toHaveLength(2)
    const group = derives.find((d) => d.kind === "group")!
    expect(group.count).toBe(2)
    expect(group.maxMs).toBe(7)
    expect(group.totalMs).toBe(10)
  })

  it("reports null rather than zero before any bucket has been asked for", () => {
    const perf = new FogPerf(fakeHost())
    expect(perf.snapshot().bucketCacheHitRate).toBeNull()
    perf.bucketRequest(false)
    perf.bucketRequest(true)
    perf.bucketRequest(true)
    expect(perf.snapshot().bucketCacheHitRate).toBeCloseTo(2 / 3)
  })
})

describe("long tasks — item 6", () => {
  it("tags each task with the phase it landed in, which is the only attribution available", () => {
    const host = fakeHost()
    const perf = new FogPerf(host)
    const stop = perf.start()

    perf.beginPhase("load")
    host.emitLongTask(180)
    perf.beginPhase("pan-across")
    host.emitLongTask(62, "iframe")
    stop()
    // Disconnected: a task arriving after teardown must not be recorded.
    host.emitLongTask(500)

    const tasks = perf.snapshot().longTasks
    expect(tasks).toEqual([
      { phase: "load", durationMs: 180, attribution: "window" },
      { phase: "pan-across", durationMs: 62, attribution: "iframe" },
    ])
  })
})

describe("heap — item 7", () => {
  it("subtracts the baseline it sampled before anything was loaded", () => {
    const readings = [20e6, 24e6, 61e6, 55e6]
    let at = 0
    const perf = new FogPerf(fakeHost({ heapBytes: () => readings[Math.min(at++, 3)]! }))
    perf.beginPhase("load")
    perf.frame(0)
    perf.frame(16)
    perf.frame(32)

    const heap = perf.snapshot().heap
    expect(heap.supported).toBe(true)
    expect(heap.baselineMb).toBeCloseTo(20)
    // The peak, not the last reading — GC after the peak must not erase it.
    expect(heap.peakMb).toBeCloseTo(61)
  })

  it("says it could not measure rather than reporting zero", () => {
    const perf = new FogPerf(fakeHost({ heapBytes: () => null }))
    perf.frame(0)
    expect(perf.snapshot().heap.supported).toBe(false)
  })
})

describe("the observer contract", () => {
  it("satisfies what FogViewportController asks of a CullObserver", () => {
    const perf = new FogPerf(fakeHost())
    // Structural, so this is the assertion that the two stay compatible without an import.
    const observer: { cullStart(): void; cullEnd(r: typeof EMPTY_CULL): void; cameraEvent(): void } =
      perf
    expect(vi.isMockFunction(observer.cullStart)).toBe(false)
    expect(typeof observer.cameraEvent).toBe("function")
  })
})

/**
 * §6.4 lists *"main-thread cull time"* (item 4) and *"bucket-derivation time"* (item 5) as two
 * instruments with two budgets. `cullBucket` performs the second inside the first — `discsFor`
 * materialises a group the first time it is asked — so measuring the cull gross measures both and
 * reports §6.1's own design as a blown budget.
 */
describe("derivation inside a cull — item 4 against item 5", () => {
  it("subtracts derivation that happened between cullStart and cullEnd", () => {
    const perf = new FogPerf(fakeHost())
    perf.beginPhase("pan-across")

    perf.cullStart()
    perf.derive({ kind: "group", res: 11, size: 900, ms: 18 })
    perf.derive({ kind: "group", res: 11, size: 900, ms: 4 })
    perf.cullEnd(cull(23))

    const [phase] = perf.snapshot().culls
    expect(phase!.maxMs).toBe(23)
    expect(phase!.deriveInsideMs).toBe(22)
    expect(phase!.netMaxMs).toBe(1)
  })

  it("leaves a warm cull untouched, which is the common case", () => {
    const perf = new FogPerf(fakeHost())
    perf.beginPhase("pan-across")
    perf.cullStart()
    perf.cullEnd(cull(0.9))

    const [phase] = perf.snapshot().culls
    expect(phase!.netMaxMs).toBeCloseTo(0.9)
    expect(phase!.deriveInsideMs).toBe(0)
  })

  it("does not charge a cull for a derivation that happened outside one", () => {
    const perf = new FogPerf(fakeHost())
    perf.beginPhase("zoom-out")
    // A bucket index built by the store before any cull asked for it.
    perf.derive({ kind: "index", res: 11, size: 4_000, ms: 46 })
    perf.cullStart()
    perf.cullEnd(cull(1.1))

    const [phase] = perf.snapshot().culls
    expect(phase!.deriveInsideMs).toBe(0)
    expect(phase!.netMaxMs).toBeCloseTo(1.1)
    // And item 5 still saw it.
    expect(perf.snapshot().derives[0]!.maxMs).toBe(46)
  })

  it("never reports a negative net cull", () => {
    const perf = new FogPerf(fakeHost())
    perf.beginPhase("pan-across")
    perf.cullStart()
    perf.derive({ kind: "group", res: 11, size: 900, ms: 40 })
    perf.cullEnd(cull(2))
    expect(perf.snapshot().culls[0]!.netMaxMs).toBe(0)
  })
})
