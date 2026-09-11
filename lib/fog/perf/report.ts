import type { GpuTimerStats } from "./gpu-timer"
import type { PerfSnapshot } from "./collector"

/**
 * THE SINGLE SUMMARY TABLE. Ticket `0059` criterion 1. `05-fog-of-war.md` §6.4, §6.3, D-238.
 *
 * *"All seven instruments above exist behind a debug flag and print a single summary table."*
 *
 * ─── EVERY BUDGET IS HERE, WITH ITS SOURCE, AND NONE OF THEM ARE INVENTED ───
 *
 * A harness that prints numbers without their budgets is a harness whose output has to be carried
 * back to a design document before it means anything, on a phone, outdoors. Every row therefore
 * carries the threshold §6.3 or §6.4 states and a verdict against it, so the operator's job is to
 * read one column.
 *
 * ─── ITEM 1'S CEILING IS SCALED BY VIEWPORT AREA, NOT APPLIED FLAT ──────────
 *
 * D-238 is explicit that the 6,000 ceiling is *"on a 400x800 CSS px viewport"* and that a 1440x900
 * desktop *"lands near 21,000 instances at z14 on solid ground; that is **recorded rather than
 * capped**, because the property worth defending is that the number is bounded by screen area and
 * not by database size."*
 *
 * A flat 6,000 would therefore fail every desktop run of this harness for being correct, which is
 * the fastest way to teach someone to ignore a red cell. Scaling the ceiling by area states the
 * actual property: **6,000 per 320,000 CSS px²**. The raw number is printed beside the scaled ceiling
 * so nobody has to trust the arithmetic, and the phone — where area is ~1x — is where the scaled and
 * the literal ceiling coincide anyway.
 *
 * This is the same correction `0058` already had to make for wall-clock cull time: an absolute
 * threshold that passes or fails on the machine that ran it is not an assertion about the code.
 *
 * ─── ITEM 7'S THRESHOLD IS THE DELTA, NOT THE TOTAL ────────────────────────
 *
 * §6.4 asserts *"the `BigUint64Array` plus buckets stays in the low tens of MB"* — a claim about what
 * the FOG costs, not about what a page holding MapLibre, a basemap and React costs. The baseline is
 * sampled before the fixture is fetched and subtracted, so the row answers the question §6.4 asked.
 */

export interface ReportContext {
  /** `50k` / `150k` / `500k`, and the exact cell count behind it. */
  dataset: string
  cells: number
  /** CSS pixels, which is the unit D-238's ceiling is stated in. */
  viewportW: number
  viewportH: number
  devicePixelRatio: number
  userAgent: string
  /** The unmasked renderer string, when `WEBGL_debug_renderer_info` allows it. D-230 wants this. */
  renderer: string | null
  /**
   * §6.4 item numbers whose verdict this surface cannot give, forced to `--` with a reason.
   *
   * THE HEADLESS HARNESS IS THE ONLY CALLER, and it passes `[2, 3, 6]`. It runs under Chromium's
   * `--virtual-time-budget`, which advances the clock instantly whenever the renderer would wait —
   * so its rAF deltas, its per-pass GPU timings and its long-task entries are all measurements of a
   * clock that is not measuring anything.
   *
   * A verdict it cannot support is worse than no verdict: printing `PASS` on a frame budget under a
   * virtual clock is how a renderer ships believing it was measured. `?fog=perf` in a real browser
   * passes nothing here and judges all seven.
   */
  unjudged?: readonly number[]
}

export interface Verdict {
  item: number
  name: string
  value: string
  budget: string
  /** `null` where there is nothing to judge — a missing extension, or a recorded-only number. */
  pass: boolean | null
  note?: string
}

/** D-238's reference viewport. The ceiling is 6,000 instances on this many CSS pixels. */
export const REFERENCE_VIEWPORT = { w: 400, h: 800 } as const
export const INSTANCE_CEILING = 6_000
/** §6.3. */
export const MASK_BUDGET_MS = 1
export const COMPOSITE_BUDGET_MS = 2
/** 60 fps. §6.4 item 3. */
export const FRAME_BUDGET_MS = 16.7
/** §6.4 item 4. */
export const CULL_BUDGET_MS = 2
/** §6.4 item 7's *"low tens of MB"*, read at the top of that range. */
export const HEAP_BUDGET_MB = 40

/** The phases item 3 and item 6 make assertions about. `load` is deliberately not one of them. */
export const PAN_PHASES = ["pan-across", "pan-z17"]

function fmt(value: number, digits = 2): string {
  return value.toFixed(digits)
}

function n(value: number): string {
  return value.toLocaleString("en-US")
}

