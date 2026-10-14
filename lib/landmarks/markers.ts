import { LANDMARK_LAYER_ID, landmarkBeforeId } from "@/lib/map-layers"
import type { LandmarkRow } from "@/lib/skills/detail"
import type { PlaceKind } from "@/src/scoring/places"

/**
 * RECORDED LANDMARKS, DRAWN ON THE HOME MAP. Ticket `0260`. `04-game-design.md` §4.3, D-301.
 *
 * *"Visible forever on a map the user already looks at."* `0248` records a `Landmark` row where 50
 * and 99 were crossed; this draws every located one as a lasting marker — a cairn for `landmark`, a
 * shrine for `shrine`.
 *
 * ─── THE FORM IS A ROW, NOT A BRANCH (D-031) ────────────────────────────────
 *
 * Which glyph a row gets is `MARKER_FORMS[row.place]` and nothing else. A new place-bound milestone
 * is a row in `PLACE_LEVELS` and a row here; nothing in this file or its callers looks at a skill
 * id. A place this table does not know draws nothing rather than a guess.
 *
 * ─── WHERE IT SITS ──────────────────────────────────────────────────────────
 *
 * Above the fog and below the route — `lib/map-layers.ts`, rule 3. Over fog because a cairn is a
 * placed object and never ground the mist may hide; that is also what makes it mode-independent
 * (`05` §5.2): atlas and adventure differ in fog uniforms and in where LABELS sit, and the marker is
 * above both in either.
 */

export const LANDMARK_SOURCE_ID = "landmarks"

/** The marker's three colours. Resolved from `app/tokens.css`, like the route's. */
export interface MarkerPalette {
  stone: string
  shrine: string
  ink: string
}

export const LANDMARK_STONE_TOKEN = "--landmark-stone"
export const LANDMARK_SHRINE_TOKEN = "--landmark-shrine"
export const LANDMARK_INK_TOKEN = "--landmark-ink"

export function markerPaletteFrom(read: (token: string) => string): MarkerPalette {
  const get = (t: string) => {
    const v = read(t).trim()
    if (!v) throw new Error(`app/tokens.css defines no ${t} (ticket 0260).`)
    return v
  }
  return { stone: get(LANDMARK_STONE_TOKEN), shrine: get(LANDMARK_SHRINE_TOKEN), ink: get(LANDMARK_INK_TOKEN) }
}

export function documentMarkerPalette(): MarkerPalette {
  const computed = getComputedStyle(document.documentElement)
  return markerPaletteFrom((t) => computed.getPropertyValue(t))
}

/**
 * The drawing surface a glyph needs — the 2D canvas calls, in CSS pixels. Structural so the
 * table's rows can be exercised without a browser.
 */
export type GlyphPen = Pick<
  CanvasRenderingContext2D,
  | "beginPath"
  | "ellipse"
  | "moveTo"
  | "lineTo"
  | "closePath"
  | "rect"
  | "arc"
  | "quadraticCurveTo"
  | "fill"
  | "stroke"
  | "save"
  | "restore"
> & {
  fillStyle: CanvasRenderingContext2D["fillStyle"]
  strokeStyle: CanvasRenderingContext2D["strokeStyle"]
  lineWidth: number
  lineJoin: CanvasLineJoin
  shadowColor: string
  shadowBlur: number
}

export interface MarkerForm {
  /** The image id registered on the map. */
  image: string
  /** CSS pixels at icon-size 1, the zoom `→ fly to` lands on (`AT_ZOOM`). Padding included. */
  width: number
  height: number
  /** Drawn above lower-ranked forms where two overlap: a shrine is never hidden by a cairn. */
  rank: number
  draw(pen: GlyphPen, palette: MarkerPalette): void
}

