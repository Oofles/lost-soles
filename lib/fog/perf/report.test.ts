import { describe, expect, it } from "vitest"

import type { PerfSnapshot } from "./collector"
import type { GpuTimerStats } from "./gpu-timer"
import {
  formatReport,
  FRAME_BUDGET_MS,
  HEAP_BUDGET_MB,
  INSTANCE_CEILING,
  REFERENCE_VIEWPORT,
  scaledCeiling,
  verdicts,
  type ReportContext,
} from "./report"

/** Ticket `0059` criterion 1. `05-fog-of-war.md` §6.3, §6.4; D-238. */

const PHONE: ReportContext = {
  dataset: "150k",
  cells: 151_201,
  viewportW: 400,
  viewportH: 800,
  devicePixelRatio: 2,
  userAgent: "test",
  renderer: "Adreno (TM) 610",
}

const DESKTOP: ReportContext = { ...PHONE, viewportW: 1440, viewportH: 900 }

const NO_GPU: GpuTimerStats = {
  supported: false,
  reason: "EXT_disjoint_timer_query_webgl2 unavailable — …",
  disjoint: 0,
  passes: [],
}

function snapshot(overrides: Partial<PerfSnapshot> = {}): PerfSnapshot {
  return {
    frames: [
      frameStats("pan-across", 239, 12, 15.5, 16, 20),
    ],
    instances: [{ zoom: 14, samples: 200, max: 5_271, resAtMax: 11, zoomAtMax: 14 }],
    longTasks: [],
    culls: [cullPhase("pan-across", 12, 1.1, 0.75)],
    derives: [{ kind: "index", res: 11, count: 1, totalMs: 48, maxMs: 48 }],
    heap: { supported: true, peakMb: 58, baselineMb: 24 },
    bucketCacheHitRate: 0.94,
    cullsPerCameraEvent: [
      { phase: "pan-inside", cameraEvents: 30, culls: 0 },
      { phase: "pan-across", cameraEvents: 240, culls: 12 },
    ],
    ...overrides,
  }
}

const row = (rows: ReturnType<typeof verdicts>, name: string) => rows.find((r) => r.name === name)!

/** `dropped` is derived the way the collector derives it: anything over 1.5x p50. */
function frameStats(phase: string, samples: number, p50: number, p95: number, p99: number, max: number, dropped = 0) {
  return {
    phase,
    samples,
    p50,
    p95,
    p99,
    max,
    fps: 1000 / p50,
    dropped,
    droppedPct: samples === 0 ? 0 : (dropped / samples) * 100,
    displayHz: 1000 / p50,
  }
}

/**
 * A cull phase. `net` defaults to `max`, i.e. no derivation happened inside the cull — the common
 * case and the one item 4's budget is stated for. Pass `deriveInsideMs` to model a pan into ground
 * the bucket has not materialised yet.
 */
function cullPhase(phase: string, culls: number, max: number, mean: number, deriveInsideMs = 0) {
  const net = Math.max(max - deriveInsideMs, 0)
  return {
    phase,
    culls,
    totalMs: mean * culls,
    maxMs: max,
    meanMs: mean,
    netTotalMs: Math.max(mean - deriveInsideMs / Math.max(culls, 1), 0) * culls,
    netMaxMs: net,
    netMeanMs: Math.max(mean - deriveInsideMs / Math.max(culls, 1), 0),
    deriveInsideMs,
  }
}

