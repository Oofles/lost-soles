import type { RouteTraceGeometry } from "@/lib/runs/wire"

/**
 * THE STILL THAT STANDS IN FOR A LOST MAP. Ticket `0084`. `06-ui-ux.md` §3.4: *"If WebGL context is
 * lost, abort to the end state with a static map image."*
 *
 * Drawn from the route's geometry, with no GPU anywhere in the path (D-298, the operator's call). A
 * canvas cannot be read once its context is gone, and snapshotting it while the sequence runs costs a
 * PNG encode per capture on exactly the frames the lantern cannot spare — so the still is a diagram
 * of the run, always available and never out of date. `MapShell` rebuilds the live map when the
 * browser gives the context back, and the still steps aside.
 *
 * Web Mercator, like the map, so the line has the shape the operator knows. Pure: geometry in, an SVG
 * `viewBox` and one path `d` out.
 */

export interface Still {
  viewBox: string
  d: string
  /** Stroke width in viewBox units — a fixed share of the drawing, so it reads at any size. */
  stroke: number
}

const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))

export function routeStill(geometry: RouteTraceGeometry | null | undefined, padShare = 0.12): Still | null {
  if (!geometry || geometry.type !== "MultiLineString") return null
  const parts = geometry.coordinates
    .map((part) =>
      part
        .filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]))
        .map((p) => [(p[0]! * Math.PI) / 180, -mercY(p[1]!)] as const),
    )
    .filter((part) => part.length >= 2)
  if (parts.length === 0) return null

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const part of parts) {
    for (const [x, y] of part) {
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
      minY = Math.min(minY, y)
      maxY = Math.max(maxY, y)
    }
  }
  // A thousand units across the longer side, so the path's numbers are short and the stroke fixed.
  const span = Math.max(maxX - minX, maxY - minY) || 1e-9
  const k = 1000 / span
  const pad = 1000 * padShare
  const w = (maxX - minX) * k + 2 * pad
  const h = (maxY - minY) * k + 2 * pad
  const at = (x: number, y: number) => `${((x - minX) * k + pad).toFixed(1)} ${((y - minY) * k + pad).toFixed(1)}`
  const d = parts.map((part) => part.map(([x, y], i) => `${i === 0 ? "M" : "L"}${at(x, y)}`).join(" ")).join(" ")
  return { viewBox: `0 0 ${w.toFixed(1)} ${h.toFixed(1)}`, d, stroke: 6 }
}
