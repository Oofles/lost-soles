import { gridDisk, latLngToCell, type H3Index } from "h3-js"

import type { GeoPoint, Trace } from "./activity"
import { MAX_IMPLIED_SPEED_MS, impliedSpeedMs, metresBetween } from "./geo"

/**
 * TRACE → TERRITORY. Ticket `0045`. `05-fog-of-war.md` §2.2 is the specification and its
 * pseudocode is normative.
 *
 * `traceToCells` turns a normalised `Trace` into the set of H3 res-10 cells a run
 * qualifies. It owns steps 1–4 — clean, collapse dwells, split, densify and collect
 * candidates. **Step 5, the exact 65 m radius filter, is ticket `0046`**, and it is the
 * step that turns this generous candidate set into the definition of the word "revealed".
 * Nothing may treat this function's output as revealed ground until `0046` lands;
 * `0047`, which writes `ExploredCell`, depends on `0046` for exactly that reason.
 *
 * PURE. No clock, no network, no randomness, no store access. It runs server-side in the
 * ingest Lambda, always (§2.2) — the client never computes cells for scoring. With one
 * user that trust boundary is theoretical, and it costs nothing to get right.
 *
 * ─── WHY A `Set`, AND WHY THAT IS NOT AN IMPLEMENTATION DETAIL ──────────────
 *
 * Every same-run property in §3.3 falls out of the return type alone. An out-and-back over
 * one street, a loop, a figure-eight, crossing your own path at mile four — each is a cell
 * appearing in the set once or not at all, with no code anywhere that knows those cases
 * exist. Do not "optimise" it into an array; the deduplication IS the feature.
 *
 * ─── RESOLUTION 10, CANONICAL, NEVER MIXED (D-115) ──────────────────────────
 *
 * A res-9 cell and its res-10 children are different ids, and `gridDisk`, `gridDistance`
 * and `gridPathCells` all refuse to cross resolutions. Res 10 is the only resolution this
 * function ever emits. Coarser resolutions exist only as derived render aggregates
 * (`0058`) and only as a transport option (`0049`) — and a compacted array must go back
 * through `uncompactCells(arr, 10)` before any membership test.
 */

/** The one resolution. D-115; see the header. */
export const RES = 10

/** Drop samples with worse reported accuracy. Absent accuracy is unknown, NOT bad. */
export const MAX_ACC_M = 50

/** Below this speed a runner is not running. §2.2. */
export const DWELL_SPEED_MS = 0.5

/** ...and below it for this long, they are standing still. §2.2. */
export const DWELL_MIN_S = 60

/**
 * THE SPEED ABOVE WHICH A STEP IS A LOST FIX, NOT A RUN — and it is the SAME NUMBER the
 * ingestion sanitizer gates on, deliberately. Ticket `0045` criterion 11; D-197.
 *
 * §2.2 as written says `TELEPORT_SPEED = 12.0`, and the `05-strava-adapter` drift audit
 * (2026-09-06, divergence 2) flagged that it contradicts the sanitizer, which D-197 set to
 * **12.5 m/s** for foot activities after measuring 21,225 real fixes. The audit left the
 * number unresolved on purpose and made reconciling it this ticket's obligation, because
 * §9.5 says to measure before touching these constants and the measurement already existed.
 *
 * **12.0 is wrong, and the reasoning is D-197's own.** A trace reaching this function has
 * already passed the sanitizer's gate, so a 12.0 threshold here can only ever fire in the
 * band 12.0–12.5 — on exactly the fixes D-197 deliberately decided to KEEP, having found
 * that an 8 m/s gate caught zero GPS jumps and rejected five plausible human bursts. And
 * firing is not free: a split writes a break into the corridor, which is the "dotted
 * corridor" §9.5 warns about and which D-197 treats as a real harm rather than the safe
 * direction. Shipping 12.0 would mean the fog layer re-introducing, one module later, the
 * precise defect the sanitizer was re-measured to remove.
 *
 * **So the two gates are one gate, with one owner.** The table lives in `./geo.ts` (moved
 * there by this ticket) and both consumers read it; restating `12.5` here would be the
 * two-owners-of-one-value failure D-193 names, and the next measurement would move one and
 * not the other.
 *
 * **Why the `run` row specifically, with no `ActivityKind` parameter.** Exactly one skill
 * row in `rules/xp-rules-v1.yaml` carries `revealsGround: true` (D-189), and its `match`
 * names the three on-foot kinds — all of which hold the same 12.5. Wheeled activities
 * never reach this function, so the sanitizer's 30 m/s row is irrelevant here, and
 * threading a kind through `traceToCells` would buy a distinction that cannot arise.
 *
 * (The row is not named here. Naming a skill id outside the rules layer is the coupling
 * D-031 forbids, and `src/rules/no-skill-names.test.ts` fires on it — as it did on the
 * first draft of this comment.)
 *
 * If a future row ever sets `revealsGround: true` for a wheeled kind, THIS is the line
 * that has to grow a parameter. The comment is here so whoever does it knows the
 * constraint was considered rather than missed.
 */