/** Stroke every subpath drawn since the last `beginPath`, filled first. */
function inked(pen: GlyphPen, fill: string, palette: MarkerPalette) {
  pen.fillStyle = fill
  pen.fill()
  pen.strokeStyle = palette.ink
  pen.lineWidth = 1.5
  pen.lineJoin = "round"
  pen.stroke()
}

/**
 * THE TABLE. Every `PlaceKind` has a row — `markers.test.ts` asserts it against `PLACE_LEVELS`, so
 * a new place-bound level cannot ship without a form.
 *
 * The two differ in silhouette (a rounded stack against a torii's beams), in fill (pale stone against
 * gold leaf) and in size, so either cue alone tells them apart.
 */
export const MARKER_FORMS: Readonly<Record<PlaceKind, MarkerForm>> = {
  // A hand-stacked cairn: four stones, widest at the foot, each a little off the line.
  landmark: {
    image: "landmark-cairn",
    width: 28,
    height: 30,
    rank: 1,
    draw(pen, palette) {
      const stones: Array<[number, number, number, number]> = [
        [14, 24.5, 11, 4.5],
        [13, 17.5, 8.5, 4],
        [14.6, 11.2, 6, 3.4],
        [13.6, 6, 3, 2.4],
      ]
      // A soft ink shadow under the whole stack, so it lifts off a road as well as off parchment.
      pen.save()
      pen.shadowColor = palette.ink
      pen.shadowBlur = 4
      for (const [x, y, rx, ry] of stones) {
        pen.beginPath()
        pen.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2)
        pen.fillStyle = palette.stone
        pen.fill()
      }
      pen.restore()
      for (const [x, y, rx, ry] of stones) {
        pen.beginPath()
        pen.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2)
        inked(pen, palette.stone, palette)
      }
    },
  },
  // A torii in gold leaf: the gate that marks a shrine. Upswept top lintel (kasagi) over a second
  // beam (shimaki), a centre strut, a tie beam (nuki) through two splayed pillars on plinths.
  shrine: {
    image: "landmark-shrine",
    width: 34,
    height: 38,
    rank: 2,
    draw(pen, palette) {
      const parts: Array<() => void> = [
        () => { pen.moveTo(9, 12); pen.lineTo(12.5, 12); pen.lineTo(11.8, 35); pen.lineTo(7.8, 35); pen.closePath() }, // left pillar
        () => { pen.moveTo(21.5, 12); pen.lineTo(25, 12); pen.lineTo(26.2, 35); pen.lineTo(22.2, 35); pen.closePath() }, // right pillar
        () => pen.rect(6.8, 34.5, 6, 2), // left plinth
        () => pen.rect(21.2, 34.5, 6, 2), // right plinth
        () => pen.rect(4, 19, 26, 3), // nuki
        () => pen.rect(15.5, 13.5, 3, 5.5), // centre strut
        () => pen.rect(6, 11, 22, 2.5), // shimaki
        () => {
          // kasagi: a beam whose ends sweep up
          pen.moveTo(1.5, 4.5)
          pen.quadraticCurveTo(17, 9.5, 32.5, 4.5)
          pen.lineTo(31, 9)
          pen.quadraticCurveTo(17, 13, 3, 9)
          pen.closePath()
        },
      ]
      // A gold glow first: the shrine is mastery, and it is the one marker allowed to shine.
      pen.save()
      pen.shadowColor = palette.shrine
      pen.shadowBlur = 7
      pen.beginPath()
      for (const part of parts) part()
      pen.fillStyle = palette.shrine
      pen.fill()
      pen.restore()
      // Each part inked on its own, bottom to top, so the beams read as crossing the pillars.
      for (const part of parts) {
        pen.beginPath()
        part()
        inked(pen, palette.shrine, palette)
      }
    },
  },
}

function formFor(place: string): MarkerForm | undefined {
  return Object.prototype.hasOwnProperty.call(MARKER_FORMS, place) ? MARKER_FORMS[place as PlaceKind] : undefined
}

