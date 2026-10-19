import { layers, type Flavor } from "@protomaps/basemaps"

import { ABOVE_FOG_METADATA } from "@/lib/map-layers"

/**
 * THE PARCHMENT BASEMAP — ONE STYLE MODULE, TWO VARIANTS. Ticket `0097`, `05-fog-of-war.md` §5.
 *
 * FORKED FROM `@protomaps/basemaps@5.7.2`, flavour `light`. The pin is the review device: a future
 * upgrade diffs that version's `namedFlavor("light")` and `layers()` against this file, and the
 * package is pinned to the same exact version in `package.json`. What is forked is the FLAVOUR —
 * every colour the generator takes — plus a post-pass for label density and, in atlas, the layers
 * that go above the fog. The generator itself (`layers()`) is upstream's, called ONCE per variant:
 * there is one layer array and one source, so the two variants cannot drift into two code paths.
 *
 * ─── D-053, AND THE COROLLARY THAT BINDS BOTH VARIANTS ─────────────────────
 *
 * Warm parchment under near-black-blue fog, never a dark basemap: dark fog on a dark ground has no
 * contrast and the reveal does not read (§5.1). So the ground stays light and low-chroma in BOTH
 * variants — the fog does the darkening. The sampled numbers are in the capability doc.
 *
 * ─── EVERY COLOUR IS A TOKEN (06 §8.2, §8.3) ────────────────────────────────
 *
 * Parchment and ink ramps only, through the `--map-*` semantic tokens in `app/tokens.css`, resolved
 * once at style-build time like the route's (a MapLibre paint value cannot be a CSS variable). No
 * seventh ramp: water is an ink wash, parks and woods are deeper parchment. Where a variant needs
 * a weaker version of a token it lays that token over the ground at an opacity (`over`) — the
 * colour a translucent fill would paint, made opaque so overlapping lines do not compound.
 *
 * NO GOLD (D-148): gold is never text on parchment and never a meaning-bearing graphic under 3:1.
 * No `--map-*` token points at a gold primitive, and a test asserts no layer paints one.
 */

export type BasemapVariant = "atlas" | "adventure"

/** 05 §5.3: adventure is the product's identity. The toggle (`0098`) changes this per device. */
export const DEFAULT_BASEMAP_VARIANT: BasemapVariant = "adventure"

export const BASEMAP_VARIANTS: readonly BasemapVariant[] = ["atlas", "adventure"]

/** The upstream this fork was taken from. Changing the package version means re-reviewing this file. */
export const PARCHMENT_UPSTREAM = { package: "@protomaps/basemaps", version: "5.7.2", flavor: "light" } as const

/** Role → token. Named here so the resolver, the tests and `tokens.css` cannot disagree on spelling. */
export const MAP_TOKENS = {
  ground: "--map-ground",
  paper: "--map-paper",
  tint: "--map-tint",
  tintDeep: "--map-tint-deep",
  rule: "--map-rule",
  casing: "--map-casing",
  water: "--map-water",
  labelStrong: "--map-label-strong",
  label: "--map-label",
  labelMuted: "--map-label-muted",
  halo: "--map-halo",
} as const

export type MapPalette = Record<keyof typeof MAP_TOKENS, string>

/** Throws on an empty token, for `routePaletteFrom`'s reason: a fallback would be a second palette. */
export function mapPaletteFrom(read: (token: string) => string): MapPalette {
  const out = {} as MapPalette
  for (const [role, token] of Object.entries(MAP_TOKENS) as Array<[keyof MapPalette, string]>) {
    const value = read(token).trim()
    if (!value) {
      throw new Error(`app/tokens.css defines no ${token}. It is added by ticket 0097.`)
    }
    out[role] = value
  }
  return out
}

/** The browser's reader. Called once, when the map is created. */
export function documentMapPalette(): MapPalette {
  const computed = getComputedStyle(document.documentElement)
  return mapPaletteFrom((token) => computed.getPropertyValue(token))
}

type Rgb = readonly [number, number, number]

/**
 * `#rgb` or `#rrggbb` — what `tokens.css` holds for every `--map-*` primitive — or the
 * `rgb(r, g, b)` that `over` itself returns, so a wash can be laid over a wash.
 */
export function parseColor(color: string): Rgb {
  const c = color.trim()
  const fn = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/.exec(c)
  if (fn) return [Number(fn[1]), Number(fn[2]), Number(fn[3])]
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c)
  if (!m) throw new Error(`basemap colour ${color} is neither a hex token value nor rgb()`)
  const h = m[1]!.length === 3 ? [...m[1]!].map((x) => x + x).join("") : m[1]!
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as unknown as Rgb
}

