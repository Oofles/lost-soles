import { WEAR, type WebFeatureCollection } from "./web"

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

/**
 * `0101`. THE SETTLED k, PER MAP. `1` on `/`; on `/run/:id` the web dims beneath the selected run
 * so a path run once reads 0.18 (`06` §4.5): `k = 0.18 / WEAR[0]`, a proportional dim, so ground
 * run more often stays proportionally darker (D-299's steps survive the dim).
 *
 * Held here, per host, rather than passed to each call, because two callers write the web's
 * opacity — the steady layer (`use-trace-web`) and beat 1 (`installWebBeat`) — and both must land
 * on the same number. Beat 1 cross-fades within it and its `remove()` restores it, never `1`.
 */
export const RUN_PAGE_ONCE_OPACITY = 0.18
export const RUN_PAGE_TRACE_K = RUN_PAGE_ONCE_OPACITY / WEAR[0]

const settled = new WeakMap<object, { k: number; beats: number }>()

function stateOf(host: object): { k: number; beats: number } {
  let s = settled.get(host)
  if (!s) settled.set(host, (s = { k: 1, beats: 0 }))
  return s
}

/** The settled k for this map: `1` unless `setTraceK` said otherwise. */
export function traceK(host: object): number {
  return settled.get(host)?.k ?? 1
}

/**
 * Set the settled k. Applied to the steady layer at once when it exists and no beat is running; a
 * running beat reads it on its next frame and restores it when it ends.
 */
export function setTraceK(host: TraceHost, k: number): void {
  const s = stateOf(host)
  if (s.k === k) return
  s.k = k
  if (s.beats === 0 && host.getLayer(TRACE_LAYER_ID)) host.setPaintProperty(TRACE_LAYER_ID, "line-opacity", traceOpacity(k))
}

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

/**
 * The first label layer, which every trace layer goes under. `undefined`: no labels, so on top.
 *
 * `0097`: in ATLAS that first label is above the fog, and so is the 0.5-opacity road-grid copy just
 * below it, so the web lands between the two — above the fog. That is deliberate (operator call,
 * amending D-307 for atlas): a web below the fog would sit under the road copy and be washed to
 * half strength on the very streets it runs along. In adventure the labels are below the fog, so
 * the web is too, unchanged.
 */
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
  // `0101`: added at the settled k — or at 0 while a beat holds it, which the beat's next frame sets.
  const s = stateOf(host)
  host.addLayer(lineLayer(TRACE_LAYER_ID, TRACE_SOURCE_ID, color, s.beats > 0 ? 0 : s.k), traceBeforeId(host))
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
  const state = stateOf(host)
  host.addSource(TRACE_BEFORE_SOURCE_ID, { type: "geojson", data: before })
  host.addLayer(lineLayer(TRACE_BEFORE_LAYER_ID, TRACE_BEFORE_SOURCE_ID, color, state.k), traceBeforeId(host))
  state.beats++
  let last = -1
  let removed = false
  // `0101`: both halves within the settled k, so the run page's beat fades between dimmed webs.
  const apply = (s: number) => {
    const k = state.k
    if (host.getLayer(TRACE_LAYER_ID)) host.setPaintProperty(TRACE_LAYER_ID, "line-opacity", traceOpacity(s * k))
    host.setPaintProperty(TRACE_BEFORE_LAYER_ID, "line-opacity", traceOpacity((1 - s) * k))
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
      state.beats = Math.max(0, state.beats - 1)
      try {
        if (host.getLayer(TRACE_BEFORE_LAYER_ID)) host.removeLayer(TRACE_BEFORE_LAYER_ID)
        if (host.getSource(TRACE_BEFORE_SOURCE_ID)) host.removeSource(TRACE_BEFORE_SOURCE_ID)
        // `0101`: back to the SETTLED k — 0.18-for-once on the run page — never a hard 1.
        if (host.getLayer(TRACE_LAYER_ID)) host.setPaintProperty(TRACE_LAYER_ID, "line-opacity", traceOpacity(state.k))
      } catch {
        // The map is already gone.
      }
    },
  }
}