export interface LandmarkFeature {
  type: "Feature"
  geometry: { type: "Point"; coordinates: [number, number] }
  properties: { icon: string; rank: number }
}
export interface LandmarkFeatureCollection {
  type: "FeatureCollection"
  features: LandmarkFeature[]
}

export const NO_LANDMARKS: LandmarkFeatureCollection = { type: "FeatureCollection", features: [] }

/** Criterion 1 and 2: one point per LOCATED row, its icon from the table. Unlocated or unknown: nothing. */
export function landmarkFeatures(rows: readonly LandmarkRow[]): LandmarkFeatureCollection {
  const features: LandmarkFeature[] = []
  for (const r of rows) {
    const form = formFor(r.place)
    if (!form || r.lng === null || r.lat === null) continue
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [r.lng, r.lat] },
      properties: { icon: form.image, rank: form.rank },
    })
  }
  return { type: "FeatureCollection", features }
}

/**
 * Full size at the zoom `→ fly to` lands on (`AT_ZOOM`, 16); a little smaller at home's 14, smaller
 * still zoomed out, never gone — a landmark is forever, and the overview is where you look for them.
 */
export const LANDMARK_ICON_SIZE = ["interpolate", ["linear"], ["zoom"], 8, 0.55, 14, 0.85, 16, 1, 18, 1.2] as const

export function landmarkLayerSpec() {
  return {
    id: LANDMARK_LAYER_ID,
    type: "symbol" as const,
    source: LANDMARK_SOURCE_ID,
    layout: {
      "icon-image": ["get", "icon"],
      "icon-size": LANDMARK_ICON_SIZE,
      // The foot of the glyph stands on the point: an object placed THERE, not a pin hovering near it.
      "icon-anchor": "bottom",
      // Always drawn, and never hides a street name: the label placement ignores it.
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
      "symbol-sort-key": ["get", "rank"],
    },
  }
}

/** A raster MapLibre's `addImage` takes. */
export interface GlyphImage {
  width: number
  height: number
  data: Uint8Array | Uint8ClampedArray
}

export interface LandmarkHost {
  getLayer(id: string): unknown
  getSource(id: string): unknown
  addSource(id: string, source: unknown): void
  addLayer(layer: unknown, beforeId?: string): void
  hasImage(id: string): boolean
  addImage(id: string, image: GlyphImage, options?: { pixelRatio?: number }): void
}

/**
 * Add the markers, or replace their data. Images are registered once per map, from `render` —
 * injected, because rasterising needs a canvas and the order logic does not.
 */
export function setLandmarks(
  host: LandmarkHost,
  data: LandmarkFeatureCollection,
  render: (form: MarkerForm) => { image: GlyphImage; pixelRatio: number },
): void {
  for (const form of Object.values(MARKER_FORMS)) {
    if (host.hasImage(form.image)) continue
    const { image, pixelRatio } = render(form)
    host.addImage(form.image, image, { pixelRatio })
  }
  const existing = host.getSource(LANDMARK_SOURCE_ID) as { setData?: (d: unknown) => void } | undefined
  if (existing) {
    existing.setData?.(data)
    return
  }
  host.addSource(LANDMARK_SOURCE_ID, { type: "geojson", data })
  host.addLayer(landmarkLayerSpec(), landmarkBeforeId(host))
}

/** Rasterise a form on a canvas at `pixelRatio`. Browser only. */
export function renderGlyph(form: MarkerForm, palette: MarkerPalette, pixelRatio = 2): { image: GlyphImage; pixelRatio: number } {
  const canvas = document.createElement("canvas")
  canvas.width = Math.ceil(form.width * pixelRatio)
  canvas.height = Math.ceil(form.height * pixelRatio)
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("landmarks: no 2D canvas")
  ctx.scale(pixelRatio, pixelRatio)
  form.draw(ctx, palette)
  const { width, height, data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
  return { image: { width, height, data }, pixelRatio }
}
