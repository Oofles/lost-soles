import { cellToLatLng, type H3Index } from "h3-js"

import { cellToBig } from "@/src/domain/explored-blob"
import { REVEAL_R_M, segmentsToCells } from "@/src/domain/fog"
import type { RouteTraceGeometry } from "@/lib/runs/wire"

import { mercatorX, mercatorY } from "./instances"
import { quantiseArc, type RevealPoint } from "./reveal-tag"

/**
 * A RUN'S REVEAL SET, COMPUTED IN THE BROWSER. Ticket `0079`. `06-ui-ux.md` §3.2 beat 1.
 *
 * Beat 1 *"never waits on the server"*: the cells and their order along the route come from the
 * trace the page already holds, with no network call. This module turns a run's stored route into
 * the two things the reveal needs:
 *
 *   - **which cells** — `segmentsToCells`, the domain's own §2.2 steps 4-5, over the very segments
 *     the sanitiser produced (`0195` stores them as the route line). Not an approximation of the
 *     server's answer: the same function. The stored line is rounded to 6 dp (~0.1 m) and drops
 *     one-point segments, so a cell sitting within ~0.1 m of the 65 m boundary can differ. That
 *     residue is cosmetic and temporary — `0251` serves the server's own ids.
 *   - **where along the route each one is** — `arc`, by arc length, `0..1`. *"Arc-length
 *     parameterised, not time parameterised"*: pace is not the subject, so a stop at a light is
 *     no pause in the reveal.
 *
 * ─── WHICH PASS OF AN OUT-AND-BACK CLEARS A CELL ────────────────────────────
 *
 * A cell's arc is the route's CLOSEST APPROACH during its FIRST pass within `REVEAL_R_M` — not the
 * global closest approach, which on an out-and-back can be the return leg and would leave ground
 * fogged behind a lantern that has already walked past it; and not the first moment it comes within
 * reach, which clears ground ~65 m AHEAD of the lantern and reads as the fog parting before it
 * rather than burning back behind it.
 *
 * ─── THE CLIENT STILL NEVER INVENTS CELLS ───────────────────────────────────
 *
 * Nothing here touches `ExploredSet`. `preRunCells` and `postRunCells` return NEW arrays for the
 * renderer's own stores; the account's set is read, never written.
 */

export interface RevealCell extends RevealPoint {
  cell: H3Index
}

/** Metres between samples of the route when locating each cell's closest approach. */
const SAMPLE_STEP_M = 5

/**
 * The cells a route reveals, each with its arc, sorted by arc.
 *
 * Distances are planar in a frame anchored at the route's first point (longitude scaled by its
 * cosine) — the same simplification `distancePointToSegments` makes, at the same scale, and cheap
 * enough that a marathon's ~1,000 cells against ~8,000 samples is a few milliseconds.
 */
