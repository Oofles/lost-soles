import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

import { basemapStyle } from "@/lib/basemap"
import { mapPaletteFrom } from "@/lib/basemap-style"
import { AT_ZOOM, HOME_ZOOM } from "@/lib/map-camera"
import {
  FOG_LAYER_ID,
  LANDMARK_LAYER_ID,
  fogBeforeId,
  fogIsAboveAllSymbols,
  landmarksBetweenFogAndRoute,
  routeIsAboveFog,
  routePaletteFrom,
  setRunGeometry,
} from "@/lib/map-layers"
import type { LandmarkRow } from "@/lib/skills/detail"
import { PLACE_LEVELS } from "@/src/scoring/places"

import {
  LANDMARK_ICON_SIZE,
  MARKER_FORMS,
  landmarkFeatures,
  landmarkLayerSpec,
  markerPaletteFrom,
  setLandmarks,
  type GlyphImage,
  type GlyphPen,
  type MarkerForm,
} from "./markers"

/** Point Nemo — the synthetic box `scripts/check-fixture-geography.mjs` allows (D-199). */
const NEMO = { lat: -48.876, lng: -123.393 }

const row = (place: string, at: { lng: number; lat: number } | null, level = 50): LandmarkRow => ({
  level,
  place,
  lng: at?.lng ?? null,
  lat: at?.lat ?? null,
})

const tokensCss = readFileSync(new URL("../../app/tokens.css", import.meta.url), "utf8")
function token(name: string): string {
  const direct = new RegExp(`\\${name}:\\s*([^;]+);`).exec(tokensCss)
  if (!direct) return ""
  const value = direct[1]!.trim()
  const hop = /^var\((--[\w-]+)\)$/.exec(value)
  return hop ? token(hop[1]!) : value
}

type Layer = { id: string; type: string }

/** MapLibre's insertion semantics and image registry, nothing else. Same shape as `map-layers.test.ts`. */
class FakeMap {
  layers: Layer[]
  sources = new Map<string, { data: unknown; setData(d: unknown): void }>()
  images = new Map<string, { image: GlyphImage; pixelRatio?: number }>()
  constructor(initial: Layer[]) {
    this.layers = [...initial]
  }
  getLayer(id: string) {
    return this.layers.find((l) => l.id === id)
  }
  getSource(id: string) {
    return this.sources.get(id)
  }
  addSource(id: string, source: unknown) {
    this.sources.set(id, {
      data: (source as { data: unknown }).data,
      setData(d: unknown) {
        this.data = d
      },
    })
  }
  addLayer(layer: unknown, beforeId?: string) {
    const at = beforeId === undefined ? -1 : this.layers.findIndex((l) => l.id === beforeId)
    if (at === -1) this.layers.push(layer as Layer)
    else this.layers.splice(at, 0, layer as Layer)
  }
  removeLayer(id: string) {
    this.layers = this.layers.filter((l) => l.id !== id)
  }
  hasImage(id: string) {
    return this.images.has(id)
  }
  addImage(id: string, image: GlyphImage, options?: { pixelRatio?: number }) {
    this.images.set(id, { image, pixelRatio: options?.pixelRatio })
  }
}

const style = () => basemapStyle("adventure", mapPaletteFrom(token)).layers as unknown as Layer[]
const fog = (): Layer => ({ id: FOG_LAYER_ID, type: "custom" })
const empty = { type: "FeatureCollection" as const, features: [] }
const ROUTE = routePaletteFrom(token)
const blank = () => ({ image: { width: 1, height: 1, data: new Uint8Array(4) }, pixelRatio: 2 })

describe("criterion 1 — one marker per located row", () => {
  it("draws a located row at its coordinate", () => {
    const fc = landmarkFeatures([row("landmark", NEMO)])
    expect(fc.features).toHaveLength(1)
    expect(fc.features[0]!.geometry.coordinates).toEqual([NEMO.lng, NEMO.lat])
  })

  it("a row with null lng/lat draws nothing", () => {
    expect(landmarkFeatures([row("landmark", null), row("shrine", null, 99)]).features).toEqual([])
  })

  it("draws every located row the owner has, across skills", () => {
    const rows = [row("landmark", NEMO), row("landmark", { ...NEMO, lng: NEMO.lng + 0.01 }), row("shrine", NEMO, 99)]
    expect(landmarkFeatures(rows).features).toHaveLength(3)
  })
})

describe("criterion 2 — the form is a data row (D-031)", () => {
  it("every place-bound kind in PLACE_LEVELS has a form", () => {
    for (const kind of Object.values(PLACE_LEVELS)) expect(MARKER_FORMS[kind]).toBeDefined()
  })

  it("the icon comes from the row's place through the table", () => {
    const [cairn, shrine] = landmarkFeatures([row("landmark", NEMO), row("shrine", NEMO, 99)]).features
    expect(cairn!.properties.icon).toBe(MARKER_FORMS.landmark.image)
    expect(shrine!.properties.icon).toBe(MARKER_FORMS.shrine.image)
  })

  it("a place the table does not know draws nothing rather than a guess", () => {
    expect(landmarkFeatures([row("obelisk", NEMO), row("constructor", NEMO)]).features).toEqual([])
  })

  it("the layer reads the icon off the feature — no expression over places or skills", () => {
    const layout = landmarkLayerSpec().layout
    expect(layout["icon-image"]).toEqual(["get", "icon"])
    expect(JSON.stringify(landmarkLayerSpec())).not.toMatch(/landmark-cairn|landmark-shrine|skill/)
  })

  it("cairn and shrine differ in image, size and rank; the shrine draws on top", () => {
    const { landmark, shrine } = MARKER_FORMS
    expect(landmark.image).not.toBe(shrine.image)
    expect(shrine.width * shrine.height).toBeGreaterThan(landmark.width * landmark.height)
    expect(shrine.rank).toBeGreaterThan(landmark.rank)
  })

  it("both are full size at the zoom → fly to lands on, and a glanceable size there", () => {
    const [, , , ...stops] = LANDMARK_ICON_SIZE
    const at = new Map<number, number>()
    for (let i = 0; i < stops.length; i += 2) at.set(stops[i] as number, stops[i + 1] as number)
    expect(at.get(AT_ZOOM)).toBe(1)
    expect(at.get(HOME_ZOOM)).toBeLessThan(1)
    for (const f of Object.values(MARKER_FORMS)) expect(Math.min(f.width, f.height)).toBeGreaterThanOrEqual(24)
  })
})

