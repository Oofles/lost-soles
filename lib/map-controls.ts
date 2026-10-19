import { regionsOf, type LngLatBounds } from "@/lib/regions"
import type { RunFeatureCollection } from "@/lib/runs/wire"
import type { WebRunInput } from "@/lib/trace-web/web"

/**
 * THE MAP'S INPUT MODEL. Ticket `0101`, `06-ui-ux.md` §4.4, D-253 (mouse and keyboard).
 *
 * Pure, so the options MapLibre is built with, the zoom settle and the two camera controls are
 * tested without WebGL (`map-controls.test.ts`), and a real Map proves the same options hold under
 * real input (`tools/fog-harness/run-map-controls.mjs`).
 *
 * ─── ROTATION AND TILT ARE OFF AT THE OPTIONS LEVEL ─────────────────────────
 *
 * §4.4: *"Bearing is locked north-up, pitch locked to 0."* A rotated street map with no compass is a
 * map you cannot navigate by, and tilt costs label legibility at the horizon (D-051). So the
 * handlers are switched off where MapLibre builds them — `dragRotate: false` (right-drag and
 * Ctrl-drag), `pitchWithRotate: false`, `touchPitch: false`, `maxPitch: 0`, `rollEnabled: false` —
 * and never swallowed in an event listener after the fact. The two handlers MapLibre offers no
 * option for (the keyboard's Shift+arrows and a touchpad's two-finger twist) are turned off by
 * their own `disableRotation()` right after construction (`lockOrientation`): still the handler,
 * not a listener.
 */

/** §4.4: z10 → z18. Below z10 the fog's zoom bucketing smears territory; above z18 the basemap is empty. */
export const ZOOM_MIN = 10
export const ZOOM_MAX = 18
/**
 * How far past a bound a gesture may carry before MapLibre stops it — the rubber band. On release
 * (`moveend`) the camera eases back inside (`settleZoom`), so neither bound hard-stops (§4.4).
 */
export const ZOOM_OVERSHOOT = 0.5
/** The ease back inside the bounds. Short: it is a settle, not a navigation. */
export const ZOOM_SETTLE_MS = 250

/** `⌖`: the last run's end point at this zoom (§4.4). */
export const RECENTRE_ZOOM = 14

/** The options `new maplibre.Map` is built with, beyond the container, style and camera. */
export const MAP_INPUT_OPTIONS = {
  minZoom: ZOOM_MIN - ZOOM_OVERSHOOT,
  maxZoom: ZOOM_MAX + ZOOM_OVERSHOOT,
  minPitch: 0,
  maxPitch: 0,
  dragRotate: false,
  pitchWithRotate: false,
  touchPitch: false,
  rollEnabled: false,
  // Drag pans with inertia; the wheel and a trackpad pinch zoom at the cursor; double-click zooms in
  // one step at the cursor; arrows and `+`/`−` pan and zoom while the map has focus. All MapLibre's
  // own handlers, named here so a later default change cannot silently turn one off.
  dragPan: true,
  scrollZoom: true,
  doubleClickZoom: true,
  keyboard: true,
  boxZoom: false,
} as const

/** The handlers `lockOrientation` reaches. MapLibre's `Map`, narrowed so a test can fake it. */
export interface OrientationHost {
  keyboard: { disableRotation(): void }
  touchZoomRotate: { disableRotation(): void }
}

/** The two rotations MapLibre's options cannot reach: Shift+arrows and a two-finger twist. */
export function lockOrientation(map: OrientationHost): void {
  map.keyboard.disableRotation()
  map.touchZoomRotate.disableRotation()
}

/**
 * Where an over-zoomed camera settles: the zoom clamped into [ZOOM_MIN, ZOOM_MAX], or `null` when it
 * is already inside and nothing should move.
 */
export function settleZoom(zoom: number): number | null {
  if (zoom < ZOOM_MIN) return ZOOM_MIN
  if (zoom > ZOOM_MAX) return ZOOM_MAX
  return null
}

type Position = [number, number] | number[]

/** The last point of the last line of a route geometry, or `null` for an empty one. */
function lastPoint(lines: readonly (readonly Position[])[]): [number, number] | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!
    const p = line[line.length - 1]
    if (p && p.length >= 2) return [p[0]!, p[1]!]
  }
  return null
}

/**
 * `⌖`'s target: the last run's END point (§4.4), from the run home already fetched. `null` with no
 * traced run, and the control then does nothing.
 */
