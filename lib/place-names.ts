import { VectorTile } from "@mapbox/vector-tile"
import { PbfReader } from "pbf"
import { PMTiles } from "pmtiles"

import { BASEMAP_ARCHIVE, basemapTilesUrl } from "@/lib/basemap"
import type { LngLatBounds } from "@/lib/regions"
import type { Located } from "@/src/domain/geo"

/**
 * NAMES, FROM THE MAP'S OWN TILES. Ticket `0256`, D-302.
 *
 * The frontier line's `— Millbrook` and the chronicle's `{street}` / `{place}` come from the same
 * pmtiles archive the basemap draws (D-226): its `places` layer (towns, neighbourhoods) and its
 * `roads` layer (named roads and paths). No reverse geocoder, no third party, no cost line — the
 * coordinates asked about never leave our own CloudFront, which already serves these bytes to
 * the map.
 *
 * DETERMINISTIC FOR AS LONG AS THE ARCHIVE IS: the name is a pure function of a coordinate and
 * `BASEMAP_ARCHIVE`, whose filename carries its build date and is never rewritten. So the same
 * activity names the same street on every read, without storing the name.
 *
 * One module for both readers, so the browser's frontier and the server's chronicle cannot pick
 * differently: the SSR page and `run-moment.tsx` each hold one `PlaceNames` and its tile cache.
 */

/** The zoom the places layer is read at. z12 carries neighbourhoods, which z10 and below thin out. */
export const PLACE_ZOOM = 12
/** The archive's max zoom: every named road, minor ones included. */
export const ROAD_ZOOM = 15

/** Farther than this from any named place, the frontier names nothing rather than a far town. */
export const PLACE_MAX_M = 3000
/** About one res-10 cell edge: a cell's street is one that actually runs through or beside it. */
export const ROAD_MAX_M = 60

const PLACE_KINDS: ReadonlySet<string> = new Set(["locality", "neighbourhood"])
/** Motorways and rail are never where a run was, however close the trace passes under them. */
const ROAD_EXCLUDED_KINDS: ReadonlySet<string> = new Set(["highway", "rail"])

export interface TileSource {
  getZxy(z: number, x: number, y: number): Promise<{ data: ArrayBuffer } | undefined>
}

export interface Tile {
  z: number
  x: number
  y: number
}

/** A named feature, decoded once per tile: a point or a polyline, in `[lng, lat]`. */
export interface NamedFeature {
  name: string
  kind: string
  lines: [number, number][][]
  /** `0285`. The archive's `population`, when it carries one — how a region's name is chosen. */
  population?: number
}

/**
 * `0285`. A region's bounds are widened by this before its most prominent place is chosen, so a
 * region of one short run on a town's edge still finds the town whose label point is just outside.
 */
export const PROMINENT_PAD_M = 5000
/** The most tiles one region's name may read. The zoom drops until the box fits in this many. */
export const PROMINENT_MAX_TILES = 4
/** The zoom range a region's name is read in: high enough for villages, low enough for a metro. */
const PROMINENT_ZOOMS = [12, 11, 10, 9, 8, 7, 6] as const

/** `[[west, south], [east, north]]`, as MapLibre's `fitBounds` takes it. */
type Bounds = LngLatBounds

/** Every tile at `z` that a box touches. */
export function tilesCovering(b: Bounds, z: number): Tile[] {
  const lo = tileFloat({ lng: b[0][0], lat: b[1][1] }, z)
  const hi = tileFloat({ lng: b[1][0], lat: b[0][1] }, z)
  const n = 2 ** z
  const out: Tile[] = []
  for (let x = Math.floor(lo.x); x <= Math.floor(hi.x); x++) {
    for (let y = Math.max(0, Math.floor(lo.y)); y <= Math.min(n - 1, Math.floor(hi.y)); y++) {
      out.push({ z, x: ((x % n) + n) % n, y })
    }
  }
  return out
}

/** A box widened by `m` metres on every side. */
export function padBounds(b: Bounds, m: number): Bounds {
  const dLat = m / 111_320
  const midLat = ((b[0][1] + b[1][1]) / 2) * D2R
  const dLng = m / (111_320 * Math.max(0.01, Math.cos(midLat)))
  return [
    [b[0][0] - dLng, b[0][1] - dLat],
    [b[1][0] + dLng, b[1][1] + dLat],
  ]
}