export function scaledCeiling(context: ReportContext): number {
  const area = context.viewportW * context.viewportH
  const reference = REFERENCE_VIEWPORT.w * REFERENCE_VIEWPORT.h
  return Math.round((INSTANCE_CEILING * area) / reference)
}

export function verdicts(
  snapshot: PerfSnapshot,
  gpu: GpuTimerStats,
  context: ReportContext,
): Verdict[] {
  const out: Verdict[] = []

  /* ── 1. visibleInstanceCount ─────────────────────────────────────────────── */
  const peak = snapshot.instances.reduce(
    (best, bucket) => (bucket.max > best.max ? bucket : best),
    { zoom: 0, max: 0, samples: 0, resAtMax: 0, zoomAtMax: 0 },
  )
  const ceiling = scaledCeiling(context)
  out.push({
    item: 1,
    name: "visibleInstanceCount",
    value: `${n(peak.max)} peak, at z${peak.zoomAtMax.toFixed(1)} (res ${peak.resAtMax})`,
    budget: `<= ${n(ceiling)} for ${context.viewportW}x${context.viewportH} (${n(INSTANCE_CEILING)} @ 400x800)`,
    pass: peak.max <= ceiling,
    note:
      context.viewportW * context.viewportH >
      REFERENCE_VIEWPORT.w * REFERENCE_VIEWPORT.h * 1.25
        ? "D-238: recorded rather than capped above the reference viewport — the property is that the count is bounded by screen area, not by dataset size"
        : undefined,
  })

  /* ── 2. GPU pass timings ─────────────────────────────────────────────────── */
  for (const [label, budget] of [
    ["mask", MASK_BUDGET_MS],
    ["composite", COMPOSITE_BUDGET_MS],
  ] as const) {
    const pass = gpu.passes.find((p) => p.label === label)
    if (!gpu.supported || !pass || pass.samples === 0) {
      out.push({
        item: 2,
        name: `GPU ${label}`,
        value: "not measured",
        budget: `< ${budget} ms`,
        pass: null,
        note: gpu.reason ?? "no samples",
      })
      continue
    }
    out.push({
      item: 2,
      name: `GPU ${label}`,
      value: `${fmt(pass.meanMs, 3)} ms mean, ${fmt(pass.maxMs, 3)} ms max (${n(pass.samples)} samples)`,
      budget: `< ${budget} ms`,
      pass: pass.meanMs < budget,
      note: gpu.disjoint > 0 ? `${gpu.disjoint} disjoint window(s) discarded` : undefined,
    })
  }

  /* ── 3. frame time ───────────────────────────────────────────────────────── */
  for (const phase of PAN_PHASES) {
    const frames = snapshot.frames.find((f) => f.phase === phase)
    if (!frames || frames.samples === 0) continue
    out.push({
      item: 3,
      name: `frame p95 — ${phase}`,
      value: `${fmt(frames.p95)} ms (p50 ${fmt(frames.p50)}, max ${fmt(frames.max)}, ${n(frames.samples)} frames)`,
      budget: `< ${FRAME_BUDGET_MS} ms`,
      pass: frames.p95 < FRAME_BUDGET_MS,
    })
  }

  /* ── 4. cull time, and the padded region ─────────────────────────────────── */

  /**
   * JUDGED OVER THE PAN PHASES, AND THE ZOOM PHASES ARE RECORDED BESIDE THEM. §6.3's table is
   * explicit that these are two different rows with two different budgets:
   *
   *   CPU on padded-region exit   two-level cull + VBO upload        1-5 ms, off the frame path
   *   Bucket derivation, cold     cellToParent pass + bbox precompute  30-80 ms, debounced, once
   *
   * A zoom that crosses a band pays the second INSIDE the first, because `cullBucket` materialises a
   * group's geometry the first time it is seen. Charging that to item 4's < 2 ms would report a
   * cold derivation — which §6.3 budgets at up to 80 ms and puts off the frame path deliberately —
   * as a blown cull budget, on every single run of the harness. The `load` phase is excluded for the
   * same reason and a stronger one: it contains the whole first derivation by construction.
   *
   * So the row that carries the verdict is the pan, which is what item 4's sentence is about, and
   * the zoom phases get a row of their own with no verdict and the number visible.
   */
  const panCulls = snapshot.culls.filter((phase) => PAN_PHASES.includes(phase.phase))
  const empty = {
    phase: "-",
    culls: 0,
    totalMs: 0,
    maxMs: 0,
    meanMs: 0,
    netTotalMs: 0,
    netMaxMs: 0,
    netMeanMs: 0,
    deriveInsideMs: 0,
  }
  const worstCull = panCulls.reduce((best, phase) => (phase.netMaxMs > best.netMaxMs ? phase : best), empty)
  const derivedInside = panCulls.reduce((sum, phase) => sum + phase.deriveInsideMs, 0)
  out.push({
    item: 4,
    name: "cull time — pan",
    value:
      worstCull.culls === 0
        ? "no culls ran"
        : `${fmt(worstCull.netMaxMs)} ms max, ${fmt(worstCull.netMeanMs)} ms mean (worst phase: ${worstCull.phase})`,
    budget: `< ${CULL_BUDGET_MS} ms`,
    pass: worstCull.culls === 0 ? null : worstCull.netMaxMs < CULL_BUDGET_MS,
    note:
      derivedInside > 0
        ? `${fmt(derivedInside)} ms of first-sight group derivation ran inside these culls and is ` +
          `subtracted (§6.3 budgets it on its own row). The worst SINGLE cull still cost the main ` +
          `thread ${fmt(Math.max(...panCulls.map((p) => p.maxMs), 0))} ms gross.`
        : undefined,
  })

  const otherCulls = snapshot.culls.filter(
    (phase) => !PAN_PHASES.includes(phase.phase) && phase.culls > 0,
  )
  if (otherCulls.length > 0) {
    const worstOther = otherCulls.reduce((best, phase) => (phase.maxMs > best.maxMs ? phase : best))
    out.push({
      item: 4,
      name: "cull time — zoom and load",
      value: `${fmt(worstOther.maxMs)} ms max (worst phase: ${worstOther.phase})`,
      budget: "30-80 ms cold, debounced, off the frame path — §6.3",
      pass: null,
      note: "a band crossing materialises a bucket's geometry inside the cull; §6.3 budgets that on its own row",
    })
  }

  const inside = snapshot.cullsPerCameraEvent.find((p) => p.phase === "pan-inside")
  out.push({
    item: 4,
    name: "culls inside the padded region",
    value: inside
      ? `${inside.culls} cull(s) over ${n(inside.cameraEvents)} camera events`
      : "phase did not run",
    budget: "0 — §6.2",
    pass: inside ? inside.culls === 0 : null,
  })

  /* ── 5. bucket derivation ────────────────────────────────────────────────── */
  const coldest = snapshot.derives.reduce(
    (best, d) => (d.maxMs > best.maxMs ? d : best),
    { kind: "index" as const, res: 0, count: 0, totalMs: 0, maxMs: 0 },
  )
  out.push({
    item: 5,
    name: "bucket derivation",
    value:
      coldest.count === 0
        ? "none"
        : `${fmt(coldest.maxMs)} ms max (${coldest.kind} at res ${coldest.res}), ` +
          `${n(snapshot.derives.reduce((s, d) => s + d.count, 0))} derivations`,
    budget: "30-80 ms, debounced, once per bucket — §6.3",
    pass: null,
    note: "recorded; §6.3 budgets this off the frame path rather than inside it",
  })
  out.push({
    item: 5,
    name: "bucket cache hit rate",
    value:
      snapshot.bucketCacheHitRate === null
        ? "no bucket requests"
        : `${fmt(snapshot.bucketCacheHitRate * 100, 1)}%`,
    budget: "derived lazily, once, and cached — §6.1",
    pass: null,
  })

  /* ── 6. long tasks ───────────────────────────────────────────────────────── */
  const panTasks = snapshot.longTasks.filter((task) => PAN_PHASES.includes(task.phase))
  out.push({
    item: 6,
    name: "long tasks during pan",
    value:
      panTasks.length === 0
        ? "0"
        : panTasks.map((t) => `${fmt(t.durationMs, 0)} ms in ${t.phase}`).join(", "),
    budget: "0 — §6.4 item 6",
    pass: panTasks.length === 0,
    note:
      snapshot.longTasks.length > panTasks.length
        ? `${snapshot.longTasks.length - panTasks.length} outside the pan phases (load and zoom), which §6.4 does not assert on`
        : undefined,
  })

  /* ── 7. heap ─────────────────────────────────────────────────────────────── */
  const delta = snapshot.heap.peakMb - snapshot.heap.baselineMb
  out.push({
    item: 7,
    name: "peak JS heap over baseline",
    value: snapshot.heap.supported
      ? `${fmt(delta, 1)} MB (peak ${fmt(snapshot.heap.peakMb, 1)}, baseline ${fmt(snapshot.heap.baselineMb, 1)})`
      : "not measured",
    budget: `low tens of MB — read as < ${HEAP_BUDGET_MB} MB`,
    pass: snapshot.heap.supported ? delta < HEAP_BUDGET_MB : null,
    note: snapshot.heap.supported
      ? undefined
      : "performance.memory is Chromium-only and absent here",
  })

  if (!context.unjudged || context.unjudged.length === 0) return out
  return out.map((row) =>
    context.unjudged!.includes(row.item)
      ? {
          ...row,
          pass: null,
          note: "not a result on this surface — the clock is virtual; see tools/fog-harness/perf-harness.js",
        }
      : row,
  )
}

