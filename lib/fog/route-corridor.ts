import { getHexagonEdgeLengthAvg } from "h3-js"

import { metresBetween } from "@/src/domain/geo"
import type { RouteTraceGeometry } from "@/lib/runs/wire"

import { discRadiusM, mercatorX, mercatorY, metresToMercator } from "./instances"
import { INSTANCE_FLOATS } from "./mask"

/**
 * THE OPTIMISTIC CORRIDOR. Ticket `0057`. `05-fog-of-war.md` §4.4's *"optimisation worth taking"*,
 * R4 §4.4.
 *
 * §4.4: *"draw the just-uploaded run's polyline into the mask as a thick soft line as well, so the
 * corridor clears the instant the run appears, before the server's cell write round-trips back."*
 *
 * ─── IT IS DRAWN AS DISCS, NOT AS A LINE, AND THAT IS THE WHOLE DESIGN ──────
 *
 * "A thick soft line" describes the result, not the primitive. Rendering it as an actual line
 * would mean a second program, a second VAO and a second falloff function — and then a corridor
 * whose feather is a DIFFERENT shape from the one the cells produce. When the real cells landed a
 * moment later, the edge would change character, which is exactly the visible jump this
 * optimisation exists to avoid.
 *
 * Splatting the same disc the cell field is made of costs no new GL objects at all: the instances
 * are four floats in the layout `mask.ts` already draws, appended to the bucket's own. The
 * corridor is then made of the same material as the map, and the transition when the cells arrive
 * is a widening rather than a substitution.
 *
 * ─── THE CLIENT NEVER INVENTS CELLS ─────────────────────────────────────────
 *
 * Nothing here produces an H3 id, and nothing here touches the explored `Set` or its
 * `BigUint64Array`. A corridor disc is four floats in a vertex buffer with no identity, exactly as
 * D-232's bridge discs are, and `FogMaskLayer.setBucket` discards the whole array on the next
 * rebuild. `route-corridor.test.ts` asserts the set is untouched by running the real path over it
 * (criterion 6); `explored-set.ts` is where the rule itself is stated.
 *
 * `REVEAL_R_M` — what counts as explored, permanently, under D-020 — is 65 m in `src/domain/fog.ts`
 * and is deliberately NOT the number below. `check-fog-render-boundary.mjs` is the gate that keeps
 * the two apart, and this file is on the render side of it.
 *
 * ─── IT IS NARROWER THAN WHAT REPLACES IT, ON PURPOSE ───────────────────────
 *
 * The cell reveal covers every res-10 cell within 65 m of the trace and then draws a 102 m disc at
 * each of their centres, so the eventual corridor reaches further from the line than a 102 m disc
 * centred ON the line does. The optimistic corridor is therefore a near-subset of its own
 * replacement, and under `gl.MAX` a subset is invisible once the real thing arrives.
 *
 * That asymmetry is the right way round. Too narrow means the fog EDGE creeps outward when the
 * cells land — a growth, and growth is what this map does. Too wide would mean ground that was
 * clear going back into the mist, which is what D-020 promises can never happen; the promise is
 * about the explored set rather than the mask, but a user cannot tell those apart by looking.
 */

/**
 * How far apart the discs are placed along the line.
 *
 * Adjacent H3 centres at res `r` are `sqrt(3) x edgeLength` apart — 131.4 m at res 10. D-232
 * found that discs at that spacing DO overlap but pinch to 0.79 of their bulge at every junction,
 * a string of pearls, and that halving the spacing takes the silhouette to 0.95. A corridor has
 * exactly the same geometry as the one-cell-wide chain D-232 was fixing, so it gets the same
 * answer: half the cell spacing, which is one bridge disc's worth.
 *
 * Derived rather than written down as 65.7, so an h3 upgrade that moves the edge-length table
 * moves this with it instead of leaving a literal behind.
 */
export function corridorStepM(res: number): number {
  return (Math.sqrt(3) * getHexagonEdgeLengthAvg(res, "m")) / 2
}

/**
 * A ceiling on how many discs one run may contribute, and it is a real guard rather than a
 * formality. §6.4 item 1 asserts `visibleInstanceCount <= 6,000` at every zoom and every dataset
 * size, and the corridor adds to that count: a marathon at 65.7 m spacing is ~640 discs, which is
 * fine, but a corrupted geometry or a bike-shaped "run" is not bounded by anything this module can
 * see. Stopping at the cap draws a partial corridor, which degrades to "the optimisation did not
 * cover the whole route" — the cells arrive shortly and fix it. Blowing the instance budget would
 * instead show up as a frame-rate finding in `0059` with no obvious cause.
 */
export const MAX_CORRIDOR_DISCS = 4000