export function revealCellsForRoute(geometry: RouteTraceGeometry | null | undefined): RevealCell[] {
  if (!geometry || geometry.type !== "MultiLineString") return []
  const parts = geometry.coordinates
    .filter((part) => part && part.length >= 2)
    .map((part) => part.map(([lng, lat]) => ({ lat: lat!, lng: lng! })))
  if (parts.length === 0) return []

  const cells = segmentsToCells(parts)
  if (cells.size === 0) return []

  const lat0 = parts[0]![0]!.lat
  const kx = 111_320 * Math.cos((lat0 * Math.PI) / 180)
  const ky = 110_540
  const toX = (lng: number) => lng * kx
  const toY = (lat: number) => lat * ky

  /** The route resampled every `SAMPLE_STEP_M`, in local metres, with metres-walked at each. */
  const xs: number[] = []
  const ys: number[] = []
  const along: number[] = []
  let walked = 0
  for (const part of parts) {
    for (let i = 0; i < part.length; i++) {
      const x = toX(part[i]!.lng)
      const y = toY(part[i]!.lat)
      if (i === 0) {
        xs.push(x)
        ys.push(y)
        along.push(walked)
        continue
      }
      const px = toX(part[i - 1]!.lng)
      const py = toY(part[i - 1]!.lat)
      const span = Math.hypot(x - px, y - py)
      const steps = Math.max(1, Math.ceil(span / SAMPLE_STEP_M))
      for (let k = 1; k <= steps; k++) {
        const t = k / steps
        xs.push(px + (x - px) * t)
        ys.push(py + (y - py) * t)
        along.push(walked + span * t)
      }
      walked += span
    }
    // The gap to the next part adds nothing: there was no running there (`0045`, D-198).
  }

  const reach2 = REVEAL_R_M * REVEAL_R_M
  const out: RevealCell[] = []
  for (const cell of cells) {
    const [lat, lng] = cellToLatLng(cell)
    const cx = toX(lng)
    const cy = toY(lat)
    let bestAny = Infinity
    let bestAnyAt = 0
    let bestPass = Infinity
    let bestPassAt = -1
    let inPass = false
    let passDone = false
    for (let i = 0; i < xs.length; i++) {
      const dx = xs[i]! - cx
      const dy = ys[i]! - cy
      const d = dx * dx + dy * dy
      if (d < bestAny) {
        bestAny = d
        bestAnyAt = i
      }
      if (passDone) continue
      if (d <= reach2) {
        inPass = true
        if (d < bestPass) {
          bestPass = d
          bestPassAt = i
        }
      } else if (inPass) {
        passDone = true
      }
    }
    // A cell `segmentsToCells` accepted is within 65 m of a segment, so a pass always exists bar
    // sampling at the very boundary; then the closest approach anywhere is the honest fallback.
    const at = bestPassAt >= 0 ? bestPassAt : bestAnyAt
    out.push({
      cell,
      x: mercatorX(lng),
      y: mercatorY(lat),
      arc: quantiseArc(walked > 0 ? along[at]! / walked : 0),
    })
  }
  out.sort((a, b) => a.arc - b.arc || (a.cell < b.cell ? -1 : a.cell > b.cell ? 1 : 0))
  return out
}

/**
 * The explored set as it was before the run: `persisted` without the reveal cells. Ascending,
 * unique, a new array — what `ExploredSet.fromCells` takes for the reveal's own `pre` store.
 */
export function preRunCells(persisted: BigUint64Array, reveal: readonly RevealCell[]): BigUint64Array {
  const drop = new Set<bigint>(reveal.map((r) => cellToBig(r.cell)))
  let kept = 0
  for (let i = 0; i < persisted.length; i++) if (!drop.has(persisted[i]!)) kept++
  const out = new BigUint64Array(kept)
  let at = 0
  for (let i = 0; i < persisted.length; i++) {
    const c = persisted[i]!
    if (!drop.has(c)) out[at++] = c
  }
  return out
}

/**
 * The explored set after the run: `persisted` with the reveal cells merged in. Returns `persisted`
 * ITSELF when it already holds every one of them — the ordinary case on `/run/:id`, whose cells
 * were written at ingest — so the reveal's `post` store can be the account's own store and derive
 * nothing a second time.
 */
export function postRunCells(persisted: BigUint64Array, reveal: readonly RevealCell[]): BigUint64Array {
  const missing: bigint[] = []
  for (const r of reveal) {
    const big = cellToBig(r.cell)
    if (!has(persisted, big)) missing.push(big)
  }
  if (missing.length === 0) return persisted
  missing.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  const out = new BigUint64Array(persisted.length + missing.length)
  let i = 0
  let j = 0
  let at = 0
  while (i < persisted.length || j < missing.length) {
    if (j >= missing.length || (i < persisted.length && persisted[i]! < missing[j]!)) {
      out[at++] = persisted[i++]!
    } else {
      out[at++] = missing[j++]!
    }
  }
  return out
}

function has(sorted: BigUint64Array, target: bigint): boolean {
  let lo = 0
  let hi = sorted.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1
    const at = sorted[mid]!
    if (at === target) return true
    if (at < target) lo = mid + 1
    else hi = mid - 1
  }
  return false
}
