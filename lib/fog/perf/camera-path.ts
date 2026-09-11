import type { FogPerf } from "./collector"
import type { GpuTimer } from "./gpu-timer"

/**
 * THE SCRIPTED CAMERA PATH. Ticket `0059` criterion 3. `05-fog-of-war.md` §6.4 item 3.
 *
 * *"Frame time p50/p95 from rAF deltas during a **scripted** camera path — a fixed pan/zoom sequence
 * replayed identically on every build, so numbers are comparable across commits."*
 *
 * ─── STEPS, NOT SECONDS ────────────────────────────────────────────────────
 *
 * The obvious path is `map.easeTo({ duration: 2000 })` and it is the wrong one. An eased camera is a
 * function of **wall-clock time**, so a device that draws at 30 fps visits half as many camera states
 * as one at 60 — and then reports a better p95 for having done less work. The comparison the ticket
 * wants is between builds and between devices, and that path makes both meaningless.
 *
 * So the path is a fixed list of camera states, advanced one per animation frame. Every device
 * visits **exactly the same states in exactly the same order**; a slow device takes longer in
 * wall-clock and that shows up where it should, in the frame deltas. Replaying it on a later commit
 * compares like with like by construction rather than by hoping the easing curve landed the same way.
 *
 * ─── AND THE STEPS ARE IN SCREEN PIXELS ────────────────────────────────────
 *
 * Not in degrees, and not in metres. Every assertion §6.2 and §6.4 make is **screen-relative**: the
 * padded region is 20% of the viewport's own width, `visibleInstanceCount` is bounded by screen area
 * (D-238), and the cull's cost is a function of what is on screen. A path defined in degrees would
 * pan a 400x800 phone clean out of its padded region on a step that a 1440x900 desktop absorbed,
 * and the `pan-inside` phase — whose whole assertion is *zero culls* — would then assert different
 * things on the two surfaces while claiming to be the same path.
 *
 * The consequence is stated rather than hidden: the two surfaces cover different amounts of GROUND.
 * That is correct. The ground is not what is being measured.
 *
 * ─── THE PHASES ARE THE ASSERTIONS ─────────────────────────────────────────
 *
 * | phase         | what §6.4 asserts about it                                              |
 * |---------------|-------------------------------------------------------------------------|
 * | `load`        | nothing. The fixture decode and the first cold bucket live here so they  |
 * |               | are not charged to a pan. §6.3 prices a cold derivation at 30-80 ms.     |
 * | `settle`      | item 4's *"~0 ms with the camera still"* — `maskDirty` false, no cull.   |
 * | `pan-inside`  | item 4's *"~0 ms inside the padded region"* — **zero culls**, §6.2.      |
 * | `pan-across`  | item 3's p95 < 16.7 ms, and item 6's zero long tasks. The main event.    |
 * | `zoom-out`    | item 1's ceiling across every bucket, and item 5's derivation cost.      |
 * | `zoom-in`     | the same, warm — which is what makes item 5's hit rate mean something.   |
 * | `pan-z17`     | p95 at the finest resolution, where there are the most instances.       |
 *
 * `run-cull.mjs` drives the same shape headlessly (a pan inside the padded region, one that leaves
 * it, then z17 down to z5) and the overlap is deliberate: when a number here is a surprise, that
 * harness is where it gets bisected without a phone in the loop.
 */

/** One segment of the path: `steps` frames, each applying the same delta. */
export interface PathSegment {
  phase: string
  steps: number
  /** Screen-space pan per step, in CSS pixels, applied to the map centre. */
  dxPx: number
  dyPx: number
  /** Absolute zoom to hold, or a per-step delta from the segment's start. */
  zoom?: number
  dZoom?: number
}

/** z14 is §9.5's planning zoom and D-051's floor; z17 is one street filling the screen. */
export const PATH: readonly PathSegment[] = [
  { phase: "settle", steps: 60, dxPx: 0, dyPx: 0, zoom: 14 },
  /**
   * 30 steps x 2 px = 60 px, against a padded region that extends 20% of the viewport's HEIGHT
   * beyond its edge — 160 px on a 400x800 phone, 180 px on a 1440x900 desktop. Comfortably inside
   * both, which is what makes "zero culls" an assertion about the code rather than about the
   * viewport that happened to run it.
   */
  { phase: "pan-inside", steps: 30, dxPx: 0, dyPx: -2, zoom: 14 },
  /**
   * OUT AND BACK, in two segments sharing one phase name — `beginPhase` reuses the accumulator, so
   * the two report as one `pan-across`.
   *
   * ~1.2 phone viewport widths each way, so the padded region is left and rebuilt many times over in
   * both directions. **The return leg is not symmetry for its own sake.** A one-way pan leaves the
   * camera 960 px from where it started, and every later phase — the whole zoom sweep — then happens
   * over ground offset from the dataset's centre. At the 50k size that is far enough for the disc's
   * EDGE to enter the viewport at z13, which made the cross-dataset canary report a smaller count for
   * the smaller dataset and read as drift when it was geometry. Coming back also matches what a
   * person does with a map.
   */
  { phase: "pan-across", steps: 120, dxPx: 4, dyPx: 0, zoom: 14 },
  { phase: "pan-across", steps: 120, dxPx: -4, dyPx: 0, zoom: 14 },
  { phase: "zoom-out", steps: 120, dxPx: 0, dyPx: 0, zoom: 17, dZoom: -0.1 },
  { phase: "zoom-in", steps: 120, dxPx: 0, dyPx: 0, zoom: 5, dZoom: 0.1 },
  { phase: "pan-z17", steps: 120, dxPx: 3, dyPx: 0, zoom: 17 },
]

