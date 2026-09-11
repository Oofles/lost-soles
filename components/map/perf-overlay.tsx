"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { perfDataset } from "@/lib/fog/debug-flags"
import type { FogMaskLayer } from "@/lib/fog/mask-layer"
import { driveScriptedPath, PATH_STEPS, type PathMap } from "@/lib/fog/perf/camera-path"
import { FIXTURE_CENTRE, parsePerfDataset } from "@/lib/fog/perf/dataset-source"
import type { FogHarness } from "@/lib/fog/perf/harness"
import { formatReport, type ReportContext } from "@/lib/fog/perf/report"

import { useExplored } from "./explored-provider"

/**
 * `?fog=perf` — THE HARNESS, ON SCREEN. Ticket `0059` criterion 1. `05-fog-of-war.md` §6.4.
 *
 * *"All seven instruments above exist behind a debug flag and print a single summary table."*
 *
 * ─── A BUTTON, NOT AN AUTORUN ──────────────────────────────────────────────
 *
 * The run starts on a tap. An autorun would begin while the basemap is still fetching its first
 * tiles, and MapLibre's tile decode is exactly the kind of main-thread work item 6 would then report
 * as a long task during `pan-across` — a red cell caused by the harness having started too early.
 * It also matters on the phone: the operator is outdoors, and a measurement that begins before they
 * are looking at it is a measurement they have to take twice.
 *
 * ─── WHAT THE OPERATOR'S JOB IS ────────────────────────────────────────────
 *
 * Open the URL, tap **Run**, wait, read the last line. D-230 argued for exactly this shape when it
 * deferred the ANGLE question here: *"a deferred risk with a two-second check attached is a different
 * thing from a deferred risk with a procedure attached."* Everything the ticket asks to be recorded
 * is in the one block of text, and **Copy** puts it on the clipboard so it can be pasted into the
 * ticket rather than transcribed from a photograph of a phone.
 */

const panel: React.CSSProperties = {
  position: "fixed",
  inset: "auto 0 0 0",
  zIndex: 3,
  maxHeight: "60dvh",
  overflow: "auto",
  padding: ".75rem",
  borderTop: "1px solid var(--line)",
  background: "var(--surface)",
  color: "var(--text-primary)",
  font: "400 .7rem/1.45 ui-monospace, monospace",
}

const bar: React.CSSProperties = {
  display: "flex",
  gap: ".5rem",
  alignItems: "center",
  flexWrap: "wrap",
  marginBottom: ".5rem",
}

const button: React.CSSProperties = {
  padding: ".4rem .9rem",
  borderRadius: ".375rem",
  border: "1px solid var(--line)",
  background: "var(--bg)",
  color: "var(--text-primary)",
  font: "500 .8rem/1 system-ui, sans-serif",
}

/**
 * The unmasked GPU string, which D-230 wants recorded alongside the numbers: the residual risk it
 * deferred to this ticket is *"Qualcomm/Mali ANGLE honouring MIN/MAX into a single-channel normalised
 * target"*, and a result with no renderer name attached cannot answer which driver it was measured on.
 *
 * `WEBGL_debug_renderer_info` is restricted in some configurations and returns null rather than
 * throwing; the report prints "(masked)" rather than inventing one.
 */
function rendererString(canvas: HTMLCanvasElement | null): string | null {
  if (!canvas) return null
  try {
    const gl = canvas.getContext("webgl2")
    if (!gl) return null
    const info = gl.getExtension("WEBGL_debug_renderer_info")
    if (!info) return gl.getParameter(gl.RENDERER) as string
    return gl.getParameter(info.UNMASKED_RENDERER_WEBGL) as string
  } catch {
    return null
  }
}

/** How long a gap between steps stops being "slow" and starts being worth saying out loud. */
const STALL_MS = 8_000

/**
 * ONE LINE THAT DISTINGUISHES SLOW FROM STUCK, which the button alone cannot.
 *
 * The path is 690 camera states and each step costs whatever cull it triggers, so several minutes is
 * a legitimate outcome on a slow device with a large dataset — and so is a hung promise. Reporting
 * the step count, the elapsed time AND the gap since the last step makes the difference readable at
 * a glance instead of requiring a reload to find out.
 */
