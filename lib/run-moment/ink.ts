import {
  RUN_CORE_METRICS,
  RUN_GLOW_METRICS,
  RUN_LAYER_IDS,
  RUN_LAYOUT,
  type RoutePalette,
} from "@/lib/map-layers"

import { TRACE_INK_LAYER_ID, TRACE_INK_SOURCE_ID, TRACE_LAYOUT, TRACE_WIDTH, traceBeforeId } from "@/lib/trace-web/layer"
import { WEAR_MAX } from "@/lib/trace-web/web"

import { clearOf } from "./palette"
import { inkGradient, type LanternPath } from "./lantern-path"

/**
 * THE ROUTE INKS IN BEHIND THE LANTERN. Ticket `0080`. `06-ui-ux.md` §3.2: *"`run-core #fff2d0` at
 * 2.5px over `run-glow #ffb347` blurred 10px at 0.35 (05 §4.4, verbatim … reused unchanged)"*.
 *
 * Reused unchanged means the SAME paint — `RUN_GLOW_METRICS`, `RUN_CORE_METRICS`, `RUN_LAYOUT` and
 * the same two tokens — on a second pair of layers over a second source. The run's own layers are
 * hidden while the beat plays and shown again when it ends; at progress 1 the ink is the whole route
 * in the same paint, so the hand-back has nothing to see. A second pair rather than restyling the
 * first, because `line-gradient` needs the parts joined (`lantern-path.ts` says why) and the
 * steady-state source must stay the stored geometry it has always been.
 */

export const INK_SOURCE_ID = "run-ink"
export const INK_GLOW_ID = "run-ink-glow"
export const INK_CORE_ID = "run-ink-core"

/** The slice of MapLibre's `Map` this uses — so a test can hold it to the calls. */
export interface InkMap {
  addSource(id: string, source: object): unknown
  getSource(id: string): unknown
  removeSource(id: string): unknown
  addLayer(layer: object): unknown
  getLayer(id: string): unknown
  removeLayer(id: string): unknown
  setPaintProperty(layer: string, name: string, value: unknown): unknown
  setLayoutProperty(layer: string, name: string, value: unknown): unknown
}

export interface Ink {
  /**
   * Keep the run's own layers hidden. `use-latest-run` adds them when the map loads, which can be
   * AFTER the ink went in — and a full route drawn over the ink would give the beat away. MapLibre
   * no-ops an unchanged layout value, so this is cheap enough to call every waiting frame.
   */
  hold(): void
  /** Move the head to the lantern's arc. Two paint writes; the map re-renders on its own. */
  update(arc: number): void
  /** Remove the ink and show the run's own layers again. Idempotent. */
  remove(): void
}

export function installInk(map: InkMap, path: LanternPath, palette: RoutePalette): Ink {
  const glowClear = clearOf(palette.glow)
  const coreClear = clearOf(palette.core)

  const hold = () => {
    for (const id of RUN_LAYER_IDS) {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", "none")
    }
  }
  hold()
  map.addSource(INK_SOURCE_ID, { type: "geojson", data: path.ink, lineMetrics: true })
  map.addLayer({
    id: INK_GLOW_ID,
    type: "line",
    source: INK_SOURCE_ID,
    layout: { ...RUN_LAYOUT },
    paint: { ...RUN_GLOW_METRICS, "line-gradient": inkGradient(path, 0, palette.glow, glowClear) },
  })
  map.addLayer({
    id: INK_CORE_ID,
    type: "line",
    source: INK_SOURCE_ID,
    layout: { ...RUN_LAYOUT },
    paint: { ...RUN_CORE_METRICS, "line-gradient": inkGradient(path, 0, palette.core, coreClear) },
  })

  let last = 0
  let removed = false
  return {
    hold() {
      if (!removed) hold()
    },
    update(arc) {
      if (removed) return
      hold()
      if (arc === last) return
      last = arc
      map.setPaintProperty(INK_GLOW_ID, "line-gradient", inkGradient(path, arc, palette.glow, glowClear))
      map.setPaintProperty(INK_CORE_ID, "line-gradient", inkGradient(path, arc, palette.core, coreClear))
    },
    remove() {
      if (removed) return
      removed = true
      try {
        for (const id of [INK_CORE_ID, INK_GLOW_ID]) if (map.getLayer(id)) map.removeLayer(id)
        if (map.getSource(INK_SOURCE_ID)) map.removeSource(INK_SOURCE_ID)
        for (const id of RUN_LAYER_IDS) {
          if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", "visible")
        }
      } catch {
        // The map may already be gone — the page navigated, or the context was lost. Nothing left.
      }
    },
  }
}

/**
 * `0085`. THE RUN JOINS THE WEB — beat 1's subject on a run with no new ground (`06-ui-ux.md` §3.5
 * rule 2): *"the lantern traverses the route over already-clear ground and the route inks into the
 * permanent trace layer"*.
 *
 * The same lantern, the same arc, the same `inkGradient` — in the trace layer's paint instead of the
 * route's, so what draws behind the light is the record and not the run. It inks at the web's
 * darkest weight, `WEAR_MAX`, so it can be watched; over the settle it fades out while the web
 * cross-fades to the web WITH this run (`installWebBeat`), so what it leaves behind is exactly the
 * line the web now holds — darker where it was run before.
 *
 * The run's own amber layers are held hidden for the whole sequence, as `installInk` holds them:
 * on this run the amber line would cover the very thing the beat is about. They come back with the
 * end state, when the sequence unmounts.
 */
export interface TraceInkMap extends InkMap {
  addLayer(layer: object, beforeId?: string): unknown
  getStyle(): { layers?: ReadonlyArray<{ id: string; type: string }> } | undefined
}

export interface TraceInk extends Ink {
  /** The ink's opacity factor, `0..1`, applied to `WEAR_MAX`. */
  fade(k: number): void
}

export function installTraceInk(map: TraceInkMap, path: LanternPath, color: string): TraceInk {
  const clear = clearOf(color)
  const hold = () => {
    for (const id of RUN_LAYER_IDS) {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", "none")
    }
  }
  hold()
  map.addSource(TRACE_INK_SOURCE_ID, { type: "geojson", data: path.ink, lineMetrics: true })
  map.addLayer(
    {
      id: TRACE_INK_LAYER_ID,
      type: "line",
      source: TRACE_INK_SOURCE_ID,
      layout: { ...TRACE_LAYOUT },
      paint: {
        "line-width": TRACE_WIDTH,
        "line-opacity": WEAR_MAX,
        "line-gradient": inkGradient(path, 0, color, clear),
      },
    },
    traceBeforeId(map),
  )
  let last = 0
  let lastFade = 1
  let removed = false
  return {
    hold() {
      if (!removed) hold()
    },
    update(arc) {
      if (removed) return
      hold()
      if (arc === last) return
      last = arc
      map.setPaintProperty(TRACE_INK_LAYER_ID, "line-gradient", inkGradient(path, arc, color, clear))
    },
    fade(k) {
      if (removed || k === lastFade) return
      lastFade = k
      map.setPaintProperty(TRACE_INK_LAYER_ID, "line-opacity", WEAR_MAX * k)
    },
    remove() {
      if (removed) return
      removed = true
      try {
        if (map.getLayer(TRACE_INK_LAYER_ID)) map.removeLayer(TRACE_INK_LAYER_ID)
        if (map.getSource(TRACE_INK_SOURCE_ID)) map.removeSource(TRACE_INK_SOURCE_ID)
        for (const id of RUN_LAYER_IDS) {
          if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", "visible")
        }
      } catch {
        // The map is already gone.
      }
    },
  }
}
