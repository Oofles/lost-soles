import { diff } from "@maplibre/maplibre-gl-style-spec"
import { describe, expect, it, vi } from "vitest"

import { isAboveFogLayer } from "./map-layers"

/**
 * `0098` — THE VARIANT SWAP KEEPS EVERY APP LAYER, AND THE CAMERA.
 *
 * The operator chose a diffed `setStyle` (Q1 = B) and asked for proof that the fog custom layer and
 * the app's other layers survive it. A real `Map` needs WebGL, so this runs MapLibre's OWN style
 * diff (`@maplibre/maplibre-gl-style-spec`'s `diff`, the function `Style.setState` calls) and applies
 * its commands to a list with MapLibre's semantics. Two of those semantics are load-bearing and
 * reproduced on purpose:
 *
 *   - a CUSTOM layer is never in a serialisation, so the diff cannot name it; it stays in the order
 *     wherever the surrounding adds and removes leave it;
 *   - an update to a same-id layer changes paint/layout/filter/zoom but NOT `metadata` — the reason
 *     atlas's labels carry ids of their own (`ATLAS_LABEL_PREFIX`).
 *
 * Any command `Style._getOperationsToPerform` does not implement makes MapLibre throw and rebuild the
 * whole style from scratch, which WOULD drop every app layer; that is asserted never to happen.
 * The real-browser half is `tools/fog-harness/run-mode-swap.mjs`.
 */

vi.mock("@/amplify_outputs.json", () => ({
  default: { custom: { basemapTilesUrl: "https://dexample123.cloudfront.net" } },
}))

const { basemapStyle, carryAppLayers, swapBasemap, BASEMAP_SOURCE } = await import("./basemap")
const { FOG_LAYER_ID, LANDMARK_LAYER_ID, RUN_CORE_ID, RUN_GLOW_ID, fogBeforeId, fogSplitsBasemap, landmarkBeforeId, landmarksBetweenFogAndRoute, routeIsAboveFog, setRunGeometry } =
  await import("./map-layers")
const { TRACE_LAYER_ID, setTraceWeb, traceIsBetweenBasemapAndRoute } = await import("./trace-web/layer")
const { landmarkLayerSpec } = await import("./landmarks/markers")

type Variant = "atlas" | "adventure"
type Layer = { id: string; type: string; source?: unknown; metadata?: unknown; [k: string]: unknown }

/** `Style._getOperationsToPerform`'s implemented commands, MapLibre 6.6. Anything else rebuilds. */
const IMPLEMENTED = new Set([
  "setCenter", "setZoom", "setBearing", "setPitch", "setRoll",
  "addLayer", "removeLayer", "setPaintProperty", "setLayoutProperty", "setFilter",
  "addSource", "removeSource", "setLayerZoomRange", "setLight", "setGeoJSONSourceData",
  "setGlyphs", "setSprite", "setTerrain", "setSky", "setProjection", "setGlobalState", "setTransition",
])

const CAMERA = { center: [-81.37, 28.54], zoom: 15, bearing: 0, pitch: 0 }

class FakeStyleMap {
  layers: Layer[]
  sources: Record<string, unknown>
  base: Record<string, unknown>
  commands: string[] = []
  removedIds: string[] = []
  camera = structuredClone(CAMERA)

  constructor(variant: Variant) {
    const style = basemapStyle(variant) as unknown as { sources: Record<string, unknown>; layers: Layer[] }
    this.base = { ...style }
    this.layers = structuredClone(style.layers)
    this.sources = { ...style.sources }
  }

  // ── what the app's helpers touch ──
  getLayer = (id: string) => this.layers.find((l) => l.id === id)
  getSource = (id: string) =>
    id in this.sources ? { setData: (d: unknown) => ((this.sources[id] as { data: unknown }).data = d) } : undefined
  addSource = (id: string, source: unknown) => void (this.sources[id] = structuredClone(source))
  removeSource = (id: string) => void delete this.sources[id]
  addLayer = (layer: Layer, beforeId?: string) => {
    const at = beforeId === undefined ? -1 : this.layers.findIndex((l) => l.id === beforeId)
    if (at === -1) this.layers.push(layer)
    else this.layers.splice(at, 0, layer)
  }
  removeLayer = (id: string) => void this.layers.splice(this.layers.findIndex((l) => l.id === id), 1)
  moveLayer = (id: string, beforeId?: string) => {
    const layer = this.getLayer(id)!
    this.removeLayer(id)
    this.addLayer(layer, beforeId)
  }
  setPaintProperty = () => {}
  /** A serialisation: custom layers are absent, exactly as `Style._serializeByIds` skips them. */
  getStyle = () => ({
    ...this.base,
    sources: structuredClone(this.sources),
    layers: structuredClone(this.layers.filter((l) => l.type !== "custom")),
  })

  // ── the camera: any call at all is a failure ──
  jumpTo = () => this.touched("jumpTo")
  setCenter = () => this.touched("setCenter")
  setZoom = () => this.touched("setZoom")
  touched(name: string): never {
    throw new Error(`the swap moved the camera through ${name}`)
  }

