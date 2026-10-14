import { PbfWriter } from "pbf"
import { describe, expect, it } from "vitest"

import {
  decodeLayer,
  nearestNamed,
  PLACE_ZOOM,
  PlaceNames,
  ROAD_MAX_M,
  ROAD_ZOOM,
  tilesAround,
  type NamedFeature,
  type Tile,
  type TileSource,
} from "./place-names"

/** Point Nemo (D-199): synthetic geography only. */
const AT = { lat: -48.876, lng: -123.393 }
/** ~111 m per 0.001° of latitude. */
const north = (m: number) => ({ lat: AT.lat + m / 111_320, lng: AT.lng })
const east = (m: number) => ({ lat: AT.lat, lng: AT.lng + m / (111_320 * Math.cos((AT.lat * Math.PI) / 180)) })

// ─── A MINIMAL MVT ENCODER, so the decoder is tested against real tile bytes ─────────────

const EXTENT = 4096

interface Draft {
  kind: string
  name?: string
  points: { lat: number; lng: number }[]
  line?: boolean
}

function tileXY(p: { lat: number; lng: number }, t: Tile): [number, number] {
  const n = 2 ** t.z
  const lat = (p.lat * Math.PI) / 180
  const x = ((p.lng + 180) / 360) * n
  const y = ((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2) * n
  return [Math.round((x - t.x) * EXTENT), Math.round((y - t.y) * EXTENT)]
}

const zigzag = (n: number) => (n << 1) ^ (n >> 31)

function encode(t: Tile, layers: Record<string, Draft[]>): ArrayBuffer {
  const pbf = new PbfWriter()
  for (const [name, drafts] of Object.entries(layers)) {
    const keys: string[] = []
    const values: string[] = []
    const idx = (arr: string[], v: string) => (arr.includes(v) ? arr.indexOf(v) : arr.push(v) - 1)
    const feats = drafts.map((d) => {
      const tags: number[] = []
      for (const [k, v] of Object.entries({ kind: d.kind, name: d.name })) {
        if (v !== undefined) tags.push(idx(keys, k), idx(values, v))
      }
      const xy = d.points.map((p) => tileXY(p, t))
      const geom: number[] = [(1 << 3) | 1, zigzag(xy[0][0]), zigzag(xy[0][1])]
      if (d.line) {
        geom.push(((xy.length - 1) << 3) | 2)
        for (let i = 1; i < xy.length; i++) geom.push(zigzag(xy[i][0] - xy[i - 1][0]), zigzag(xy[i][1] - xy[i - 1][1]))
      }
      return { tags, type: d.line ? 2 : 1, geom }
    })
    pbf.writeMessage(3, (_: unknown, w: PbfWriter) => {
      w.writeVarintField(15, 2)
      w.writeStringField(1, name)
      for (const f of feats) {
        w.writeMessage(2, (_: unknown, fw: PbfWriter) => {
          fw.writePackedVarint(2, f.tags)
          fw.writeVarintField(3, f.type)
          fw.writePackedVarint(4, f.geom)
        }, null)
      }
      for (const k of keys) w.writeStringField(3, k)
      for (const v of values) w.writeMessage(4, (_: unknown, vw: PbfWriter) => vw.writeStringField(1, v), null)
      w.writeVarintField(5, EXTENT)
    }, null)
  }
  const out = pbf.finish()
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer
}

/** A source serving drafts for every tile asked of it, at the zooms they belong to. */
function source(byZoom: Record<number, Record<string, Draft[]>>): TileSource & { asked: string[] } {
  const asked: string[] = []
  return {
    asked,
    async getZxy(z, x, y) {
      asked.push(`${z}/${x}/${y}`)
      const layers = byZoom[z]
      return layers ? { data: encode({ z, x, y }, layers) } : undefined
    },
  }
}

const road = (name: string | undefined, kind: string, ...points: { lat: number; lng: number }[]): Draft => ({ kind, name, points, line: true })

describe("tilesAround", () => {
  it("returns the point's own tile and the three nearest neighbours", () => {
    const tiles = tilesAround(AT, ROAD_ZOOM)
    expect(tiles).toHaveLength(4)
    expect(new Set(tiles.map((t) => `${t.x}/${t.y}`)).size).toBe(4)
    const xs = tiles.map((t) => t.x), ys = tiles.map((t) => t.y)
    expect(Math.max(...xs) - Math.min(...xs)).toBe(1)
    expect(Math.max(...ys) - Math.min(...ys)).toBe(1)
  })
})

describe("nearestNamed", () => {
  const f = (name: string, at: { lat: number; lng: number }): NamedFeature => ({ name, kind: "minor_road", lines: [[[at.lng, at.lat]]] })

  it("picks the nearest within the radius, and nothing beyond it", () => {
    expect(nearestNamed([f("Far", north(50)), f("Near", north(20))], AT, 60)).toBe("Near")
    expect(nearestNamed([f("Far", north(80))], AT, 60)).toBeNull()
  })

  it("breaks an exact tie on the name, so tile order never decides", () => {
    const a = [f("Beta Way", north(30)), f("Alpha Way", east(30))]
    expect(nearestNamed(a, AT, 60)).toBe(nearestNamed([...a].reverse(), AT, 60))
  })

  it("measures a line to its nearest segment, not its nearest vertex", () => {
    // A road running east–west 20 m north of the point, with vertices 500 m either side.
    const line: NamedFeature = { name: "Long Road", kind: "minor_road", lines: [[[east(-500).lng, north(20).lat], [east(500).lng, north(20).lat]]] }
    expect(nearestNamed([line], AT, ROAD_MAX_M)).toBe("Long Road")
  })
})

describe("decodeLayer, on real tile bytes", () => {
  it("round-trips names, kinds and geometry, and drops unnamed features", () => {
    const t = tilesAround(AT, ROAD_ZOOM)[0]
    const data = encode(t, { roads: [road("Gull Lane", "minor_road", east(-100), east(100)), road(undefined, "path", north(5), north(10))] })
    const out = decodeLayer(data, t, "roads", () => true)
    expect(out.map((f) => f.name)).toEqual(["Gull Lane"])
    expect(nearestNamed(out, AT, ROAD_MAX_M)).toBe("Gull Lane")
  })

  it("is empty for a layer the tile does not have", () => {
    const t = tilesAround(AT, ROAD_ZOOM)[0]
    expect(decodeLayer(encode(t, { roads: [] }), t, "places", () => true)).toEqual([])
  })
})

describe("PlaceNames", () => {
  it("names the street a point lies on, ignoring motorways and rail even when nearer", async () => {
    const names = new PlaceNames(
      source({
        [ROAD_ZOOM]: {
          roads: [
            road("I-0 Express", "highway", { ...north(2), lng: east(-300).lng }, { ...north(2), lng: east(300).lng }),
            road("Night Line", "rail", north(3), east(150)),
            road("Kelp Street", "minor_road", { ...north(25), lng: east(-300).lng }, { ...north(25), lng: east(300).lng }),
          ],
        },
      }),
    )
    expect(await names.street(AT)).toBe("Kelp Street")
  })

  it("names the nearest town or neighbourhood, never a POI-like kind, within its radius", async () => {
    const names = new PlaceNames(
      source({
        [PLACE_ZOOM]: {
          places: [
            { kind: "locality", name: "Millbrook", points: [north(1200)] },
            { kind: "neighbourhood", name: "Saltmarsh", points: [north(800)] },
            { kind: "country", name: "Nowhere", points: [north(10)] },
            { kind: "locality", name: "Distant", points: [north(-4000)] },
          ],
        },
      }),
    )
    expect(await names.place(AT)).toBe("Saltmarsh")
    expect(await names.place(north(-3900))).toBe("Distant")
  })

  it("is null where the tiles name nothing, and reads each tile once", async () => {
    const src = source({})
    const names = new PlaceNames(src)
    expect(await names.street(AT)).toBeNull()
    expect(await names.street(AT)).toBeNull()
    expect(src.asked).toHaveLength(4)
  })

  it("does not cache a failed fetch", async () => {
    let fail = true
    const names = new PlaceNames({
      async getZxy(z, x, y) {
        if (fail) throw new Error("offline")
        return { data: encode({ z, x, y }, { roads: [road("Kelp Street", "minor_road", east(-100), east(100))] }) }
      },
    })
    await expect(names.street(AT)).rejects.toThrow("offline")
    fail = false
    expect(await names.street(AT)).toBe("Kelp Street")
  })
})