const PROMINENCE: Record<string, number> = { locality: 0, neighbourhood: 1 }

/**
 * `0285`. THE MOST PROMINENT NAMED PLACE INSIDE A BOX, or `null`: a town before a neighbourhood,
 * then the larger population, then the name, so the answer never depends on tile order.
 */
export function prominentNamed(features: Iterable<NamedFeature>, b: Bounds): string | null {
  let best: NamedFeature | null = null
  const inside = (f: NamedFeature) =>
    f.lines.some((line) => line.some(([lng, lat]) => lng >= b[0][0] && lng <= b[1][0] && lat >= b[0][1] && lat <= b[1][1]))
  const rank = (f: NamedFeature) => PROMINENCE[f.kind] ?? 2
  for (const f of features) {
    if (!inside(f)) continue
    if (
      !best ||
      rank(f) < rank(best) ||
      (rank(f) === rank(best) &&
        ((f.population ?? 0) > (best.population ?? 0) ||
          ((f.population ?? 0) === (best.population ?? 0) && f.name < best.name)))
    ) {
      best = f
    }
  }
  return best?.name ?? null
}

const D2R = Math.PI / 180

/** The tile containing `at`, as a fractional position, so callers can see which edge is nearer. */
function tileFloat(at: Located, z: number): { x: number; y: number } {
  const n = 2 ** z
  const lat = Math.max(-85.0511, Math.min(85.0511, at.lat)) * D2R
  return {
    x: ((at.lng + 180) / 360) * n,
    y: ((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2) * n,
  }
}

/**
 * The 2×2 block of tiles nearest `at`: its own tile and the neighbours on the sides it is closer
 * to. Every radius used here is under half a tile at its zoom, so the nearest feature within the
 * radius is always in one of these four.
 */
export function tilesAround(at: Located, z: number): Tile[] {
  const f = tileFloat(at, z)
  const x = Math.floor(f.x)
  const y = Math.floor(f.y)
  const dx = f.x - x < 0.5 ? -1 : 1
  const dy = f.y - y < 0.5 ? -1 : 1
  const n = 2 ** z
  const out: Tile[] = []
  for (const tx of [x, x + dx]) for (const ty of [y, y + dy]) {
    if (ty >= 0 && ty < n) out.push({ z, x: ((tx % n) + n) % n, y: ty })
  }
  return out
}

/** Metres between two points: equirectangular, which at these distances is exact enough. */
function metres(a: [number, number], b: Located): number {
  const k = Math.cos(b.lat * D2R)
  const dx = (a[0] - b.lng) * k
  const dy = a[1] - b.lat
  return Math.sqrt(dx * dx + dy * dy) * 111_320
}

/** Metres from `p` to the segment `a–b`, in a local plane centred on `p`. */
function toSegment(a: [number, number], b: [number, number], p: Located): number {
  const k = Math.cos(p.lat * D2R)
  const ax = (a[0] - p.lng) * k, ay = a[1] - p.lat
  const bx = (b[0] - p.lng) * k, by = b[1] - p.lat
  const vx = bx - ax, vy = by - ay
  const len = vx * vx + vy * vy
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, -(ax * vx + ay * vy) / len))
  const cx = ax + t * vx, cy = ay + t * vy
  return Math.sqrt(cx * cx + cy * cy) * 111_320
}

/** Distance from `at` to a feature: to its nearest vertex for a point, its nearest segment for a line. */
export function distanceTo(f: NamedFeature, at: Located): number {
  let best = Infinity
  for (const line of f.lines) {
    if (line.length === 1) best = Math.min(best, metres(line[0], at))
    for (let i = 1; i < line.length; i++) best = Math.min(best, toSegment(line[i - 1], line[i], at))
  }
  return best
}

/**
 * THE NEAREST NAMED FEATURE WITHIN `maxM`, or `null`. Ties — equal distance, which in practice is
 * one road split across two tiles — break on the name, so the answer never depends on tile order.
 */
export function nearestNamed(features: Iterable<NamedFeature>, at: Located, maxM: number): string | null {
  let best: { name: string; d: number } | null = null
  for (const f of features) {
    const d = distanceTo(f, at)
    if (d > maxM) continue
    if (!best || d < best.d || (d === best.d && f.name < best.name)) best = { name: f.name, d }
  }
  return best?.name ?? null
}

type Coords = number[] | number[][] | number[][][]