  /** `Map.setStyle(style, {diff: true, transformStyle})` → `Style.setState`. */
  setStyle = (next: unknown, options: { diff: true; transformStyle: (p: never, n: never) => unknown }) => {
    const prev = this.getStyle()
    const target = options.transformStyle(prev as never, structuredClone(next) as never) as {
      sources: Record<string, unknown>
      layers: Layer[]
    }
    for (const cmd of diff(prev as never, target as never)) {
      this.commands.push(cmd.command)
      if (!IMPLEMENTED.has(cmd.command)) throw new Error(`Unimplemented: ${cmd.command} — MapLibre would rebuild`)
      const args = cmd.args as unknown[]
      switch (cmd.command) {
        case "removeLayer":
          this.removedIds.push(args[0] as string)
          this.removeLayer(args[0] as string)
          break
        case "addLayer":
          this.addLayer(structuredClone(args[0] as Layer), args[1] as string | undefined)
          break
        case "addSource":
          this.addSource(args[0] as string, args[1])
          break
        case "removeSource":
          this.removedIds.push(`source:${args[0]}`)
          this.removeSource(args[0] as string)
          break
        case "setPaintProperty":
        case "setLayoutProperty": {
          const [id, name, value] = args as [string, string, unknown]
          const layer = this.getLayer(id)!
          const key = cmd.command === "setPaintProperty" ? "paint" : "layout"
          layer[key] = { ...(layer[key] as object), [name]: value }
          break
        }
        case "setFilter":
          this.getLayer(args[0] as string)!.filter = args[1]
          break
        case "setLayerZoomRange":
          Object.assign(this.getLayer(args[0] as string)!, { minzoom: args[1], maxzoom: args[2] })
          break
        // metadata: deliberately never updated — MapLibre's diff does not compare it.
      }
    }
  }
}

const RUNS = { type: "FeatureCollection", features: [] } as never
const PALETTE = { glow: "rgb(0, 0, 1)", core: "rgb(0, 0, 2)" }

/** The map as `/` builds it: basemap, trace web, fog, landmarks, route — in either arrival order. */
function built(variant: Variant, fogFirst: boolean): FakeStyleMap {
  const map = new FakeStyleMap(variant)
  const fog = () => map.addLayer({ id: FOG_LAYER_ID, type: "custom" }, fogBeforeId(map))
  if (fogFirst) fog()
  setTraceWeb(map as never, RUNS, "rgb(0, 0, 3)")
  map.addSource("landmarks", { type: "geojson", data: RUNS })
  map.addLayer(landmarkLayerSpec() as unknown as Layer, landmarkBeforeId(map))
  setRunGeometry(map as never, RUNS, PALETTE)
  if (!fogFirst) fog()
  return map
}

function assertPlaced(map: FakeStyleMap, variant: Variant) {
  const ids = map.layers.map((l) => l.id)
  for (const id of [FOG_LAYER_ID, TRACE_LAYER_ID, LANDMARK_LAYER_ID, RUN_GLOW_ID, RUN_CORE_ID]) {
    expect(ids.filter((x) => x === id)).toHaveLength(1)
  }
  for (const s of ["runs", "landmarks", BASEMAP_SOURCE]) expect(map.sources).toHaveProperty(s)
  expect(fogSplitsBasemap(map.layers, BASEMAP_SOURCE)).toBe(true)
  expect(routeIsAboveFog(map.layers)).toBe(true)
  expect(landmarksBetweenFogAndRoute(map.layers)).toBe(true)
  expect(traceIsBetweenBasemapAndRoute(map.layers)).toBe(true)
  // The tags on screen are this variant's, and only this variant's.
  expect(map.layers.some((l) => isAboveFogLayer(l))).toBe(variant === "atlas")
  const fog = ids.indexOf(FOG_LAYER_ID)
  const trace = ids.indexOf(TRACE_LAYER_ID)
  // D-368: atlas's web sits above the fog; adventure's below it (D-307).
  expect(trace > fog).toBe(variant === "atlas")
}

describe("swapBasemap — the variant changes, the app's layers and the camera do not (0098)", () => {
  for (const from of ["adventure", "atlas"] as const) {
    const to: Variant = from === "atlas" ? "adventure" : "atlas"
    for (const fogFirst of [true, false]) {
      it(`${from} → ${to} (${fogFirst ? "fog added first" : "route added first"})`, () => {
        const map = built(from, fogFirst)
        assertPlaced(map, from)
        swapBasemap(map as never, to)
        assertPlaced(map, to)
        // Nothing the app added was removed by the diff — it was carried, not re-created.
        for (const id of [TRACE_LAYER_ID, LANDMARK_LAYER_ID, RUN_GLOW_ID, RUN_CORE_ID, "source:runs", "source:landmarks", `source:${BASEMAP_SOURCE}`]) {
          expect(map.removedIds).not.toContain(id)
        }
        expect(map.camera).toEqual(CAMERA)
      })
    }
  }

  it("survives five round trips with the order unchanged", () => {
    const map = built("adventure", true)
    const start = map.layers.map((l) => l.id)
    for (let i = 0; i < 5; i++) {
      swapBasemap(map as never, "atlas")
      assertPlaced(map, "atlas")
      swapBasemap(map as never, "adventure")
      assertPlaced(map, "adventure")
    }
    expect(map.layers.map((l) => l.id)).toEqual(start)
    expect(map.camera).toEqual(CAMERA)
  })

  it("a swap to the variant already showing changes nothing", () => {
    const map = built("atlas", false)
    const start = map.layers.map((l) => l.id)
    map.commands = []
    swapBasemap(map as never, "atlas")
    expect(map.commands).toEqual([])
    expect(map.layers.map((l) => l.id)).toEqual(start)
  })
})

describe("carryAppLayers", () => {
  it("returns the next style untouched when there is no previous one", () => {
    const next = basemapStyle("atlas") as never
    expect(carryAppLayers(undefined, next)).toBe(next)
  })
})
