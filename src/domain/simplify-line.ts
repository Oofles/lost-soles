/**
 * LINE SIMPLIFICATION, FOR DRAWING ONLY. Ticket `0085`, D-299.
 *
 * Shared by the worker (which stores the permanent web simplified) and the browser (which simplifies
 * each drawn piece of it). Never on the scoring path: cells come from the full trace (D-121), and this
 * only ever sees geometry that has already been scored.
 */

/** GeoJSON order, `[lng, lat]`. */
export type Position = [number, number]

/**
 * DOUGLAS-PEUCKER TOLERANCE, METRES.
 *
 * Two metres is a quarter of the GPS error the sanitiser already tolerates and invisible at every
 * zoom the map has; it takes a 1 Hz trace's ~3 m vertex spacing down to the bends that matter, which
 * is what keeps five years of running a fetch rather than a download.
 */
export const SIMPLIFY_TOLERANCE_M = 2

const R_EARTH = 6_371_008.8
const RAD = Math.PI / 180

/** One line, simplified, in place of the original. Equirectangular about the line's first vertex. */
export function simplifyLine(line: readonly Position[], toleranceM = SIMPLIFY_TOLERANCE_M): Position[] {
  if (line.length <= 2) return line.slice()
  const kx = R_EARTH * RAD * Math.cos(line[0]![1] * RAD)
  const ky = R_EARTH * RAD
  const xy = line.map(([lng, lat]) => [lng * kx, lat * ky] as const)
  const keep = new Uint8Array(line.length)
  keep[0] = keep[line.length - 1] = 1
  const stack: Array<[number, number]> = [[0, line.length - 1]]
  const tol2 = toleranceM * toleranceM
  while (stack.length > 0) {
    const [a, b] = stack.pop()!
    const [ax, ay] = xy[a]!
    const [bx, by] = xy[b]!
    const dx = bx - ax
    const dy = by - ay
    const len2 = dx * dx + dy * dy
    let worst = -1
    let worstD = tol2
    for (let i = a + 1; i < b; i++) {
      const [px, py] = xy[i]!
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2))
      const ex = px - (ax + t * dx)
      const ey = py - (ay + t * dy)
      const d = ex * ex + ey * ey
      if (d > worstD) {
        worstD = d
        worst = i
      }
    }
    if (worst >= 0) {
      keep[worst] = 1
      stack.push([a, worst], [worst, b])
    }
  }
  return line.filter((_, i) => keep[i] === 1)
}