export const TELEPORT_SPEED_MS = MAX_IMPLIED_SPEED_MS.run

/** A gap this wide (§2.2)... */
export const SPLIT_GAP_M = 250

/** ...lasting this long is a dropout, not a stride. */
export const SPLIT_GAP_S = 120

/**
 * Densify to at most this spacing before indexing.
 *
 * Comfortably under res 10's **65.7 m inradius**, so no cell along the path can be skipped
 * when the stream drops points in a tunnel or under tree cover. `gridPathCells(a, b)` is
 * the cheaper alternative and it is wrong: it returns a *grid* line rather than a geodesic
 * one, fails across pentagons, and errors outright on long distances. Densify-then-index
 * is boring and correct; prefer it.
 */
export const DENSIFY_STEP_M = 30

/**
 * How many Weiszfeld iterations the geometric median gets. Fixed, because purity means
 * deterministic: an iterate-until-converged loop makes the output depend on floating-point
 * luck, and a dwell is a handful of metres across where 32 iterations is far past the
 * point of measurable movement.
 */
const MEDIAN_ITERATIONS = 32

/**
 * TRACE → CANDIDATE CELLS. §2.2 steps 1–4.
 *
 * @returns res-10 cell ids only. Generous by construction — `0046`'s exact radius filter
 *          is what makes the answer mean "revealed".
 */
export function traceToCells(trace: Trace): Set<H3Index> {
  const cells = new Set<H3Index>()

  for (const run of splitOnGaps(trace)) {
    // 1. clean ─────────────────────────────────────────────────────────────
    const cleaned = clean(run)
    if (cleaned.length === 0) continue

    // 2. collapse pauses ───────────────────────────────────────────────────
    const collapsed = collapseDwells(cleaned)

    // 3. split on implausible jumps ────────────────────────────────────────
    for (const segment of splitImplausible(collapsed)) {
      // 4. densify + collect candidates ────────────────────────────────────
      for (const p of densify(segment)) {
        const cell = latLngToCell(p.lat, p.lng, RES)
        // k=1 so a path grazing a cell's edge still qualifies it. NOT the answer —
        // `gridDisk(c, 1)` is 7 cells and ~394 m across, which would gift the two
        // parallel streets either side and attack D-012 directly. `0046` corrects it.
        for (const candidate of gridDisk(cell, 1)) cells.add(candidate)
      }
    }
  }

  return cells
}

/**
 * STEP 0, WHICH §2.2 DOES NOT HAVE — split on `Trace.gaps` before anything else.
 * Ticket `0045`, D-198.
 *
 * §2.2's pseudocode takes a bare list of points and was written before `gaps` existed. The
 * field arrived with D-198 and carries the one question this function has to ask: *may a
 * corridor be drawn across here?* Two different causes feed it — a time interval past
 * `GAP_THRESHOLD_MS` (30 s, D-195) and a sanitation break where an implausible fix was
 * dropped between two accepted ones — and D-198 is explicit that they share one field
 * precisely so that no consumer can honour one and forget the other. This is a consumer.
 *
 * **It is also strictly stronger than §2.2's own step 3, which is why it goes first.** A
 * 30-second interval breaks the trace regardless of distance; §2.2's rule needs 250 m AND
 * 120 s. Every split §2.2 would make across a dropout, `gaps` has already made. Step 3
 * survives as defence in depth for a `Trace` that did not come through the sanitizer —
 * this is a domain function and it does not get to assume its caller — and it is expected
 * never to fire on a normalised one.
 *
 * A pair is `[startIdx, endIdx]` into `trace.points`. The cut is expressed per adjacency
 * rather than per pair so that a pair spanning more than one step cuts every step it
 * covers and drops no point on the floor. In practice every pair is `[i, i+1]`.
 */
