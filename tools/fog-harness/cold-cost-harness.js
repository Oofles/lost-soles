// Ticket 0298 — what atlas's cold pass (D-391) costs on a REAL GPU, against the same view with the
// cold weight forced to 0.
//
// `0100` added pass 3: a full-frame `copyTexSubImage2D` of the ground under the fog, then a
// full-screen triangle with ~17 mask taps plus the composite's warp. SwiftShader cannot price a
// frame copy, so `0059`'s budget (05 §6.4 items 2 and 3, D-241) was never checked against it. This
// page answers it on real hardware: run-cold-cost.mjs opens it HEADED, on the host's GPU (WSLg's
// D3D12 backend on this machine), with a real requestAnimationFrame clock — not the virtual one the
// other harnesses use, which is exactly the clock that cannot answer a frame-time question.
//
// THE SHAPE OF THE MEASUREMENT
//
//   - 150k cells, every one last run a year ago: the ramp is saturated, so the whole revealed disc
//     is cold ground and the pass does its full work on every covered pixel. The worst case for the
//     shader, and the copy costs the same however much is cold.
//   - The shipped scripted `PATH` (690 camera states), driven one state per real animation frame.
//   - Arms interleaved COLD, OFF, COLD, OFF after one discarded warm-up, so bucket derivation and
//     shader compilation land in the warm-up and a thermal or compositor drift lands in both arms.
//     OFF is `{ ...ATLAS, coldWash: 0 }` — the layer then skips the pass outright, copy included
//     (mask-layer.ts), which is precisely "the same view with the cold weight forced to 0".
//   - A COPY-ONLY arm: the cold weight at 0 plus a tiny custom layer that does nothing but the same
//     full-frame copy into an RGB8 texture, timed on its own. It separates the copy from the shader,
//     which is the split any cheaper path (a half-resolution copy, skipping the copy) would act on.
//
// Bundled by run-cold-cost.mjs.
import * as maplibre from "maplibre-gl"

import { ATLAS } from "../../lib/fog/fog-uniforms.ts"
import { ExploredSet } from "../../lib/fog/explored-set.ts"
import { LastRunDays, todayDay } from "../../lib/fog/last-run.ts"
import { FogMaskLayer } from "../../lib/fog/mask-layer.ts"
import { driveScriptedPath, PATH } from "../../lib/fog/perf/camera-path.ts"
import { FogPerf } from "../../lib/fog/perf/collector.ts"
import { GpuTimer } from "../../lib/fog/perf/gpu-timer.ts"
import {
  COMPOSITE_BUDGET_MS,
  DROPPED_BUDGET_PCT,
  FRAME_BUDGET_MS,
  MASK_BUDGET_MS,
  PAN_PHASES,
} from "../../lib/fog/perf/report.ts"
import { PERF_ORIGIN } from "../../lib/fog/perf/synthetic.ts"
import { FogViewportController } from "../../lib/fog/viewport-controller.ts"
import { ZoomBucketStore } from "../../lib/fog/zoom-buckets.ts"

/** A year ago: past the ramp's asymptote (D-392 reaches 0.18 by month 9). */
const COLD_AGE_DAYS = 365

const OFF = { ...ATLAS, coldWash: 0 }

const map = new maplibre.Map({
  container: "map",
  // A solid ground. The copy's cost is a function of the buffer's size, not of what is in it, and a
  // tile-free style keeps the network out of a frame-time measurement.
  style: {
    version: 8,
    sources: {},
    layers: [{ id: "ground", type: "background", paint: { "background-color": "rgb(201, 211, 184)" } }],
  },
  center: [PERF_ORIGIN.lng, PERF_ORIGIN.lat],
  zoom: 14,
  attributionControl: false,
})

/** The layer is built once; each arm swaps the timer it reports to. */
let timer = new GpuTimer()
const timerProxy = {
  attach: (gl) => timer.attach(gl),
  begin: (label) => timer.begin(label),
  end: () => timer.end(),
}

/**
 * THE COPY ALONE. The same call `runColdPass` makes, at the same point in the frame (it is added
 * just below the fog, so the frame it copies is the ground), into the same RGB8 texture shape.
 */