describe("criterion 3 — above the fog, below the route", () => {
  it("added after fog and route, it lands between them", () => {
    const map = new FakeMap(style())
    map.addLayer(fog(), fogBeforeId(map))
    setRunGeometry(map, empty, ROUTE)
    setLandmarks(map, landmarkFeatures([]), blank)
    expect(landmarksBetweenFogAndRoute(map.layers)).toBe(true)
    expect(routeIsAboveFog(map.layers)).toBe(true)
  })

  it("added before the route, the route still appends above it", () => {
    const map = new FakeMap(style())
    map.addLayer(fog(), fogBeforeId(map))
    setLandmarks(map, landmarkFeatures([]), blank)
    setRunGeometry(map, empty, ROUTE)
    expect(landmarksBetweenFogAndRoute(map.layers)).toBe(true)
  })

  it("the fog re-added (`?fog=off` and back, a style reload) goes under the landmarks", () => {
    const map = new FakeMap(style())
    setRunGeometry(map, empty, ROUTE)
    setLandmarks(map, landmarkFeatures([]), blank)
    map.addLayer(fog(), fogBeforeId(map))
    expect(landmarksBetweenFogAndRoute(map.layers)).toBe(true)
    expect(routeIsAboveFog(map.layers)).toBe(true)
    expect(fogIsAboveAllSymbols(map.layers.filter((l) => l.id !== LANDMARK_LAYER_ID))).toBe(true)
  })

  it("a second call replaces the data and registers no image twice", () => {
    const map = new FakeMap(style())
    let rendered = 0
    const count = () => (rendered++, blank())
    setLandmarks(map, landmarkFeatures([]), count)
    setLandmarks(map, landmarkFeatures([row("shrine", NEMO, 99)]), count)
    expect(rendered).toBe(Object.keys(MARKER_FORMS).length)
    expect(map.layers.filter((l) => l.id === LANDMARK_LAYER_ID)).toHaveLength(1)
    expect((map.sources.get("landmarks")!.data as { features: unknown[] }).features).toHaveLength(1)
  })

  it("never hides a street name, and is never hidden by one", () => {
    const layout = landmarkLayerSpec().layout
    expect(layout["icon-allow-overlap"]).toBe(true)
    expect(layout["icon-ignore-placement"]).toBe(true)
  })
})

describe("the palette lives in app/tokens.css", () => {
  it("resolves all three marker tokens", () => {
    const p = markerPaletteFrom(token)
    expect(p.stone).toMatch(/^#[0-9a-f]{6}$/)
    expect(p.shrine).toMatch(/^#[0-9a-f]{6}$/)
    expect(p.ink).toMatch(/^#[0-9a-f]{6}$/)
  })

  it("throws on a missing token rather than drawing an invisible marker", () => {
    expect(() => markerPaletteFrom(() => "")).toThrow(/--landmark-stone/)
  })
})

describe("the glyphs draw inside their own box", () => {
  /** A pen that records every coordinate it is handed, so a glyph cannot paint off its canvas. */
  function recordingPen() {
    const xs: number[] = []
    const ys: number[] = []
    const pt = (x: number, y: number, r = 0) => {
      xs.push(x - r, x + r)
      ys.push(y - r, y + r)
    }
    const noop = () => {}
    const pen: GlyphPen = {
      beginPath: noop,
      closePath: noop,
      fill: noop,
      stroke: noop,
      save: noop,
      restore: noop,
      moveTo: (x, y) => pt(x, y),
      lineTo: (x, y) => pt(x, y),
      rect: (x, y, w, h) => (pt(x, y), pt(x + w, y + h)),
      arc: (x, y, r) => pt(x, y, r),
      quadraticCurveTo: (cx, cy, x, y) => (pt(cx, cy), pt(x, y)),
      ellipse: (x, y, rx, ry) => (xs.push(x - rx, x + rx), ys.push(y - ry, y + ry)),
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 1,
      lineJoin: "miter",
      shadowColor: "",
      shadowBlur: 0,
    } as GlyphPen
    return { pen, xs, ys }
  }

  it.each(Object.entries(MARKER_FORMS) as Array<[string, MarkerForm]>)("%s", (_, form) => {
    const { pen, xs, ys } = recordingPen()
    form.draw(pen, markerPaletteFrom(token))
    // The 1.5 px ink stroke straddles the path, so 1 px of margin is the least that keeps it whole.
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(1)
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(1)
    expect(Math.max(...xs)).toBeLessThanOrEqual(form.width - 1)
    expect(Math.max(...ys)).toBeLessThanOrEqual(form.height - 1)
  })
})