/** `top` laid over `base` at `alpha` — what a translucent fill paints, made opaque. */
export function over(base: string, top: string, alpha: number): string {
  const b = parseColor(base)
  const t = parseColor(top)
  const c = b.map((v, i) => Math.round(v + (t[i]! - v) * alpha))
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`
}

/**
 * THE TWO VARIANTS' DIFFERENCES, AS NUMBERS (05 §5.2's basemap rows).
 *
 * - `age`: how far every fill and line is washed toward `--map-tint-deep` — adventure's "older,
 *   warmer" paper. Text and halos are never aged: a label's contrast is not atmosphere (D-051).
 * - `casing`: atlas draws road casings in ink ("dark road casings, strong hierarchy");
 *   adventure draws them as a parchment rule ("lower contrast, hand-drawn-feeling").
 * - `water`: how much ink the wash carries. Atlas keeps water "clearly separated from land".
 */
const LOOK = {
  atlas: { age: 0, casing: "casing", water: 0.7 },
  adventure: { age: 0.3, casing: "rule", water: 0.5 },
} as const satisfies Record<BasemapVariant, { age: number; casing: keyof MapPalette; water: number }>

/** The fork. Every field of upstream's `Flavor`, mapped onto a parchment-and-ink role. */
export function parchmentFlavor(variant: BasemapVariant, p: MapPalette): Flavor {
  const look = LOOK[variant]
  const aged = (c: string) => (look.age ? over(c, p.tintDeep, look.age) : c)

  const ground = aged(p.ground)
  const paper = aged(p.paper)
  const tint = aged(p.tint)
  const deep = aged(p.tintDeep)
  const water = over(ground, p.water, look.water)
  const casing = aged(p[look.casing])
  const rule = aged(p.rule)
  const rail = aged(p.labelMuted)

  return {
    background: ground,
    earth: ground,
    park_a: tint,
    park_b: tint,
    hospital: tint,
    industrial: tint,
    school: tint,
    wood_a: deep,
    wood_b: deep,
    pedestrian: paper,
    scrub_a: tint,
    scrub_b: tint,
    glacier: paper,
    sand: tint,
    beach: tint,
    aerodrome: tint,
    runway: paper,
    water,
    zoo: tint,
    military: tint,
    tunnel_other_casing: rule,
    tunnel_minor_casing: rule,
    tunnel_link_casing: rule,
    tunnel_major_casing: rule,
    tunnel_highway_casing: rule,
    tunnel_other: tint,
    tunnel_minor: tint,
    tunnel_link: tint,
    tunnel_major: tint,
    tunnel_highway: tint,
    pier: paper,
    buildings: deep,
    minor_service_casing: casing,
    minor_casing: casing,
    link_casing: casing,
    major_casing_late: casing,
    highway_casing_late: casing,
    other: paper,
    minor_service: paper,
    minor_a: paper,
    minor_b: paper,
    link: paper,
    major_casing_early: casing,
    major: paper,
    highway_casing_early: casing,
    highway: paper,
    railway: rail,
    boundaries: rule,
    bridges_other_casing: casing,
    bridges_minor_casing: casing,
    bridges_link_casing: casing,
    bridges_major_casing: casing,
    bridges_highway_casing: casing,
    bridges_other: paper,
    bridges_minor: paper,
    bridges_link: paper,
    bridges_major: paper,
    bridges_highway: paper,
    // Text: never aged, never gold. `--map-label-muted` is --ink-500, 06 §8.3's text floor.
    roads_label_minor: p.label,
    roads_label_minor_halo: p.halo,
    roads_label_major: p.label,
    roads_label_major_halo: p.halo,
    ocean_label: p.label,
    subplace_label: p.labelMuted,
    subplace_label_halo: p.halo,
    city_label: p.labelStrong,
    city_label_halo: p.halo,
    state_label: p.labelMuted,
    state_label_halo: p.halo,
    country_label: p.labelMuted,
    address_label: p.labelMuted,
    address_label_halo: p.halo,
    // Upstream colours POI names by category in eight hues; a parchment map has one ink.
    pois: {
      blue: p.label,
      green: p.label,
      lapis: p.label,
      pink: p.label,
      red: p.label,
      slategray: p.label,
      tangerine: p.label,
      turquoise: p.label,
    },
    landcover: {
      grassland: tint,
      barren: tint,
      urban_area: ground,
      farmland: tint,
      glacier: paper,
      scrub: tint,
      forest: deep,
    },
  }
}

/**
 * ADVENTURE'S LABEL DENSITY: place names, major roads, parks; small POIs suppressed (05 §5.2).
 * These upstream layers are dropped outright; `pois` is narrowed to the park-like kinds below.
 */
export const ADVENTURE_DROPPED_LAYERS = [
  "roads_labels_minor",
  "address_label",
  "roads_oneway",
  "roads_shields",
] as const

/** The POI kinds adventure keeps — parks and open ground, the names a walker steers by. */
export const ADVENTURE_POI_KINDS = ["park", "garden", "forest", "beach", "peak", "zoo", "marina"] as const

/** 05 §5.2 atlas: house-number-scale labels at z ≥ 16 (upstream shows them from z18). */
export const ATLAS_ADDRESS_MINZOOM = 16

/** 05 §5.2 atlas: road geometry drawn ABOVE the fog at ~0.5 opacity. */
export const ATLAS_ROAD_GHOST_OPACITY = 0.5

/** Prefix of atlas's above-fog road copies. One per upstream road FILL layer, derived, never listed. */
export const ROAD_GHOST_PREFIX = "atlas_road_ghost_"

type StyleLayer = ReturnType<typeof layers>[number]

/** A road FILL (not a casing, not a tunnel, not rail): what the street grid is drawn with. */
function isRoadFill(l: StyleLayer): boolean {
  return (
    l.type === "line" &&
    "source-layer" in l &&
    l["source-layer"] === "roads" &&
    !l.id.includes("casing") &&
    !l.id.includes("tunnels") &&
    !["roads_rail", "roads_runway", "roads_taxiway"].includes(l.id)
  )
}

const aboveFog = <T extends StyleLayer>(l: T): T => ({ ...l, metadata: { ...ABOVE_FOG_METADATA } })

/**
 * The variant's layer list. ONE `layers()` call, then the variant's post-pass.
 *
 * ATLAS: the road fill layers are copied in the fill colour at 0.5 opacity and inserted just under
 * the first label, and those copies and every label are tagged `ABOVE_FOG_METADATA`, which is how
 * `fogBeforeId` knows to put the fog under them. On explored ground a copy is invisible — the fill
 * colour at 0.5 over the identical opaque fill — and over the fog it is the street grid's pale
 * ghost, traceable into unexplored ground. The trace web goes between the copies and the labels
 * (D-368, amending D-307 for atlas), so the copies never wash it out.
 *
 * ADVENTURE: nothing is tagged; the fog goes over the whole basemap and its labels (05 §4.4 rule 1).
 */
export function parchmentLayers(source: string, variant: BasemapVariant, palette: MapPalette): StyleLayer[] {
  const base = layers(source, parchmentFlavor(variant, palette), { lang: "en" })

  if (variant === "adventure") {
    const dropped: readonly string[] = ADVENTURE_DROPPED_LAYERS
    return base
      .filter((l) => !dropped.includes(l.id))
      .map((l) =>
        l.id === "pois" && "filter" in l && l.filter
          ? {
              ...l,
              filter: ["all", l.filter, ["in", ["get", "kind"], ["literal", [...ADVENTURE_POI_KINDS]]]],
            }
          : l,
      ) as StyleLayer[]
  }

  const ghosts = base.filter(isRoadFill).map((l) =>
    aboveFog({
      ...l,
      id: `${ROAD_GHOST_PREFIX}${l.id}`,
      paint: { ...("paint" in l ? l.paint : {}), "line-opacity": ATLAS_ROAD_GHOST_OPACITY },
    } as StyleLayer),
  )
  const out: StyleLayer[] = []
  let placed = false
  for (const l of base) {
    if (l.type === "symbol") {
      if (!placed) {
        out.push(...ghosts)
        placed = true
      }
      out.push(aboveFog(l.id === "address_label" ? ({ ...l, minzoom: ATLAS_ADDRESS_MINZOOM } as StyleLayer) : l))
    } else {
      out.push(l)
    }
  }
  if (!placed) out.push(...ghosts)
  return out
}

/**
 * A token reader over the TEXT of `app/tokens.css`, following `var()` hops. For tests and tools
 * that have no `document` — they resolve against the real palette file, never a hand-written copy.
 */
export function cssTokenReader(css: string): (token: string) => string {
  const read = (name: string): string => {
    const m = new RegExp(`\\${name}:\\s*([^;]+);`).exec(css)
    if (!m) return ""
    const value = m[1]!.trim()
    const hop = /^var\((--[\w-]+)\)$/.exec(value)
    return hop ? read(hop[1]!) : value
  }
  return read
}