describe("item 1's ceiling — D-238", () => {
  it("is 6,000 exactly on the reference viewport", () => {
    expect(scaledCeiling({ ...PHONE, viewportW: REFERENCE_VIEWPORT.w, viewportH: REFERENCE_VIEWPORT.h }))
      .toBe(INSTANCE_CEILING)
  })

  /**
   * THE ROW THAT WOULD OTHERWISE BE PERMANENTLY RED. D-238 is explicit that a 1440x900 desktop lands
   * near 21,000 instances at z14 and that this is *"recorded rather than capped"*. A flat 6,000 would
   * fail every desktop run of the harness for being correct — which is how a red cell gets ignored.
   */
  it("scales with viewport area, so a desktop run is judged against a desktop screen", () => {
    expect(scaledCeiling(DESKTOP)).toBe(24_300)
    const rows = verdicts(snapshot({ instances: [{ zoom: 14, samples: 9, max: 21_000, resAtMax: 11, zoomAtMax: 14 }] }), NO_GPU, DESKTOP)
    expect(row(rows, "visibleInstanceCount").pass).toBe(true)
    expect(row(rows, "visibleInstanceCount").note).toContain("recorded rather than capped")
  })

  it("still fails a count that is not bounded by screen area at all", () => {
    const rows = verdicts(
      snapshot({ instances: [{ zoom: 14, samples: 9, max: 151_201, resAtMax: 11, zoomAtMax: 14 }] }),
      NO_GPU,
      PHONE,
    )
    expect(row(rows, "visibleInstanceCount").pass).toBe(false)
  })

  it("carries no desktop note on the phone, where the two ceilings coincide", () => {
    expect(row(verdicts(snapshot(), NO_GPU, PHONE), "visibleInstanceCount").note).toBeUndefined()
  })
})

describe("item 2 — a missing extension is not a failure", () => {
  it("reports the two GPU rows as unjudged, with the reason", () => {
    const rows = verdicts(snapshot(), NO_GPU, PHONE)
    for (const label of ["GPU mask", "GPU composite"]) {
      expect(row(rows, label).pass).toBeNull()
      expect(row(rows, label).value).toBe("not measured")
      expect(row(rows, label).note).toContain("unavailable")
    }
  })

  it("judges them against §6.3 when the driver did answer", () => {
    const gpu: GpuTimerStats = {
      supported: true,
      reason: null,
      disjoint: 3,
      passes: [
        { label: "mask", samples: 100, totalNs: 60e6, maxNs: 0.9e6, meanMs: 0.6, maxMs: 0.9 },
        { label: "composite", samples: 100, totalNs: 240e6, maxNs: 3e6, meanMs: 2.4, maxMs: 3 },
      ],
    }
    const rows = verdicts(snapshot(), gpu, PHONE)
    expect(row(rows, "GPU mask").pass).toBe(true)
    expect(row(rows, "GPU composite").pass).toBe(false)
    expect(row(rows, "GPU mask").note).toContain("3 disjoint")
  })
})

describe("item 3 — frame time, restated as dropped frames (D-241)", () => {
  it("judges each pan phase and ignores load and zoom", () => {
    const rows = verdicts(
      snapshot({
        frames: [
          frameStats("load", 60, 40, 300, 320, 340, 30),
          frameStats("pan-across", 239, 12, 15.5, 16, 20),
        ],
      }),
      NO_GPU,
      PHONE,
    )
    expect(rows.filter((r) => r.item === 3)).toHaveLength(1)
    expect(row(rows, "frame — pan-across").pass).toBe(true)
  })

  /**
   * THE CASE THE OLD ASSERTION GOT WRONG, and it is the whole reason for D-241. These are the real
   * numbers from the first desktop run: a vsync-locked 60 Hz display holding a rock-steady 60 fps
   * through `pan-across`, with nothing dropped. `p95 < 16.7` scored it FAIL, because on a 60 Hz
   * display an ON-TIME frame's delta is 16.7 ms — the budget is the floor, not a ceiling.
   */
  it("passes a flawless 60 Hz run that the old p95 rule failed", () => {
    const rows = verdicts(
      snapshot({ frames: [frameStats("pan-across", 238, 16.7, 17.3, 18.6, 27.1, 0)] }),
      NO_GPU,
      PHONE,
    )
    const frame = row(rows, "frame — pan-across")
    expect(frame.pass).toBe(true)
    expect(frame.value).toContain("0 dropped")
    expect(frame.note).toContain("~60 Hz")
  })

  it("fails a phase that genuinely drops frames", () => {
    const rows = verdicts(
      // zoom-out's real shape: on-time median, a long tail. 12 of 119 missed a vsync.
      snapshot({ frames: [frameStats("pan-across", 119, 16.7, 58.1, 98.6, 243.7, 12)] }),
      NO_GPU,
      PHONE,
    )
    expect(row(rows, "frame — pan-across").pass).toBe(false)
  })

  /**
   * THE HOLE THE DROP RATE OPENS ON ITS OWN, closed by the p50 half. A renderer stuck at 30 fps has
   * a p50 of 33 ms, so every frame is "on time" relative to itself and nothing is ever 1.5x the
   * median. Without the absolute check it would score a clean pass at half the target rate.
   */
  it("fails a renderer running at half rate even though it drops nothing", () => {
    const rows = verdicts(
      snapshot({ frames: [frameStats("pan-across", 200, 33.4, 34, 35, 36, 0)] }),
      NO_GPU,
      PHONE,
    )
    const frame = row(rows, "frame — pan-across")
    expect(frame.pass).toBe(false)
    expect(frame.note).toContain("not being kept up with")
    expect(FRAME_BUDGET_MS).toBe(17.0)
  })

  it("names the kill criteria in the verdict line when a budget is missed", () => {
    const text = formatReport(
      snapshot({ frames: [frameStats("pan-across", 239, 22, 31, 40, 60, 40)] }),
      NO_GPU,
      PHONE,
    )
    expect(text).toContain("FAIL")
    expect(text).toContain("mask scale 0.35x")
    expect(text).toContain("fBm 2 octaves")
  })
})

