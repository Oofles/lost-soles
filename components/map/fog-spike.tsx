"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import { basemapStyle, registerPmtilesProtocol } from "@/lib/basemap"
import { spikeField, spikeProbe, SPIKE_CENTRE } from "@/lib/fog/spike-cells"
import {
  createResources,
  detectCapabilities,
  disposeResources,
  formatVerdict,
  judgeProbe,
  overallVerdict,
  resizeMask,
  runBlitPass,
  runMaskPass,
  type Capabilities,
  type MaskResources,
  type ProjectionLike,
  type SpikeVerdict,
} from "@/lib/fog/spike-mask"

import "maplibre-gl/dist/maplibre-gl.css"

/**
 * THROWAWAY. Ticket `0118` — the go/no-go spike for `05-fog-of-war.md` §4, deleted at
 * the ticket's close. `0055` rebuilds the mask pass properly.
 *
 * This route exists because the question cannot be answered anywhere else. §9.6 names
 * the unvalidated assumption — `MAX` blending against `R8` via ANGLE — and the only
 * instrument that can answer it is a browser on a real GPU. `tools/spike-harness` proves
 * the logic headless on SwiftShader; this proves the driver.
 *
 * IT IS NOT A REFACTOR OF `map-shell.tsx` AND MUST NOT BECOME ONE. The duplication of
 * the worker URL, the pmtiles registration and the WebGL2 check is deliberate: this file
 * is deleted in a few days and a shared helper extracted for its benefit would outlive
 * it, carrying a spike's shape into `0055`.
 */

type MapLibre = typeof import("maplibre-gl")
type MapInstance = import("maplibre-gl").Map
type CustomLayer = import("maplibre-gl").CustomLayerInterface
type RenderInput = import("maplibre-gl").CustomRenderMethodInput

/** Median, not mean. One GC pause should not be allowed to describe the frame rate. */
function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

type VerdictPatch = Partial<SpikeVerdict>

/**
 * §4.2's two passes as a MapLibre custom layer.
 *
 * RESOURCES ARE BUILT IN `prerender`, NOT `onAdd`, and that is forced rather than
 * chosen: the vertex shader needs `shaderData.vertexShaderPrelude`, which only exists
 * on the render-method input. `onAdd` receives the context and nothing else. The
 * prelude also changes with the projection — `variantName` is MapLibre's own cache key
 * for exactly this — so a changed variant rebuilds rather than silently rendering with
 * a shader compiled for the other projection.
 */
class SpikeLayer implements CustomLayer {
  readonly id = "fog-spike"
  readonly type = "custom" as const
  readonly renderingMode = "2d" as const

  private resources: MaskResources | null = null
  private variant: string | null = null
  private gl: WebGL2RenderingContext | null = null
  private capabilities: Capabilities | null = null
  private lastFrameAt: number | null = null
  private frames: number[] = []

  /** Set by `requestProbe`, cleared once the probe has actually run a frame. */
  private probePending = true

  private readonly field = spikeField()
  private readonly probe = spikeProbe()

  constructor(private readonly report: (patch: VerdictPatch) => void) {}

  requestProbe(): void {
    this.probePending = true
  }

  onAdd(_map: MapInstance, gl: WebGL2RenderingContext): void {
    this.gl = gl
    this.capabilities = detectCapabilities(gl)
    this.report({ capabilities: this.capabilities, instances: this.field.length / 4 })
  }

  onRemove(_map: MapInstance, gl: WebGL2RenderingContext): void {
    if (this.resources) disposeResources(gl, this.resources)
    this.resources = null
    this.variant = null
  }

  prerender(gl: WebGL2RenderingContext, options: RenderInput): void {
    const { vertexShaderPrelude, define, variantName } = options.shaderData

    if (this.resources && this.variant !== variantName) {
      disposeResources(gl, this.resources)
      this.resources = null
    }

    if (!this.resources) {
      try {
        this.resources = createResources(gl, {
          prelude: vertexShaderPrelude,
          define,
          field: this.field,
          probe: this.probe,
          width: gl.drawingBufferWidth,
          height: gl.drawingBufferHeight,
        })
        this.variant = variantName
        this.probePending = true
        this.report({ shaderError: null })
      } catch (error) {
        // A driver-specific compile failure IS the finding. Surface it verbatim and
        // stop trying every frame, which would otherwise bury it in a console flood.
        this.report({ shaderError: error instanceof Error ? error.message : String(error) })
        this.variant = variantName
        return
      }
    }

    resizeMask(gl, this.resources, gl.drawingBufferWidth, gl.drawingBufferHeight)

    const wantProbe = this.probePending
    const result = runMaskPass(gl, this.resources, options.defaultProjectionData as ProjectionLike, {
      probe: wantProbe,
    })

    if (wantProbe) {
      this.probePending = false
      this.report({
        probe: result.probe ? judgeProbe(result.probe) : null,
        readPath: result.probe?.readPath ?? null,
        restore: result.restore,
        glError: result.glError,
        maskSize: `${this.resources.maskW}×${this.resources.maskH}`,
      })
    }
  }

  render(gl: WebGL2RenderingContext): void {
    if (!this.resources) return
    runBlitPass(gl, this.resources)

    const now = performance.now()
    if (this.lastFrameAt !== null) {
      this.frames.push(now - this.lastFrameAt)
      if (this.frames.length > 60) this.frames.shift()
    }
    this.lastFrameAt = now
  }

