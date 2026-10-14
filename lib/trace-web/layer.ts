import type { WebFeatureCollection } from "./web"

/**
 * THE PERMANENT TRACE LAYER ON THE MAP. Ticket `0085`, D-299. `06-ui-ux.md` §3.5 rule 2.
 *
 * ─── WHERE IT SITS ──────────────────────────────────────────────────────────
 *
 * Criterion 1: *"beneath the run polyline and above the basemap"*. Precisely: above the basemap's
 * roads and ground, BELOW its labels, and so below the fog (which sits above every label,
 * `lib/map-layers.ts` rule 1) and the route (above the fog, rule 2). Below the labels because the
 * web runs along the very streets whose names it would otherwise strike through — and legibility
 * beats atmosphere (D-051). Below the fog costs nothing: every past route is on revealed ground.
 *
 * ─── ONE OPACITY, TWO FACTORS ───────────────────────────────────────────────
 *
 * Each feature's `wear` is its own paint (`web.ts`). The layer multiplies it by one scalar, `k`, so
 * beat 1 can cross-fade the web as it was before this run into the web with it, without touching
 * any feature's data mid-beat.
 */

export const TRACE_SOURCE_ID = "trace-web"
export const TRACE_LAYER_ID = "trace-web"
/** Beat 1's copy of the web without this run (`installWebBeat`). */
export const TRACE_BEFORE_SOURCE_ID = "trace-web-before"
export const TRACE_BEFORE_LAYER_ID = "trace-web-before"
/** Beat 1's ink on a run with no new ground: the route joining the web. */
export const TRACE_INK_SOURCE_ID = "trace-ink"
export const TRACE_INK_LAYER_ID = "trace-ink"

export const TRACE_LINE_TOKEN = "--trace-line"

/** Thin: a record, not a route. The run's own core is 2.5 px; this is the faint line beneath it. */
export const TRACE_WIDTH = 2
export const TRACE_LAYOUT = { "line-cap": "round", "line-join": "round" } as const

export const traceOpacity = (k: number) => ["*", k, ["get", "wear"]]

export function tracePaint(color: string, k = 1) {
  return { "line-color": color, "line-width": TRACE_WIDTH, "line-opacity": traceOpacity(k) }
}

export function traceColorFrom(read: (token: string) => string): string {
  const color = read(TRACE_LINE_TOKEN).trim()
  if (!color) throw new Error(`app/tokens.css defines no ${TRACE_LINE_TOKEN} (ticket 0085).`)
  return color
}

export function documentTraceColor(): string {
  const computed = getComputedStyle(document.documentElement)
  return traceColorFrom((t) => computed.getPropertyValue(t))
}

/** The slice of MapLibre's `Map` these touch. Structural, so a test drives it with a plain object. */
export interface TraceHost {
  getLayer(id: string): unknown
  getSource(id: string): unknown
  addSource(id: string, source: unknown): void
  addLayer(layer: unknown, beforeId?: string): void
  removeLayer(id: string): void
  removeSource(id: string): void
  setPaintProperty(layer: string, name: string, value: unknown): void
  getStyle(): { layers?: ReadonlyArray<{ id: string; type: string }> } | undefined
}

/** The first label layer, which every trace layer goes under. `undefined`: no labels, so on top. */
export function traceBeforeId(host: Pick<TraceHost, "getStyle">): string | undefined {
  return host.getStyle()?.layers?.find((l) => l.type === "symbol")?.id
}

function lineLayer(id: string, source: string, color: string, k = 1) {
  return { id, type: "line" as const, source, layout: { ...TRACE_LAYOUT }, paint: tracePaint(color, k) }
}

/** Add the web, or replace its data. */
export function setTraceWeb(host: TraceHost, data: WebFeatureCollection, color: string): void {
  const existing = host.getSource(TRACE_SOURCE_ID) as { setData?: (d: unknown) => void } | undefined
  if (existing) {
    existing.setData?.(data)
    return
  }
  host.addSource(TRACE_SOURCE_ID, { type: "geojson", data })
  host.addLayer(lineLayer(TRACE_LAYER_ID, TRACE_SOURCE_ID, color), traceBeforeId(host))
}

/** Criterion 1 as a predicate over a style's layer list. */
export function traceIsBetweenBasemapAndRoute(layers: ReadonlyArray<{ id: string; type: string }>): boolean {
  const at = (id: string) => layers.findIndex((l) => l.id === id)
  const trace = at(TRACE_LAYER_ID)
  const firstSymbol = layers.findIndex((l) => l.type === "symbol")
  const route = at("run-glow")
  return trace > 0 && (firstSymbol === -1 || trace < firstSymbol) && (route === -1 || trace < route)
}

/**
 * BEAT 1'S WEB: before this run, then with it. The steady-state layer holds the web WITH this run
 * (`use-trace-web`); for the beat it is held at `k = 0` and a second layer of the web without it
 * shows instead. `crossfade(s)` moves `s` from 0 to 1 — before fading out as after fades in — and
 * `remove` leaves the steady state exactly as it was.
 */
export interface WebBeat {
  /** Called every frame: the steady-state layer can arrive mid-beat, from its own effect. */
  crossfade(s: number): void
  remove(): void
}

export function installWebBeat(host: TraceHost, before: WebFeatureCollection, color: string): WebBeat {
  host.addSource(TRACE_BEFORE_SOURCE_ID, { type: "geojson", data: before })
  host.addLayer(lineLayer(TRACE_BEFORE_LAYER_ID, TRACE_BEFORE_SOURCE_ID, color), traceBeforeId(host))
  let last = -1
  let removed = false
  const apply = (s: number) => {
    if (host.getLayer(TRACE_LAYER_ID)) host.setPaintProperty(TRACE_LAYER_ID, "line-opacity", traceOpacity(s))
    host.setPaintProperty(TRACE_BEFORE_LAYER_ID, "line-opacity", traceOpacity(1 - s))
  }
  return {
    crossfade(s) {
      if (removed) return
      // Re-applied while waiting at 0: the steady layer may have just been added at full strength.
      if (s === last && s !== 0) return
      last = s
      apply(s)
    },
    remove() {
      if (removed) return
      removed = true
      try {
        if (host.getLayer(TRACE_BEFORE_LAYER_ID)) host.removeLayer(TRACE_BEFORE_LAYER_ID)
        if (host.getSource(TRACE_BEFORE_SOURCE_ID)) host.removeSource(TRACE_BEFORE_SOURCE_ID)
        if (host.getLayer(TRACE_LAYER_ID)) host.setPaintProperty(TRACE_LAYER_ID, "line-opacity", traceOpacity(1))
      } catch {
        // The map is already gone.
      }
    },
  }
}