/** Decodes one layer of one tile into named features, keeping only the kinds `keep` accepts. */
export function decodeLayer(data: ArrayBuffer, tile: Tile, layer: string, keep: (kind: string) => boolean): NamedFeature[] {
  const vt = new VectorTile(new PbfReader(new Uint8Array(data)))
  const l = vt.layers[layer]
  if (!l) return []
  const out: NamedFeature[] = []
  for (let i = 0; i < l.length; i++) {
    const f = l.feature(i)
    const name = f.properties.name
    const kind = String(f.properties.kind ?? "")
    if (typeof name !== "string" || !name || !keep(kind)) continue
    const g = f.toGeoJSON(tile.x, tile.y, tile.z).geometry as { type: string; coordinates: Coords }
    const lines =
      g.type === "Point" ? [[g.coordinates as number[]]]
      : g.type === "MultiPoint" || g.type === "LineString" ? [g.coordinates as number[][]]
      : g.type === "MultiLineString" ? (g.coordinates as number[][][])
      : []
    const population = Number(f.properties.population)
    if (lines.length) {
      out.push({
        name,
        kind,
        lines: lines as [number, number][][],
        ...(Number.isFinite(population) && population > 0 ? { population } : {}),
      })
    }
  }
  return out
}

/**
 * A NAMES LOOKUP OVER ONE ARCHIVE, with a per-instance tile cache. Every method resolves to
 * `null` rather than throwing on a missing tile: no name is a reading the lines already handle.
 */
export class PlaceNames {
  private readonly cache = new Map<string, Promise<NamedFeature[]>>()

  constructor(private readonly source: TileSource) {}

  private layer(tile: Tile, layer: string, keep: (kind: string) => boolean): Promise<NamedFeature[]> {
    const key = `${layer}/${tile.z}/${tile.x}/${tile.y}`
    let hit = this.cache.get(key)
    if (!hit) {
      hit = this.source.getZxy(tile.z, tile.x, tile.y).then((t) => (t ? decodeLayer(t.data, tile, layer, keep) : []))
      this.cache.set(key, hit)
      // A failed fetch is not cached: the next read may succeed.
      hit.catch(() => this.cache.delete(key))
    }
    return hit
  }

  private async near(at: Located, z: number, layer: string, keep: (kind: string) => boolean, maxM: number) {
    const tiles = await Promise.all(tilesAround(at, z).map((t) => this.layer(t, layer, keep)))
    return nearestNamed(tiles.flat(), at, maxM)
  }

  /** The town or neighbourhood nearest `at`, within `PLACE_MAX_M`. */
  place(at: Located): Promise<string | null> {
    return this.near(at, PLACE_ZOOM, "places", (k) => PLACE_KINDS.has(k), PLACE_MAX_M)
  }

  /** The named road or path nearest `at`, within `ROAD_MAX_M`. */
  street(at: Located): Promise<string | null> {
    return this.near(at, ROAD_ZOOM, "roads", (k) => !ROAD_EXCLUDED_KINDS.has(k), ROAD_MAX_M)
  }

  /**
   * `0285`. The most prominent town or neighbourhood inside a region's box (widened by
   * `PROMINENT_PAD_M`) — the jump-to control's label. Read at the highest zoom whose tiles over the
   * box number at most `PROMINENT_MAX_TILES`: a low zoom still carries every large town (a place's
   * `min_zoom` falls with its size), and a small region gets its villages too. The same `places`
   * filter as `place()`, so the two share the tile cache without one poisoning the other.
   */
  async prominent(b: Bounds): Promise<string | null> {
    const box = padBounds(b, PROMINENT_PAD_M)
    let tiles: Tile[] = []
    for (const z of PROMINENT_ZOOMS) {
      tiles = tilesCovering(box, z)
      if (tiles.length <= PROMINENT_MAX_TILES) break
    }
    const features = await Promise.all(tiles.map((t) => this.layer(t, "places", (k) => PLACE_KINDS.has(k))))
    return prominentNamed(features.flat(), box)
  }
}

let shared: PlaceNames | undefined

/** The basemap archive's lookup, one per container (server) or page (browser). */
export function basemapPlaceNames(): PlaceNames {
  return (shared ??= new PlaceNames(new PMTiles(`${basemapTilesUrl()}/${BASEMAP_ARCHIVE}`)))
}