  /** Read by a timer rather than reported per frame — 60 reports a second is not evidence. */
  frameMs(): number | null {
    return median(this.frames)
  }
}

const shell: React.CSSProperties = { position: "fixed", inset: 0, height: "100dvh", width: "100%" }

const panel: React.CSSProperties = {
  position: "fixed",
  top: "0.5rem",
  left: "0.5rem",
  right: "0.5rem",
  maxHeight: "52dvh",
  overflow: "auto",
  zIndex: 2,
  padding: "0.75rem 1rem",
  background: "var(--surface)",
  color: "var(--text-primary)",
  border: "1px solid var(--line)",
  borderRadius: "0.5rem",
  font: "500 11px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace",
  whiteSpace: "pre-wrap",
  boxShadow: "0 2px 12px var(--line)",
}

const EMPTY: SpikeVerdict = {
  capabilities: null,
  instances: 0,
  maskSize: "—",
  probe: null,
  readPath: null,
  restore: null,
  glError: null,
  shaderError: null,
  userAgent: "",
  devicePixelRatio: 1,
  frameMs: null,
}

export function FogSpike() {
  const container = useRef<HTMLDivElement | null>(null)
  const map = useRef<MapInstance | null>(null)
  const layer = useRef<SpikeLayer | null>(null)
  const [verdict, setVerdict] = useState<SpikeVerdict>(EMPTY)
  const [installed, setInstalled] = useState(true)
  const [unsupported, setUnsupported] = useState(false)

  const patch = useCallback((next: VerdictPatch) => {
    setVerdict((previous) => ({
      ...previous,
      ...next,
      userAgent: navigator.userAgent,
      devicePixelRatio: window.devicePixelRatio,
    }))
  }, [])

  useEffect(() => {
    try {
      if (document.createElement("canvas").getContext("webgl2") === null) {
        setUnsupported(true)
        return
      }
    } catch {
      setUnsupported(true)
      return
    }

    let disposed = false

    void (async () => {
      const lib: MapLibre = await import("maplibre-gl")
      if (disposed || !container.current) return

      // Both as in map-shell.tsx, and for the reasons documented there at length:
      // MapLibre 6 derives its worker URL from import.meta.url, which webpack inlines
      // as a file:// path, and without this the map renders its background and nothing
      // else.
      lib.setWorkerUrl("/maplibre/maplibre-gl-worker.js")
      registerPmtilesProtocol(lib)

      const instance = new lib.Map({
        container: container.current,
        style: basemapStyle(),
        // The spike's own coordinate, never the operator's home — see spike-cells.ts.
        center: [SPIKE_CENTRE.lng, SPIKE_CENTRE.lat],
        zoom: 14,
        pixelRatio: Math.min(window.devicePixelRatio, 2),
        attributionControl: { compact: false },
      })
      map.current = instance

      instance.on("load", () => {
        if (disposed) return
        const spike = new SpikeLayer(patch)
        layer.current = spike
        instance.addLayer(spike)
      })

      // The probe runs on the first frame AFTER the camera settles. Before `idle` the
      // first frames can be mid-transition, which would land the probe discs off the
      // mask and report "nothing-drawn" — a false NO-GO, and the worst possible
      // failure for a ticket whose output is a go/no-go.
      instance.on("idle", () => layer.current?.requestProbe())
    })()

    return () => {
      disposed = true
      map.current?.remove()
      map.current = null
      layer.current = null
    }
  }, [patch])

  // Frame time, sampled rather than reported per frame.
  useEffect(() => {
    const timer = window.setInterval(() => {
      const frameMs = layer.current?.frameMs() ?? null
      setVerdict((previous) => (previous.frameMs === frameMs ? previous : { ...previous, frameMs }))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [])

  // The tab title carries the verdict, so `--dump-dom` and a glance at the tab both
  // answer the ticket without scrolling the panel.
  useEffect(() => {
    document.title = `0118 ${overallVerdict(verdict)}`
  }, [verdict])

  const toggle = useCallback(() => {
    const instance = map.current
    if (!instance) return
    if (installed) {
      instance.removeLayer("fog-spike")
      layer.current = null
      setInstalled(false)
    } else {
      const spike = new SpikeLayer(patch)
      layer.current = spike
      instance.addLayer(spike)
      setInstalled(true)
    }
  }, [installed, patch])

  if (unsupported) {
    return (
      <div style={{ ...shell, padding: "2rem", color: "var(--text-primary)" }}>
        NO-GO. This browser has no WebGL2 context at all, so neither MapLibre 6 nor the
        fog can run here (§9.6: there is no WebGL1 fallback path).
      </div>
    )
  }

  return (
    <>
      <div ref={container} style={shell} data-testid="fog-spike-map" />
      <div style={panel}>
        <div style={{ display: "flex", gap: "0.75rem", marginBottom: "0.5rem" }}>
          <button type="button" onClick={() => layer.current?.requestProbe()} disabled={!installed}>
            re-run MAX probe
          </button>
          {/* Criterion 4 — "the basemap renders unchanged with the layer installed" is
              not answerable from memory. This makes it an A/B. */}
          <button type="button" onClick={toggle}>
            {installed ? "remove the fog layer" : "install the fog layer"}
          </button>
        </div>
        <div data-testid="fog-spike-verdict">{formatVerdict(verdict)}</div>
      </div>
    </>
  )
}

export default FogSpike