function mark(pass: boolean | null): string {
  if (pass === null) return "  -- "
  return pass ? " PASS" : " FAIL"
}

/** The whole thing as one block of monospaced text, ready to read or paste into the ticket. */
export function formatReport(
  snapshot: PerfSnapshot,
  gpu: GpuTimerStats,
  context: ReportContext,
): string {
  const rows = verdicts(snapshot, gpu, context)
  const lines: string[] = []

  lines.push(`LOST SOLES — fog perf harness (0059) · 05-fog-of-war.md §6.4`)
  lines.push(
    `dataset ${context.dataset} (${n(context.cells)} cells) · ` +
      `viewport ${context.viewportW}x${context.viewportH} CSS px @ dpr ${context.devicePixelRatio}`,
  )
  lines.push(`renderer ${context.renderer ?? "(masked)"}`)
  lines.push(`ua ${context.userAgent}`)
  lines.push("")

  const nameWidth = Math.max(...rows.map((r) => r.name.length))
  const valueWidth = Math.max(...rows.map((r) => r.value.length))
  for (const row of rows) {
    lines.push(
      `${String(row.item).padStart(2)}  ${row.name.padEnd(nameWidth)}  ` +
        `${row.value.padEnd(valueWidth)}  ${mark(row.pass)}  ${row.budget}`,
    )
    if (row.note) lines.push(`    ${" ".repeat(nameWidth)}  ↳ ${row.note}`)
  }

  lines.push("")
  lines.push("frame time, per phase")
  for (const frame of snapshot.frames) {
    if (frame.samples === 0) {
      lines.push(`  ${frame.phase.padEnd(12)} no frames`)
      continue
    }
    lines.push(
      `  ${frame.phase.padEnd(12)} p50 ${fmt(frame.p50).padStart(6)}  p95 ${fmt(frame.p95).padStart(6)}  ` +
        `p99 ${fmt(frame.p99).padStart(6)}  max ${fmt(frame.max).padStart(7)}  ` +
        `${n(frame.samples).padStart(5)} frames  ~${fmt(frame.fps, 0)} fps`,
    )
  }

  lines.push("")
  lines.push("visibleInstanceCount, per zoom (item 1's histogram)")
  for (const bucket of snapshot.instances) {
    lines.push(
      `  z${String(bucket.zoom).padStart(2)}  res ${bucket.resAtMax}  ` +
        `max ${n(bucket.max).padStart(7)} at z${bucket.zoomAtMax.toFixed(2).padStart(5)}  ` +
        `${n(bucket.samples).padStart(4)} samples`,
    )
  }

  if (snapshot.derives.length > 0) {
    lines.push("")
    lines.push("bucket derivation (item 5)")
    for (const derive of snapshot.derives) {
      lines.push(
        `  ${derive.kind.padEnd(5)} res ${derive.res}  ` +
          `${n(derive.count).padStart(5)} x  max ${fmt(derive.maxMs).padStart(7)} ms  ` +
          `total ${fmt(derive.totalMs).padStart(8)} ms`,
      )
    }
  }

  lines.push("")
  lines.push("culls, per phase (item 4)")
  for (const cull of snapshot.culls) {
    const events = snapshot.cullsPerCameraEvent.find((p) => p.phase === cull.phase)
    lines.push(
      `  ${cull.phase.padEnd(12)} ${String(cull.culls).padStart(4)} culls / ` +
        `${String(events?.cameraEvents ?? 0).padStart(5)} camera events  ` +
        `net max ${fmt(cull.netMaxMs).padStart(7)} ms  net mean ${fmt(cull.netMeanMs).padStart(7)} ms  ` +
        `gross max ${fmt(cull.maxMs).padStart(7)} ms  derive inside ${fmt(cull.deriveInsideMs).padStart(8)} ms`,
    )
  }

  const failures = rows.filter((row) => row.pass === false)
  lines.push("")
  lines.push(
    failures.length === 0
      ? "VERDICT: every measured budget met."
      : `VERDICT: ${failures.length} budget(s) missed — ${failures.map((f) => f.name).join(", ")}. ` +
        `§6.4's kill criteria, in order: (a) mask scale 0.35x, (b) animation 20 fps, (c) fBm 2 octaves.`,
  )

  return lines.join("\n")
}
