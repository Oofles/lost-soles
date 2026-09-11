import { readFileSync } from "node:fs"

import { describe, expect, it, vi } from "vitest"

/**
 * LAYER ORDER. Ticket `0057`, criteria 1, 3 and 7. `05-fog-of-war.md` §4.4.
 *
 * `amplify_outputs.json` is gitignored and generated per environment, so `basemapStyle()` would
 * otherwise be tested against whatever file is on disk. Stubbed for `basemap.test.ts`'s reason —
 * these assertions are about the style, not the machine.
 */
vi.mock("@/amplify_outputs.json", () => ({
  default: { custom: { basemapTilesUrl: "https://dexample123.cloudfront.net" } },
}))

const { basemapStyle } = await import("./basemap")
const { FogMaskLayer } = await import("./fog/mask-layer")
const {
  FOG_LAYER_ID,
  ROUTE_GLOW_TOKEN,
  ROUTE_LINE_TOKEN,
  RUN_CORE_ID,
  RUN_CORE_METRICS,
  RUN_GLOW_ID,
  RUN_GLOW_METRICS,
  RUN_LAYOUT,
  RUN_SOURCE_ID,
  fogBeforeId,
  fogIsAboveAllSymbols,
  lastSymbolIndex,
  routeIsAboveFog,
  routePaletteFrom,
  runCoreSpec,
  runGlowSpec,
  runSourceSpec,
  setRunGeometry,
} = await import("./map-layers")

type Layer = { id: string; type: string }

/**
 * MapLibre's insertion semantics, and only those: `addLayer(l)` appends, `addLayer(l, beforeId)`
 * inserts immediately below that layer. A real `Map` needs WebGL, a style fetch and a pmtiles
 * archive; what these criteria are about is an ORDER, and an order is a list.
 */
class FakeMap {
  layers: Layer[]
  sources = new Map<string, { data: unknown; lineMetrics?: boolean; setData(d: unknown): void }>()
  repaints = 0

  constructor(initial: Layer[]) {
    this.layers = [...initial]
  }

  getLayer(id: string): Layer | undefined {
    return this.layers.find((l) => l.id === id)
  }
  getSource(id: string) {
    return this.sources.get(id)
  }
  addSource(id: string, source: unknown) {
    const spec = source as { data: unknown; lineMetrics?: boolean }
    this.sources.set(id, {
      data: spec.data,
      lineMetrics: spec.lineMetrics,
      setData(d: unknown) {
        this.data = d
      },
    })
  }
  addLayer(layer: unknown, beforeId?: string) {
    const at = beforeId === undefined ? -1 : this.layers.findIndex((l) => l.id === beforeId)
    if (at === -1) this.layers.push(layer as Layer)
    else this.layers.splice(at, 0, layer as Layer)
  }
  removeLayer(id: string) {
    this.layers = this.layers.filter((l) => l.id !== id)
  }
  triggerRepaint() {
    this.repaints++
  }
}

const style = () => basemapStyle().layers as unknown as Layer[]
const empty = { type: "FeatureCollection" as const, features: [] }

/**
 * THE REAL `app/tokens.css`, READ FROM DISK and resolved one `var()` hop by hand.
 *
 * The point of this fixture is that it is not a fixture: §4.4's two colours now live in the
 * palette, so the assertion that they are *"exactly the paint values above"* has to be made
 * against the file that actually holds them. A hand-written pair here would certify the spec
 * builder against a palette that does not exist — which is the failure mode this repo has met
 * before, and the reason it does not write fixtures by hand.
 */
const tokensCss = readFileSync(new URL("../app/tokens.css", import.meta.url), "utf8")

function token(name: string): string {
  const direct = new RegExp(`\\${name}:\\s*([^;]+);`).exec(tokensCss)
  if (!direct) throw new Error(`no ${name} in app/tokens.css`)
  const value = direct[1]!.trim()
  const hop = /^var\((--[\w-]+)\)$/.exec(value)
  return hop ? token(hop[1]!) : value
}

const PALETTE = routePaletteFrom(token)
const fog = (): Layer => ({ id: FOG_LAYER_ID, type: "custom" })