describe("item 4 — cull time and the padded region", () => {
  /**
   * THE ROW THAT WAS RED ON EVERY RUN UNTIL IT WAS SPLIT. A band crossing materialises a bucket's
   * geometry inside the cull, and §6.3 budgets that at 30-80 ms on its own row — so folding it into
   * item 4's < 2 ms reported a cost the design deliberately put off the frame path as a blown
   * budget, every time.
   */
  it("judges the pan and merely records the zoom and load phases", () => {
    const rows = verdicts(
      snapshot({
        culls: [
          cullPhase("load", 1, 134, 134),
          cullPhase("pan-across", 10, 1.4, 0.9),
          cullPhase("zoom-out", 17, 221, 41),
        ],
      }),
      NO_GPU,
      PHONE,
    )
    const pan = row(rows, "cull time — pan")
    expect(pan.pass).toBe(true)
    expect(pan.value).toContain("1.40 ms max")

    const other = row(rows, "cull time — zoom and load")
    expect(other.pass).toBeNull()
    expect(other.value).toContain("221.00 ms max")
    expect(other.value).toContain("zoom-out")
  })

  /**
   * THE ROW'S WHOLE POINT. `cullBucket` materialises a group's geometry the first time it is asked,
   * so a pan into new ground pays §6.3's 30-80 ms derivation inside item 4's < 2 ms cull. Gross, this
   * is a 23 ms cull and a failure; net, it is a 1.2 ms cull and a pass, and the note carries the
   * gross figure so the hitch is not hidden by the subtraction.
   */
  it("subtracts first-sight derivation, and still reports the gross cost", () => {
    const rows = verdicts(
      snapshot({ culls: [cullPhase("pan-across", 10, 23, 5.1, 21.8)] }),
      NO_GPU,
      PHONE,
    )
    const pan = row(rows, "cull time — pan")
    expect(pan.pass).toBe(true)
    expect(pan.value).toContain("1.20 ms max")
    expect(pan.note).toContain("21.80 ms of first-sight group derivation")
    expect(pan.note).toContain("23.00 ms gross")
  })

  it("still fails a genuinely slow cull during a pan", () => {
    const rows = verdicts(
      snapshot({ culls: [cullPhase("pan-across", 10, 9, 9)] }),
      NO_GPU,
      PHONE,
    )
    expect(row(rows, "cull time — pan").pass).toBe(false)
  })

  it("passes on zero culls inside it and fails on one", () => {
    expect(row(verdicts(snapshot(), NO_GPU, PHONE), "culls inside the padded region").pass).toBe(true)
    const dirty = snapshot({
      cullsPerCameraEvent: [{ phase: "pan-inside", cameraEvents: 30, culls: 1 }],
    })
    expect(row(verdicts(dirty, NO_GPU, PHONE), "culls inside the padded region").pass).toBe(false)
  })
})

