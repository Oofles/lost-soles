import type { RunFeatureCollection } from "@/lib/runs/wire"

/**
 * LAYER ORDER, WHICH §4.4 OPENS BY CALLING *"a design decision, not plumbing"*. Ticket `0057`.
 * `05-fog-of-war.md` §4.4, R4 §4.3.
 *
 * Two rules, and the mechanic depends on both:
 *
 *   1. **The fog sits above the basemap AND ITS LABELS.** A fog layer inserted below the symbol
 *      layers leaves street names and place names floating over undiscovered ground. That reads
 *      as a rendering bug, and it hands the operator the map's answers for free — most of the
 *      "uncovering the world" feeling is names you cannot read yet.
 *   2. **The route sits above the fog.** Your own trace is always visible, including over ground
 *      whose cells have not been written: a run that is still syncing must still draw its line.
 *
 * ─── WHY THIS IS A MODULE AND NOT TWO `addLayer` CALLS IN AN EFFECT ─────────
 *
 * Order here is decided by CALL ORDER, and the two things being ordered are added from two
 * different React effects — `useFogMask` owns the custom layer, `use-latest-run` owns the route.
 * Effect order is a fact about the component tree, a style reload re-adds custom layers at the
 * top, and neither is something the mechanic should depend on. `fogBeforeId` makes the rule hold
 * from either direction: the route always appends, and the fog inserts *under* the route when
 * the route is already there.
 */

/** Must equal `FogMaskLayer.id`. `map-layers.test.ts` asserts it rather than trusting this line. */
export const FOG_LAYER_ID = "fog-mask"

export const RUN_SOURCE_ID = "runs"
export const RUN_GLOW_ID = "run-glow"
export const RUN_CORE_ID = "run-core"

/** Bottom to top. The route's own two layers, in the order they must be added. */
export const RUN_LAYER_IDS = [RUN_GLOW_ID, RUN_CORE_ID] as const

/**
 * ─── THE COLOURS COME FROM `app/tokens.css`, NOT FROM THIS FILE ─────────────
 *
 * §4.4 writes them as literals — `#ffb347` and `#fff2d0` — and `check-design-tokens.mjs` refuses
 * a raw hex anywhere but the palette, under §8.3. That looked like a conflict between two design
 * rules and is not one: **`0016` already put both values in `app/tokens.css`**, under the comment
 * *"Lantern — the frontier, the route, the reveal. FIXED BY 05-fog-of-war.md §4.4. DO NOT
 * RETUNE."* The palette was written for this ticket before this ticket existed.
 *
 * So the values are unchanged and their home is the one §8.3 names. The gate's own escape hatch
 * (`design-tokens:allow`) would have been the wrong answer — the reason to suppress would have
 * been "the colour is specified elsewhere", and it turned out to be specified in exactly the file
 * the gate points at.
 *
 * It also buys the thing §8.1 argues the palette is for: **capability 15 introduces the parchment
 * background these were chosen against**, and it edits `tokens.css`. A literal in this module
 * would have made the route the one element of the map its art-direction pass could not see.
 *
 * The cost is that a MapLibre paint value cannot BE a CSS variable — the style spec takes a colour
 * string — so it is resolved from the computed style once, when the layers are added.
 */

/** The two semantic tokens. Named so the resolver and its test cannot disagree on the spelling. */
export const ROUTE_GLOW_TOKEN = "--route-glow"
export const ROUTE_LINE_TOKEN = "--route-line"

export interface RoutePalette {
  /** `--route-glow` — the amber halo. Wide, blurred, translucent. */
  glow: string
  /** `--route-line` — the warm cream core. Thin and opaque. */
  core: string
}

/**
 * Resolve the palette through a reader, so the browser and a test use the same code path.
 *
 * THROWS ON AN EMPTY TOKEN rather than falling back to a literal. A fallback would be a second
 * copy of the colour, in this file, which is the exact thing the tokens exist to prevent — and it
 * would hide a stylesheet that failed to load behind a route that looked right. The one caller
 * catches, so a broken palette costs the line and not the map.
 */
export function routePaletteFrom(read: (token: string) => string): RoutePalette {
  const glow = read(ROUTE_GLOW_TOKEN).trim()
  const core = read(ROUTE_LINE_TOKEN).trim()
  if (!glow || !core) {
    throw new Error(
      `app/tokens.css defines no ${!glow ? ROUTE_GLOW_TOKEN : ROUTE_LINE_TOKEN}. ` +
        "It is added by ticket 0057; an empty value means the stylesheet did not load.",
    )
  }
  return { glow, core }
}

/** The browser's reader. Read once per layer add — never per frame, and never per feature. */
export function documentRoutePalette(): RoutePalette {
  const computed = getComputedStyle(document.documentElement)
  return routePaletteFrom((token) => computed.getPropertyValue(token))
}

/**
 * §4.4's non-colour paint, verbatim, and the ticket is explicit that none of it is to be improved
 * on: *"Do not substitute a 'nicer' colour — this pairing is doing two jobs at once."*
 *
 * `line-blur: 10` at `line-width: 12` is why the glow needs no second pass and no shader: MapLibre
 * feathers the line's own edge, so the halo is the same geometry drawn wide and soft underneath.
 * The glow is what makes the line *findable* at a glance rather than a thin thread to be hunted
 * for — the job it does that the core cannot.
 */