/** What `map-shell.tsx` does, in the order it does it: fog first, then the route. */
function mapWithFogThenRoute() {
  const map = new FakeMap(style())
  map.addLayer(fog(), fogBeforeId(map))
  setRunGeometry(map, empty, PALETTE)
  return map
}

/** The other order — a style reload re-adds custom layers after the style's own. */
function mapWithRouteThenFog() {
  const map = new FakeMap(style())
  setRunGeometry(map, empty, PALETTE)
  map.addLayer(fog(), fogBeforeId(map))
  return map
}

describe("the id this module and the layer must agree on", () => {
  /**
   * `FOG_LAYER_ID` is a string in one file and `FogMaskLayer.id` is a string in another, and
   * `fogBeforeId` compares them without either knowing. A silent disagreement would not throw —
   * the fog would simply always append, which is correct until the route exists and wrong after.
   */
  it("FOG_LAYER_ID is FogMaskLayer's own id", () => {
    expect(new FogMaskLayer().id).toBe(FOG_LAYER_ID)
  })
})

describe("criterion 1 — the fog is above every symbol layer", () => {
  /**
   * ASSERTED AGAINST THE REAL PROTOMAPS LAYER LIST, not a fixture. The mechanic depends on a
   * property of somebody else's style: if a flavour upgrade adds a symbol layer at the very top,
   * street names start bleeding through fog over undiscovered ground, and that must arrive as a
   * failing test rather than as a rendering bug nobody can name.
   */
  it("the stock light flavour really does have symbol layers to sit above", () => {
    const layers = style()
    expect(lastSymbolIndex(layers)).toBeGreaterThan(-1)
    // And they are the LAST thing in it, which is why appending suffices in the simple case.
    expect(lastSymbolIndex(layers)).toBe(layers.length - 1)
  })

  it("holds when the fog is added first", () => {
    expect(fogIsAboveAllSymbols(mapWithFogThenRoute().layers)).toBe(true)
  })

  it("holds when the route is already there", () => {
    expect(fogIsAboveAllSymbols(mapWithRouteThenFog().layers)).toBe(true)
  })

  it("fails loudly if the fog is ever inserted under the labels", () => {
    const layers = style()
    layers.splice(0, 0, fog())
    expect(fogIsAboveAllSymbols(layers)).toBe(false)
  })
})

describe("criterion 3 — the route is above the fog", () => {
  it("holds in both insertion orders", () => {
    expect(routeIsAboveFog(mapWithFogThenRoute().layers)).toBe(true)
    expect(routeIsAboveFog(mapWithRouteThenFog().layers)).toBe(true)
  })

  /**
   * The case that motivates `fogBeforeId` existing at all. `?fog=off` and back, or a style
   * reload, re-adds the fog to a map that already has a route — and an unconditional append
   * would put the mist over the line it is meant to be drawn under.
   */
  it("re-adding the fog does not bury the route", () => {
    const map = mapWithFogThenRoute()
    map.removeLayer(FOG_LAYER_ID)
    expect(routeIsAboveFog(map.layers)).toBe(false)
    map.addLayer(fog(), fogBeforeId(map))
    expect(routeIsAboveFog(map.layers)).toBe(true)
    expect(fogIsAboveAllSymbols(map.layers)).toBe(true)
  })

  it("the glow is under the core", () => {
    const ids = mapWithFogThenRoute().layers.map((l) => l.id)
    expect(ids.indexOf(RUN_GLOW_ID)).toBeLessThan(ids.indexOf(RUN_CORE_ID))
  })
})

