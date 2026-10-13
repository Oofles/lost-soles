import { CAMERA_MS, easeOutCubic } from "./beat1"

/**
 * BEAT 1'S CAMERA. Ticket `0080`. `06-ui-ux.md` §3.2: *"fly to the run's bounding box with 12%
 * padding, `easeOutCubic`, 400 ms. If the run is already in frame, do not move — a gratuitous
 * camera move at the start reads as jank."*
 *
 * On an autoplay entry the page has just framed the run with no flight (`0078`), so the ordinary
 * case is "already in frame" and the camera is still. It moves when ⟲ Relive is pressed after a pan.
 */

/** `[[west, south], [east, north]]`, the shape `fitBounds` and `runBounds` use. */
export type Box = [[number, number], [number, number]]

/** §3.2's padding, as a fraction of the map's shorter side — the same rule `MapShell` frames with. */
export const RUN_PADDING = 0.12

/**
 * Whether the whole run is already visible. Containment, not overlap: a run half off-screen is not
 * "in frame", and flying to it is the move §3.2 wants.
 */
export function runInView(run: Box, view: Box): boolean {
  const [[w, s], [e, n]] = run
  const [[vw, vs], [ve, vn]] = view
  return w >= vw && e <= ve && s >= vs && n <= vn
}

export function paddingFor(width: number, height: number): number {
  return Math.round(Math.min(width, height) * RUN_PADDING)
}

/** The slice of MapLibre's `Map` the camera needs. */
export interface CameraMap {
  getBounds(): { getWest(): number; getSouth(): number; getEast(): number; getNorth(): number }
  getContainer(): { getBoundingClientRect(): { width: number; height: number } }
  fitBounds(box: Box, options: object): unknown
}

/**
 * Beat 1's 0.0–0.4 s. Flies only when the run is not already wholly in view; returns whether it did.
 * The same 12% padding and `maxZoom` `MapShell` frames the page with, so a flight lands where a
 * fresh page load would have opened.
 */
export function flyToRun(map: CameraMap, run: Box): boolean {
  const b = map.getBounds()
  const view: Box = [
    [b.getWest(), b.getSouth()],
    [b.getEast(), b.getNorth()],
  ]
  if (runInView(run, view)) return false
  const { width, height } = map.getContainer().getBoundingClientRect()
  map.fitBounds(run, { padding: paddingFor(width, height), duration: CAMERA_MS, easing: easeOutCubic, maxZoom: 17 })
  return true
}

/** The slice of MapLibre's `Map` beat 2's pull-back needs. */
export interface PullBackMap extends Pick<CameraMap, "getContainer"> {
  cameraForBounds(box: Box, options: object): { center?: unknown; zoom?: number } | undefined
  easeTo(options: object): unknown
}

/**
 * Beat 2's camera (`0081`, §3.2): *"pulls back 1.5 zoom levels"* — from the run's OWN framing, not
 * from wherever the camera happens to be. Measured in 0081's smoke: relative to the current zoom,
 * every ⟲ Relive pulled back another 1.5 levels, because beat 1 does not move a camera that already
 * holds the run, and the route shrank with each replay.
 *
 * `offset`, not `padding`, keeps the run's ground clear of the parchment: padding persists on the
 * map's transform and would skew every later `fitBounds`; an offset is spent with the move.
 */
export function pullBack(
  map: PullBackMap,
  run: Box,
  opts: { zoomOut: number; covered: number; duration: number; easing: (t: number) => number },
): boolean {
  const { width, height } = map.getContainer().getBoundingClientRect()
  const fit = map.cameraForBounds(run, { padding: paddingFor(width, height), maxZoom: 17 })
  if (!fit || fit.zoom === undefined) return false
  map.easeTo({
    center: fit.center,
    zoom: fit.zoom - opts.zoomOut,
    offset: [0, -opts.covered / 2],
    duration: opts.duration,
    easing: opts.easing,
  })
  return true
}
