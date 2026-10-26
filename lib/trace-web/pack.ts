import type { WebFeature, WebFeatureCollection } from "./web"

/**
 * THE DRAWN WEB, AS THREE TYPED ARRAYS. Ticket `0259`.
 *
 * The worker (`web.worker.ts`) builds the web; the main thread draws it. A `WebFeatureCollection`
 * posted as it is would be structured-cloned, which costs the main thread one deserialisation per
 * nested coordinate array (~17 ms for a five-year web). Packed, the three buffers are TRANSFERRED —
 * zero copy — and `unpackWeb` rebuilds the objects in a few milliseconds. `Float64Array` keeps every
 * ordinate and every `wear` bit-identical, so the unpacked web is exactly `buildWeb`'s output.
 */
export interface PackedWeb {
  /** `wear` per feature. */
  wear: Float64Array
  /** Feature `i`'s points are `[ends[i - 1] ?? 0, ends[i])`, in points, not ordinates. */
  ends: Uint32Array
  /** `[lng, lat, lng, lat, …]`. */
  coords: Float64Array
}

export function packWeb(web: WebFeatureCollection): PackedWeb {
  const n = web.features.length
  let points = 0
  for (const f of web.features) points += f.geometry.coordinates.length
  const wear = new Float64Array(n)
  const ends = new Uint32Array(n)
  const coords = new Float64Array(points * 2)
  let at = 0
  for (let i = 0; i < n; i++) {
    const f = web.features[i]!
    wear[i] = f.properties.wear
    for (const [lng, lat] of f.geometry.coordinates) {
      coords[at++] = lng
      coords[at++] = lat
    }
    ends[i] = at / 2
  }
  return { wear, ends, coords }
}

export function unpackWeb({ wear, ends, coords }: PackedWeb): WebFeatureCollection {
  const features: WebFeature[] = new Array(wear.length)
  let p = 0
  for (let i = 0; i < wear.length; i++) {
    const end = ends[i]!
    const coordinates: [number, number][] = new Array(end - p)
    for (let j = 0; p < end; j++, p++) coordinates[j] = [coords[2 * p]!, coords[2 * p + 1]!]
    features[i] = { type: "Feature", geometry: { type: "LineString", coordinates }, properties: { wear: wear[i]! } }
  }
  return { type: "FeatureCollection", features }
}

/** The buffers to list in `postMessage`'s transfer, so they move rather than copy. */
export const transferablesOf = (p: PackedWeb): ArrayBuffer[] => [
  p.wear.buffer as ArrayBuffer,
  p.ends.buffer as ArrayBuffer,
  p.coords.buffer as ArrayBuffer,
]