export function lastRunEnd(latest: RunFeatureCollection): [number, number] | null {
  const geometry = latest.features[0]?.geometry as { type: string; coordinates: unknown } | undefined
  if (!geometry) return null
  if (geometry.type === "LineString") return lastPoint([geometry.coordinates as Position[]])
  if (geometry.type === "MultiLineString") return lastPoint(geometry.coordinates as Position[][])
  return null
}

/**
 * Fit-to-territory's target: the box of every traced point in the permanent web — the same source
 * the jump-to control frames regions from (D-381). `null` with no runs.
 */
export function territoryBounds(runs: readonly WebRunInput[]): LngLatBounds | null {
  let w = Infinity
  let s = Infinity
  let e = -Infinity
  let n = -Infinity
  for (const run of runs) {
    for (const line of run.lines) {
      for (const p of line) {
        if (p[0]! < w) w = p[0]!
        if (p[0]! > e) e = p[0]!
        if (p[1]! < s) s = p[1]!
        if (p[1]! > n) n = p[1]!
      }
    }
  }
  return Number.isFinite(w) ? [[w, s], [e, n]] : null
}

/** What the two controls need of the map. */
export interface CameraHost {
  easeTo(options: { center: [number, number]; zoom: number; bearing: 0; pitch: 0 }): unknown
  fitBounds(bounds: LngLatBounds, options: { padding: number; maxZoom: number; bearing: 0; pitch: 0 }): unknown
  cameraForBounds(bounds: LngLatBounds, options: { padding: number }): { zoom?: number } | undefined
  getCenter(): { lng: number; lat: number }
  getContainer(): HTMLElement
}

const inside = (b: LngLatBounds, p: { lng: number; lat: number }) =>
  p.lng >= b[0][0] && p.lng <= b[1][0] && p.lat >= b[0][1] && p.lat <= b[1][1]

const distanceTo = (b: LngLatBounds, p: { lng: number; lat: number }) =>
  Math.hypot((b[0][0] + b[1][0]) / 2 - p.lng, (b[0][1] + b[1][1]) / 2 - p.lat)

/**
 * WHAT "THE WHOLE TERRITORY" IS WHEN IT CANNOT FIT ABOVE z10. Territory spread over several
 * regions (D-381's 50 km clusters — the operator's runs span states) needs a zoom below the z10
 * floor to fit, and the floor wins (§4.4: below it the fog misrepresents what is explored). So the
 * fit falls back to the region the view is in — or the nearest one — which is the whole of the
 * territory that can be seen at once. Jump-to (`0285`) is how to reach the others.
 */
export function territoryTarget(
  runs: readonly WebRunInput[],
  fits: (bounds: LngLatBounds) => boolean,
  centre: { lng: number; lat: number },
): LngLatBounds | null {
  const whole = territoryBounds(runs)
  if (!whole || fits(whole)) return whole
  const regions = regionsOf(runs)
  if (regions.length === 0) return whole
  const here = regions.find((r) => inside(r.bounds, centre))
  if (here) return here.bounds
  return regions.reduce((a, b) => (distanceTo(b.bounds, centre) < distanceTo(a.bounds, centre) ? b : a)).bounds
}

/** `⌖`. Recentre on the last run's end at z14. Returns whether it moved. */
export function recentre(map: CameraHost, latest: RunFeatureCollection): boolean {
  const end = lastRunEnd(latest)
  if (!end) return false
  map.easeTo({ center: end, zoom: RECENTRE_ZOOM, bearing: 0, pitch: 0 })
  return true
}

/**
 * Fit the whole territory in the pane, with §3.2's 12% padding, never closer than the zoom bound —
 * or, when the whole cannot fit at z10, the region in view (`territoryTarget`). Returns whether it moved.
 */
export function fitTerritory(map: CameraHost, runs: readonly WebRunInput[]): boolean {
  const box = map.getContainer().getBoundingClientRect()
  const padding = Math.round(Math.min(box.width, box.height) * 0.12)
  const fits = (b: LngLatBounds) => {
    const zoom = map.cameraForBounds(b, { padding })?.zoom
    return zoom === undefined || zoom >= ZOOM_MIN
  }
  const bounds = territoryTarget(runs, fits, map.getCenter())
  if (!bounds) return false
  map.fitBounds(bounds, { padding, maxZoom: ZOOM_MAX, bearing: 0, pitch: 0 })
  return true
}