export interface CorridorPack {
  /** The instance floats, in `mask.ts`'s layout. Empty when there is nothing to draw. */
  instances: Float32Array
  /** How many discs that is. `instances.length / INSTANCE_FLOATS`. */
  count: number
  /** True when `MAX_CORRIDOR_DISCS` stopped the walk early. Surfaced in `MaskStats` for the HUD. */
  truncated: boolean
}

export const EMPTY_CORRIDOR: CorridorPack = {
  instances: new Float32Array(0),
  count: 0,
  truncated: false,
}

/**
 * Sample one `MultiLineString` into disc instances.
 *
 * ─── ONE PART PER SEGMENT, AND NO CHORD BETWEEN THEM (criterion 8) ──────────
 *
 * A trace with a split (`0045`) reaches the browser as several `coordinates` entries, because
 * `segmentsToGeometry` builds one per surviving segment. Each is walked independently and the
 * walk's accumulated distance resets between them, so no disc is ever placed in the gap. The
 * chords are not filtered out here — they never exist, which is the property `0195` bought by
 * storing the sanitiser's own `segments` array rather than re-deriving geometry for the renderer.
 *
 * `res` exists so the corridor's discs match whichever bucket is on screen. `0058` will pass the
 * bucket's resolution; until then everything is res 10.
 */
export function packRouteCorridor(
  geometry: RouteTraceGeometry | null | undefined,
  options: { res?: number } = {},
): CorridorPack {
  if (!geometry || geometry.type !== "MultiLineString") return EMPTY_CORRIDOR

  const res = options.res ?? 10
  const radiusM = discRadiusM(res)
  const step = corridorStepM(res)

  const discs: Array<{ lng: number; lat: number }> = []
  let truncated = false

  for (const part of geometry.coordinates) {
    if (truncated) break
    // Fewer than two positions is not a line. `segmentsToGeometry` already drops these, so this
    // is a guard against a hand-made or future producer rather than against the shipped writer.
    if (!part || part.length < 2) continue

    let carry = 0
    let previous = { lng: part[0]![0], lat: part[0]![1] }
    if (!push(discs, previous)) {
      truncated = true
      break
    }

    for (let i = 1; i < part.length; i++) {
      const next = { lng: part[i]![0], lat: part[i]![1] }
      const span = metresBetween(previous, next)
      if (span > 0) {
        // Walk this leg in `step`-metre increments, carrying the remainder across legs so a trace
        // of 5 m fixes does not emit a disc per fix — the spacing is a property of the ROUTE, not
        // of how often the watch sampled it.
        let along = step - carry
        while (along < span) {
          const t = along / span
          if (
            !push(discs, {
              lng: previous.lng + (next.lng - previous.lng) * t,
              lat: previous.lat + (next.lat - previous.lat) * t,
            })
          ) {
            truncated = true
            break
          }
          along += step
        }
        if (truncated) break
        carry = (carry + span) % step
      }
      previous = next
    }
    if (truncated) break

    // The final vertex, always. Without it a route ending mid-step leaves its tip fogged, and the
    // tip is where the operator's eye goes: it is where they stopped.
    if (!push(discs, previous)) {
      truncated = true
      break
    }
  }

  if (discs.length === 0) return EMPTY_CORRIDOR

  const instances = new Float32Array(discs.length * INSTANCE_FLOATS)
  for (let i = 0; i < discs.length; i++) {
    const { lng, lat } = discs[i]!
    const at = i * INSTANCE_FLOATS
    instances[at + 0] = mercatorX(lng)
    instances[at + 1] = mercatorY(lat)
    instances[at + 2] = metresToMercator(radiusM, lat)
    // 1.0, like every stored res-10 cell: the corridor is a claim that the operator ran HERE, not
    // a partial-coverage estimate. `0058`'s coarse buckets are where `a_fraction` earns its keep.
    instances[at + 3] = 1
  }

  return { instances, count: discs.length, truncated }
}

function push(discs: Array<{ lng: number; lat: number }>, point: { lng: number; lat: number }): boolean {
  if (discs.length >= MAX_CORRIDOR_DISCS) return false
  discs.push(point)
  return true
}

/**
 * The corridor for whatever `/api/runs/latest` returned. One feature today; a fold over all of
 * them, so `0085`'s many-runs collection needs no change here.
 */
export function packCorridorForCollection(
  features: ReadonlyArray<{ geometry: RouteTraceGeometry }>,
  options: { res?: number } = {},
): CorridorPack {
  if (features.length === 0) return EMPTY_CORRIDOR
  if (features.length === 1) return packRouteCorridor(features[0]!.geometry, options)

  const packs = features.map((f) => packRouteCorridor(f.geometry, options))
  const count = packs.reduce((n, p) => n + p.count, 0)
  const instances = new Float32Array(count * INSTANCE_FLOATS)
  let at = 0
  for (const pack of packs) {
    instances.set(pack.instances, at)
    at += pack.instances.length
  }
  return { instances, count, truncated: packs.some((p) => p.truncated) }
}