function splitOnGaps(trace: Trace): GeoPoint[][] {
  const points = trace.points
  if (points.length === 0) return []

  const cutAfter = new Set<number>()
  for (const [start, end] of trace.gaps) {
    for (let i = start; i < end; i++) cutAfter.add(i)
  }

  const runs: GeoPoint[][] = []
  let current: GeoPoint[] = []
  for (let i = 0; i < points.length; i++) {
    current.push(points[i])
    if (cutAfter.has(i)) {
      runs.push(current)
      current = []
    }
  }
  if (current.length) runs.push(current)
  return runs
}

/**
 * STEP 1. Drop what cannot be trusted and what says nothing.
 *
 * Reported accuracy is used where the adapter provides it (Health Connect's
 * `ExerciseRoute` does, D-113; the MVP source's stream does not). **Absent accuracy is
 * unknown, not zero** — `GeoPoint.accuracyM` is optional for that reason, and treating a
 * missing value as a failure would discard every point from the only source that ships.
 *
 * Consecutive identical coordinates are dropped because they contribute nothing to the
 * geometry and would otherwise weight a dwell's geometric median towards whichever fix the
 * receiver happened to repeat.
 */
function clean(points: readonly GeoPoint[]): GeoPoint[] {
  const out: GeoPoint[] = []
  for (const p of points) {
    if (p.accuracyM != null && p.accuracyM > MAX_ACC_M) continue
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue
    const last = out[out.length - 1]
    if (last && last.lat === p.lat && last.lng === p.lng) continue
    out.push(p)
  }
  return out
}

/**
 * STEP 2. COLLAPSE dwells — do not drop them.
 *
 * A stationary runner at a traffic light, a water fountain or a shoe retie keeps emitting
 * points that wander with GPS drift. Left alone, a three-minute pause smears a disc of
 * noise cells around a single spot — the "blob several cells wide" `0046`'s operator check
 * looks for. Dropping the dwell instead would be worse in the other direction: the runner
 * is still ON the route and that cell must still be revealed.
 *
 * So each dwell becomes exactly one point, at the geometric median of its fixes, timed at
 * the midpoint of the dwell. The midpoint is chosen over either end deliberately: it
 * leaves half the dwell's duration on each side, so neither the step into the dwell nor
 * the step out of it can look implausibly fast to step 3.
 */
function collapseDwells(points: readonly GeoPoint[]): GeoPoint[] {
  if (points.length < 2) return [...points]

  const out: GeoPoint[] = []
  let i = 0
  while (i < points.length) {
    // How far does a run of slow steps extend from here?
    let j = i
    while (
      j + 1 < points.length &&
      impliedSpeedMs(points[j], points[j + 1]) < DWELL_SPEED_MS
    ) {
      j++
    }

    const seconds = (points[j].t - points[i].t) / 1000
    if (j > i && seconds >= DWELL_MIN_S) {
      out.push(geometricMedian(points.slice(i, j + 1)))
      i = j + 1
    } else {
      out.push(points[i])
      i++
    }
  }
  return out
}

/**
 * The geometric median (the point minimising total distance to all of them), by Weiszfeld
 * iteration — NOT the centroid, which a single wild fix drags with it.
 *
 * Computed in a local planar frame: a dwell spans metres, so scaling longitude by
 * `cos(lat)` about the cluster's own mean makes the geometry Euclidean to well under a
 * millimetre, and the alternative — spherical iteration — would add trigonometry to buy
 * nothing at this scale.
 *
 * The timestamp is the dwell's midpoint; see `collapseDwells`.
 */
function geometricMedian(points: readonly GeoPoint[]): GeoPoint {
  const lat0 = points.reduce((s, p) => s + p.lat, 0) / points.length
  const k = Math.cos((lat0 * Math.PI) / 180)

  const xs = points.map((p) => p.lng * k)
  const ys = points.map((p) => p.lat)

  let x = xs.reduce((s, v) => s + v, 0) / xs.length
  let y = ys.reduce((s, v) => s + v, 0) / ys.length

  for (let iter = 0; iter < MEDIAN_ITERATIONS; iter++) {
    let wx = 0
    let wy = 0
    let w = 0
    let coincident = false
    for (let i = 0; i < xs.length; i++) {
      const d = Math.hypot(xs[i] - x, ys[i] - y)
      // Weiszfeld is undefined AT a sample. Landing exactly on one means the iterate has
      // already converged to it, so stop rather than divide by zero.
      if (d === 0) {
        coincident = true
        break
      }
      wx += xs[i] / d
      wy += ys[i] / d
      w += 1 / d
    }
    if (coincident || w === 0) break
    x = wx / w
    y = wy / w
  }

  const first = points[0]
  const last = points[points.length - 1]
  return {
    lat: y,
    lng: x / k,
    t: Math.round((first.t + last.t) / 2),
  }
}