const copyProbe = {
  id: "cold-cost-copy-probe",
  type: "custom",
  renderingMode: "2d",
  enabled: false,
  tex: null,
  w: 0,
  h: 0,
  onAdd() {},
  render(gl) {
    if (!this.enabled) return
    const w = gl.drawingBufferWidth
    const h = gl.drawingBufferHeight
    if (!this.tex) this.tex = gl.createTexture()
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, this.tex)
    if (this.w !== w || this.h !== h) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB8, w, h, 0, gl.RGB, gl.UNSIGNED_BYTE, null)
      this.w = w
      this.h = h
    }
    timerProxy.attach(gl)
    timerProxy.begin("copy-only")
    gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, w, h)
    timerProxy.end()
    gl.bindTexture(gl.TEXTURE_2D, null)
    gl.activeTexture(gl.TEXTURE0)
  },
}

function rendererString() {
  try {
    const gl = map.getCanvas().getContext("webgl2")
    const info = gl.getExtension("WEBGL_debug_renderer_info")
    return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)
  } catch {
    return null
  }
}

function setStatus(text) {
  document.getElementById("out").textContent = text
}

async function runArm(name, layer, controller, perfFor) {
  timer = new GpuTimer()
  const perf = perfFor()
  perf.start()
  const before = layer.stats().coldPasses
  await driveScriptedPath(map, perf, { gpuTimer: timer, path: PATH })
  // Results land several frames after their window closes; give the driver a few to finish.
  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => requestAnimationFrame(resolve))
    timer.poll()
  }
  perf.stop()
  const snapshot = perf.snapshot()
  return {
    name,
    coldPasses: layer.stats().coldPasses - before,
    frames: snapshot.frames,
    gpu: timer.stats(),
    controller,
  }
}

function pan(arm) {
  // The judged phases (D-241), pooled the way report.ts judges them: phase by phase.
  return arm.frames.filter((f) => PAN_PHASES.includes(f.phase))
}

function gpuMean(arm, label) {
  const pass = arm.gpu.passes.find((p) => p.label === label)
  return pass ? pass : null
}

function fmt(n, d = 2) {
  return Number.isFinite(n) ? n.toFixed(d) : "—"
}