describe("criterion 3 — the paint values, exactly as §4.4 specifies them", () => {
  /**
   * VERBATIM, AND THE TICKET SAYS NOT TO IMPROVE THEM: *"Do not substitute a 'nicer' colour —
   * this pairing is doing two jobs at once."* Capability 15 introduces the parchment background
   * these were chosen against, so the day they matter most is after the code was written.
   */
  it("run-glow is amber, wide, blurred and translucent", () => {
    // The colour, from the palette. `0016` wrote it there under "FIXED BY 05-fog-of-war.md §4.4".
    // design-tokens:allow — §4.4's literal IS the assertion here. Comparing the palette to
    // itself would assert nothing, which is the whole reason this test exists.
    expect(PALETTE.glow.toLowerCase()).toBe("#ffb347") // design-tokens:allow
    expect(RUN_GLOW_METRICS).toEqual({ "line-width": 12, "line-blur": 10, "line-opacity": 0.35 })
    expect(runGlowSpec(PALETTE).paint).toEqual({
      "line-color": PALETTE.glow,
      "line-width": 12,
      "line-blur": 10,
      "line-opacity": 0.35,
    })
  })

  it("run-core is warm cream and thin", () => {
    // design-tokens:allow — see run-glow above.
    expect(PALETTE.core.toLowerCase()).toBe("#fff2d0") // design-tokens:allow
    expect(RUN_CORE_METRICS).toEqual({ "line-width": 2.5 })
    expect(runCoreSpec(PALETTE).paint).toEqual({ "line-color": PALETTE.core, "line-width": 2.5 })
  })

  /**
   * §8.3: the dark theme does not darken the map. The route sits on the same fog in either
   * theme, so a value that moved with the chrome would be tuned against a background it never
   * actually appears on. Asserted because the dark blocks are a natural place to "finish the
   * set" without noticing that finishing it is wrong.
   */
  it("neither token is overridden by a dark block", () => {
    const darkBlocks = tokensCss.slice(tokensCss.indexOf("prefers-color-scheme: dark"))
    expect(darkBlocks).not.toContain(ROUTE_GLOW_TOKEN)
    expect(darkBlocks).not.toContain(ROUTE_LINE_TOKEN)
  })

  it("refuses an unresolvable palette rather than substituting a literal", () => {
    expect(() => routePaletteFrom(() => "")).toThrow(/tokens\.css/)
    // Any non-empty value will do — what is under test is which token was missing, not its value.
    expect(() => routePaletteFrom((t) => (t === ROUTE_GLOW_TOKEN ? "amber" : ""))).toThrow(
      ROUTE_LINE_TOKEN,
    )
  })

  it("both are round-capped and round-joined", () => {
    expect(RUN_LAYOUT).toEqual({ "line-cap": "round", "line-join": "round" })
  })

  it("the source sets lineMetrics", () => {
    expect(runSourceSpec(empty).lineMetrics).toBe(true)
    expect(mapWithFogThenRoute().sources.get(RUN_SOURCE_ID)?.lineMetrics).toBe(true)
  })
})

describe("setRunGeometry", () => {
  it("creates the source and both layers once, then updates data in place", () => {
    const map = new FakeMap(style())
    setRunGeometry(map, empty, PALETTE)
    const before = map.layers.length
    const withRun = { type: "FeatureCollection" as const, features: [{ marker: 1 }] }
    setRunGeometry(map, withRun as never, PALETTE)
    expect(map.layers.length).toBe(before)
    expect(map.sources.get(RUN_SOURCE_ID)?.data).toBe(withRun)
  })

  /**
   * Criterion 4, at the level this file can assert it: the route source is populated from the
   * run endpoint and knows nothing about the explored set, so a run whose cells have not been
   * written draws exactly the same line as one whose have. `use-latest-run.test.ts` asserts the
   * two really are independent fetches.
   */
  it("adds the layers even for an empty collection, so the order is settled before there is data", () => {
    const map = new FakeMap(style())
    setRunGeometry(map, empty, PALETTE)
    expect(map.getLayer(RUN_GLOW_ID)).toBeDefined()
    expect(map.getLayer(RUN_CORE_ID)).toBeDefined()
  })
})

describe("criterion 7 — the fog toggled off", () => {
  /**
   * `?fog=off` adds no custom layer. What must remain true is that the basemap is untouched and
   * the route still renders — the failure this guards against is the route having been made to
   * depend on the fog layer's existence, which is easy to do and invisible until someone toggles.
   */
  it("leaves the basemap intact and the route drawn", () => {
    const map = new FakeMap(style())
    setRunGeometry(map, empty, PALETTE)

    expect(map.getLayer(FOG_LAYER_ID)).toBeUndefined()
    expect(map.getLayer(RUN_GLOW_ID)).toBeDefined()
    expect(map.getLayer(RUN_CORE_ID)).toBeDefined()
    // Every layer the stock style shipped is still present, in its original order.
    const stock = style().map((l) => l.id)
    expect(map.layers.slice(0, stock.length).map((l) => l.id)).toEqual(stock)
  })
})