/**
 * STEP 3. SPLIT, never interpolate, across an implausible jump.
 *
 * A lost fix that reacquires 400 m away must not draw a corridor through the buildings in
 * between, and neither must a drive between a trailhead and home recorded inside one
 * activity. Splitting is the conservative direction and the asymmetry is the whole reason:
 * under-revealing is recoverable — run it again — and over-revealing is not, because D-020
 * makes it permanent.
 *
 * Expected never to fire on a normalised `Trace`: the sanitizer has already applied the
 * same speed gate (see `TELEPORT_SPEED_MS`) and `gaps` has already cut anything past 30 s
 * (see `splitOnGaps`). It is kept because this is a domain function, and a domain function
 * that assumes its input was sanitised is one bad adapter away from a permanent scar.
 */
function splitImplausible(points: readonly GeoPoint[]): GeoPoint[][] {
  if (points.length === 0) return []

  const segments: GeoPoint[][] = []
  let current: GeoPoint[] = [points[0]]

  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    const metres = metresBetween(a, b)
    const seconds = (b.t - a.t) / 1000

    const teleport = impliedSpeedMs(a, b) > TELEPORT_SPEED_MS
    const dropout = metres > SPLIT_GAP_M && seconds > SPLIT_GAP_S

    if (teleport || dropout) {
      segments.push(current)
      current = [b]
    } else {
      current.push(b)
    }
  }
  segments.push(current)
  return segments
}

/**
 * STEP 4a. Interpolate along the great circle so no step exceeds `DENSIFY_STEP_M`.
 *
 * Spherical interpolation rather than linear-in-degrees. At the distances that survive
 * step 3 the two agree to about a centimetre, so this is not chasing accuracy — it is
 * refusing to carry a small-angle assumption in a function whose output is permanent, and
 * costs a handful of trigonometric calls per step.
 *
 * Endpoints are emitted once: each step contributes its start and its interior samples,
 * and the segment's final point is appended at the end.
 */
function densify(points: readonly GeoPoint[]): Array<{ lat: number; lng: number }> {
  if (points.length === 0) return []
  if (points.length === 1) return [{ lat: points[0].lat, lng: points[0].lng }]

  const out: Array<{ lat: number; lng: number }> = []
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]
    const b = points[i + 1]
    const steps = Math.max(1, Math.ceil(metresBetween(a, b) / DENSIFY_STEP_M))
    for (let k = 0; k < steps; k++) out.push(interpolate(a, b, k / steps))
  }
  const last = points[points.length - 1]
  out.push({ lat: last.lat, lng: last.lng })
  return out
}

/** Great-circle point a fraction `f` of the way from `a` to `b`. */
function interpolate(
  a: GeoPoint,
  b: GeoPoint,
  f: number,
): { lat: number; lng: number } {
  const toRad = Math.PI / 180
  const lat1 = a.lat * toRad
  const lng1 = a.lng * toRad
  const lat2 = b.lat * toRad
  const lng2 = b.lng * toRad

  const dLat = lat2 - lat1
  const dLng = lng2 - lng1
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  const d = 2 * Math.asin(Math.min(1, Math.sqrt(h)))

  // Coincident endpoints: the slerp weights below are 0/0 there.
  if (d === 0) return { lat: a.lat, lng: a.lng }

  const wa = Math.sin((1 - f) * d) / Math.sin(d)
  const wb = Math.sin(f * d) / Math.sin(d)

  const x = wa * Math.cos(lat1) * Math.cos(lng1) + wb * Math.cos(lat2) * Math.cos(lng2)
  const y = wa * Math.cos(lat1) * Math.sin(lng1) + wb * Math.cos(lat2) * Math.sin(lng2)
  const z = wa * Math.sin(lat1) + wb * Math.sin(lat2)

  return {
    lat: Math.atan2(z, Math.hypot(x, y)) / toRad,
    lng: Math.atan2(y, x) / toRad,
  }
}