describe("item 6 — long tasks", () => {
  it("asserts only on the pan phases, and says how many were outside them", () => {
    const rows = verdicts(
      snapshot({
        longTasks: [
          { phase: "load", durationMs: 240, attribution: "window" },
          { phase: "zoom-out", durationMs: 70, attribution: "window" },
        ],
      }),
      NO_GPU,
      PHONE,
    )
    const tasks = row(rows, "long tasks during pan")
    expect(tasks.pass).toBe(true)
    expect(tasks.note).toContain("2 outside the pan phases")
  })

  it("fails on one during a pan and names the phase", () => {
    const rows = verdicts(
      snapshot({ longTasks: [{ phase: "pan-z17", durationMs: 88, attribution: "window" }] }),
      NO_GPU,
      PHONE,
    )
    expect(row(rows, "long tasks during pan").pass).toBe(false)
    expect(row(rows, "long tasks during pan").value).toContain("pan-z17")
  })
})

describe("item 7 — heap", () => {
  /**
   * The BUDGET IS THE DELTA. A page holding MapLibre, a basemap and React is tens of megabytes before
   * a single cell is decoded, so a total would fail §6.4's claim about the fog by measuring something
   * else entirely.
   */
  it("subtracts the baseline before judging", () => {
    const rows = verdicts(snapshot(), NO_GPU, PHONE)
    const heap = row(rows, "peak JS heap over baseline")
    expect(heap.value).toContain("34.0 MB")
    expect(heap.pass).toBe(true)
    expect(HEAP_BUDGET_MB).toBe(40)

    const heavy = snapshot({ heap: { supported: true, peakMb: 130, baselineMb: 24 } })
    expect(row(verdicts(heavy, NO_GPU, PHONE), "peak JS heap over baseline").pass).toBe(false)
  })

  it("is unjudged rather than zero where performance.memory is absent", () => {
    const rows = verdicts(
      snapshot({ heap: { supported: false, peakMb: 0, baselineMb: 0 } }),
      NO_GPU,
      PHONE,
    )
    expect(row(rows, "peak JS heap over baseline").pass).toBeNull()
  })
})

describe("a surface that cannot judge", () => {
  /**
   * The headless harness runs under a virtual clock. A `PASS` on a frame budget there would be a
   * claim about nothing, and it is exactly the claim someone would later quote.
   */
  it("forces the named items to no verdict, with a reason", () => {
    const rows = verdicts(snapshot(), NO_GPU, { ...PHONE, unjudged: [2, 3, 6] })
    for (const item of [2, 3, 6]) {
      for (const r of rows.filter((row) => row.item === item)) {
        expect(r.pass).toBeNull()
        expect(r.note).toContain("the clock is virtual")
      }
    }
    // And the items it CAN judge are untouched.
    expect(row(rows, "visibleInstanceCount").pass).toBe(true)
    expect(row(rows, "peak JS heap over baseline").pass).toBe(true)
  })
})

describe("the table itself", () => {
  it("carries every instrument, the device, and a single verdict line", () => {
    const text = formatReport(snapshot(), NO_GPU, PHONE)
    for (const needle of [
      "visibleInstanceCount",
      "GPU mask",
      "frame — ",
      "cull time — pan",
      "bucket cache hit rate",
      "long tasks during pan",
      "peak JS heap",
      "Adreno (TM) 610",
      "400x800",
      "VERDICT: every measured budget met.",
    ]) {
      expect(text).toContain(needle)
    }
    // The histogram and the per-phase blocks, which the ticket asks to be recorded.
    expect(text).toContain("visibleInstanceCount, per zoom")
    expect(text).toContain("frame time, per phase")
  })

  it("prints (masked) rather than inventing a renderer", () => {
    expect(formatReport(snapshot(), NO_GPU, { ...PHONE, renderer: null })).toContain("(masked)")
  })
})