function progressLine(
  progress: { phase: string; step: number } | null,
  startedAt: number,
  lastStepAt: number,
  wasHidden: boolean,
): string {
  const now = performance.now()
  const elapsed = `${((now - startedAt) / 1000).toFixed(0)}s elapsed`
  if (wasHidden) {
    return (
      `${progress ? `${progress.phase} — ${progress.step} / ${PATH_STEPS}` : "starting"} · ${elapsed}
` +
      `this tab was backgrounded, which stops requestAnimationFrame — the path pauses there and ` +
      `resumes on return. Measurements taken across that gap are not comparable; run it again.`
    )
  }
  if (!progress) return `starting — decoding and the first cull · ${elapsed}`
  const since = now - lastStepAt
  const line = `${progress.phase} — ${progress.step} / ${PATH_STEPS} frames · ${elapsed}`
  return since > STALL_MS
    ? `${line}
no frame for ${(since / 1000).toFixed(0)}s. Still running, but a single step is ` +
        `taking that long — see ticket 0202. Cancel keeps the samples taken so far.`
    : line
}

export function PerfOverlay({
  map,
  layer,
  harness,
}: {
  map: import("maplibre-gl").Map | null
  layer: FogMaskLayer | null
  harness: FogHarness | null
}) {
  const explored = useExplored()
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<{ phase: string; step: number } | null>(null)
  const [report, setReport] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const started = useRef(false)
  const cancelled = useRef(false)
  /**
   * WHEN THE LAST STEP LANDED, AND WHEN THE RUN BEGAN — so the panel can tell SLOW from STUCK.
   *
   * The first time this was run on a real device it sat on `running…` and there was no way to tell
   * which it was: the path is 690 camera states and a step is only as fast as the cull it triggers,
   * so minutes is a legitimate outcome — and so is a hung promise. A button that says the same thing
   * in both cases is a button that gets reloaded past, taking every sample with it.
   */
  const startedAt = useRef(0)
  const lastStepAt = useRef(0)
  const [, setTick] = useState(0)

  const flag = useMemo(
    () => (typeof window === "undefined" ? null : perfDataset(window.location.search)),
    [],
  )
  const parsed = flag ? parsePerfDataset(flag) : null

  /** The long-task observer runs for the whole session, not only during the path. */
  useEffect(() => {
    if (!harness) return
    return harness.perf.start()
  }, [harness])

  /**
   * A once-a-second repaint while the path runs, purely so the elapsed clock and the stall warning
   * below are live. `setProgress` already re-renders on every step — which is exactly the case this
   * has to cover, because a stalled run produces no steps and therefore no re-renders.
   */
  useEffect(() => {
    if (!running) return
    const id = window.setInterval(() => setTick((n) => n + 1), 1000)
    return () => window.clearInterval(id)
  }, [running])

  /**
   * `requestAnimationFrame` DOES NOT FIRE IN A HIDDEN TAB, so the path stops dead the moment the
   * phone locks, the browser is backgrounded, or the operator switches apps — and resumes when it
   * comes back. That is correct behaviour and it is indistinguishable from a hang unless it is said
   * out loud, which is what this is for. It also matters for the numbers: `FogAnimator` and the
   * controller both stop on `visibilitychange` (§6.2's hidden switch), so nothing is being measured
   * while away.
   */
  const [wasHidden, setWasHidden] = useState(false)
  useEffect(() => {
    if (!running) return
    const onVisibility = () => {
      if (document.hidden) setWasHidden(true)
    }
    document.addEventListener("visibilitychange", onVisibility)
    return () => document.removeEventListener("visibilitychange", onVisibility)
  }, [running])

  const run = useCallback(async () => {
    if (!map || !layer || !harness || !parsed || started.current) return
    started.current = true
    cancelled.current = false
    startedAt.current = performance.now()
    lastStepAt.current = performance.now()
    setRunning(true)
    setReport(null)
    setError(null)
    setWasHidden(false)

    const pathMap = map as unknown as PathMap
    harness.timer.clear()

    /**
     * EVERYTHING FROM HERE IS INSIDE try/finally, AND THE ABSENCE OF THAT WAS A REAL BUG.
     *
     * `run` is async and the click handler discards its promise, so anything that threw mid-path
     * rejected unhandled: `setRunning(false)` never ran, `started.current` stayed true, and the
     * button read `running…` for ever with no message anywhere. The operator's report was exactly
     * that sentence. A harness whose failure mode is silence is worse than no harness, because it
     * costs a trip to find out.
     */
    try {

    /**
     * THE FIXTURE IS SOMEWHERE ELSE, so a fixture run has to fly there first — and the flight is
     * OUTSIDE the measured path, in the `load` phase, because a 12,000 km jump is a tile fetch for
     * every layer in the style and nothing about it is a frame-time measurement.
     *
     * `here` skips this: its whole point is that the camera is already over ground the basemap has.
     */
      harness.perf.beginPhase("load")
      if (parsed.here) {
        pathMap.jumpTo({ center: pathMap.getCenter(), zoom: 14 })
      } else {
        pathMap.jumpTo({ center: { ...FIXTURE_CENTRE }, zoom: 14 })
      }
      // One second of real frames so the first cull, the first cold bucket and the basemap's first
      // tiles all land inside `load` rather than at the top of `settle`.
      await new Promise((resolve) => setTimeout(resolve, 1000))

      await driveScriptedPath(pathMap, harness.perf, {
        gpuTimer: harness.timer,
        shouldStop: () => cancelled.current,
        onProgress: ({ phase, step }) => {
          lastStepAt.current = performance.now()
          setProgress({ phase, step })
        },
      /**
       * §6.4 item 1, sampled per FRAME rather than per rebuild — and the difference matters for the
       * histogram. The count only changes when the buffer is rebuilt, but the *zoom it is drawn at*
       * changes every frame of a pinch, and during the 250 ms debounce the previous bucket's
       * instances are genuinely on screen at the new zoom. Per-rebuild sampling would record seven
       * points across a twelve-level zoom and miss exactly the transient §6.2's header warns about.
       */
        onSample: () => {
          const stats = layer.stats()
          harness.perf.instances(pathMap.getZoom(), stats.visibleInstanceCount, stats.res)
        },
      })

      const canvas = map.getCanvas()
      const context: ReportContext = {
        dataset:
          `${parsed.here ? `${parsed.dataset.label} @ here` : parsed.dataset.label}` +
          (cancelled.current ? " — CANCELLED PART-WAY, the path did not finish" : ""),
        cells: explored.set?.size ?? parsed.dataset.cells,
        viewportW: canvas.clientWidth,
        viewportH: canvas.clientHeight,
        devicePixelRatio: window.devicePixelRatio,
        userAgent: navigator.userAgent,
        renderer: rendererString(canvas),
      }
      /**
       * REPORTED EVEN ON A CANCEL, and the header says so. A partial run still carries every sample
       * taken before the stop, and on a device slow enough that someone reached for Cancel those are
       * the most interesting samples anyone has.
       */
      const text = formatReport(harness.perf.snapshot(), harness.timer.stats(), context)
      setReport(text)
      console.log(text)
    } catch (caught) {
      const message = caught instanceof Error ? (caught.stack ?? caught.message) : String(caught)
      setError(message)
      console.error("fog perf: the scripted path threw", caught)
    } finally {
      // `finally`, so a throw cannot strand the button. This is the half that was missing.
      setRunning(false)
      setProgress(null)
      started.current = false
    }
  }, [map, layer, harness, parsed, explored.set])

  if (!flag || !harness) return null

  const ready = explored.phase === "ready" && !!layer

  return (
    <div style={panel} data-testid="fog-perf-overlay">
      <div style={bar}>
        <strong>fog perf · 0059</strong>
        <span>{flag}</span>
        <button style={button} onClick={() => void run()} disabled={!ready || running}>
          {running ? "running…" : report || error ? "Run again" : "Run scripted path"}
        </button>
        {running && (
          <button
            style={button}
            onClick={() => {
              cancelled.current = true
            }}
          >
            Cancel
          </button>
        )}
        {report && (
          <button
            style={button}
            onClick={() => {
              void navigator.clipboard?.writeText(report).then(() => setCopied(true))
            }}
          >
            {copied ? "copied" : "Copy"}
          </button>
        )}
      </div>

      {/*
        ALWAYS ON SCREEN, NOT ONLY WHILE LOADING. It used to render under `!ready` and disappear the
        moment the dataset arrived — which is precisely when it starts mattering.

        `?fog=perf:here` puts 49,537 to 500,617 cells of SYNTHETIC solid ground over the operator's
        own neighbourhood, on the phone, outdoors. Nobody has run that. With the line hidden there is
        nothing on screen to say so, and a page whose fog is indistinguishable from real territory is
        a page the operator can mistake for their own map — the exact confusion `FogSource:
        "synthetic"` was added to `boot.ts` to prevent. `MaskHud` carries the same word but only
        under `?fog=mask` or `?fog=noise`, which is a different URL.

        Found by `tools/fog-harness/run-overlay.mjs` on its first green run.
      */}
      <div>{explored.message ?? `explored set: ${explored.phase}`}</div>
      {running && <div>{progressLine(progress, startedAt.current, lastStepAt.current, wasHidden)}</div>}
      {error && (
        <pre style={{ margin: 0, whiteSpace: "pre-wrap", color: "var(--text-primary)" }}>
          {`the scripted path threw — this is a bug in the harness, not a measurement

${error}`}
        </pre>
      )}
      {report && <pre style={{ margin: 0, whiteSpace: "pre" }}>{report}</pre>}
    </div>
  )
}