map.on("load", async () => {
  try {
    const bytes = Uint8Array.from(atob(window.FOG_FIXTURE_B64), (c) => c.charCodeAt(0))
    const set = ExploredSet.fromBlob(bytes)
    const cells = set.cells
    const today = todayDay(Date.now())
    const days = new Uint16Array(cells.length).fill(today - COLD_AGE_DAYS)
    const lastRun = new LastRunDays(cells, days, 1)

    const store = new ZoomBucketStore(set)
    store.setLastRun(lastRun)
    const layer = new FogMaskLayer({ timeSource: () => 3.25, timer: timerProxy, palette: ATLAS })
    map.addLayer(copyProbe)
    map.addLayer(layer)

    let perf = null
    const controller = new FogViewportController({
      map,
      store,
      // Captured once by the controller, so it delegates to whichever arm's collector is current.
      observer: {
        cameraEvent: () => perf?.cameraEvent(),
        cullStart: () => perf?.cullStart(),
        cullEnd: (result) => perf?.cullEnd(result),
      },
      onInstances: (instances, _result, res, fromData) =>
        layer.setInstances(instances, res, { supersedesRoute: fromData }),
    })
    controller.start()
    const perfFor = () => {
      perf = new FogPerf()
      return perf
    }

    const plan = [
      ["warm-up", ATLAS, false],
      ["cold", ATLAS, false],
      ["off", OFF, false],
      ["cold", ATLAS, false],
      ["off", OFF, false],
      ["copy-only", OFF, true],
    ]
    const arms = []
    for (const [i, [name, palette, probe]] of plan.entries()) {
      setStatus(`running ${i + 1}/${plan.length}: ${name}`)
      layer.setPalette(palette)
      copyProbe.enabled = probe
      map.jumpTo({ center: [PERF_ORIGIN.lng, PERF_ORIGIN.lat], zoom: 14 })
      arms.push(await runArm(name, layer, controller, perfFor))
    }
    controller.stop()

    const gl = map.getCanvas().getContext("webgl2")
    const lines = []
    const fails = []
    lines.push(`renderer       ${rendererString()}`)
    lines.push(`maplibre       ${maplibre.getVersion()}`)
    lines.push(
      `viewport       ${map.getCanvas().clientWidth}x${map.getCanvas().clientHeight} CSS px, ` +
        `DPR ${window.devicePixelRatio}, drawing buffer ${gl.drawingBufferWidth}x${gl.drawingBufferHeight}`,
    )
    lines.push(`dataset        ${set.size} cells, every one last run ${COLD_AGE_DAYS} days ago`)
    lines.push(`timer          ${arms[1].gpu.supported ? "EXT_disjoint_timer_query_webgl2" : arms[1].gpu.reason}`)
    lines.push("")
    lines.push("arm        cold passes   GPU mask ms     GPU composite ms   GPU cold ms       GPU copy-only ms  disjoint")
    lines.push("                         mean / max      mean / max         mean / max        mean / max")
    for (const arm of arms) {
      const cell = (label) => {
        const p = gpuMean(arm, label)
        return p ? `${fmt(p.meanMs, 3)} / ${fmt(p.maxMs, 3)}`.padEnd(18) : "—".padEnd(18)
      }
      lines.push(
        `${arm.name.padEnd(10)} ${String(arm.coldPasses).padEnd(13)} ${cell("mask").padEnd(15)} ` +
          `${cell("composite")} ${cell("cold")} ${cell("copy-only")}${arm.gpu.disjoint}`,
      )
    }
    lines.push("")
    lines.push("frame time, rAF deltas (D-241: p50 <= 17 ms and < 1% of frames over 1.5x p50, on the pan phases)")
    lines.push("arm        phase        n     p50     p95     p99     max     dropped")
    for (const arm of arms) {
      for (const f of arm.frames) {
        lines.push(
          `${arm.name.padEnd(10)} ${f.phase.padEnd(12)} ${String(f.samples).padEnd(5)} ` +
            `${fmt(f.p50).padStart(6)}  ${fmt(f.p95).padStart(6)}  ${fmt(f.p99).padStart(6)}  ` +
            `${fmt(f.max).padStart(6)}  ${f.dropped} (${fmt(f.droppedPct, 1)}%)`,
        )
      }
    }

    // THE VERDICT, on the measured arms only (the warm-up pays derivation and compilation).
    for (const arm of arms.slice(1)) {
      if (arm.name === "cold" && arm.coldPasses === 0) fails.push(`${arm.name}: the cold pass never ran`)
      if (arm.name !== "cold" && arm.coldPasses !== 0) fails.push(`${arm.name}: the cold pass ran ${arm.coldPasses} times`)
      for (const f of pan(arm)) {
        if (f.p50 > FRAME_BUDGET_MS) fails.push(`${arm.name} ${f.phase}: p50 ${fmt(f.p50)} ms > ${FRAME_BUDGET_MS}`)
        if (f.droppedPct >= DROPPED_BUDGET_PCT) {
          fails.push(`${arm.name} ${f.phase}: ${fmt(f.droppedPct, 1)}% dropped >= ${DROPPED_BUDGET_PCT}%`)
        }
      }
      const mask = gpuMean(arm, "mask")
      const composite = gpuMean(arm, "composite")
      if (mask && mask.meanMs > MASK_BUDGET_MS) fails.push(`${arm.name}: GPU mask ${fmt(mask.meanMs, 3)} ms > ${MASK_BUDGET_MS}`)
      if (composite && composite.meanMs > COMPOSITE_BUDGET_MS) {
        fails.push(`${arm.name}: GPU composite ${fmt(composite.meanMs, 3)} ms > ${COMPOSITE_BUDGET_MS}`)
      }
    }
    const head = fails.length === 0 ? "COLD COST PASS" : `COLD COST FAIL (${fails.length})`
    setStatus([head, ...fails.map((f) => `  x ${f}`), "", ...lines].join("\n"))
    document.title = head
  } catch (error) {
    setStatus(`COLD COST FAIL (1)\n  x ${error && error.stack ? error.stack : String(error)}`)
    document.title = "COLD COST FAIL"
  }
})