export const RUN_GLOW_METRICS = { "line-width": 12, "line-blur": 10, "line-opacity": 0.35 } as const

export const RUN_CORE_METRICS = { "line-width": 2.5 } as const

/** Both layers. `round` on both ends: a square cap on a GPS trace reads as a clipped route. */
export const RUN_LAYOUT = { "line-cap": "round", "line-join": "round" } as const

/**
 * `lineMetrics: true` on the SOURCE, which §4.4's snippet sets and which is easy to read as
 * incidental. It is what makes `line-gradient` available later — `0080`'s lantern traverses this
 * same geometry — and MapLibre can only compute it at tile-build time, so a source created
 * without it cannot be upgraded in place. It costs one boolean now and a source rebuild later.
 */
export function runSourceSpec(data: RunFeatureCollection) {
  return { type: "geojson" as const, data, lineMetrics: true }
}

export function runGlowSpec(palette: RoutePalette) {
  return {
    id: RUN_GLOW_ID,
    type: "line" as const,
    source: RUN_SOURCE_ID,
    layout: { ...RUN_LAYOUT },
    paint: { "line-color": palette.glow, ...RUN_GLOW_METRICS },
  }
}

export function runCoreSpec(palette: RoutePalette) {
  return {
    id: RUN_CORE_ID,
    type: "line" as const,
    source: RUN_SOURCE_ID,
    layout: { ...RUN_LAYOUT },
    paint: { "line-color": palette.core, ...RUN_CORE_METRICS },
  }
}

/**
 * The minimum of MapLibre's `Map` these helpers touch. Structural, so the tests below drive them
 * with a plain object and no WebGL — the same convention `RunQueryDdb` sets in `lib/runs/server.ts`.
 */
export interface LayerHost {
  getLayer(id: string): unknown
  getSource(id: string): unknown
  addSource(id: string, source: unknown): void
  addLayer(layer: unknown, beforeId?: string): void
  removeLayer(id: string): void
}

/**
 * WHERE THE FOG GOES IN. Rule 2, expressed as the one argument `addLayer` takes.
 *
 * `undefined` means "on top of everything", which satisfies rule 1 on its own — every Protomaps
 * symbol layer is already below. When the route layers exist the fog must go UNDER them instead,
 * and `run-glow` is the lower of the two, so it is the insertion point.
 *
 * That case is not hypothetical: `?fog=off` removes the layer and a toggle back re-adds it, and a
 * style reload re-adds every custom layer after the style's own. Appending unconditionally would
 * put the fog over the route on exactly those paths — the route would vanish into the mist it is
 * supposed to be drawn on top of, intermittently, which is the worst kind of ordering bug.
 */
export function fogBeforeId(host: Pick<LayerHost, "getLayer">): string | undefined {
  return host.getLayer(RUN_GLOW_ID) ? RUN_GLOW_ID : undefined
}

/**
 * Add the route source and its two layers, or update the data if they are already there.
 *
 * APPENDED, ALWAYS — never with a `beforeId`. The route is the topmost thing on the map by design,
 * and `fogBeforeId` is what keeps that true when the fog arrives second.
 */
export function setRunGeometry(
  host: LayerHost,
  data: RunFeatureCollection,
  palette: RoutePalette,
): void {
  const existing = host.getSource(RUN_SOURCE_ID) as { setData?: (d: unknown) => void } | undefined
  if (existing) {
    existing.setData?.(data)
    return
  }
  host.addSource(RUN_SOURCE_ID, runSourceSpec(data))
  host.addLayer(runGlowSpec(palette))
  host.addLayer(runCoreSpec(palette))
}

/**
 * The last index in a style's layer list that is a `symbol` layer, or `-1` when there is none.
 *
 * Labels are the only reason rule 1 exists, and in a MapLibre style a label is a `symbol` layer —
 * place names, street names, POI icons and their text all are. `map-layers.test.ts` runs this
 * against the real `@protomaps/basemaps` layer list rather than a fixture, so a flavour upgrade
 * that adds a symbol layer at the very top is a failing test rather than names bleeding through.
 */
export function lastSymbolIndex(layers: ReadonlyArray<{ type: string }>): number {
  let last = -1
  for (let i = 0; i < layers.length; i++) if (layers[i]!.type === "symbol") last = i
  return last
}

/** Criterion 1, as a predicate: the fog is present and after every symbol layer. */
export function fogIsAboveAllSymbols(layers: ReadonlyArray<{ id: string; type: string }>): boolean {
  const fog = layers.findIndex((l) => l.id === FOG_LAYER_ID)
  return fog !== -1 && fog > lastSymbolIndex(layers)
}

/** Criterion 3, as a predicate: both route layers sit above the fog, glow under core. */
export function routeIsAboveFog(layers: ReadonlyArray<{ id: string }>): boolean {
  const index = (id: string) => layers.findIndex((l) => l.id === id)
  const fog = index(FOG_LAYER_ID)
  const glow = index(RUN_GLOW_ID)
  const core = index(RUN_CORE_ID)
  if (fog === -1 || glow === -1 || core === -1) return false
  return glow > fog && core > glow
}