export const PATH_STEPS = PATH.reduce((total, segment) => total + segment.steps, 0)

/** Steps per phase, summed across segments that share a name. */
export function stepsPerPhase(path: readonly PathSegment[] = PATH): Map<string, number> {
  const out = new Map<string, number>()
  for (const segment of path) out.set(segment.phase, (out.get(segment.phase) ?? 0) + segment.steps)
  return out
}

/** The slice of MapLibre's `Map` the driver needs. Small on purpose — the test drives an object. */
export interface PathMap {
  getZoom(): number
  getCenter(): { lng: number; lat: number }
  getCanvas(): { clientWidth: number; clientHeight: number }
  unproject(point: [number, number]): { lng: number; lat: number }
  jumpTo(options: { center: { lng: number; lat: number }; zoom: number }): void
  triggerRepaint(): void
}

export interface PathHost {
  now(): number
  requestAnimationFrame(callback: () => void): number
}

export const browserPathHost: PathHost = {
  now: () => performance.now(),
  requestAnimationFrame: (callback) => window.requestAnimationFrame(callback),
}

export interface PathProgress {
  phase: string
  step: number
  total: number
}

/**
 * Drive the path to completion. Resolves when the last step has been drawn.
 *
 * THE FRAME IS SAMPLED BEFORE THE CAMERA MOVES, and the order is load-bearing. `perf.frame()` records
 * the delta since the previous callback — which is the time the browser took to draw the state set
 * on that previous callback. Moving first and sampling after would attribute each state's cost to the
 * step that came after it, putting every phase boundary's cost in the wrong phase.
 */
export async function driveScriptedPath(
  map: PathMap,
  perf: FogPerf,
  options: {
    gpuTimer?: GpuTimer
    host?: PathHost
    path?: readonly PathSegment[]
    onProgress?: (progress: PathProgress) => void
    /**
     * Called once per frame, AFTER the frame is sampled and BEFORE the camera moves — so what it
     * reads is the state that was just drawn, at the zoom it was drawn at. Sampling after the jump
     * would pair the count from the old bucket with the zoom of the new one, which at a band
     * boundary is precisely the pairing §6.4 item 1's histogram exists to rule out.
     */
    onSample?: (phase: string) => void
  } = {},
): Promise<void> {
  const host = options.host ?? browserPathHost
  const path = options.path ?? PATH
  const total = path.reduce((sum, segment) => sum + segment.steps, 0)
  let done = 0

  for (const segment of path) {
    perf.beginPhase(segment.phase)
    const startZoom = segment.zoom ?? map.getZoom()

    for (let step = 0; step < segment.steps; step++) {
      await new Promise<void>((resolve) => host.requestAnimationFrame(resolve))

      perf.frame(host.now())
      options.gpuTimer?.poll()
      options.onSample?.(segment.phase)

      const canvas = map.getCanvas()
      const zoom = startZoom + (segment.dZoom ?? 0) * step
      /**
       * `unproject` FROM THE CANVAS CENTRE, not arithmetic on the longitude. A pixel is a constant
       * mercator distance but a varying number of degrees of longitude with latitude, and a varying
       * number of degrees of latitude with latitude too — so a path expressed in degrees drifts out
       * of screen space the moment it moves north, and `pan-inside`'s zero-cull assertion drifts
       * with it. MapLibre's own projection is the only thing that knows the answer for the camera it
       * currently has.
       */
      const centre =
        segment.dxPx === 0 && segment.dyPx === 0
          ? map.getCenter()
          : map.unproject([
              canvas.clientWidth / 2 + segment.dxPx,
              canvas.clientHeight / 2 + segment.dyPx,
            ])

      map.jumpTo({ center: { lng: centre.lng, lat: centre.lat }, zoom })
      /**
       * A still camera draws nothing without this. `jumpTo` with no movement fires no `move`, so on
       * the `settle` phase MapLibre would idle and the rAF loop would be measuring an empty frame —
       * reporting the fog's cost as zero by never drawing it. The animator repaints anyway while the
       * fog animates, and this makes the phase honest when it does not.
       */
      map.triggerRepaint()

      done++
      options.onProgress?.({ phase: segment.phase, step: done, total })
    }
  }
}
