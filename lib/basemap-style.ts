import { layers, namedFlavor } from "@protomaps/basemaps"

import { ABOVE_FOG_METADATA } from "@/lib/map-layers"

/**
 * THE BASEMAP — ONE STYLE MODULE, TWO VARIANTS. Ticket `0097`, `05-fog-of-war.md` §5.
 *
 * FORKED FROM `@protomaps/basemaps@5.7.2`, flavour `light`. The pin is the review device: a future
 * upgrade diffs that version's `layers()` against this file's post-pass, and the package is pinned
 * to the same exact version in `package.json`. The generator (`layers()`) is upstream's, called
 * ONCE per variant: there is one layer array and one source, so the two variants cannot drift into
 * two code paths. What is forked is the post-pass — label density, and in atlas the layers that go
 * above the fog.
 *
 * ─── THE COLOURS ARE STOCK (D-373) ──────────────────────────────────────────
 *
 * Both variants paint upstream's `light` flavour unchanged. A parchment recolouring was built and
 * rejected by the operator: it read as a filter laid over the map, and the fog already carries the
 * atmosphere. D-373 supersedes D-053's parchment ground and D-369. D-053's refusal of a DARK
 * basemap still holds — stock light is a light, low-chroma ground, so the fog does the darkening.
 * The sampled numbers are in `docs/capabilities/15-two-map-modes-and-cold-territory.md`.
 *
 * NO GOLD (D-148): the stock flavour contains no gold token, and a test asserts no layer paints one.
 */

export type BasemapVariant = "atlas" | "adventure"

/** 05 §5.3: adventure is the default (D-370). The toggle (`0098`) changes this per device. */
export const DEFAULT_BASEMAP_VARIANT: BasemapVariant = "adventure"

export const BASEMAP_VARIANTS: readonly BasemapVariant[] = ["atlas", "adventure"]

/** The upstream this fork was taken from. Changing the package version means re-reviewing this file. */
export const BASEMAP_UPSTREAM = { package: "@protomaps/basemaps", version: "5.7.2", flavor: "light" } as const

/** The one flavour both variants paint with, unmodified (D-373). */
export const BASEMAP_FLAVOR = namedFlavor(BASEMAP_UPSTREAM.flavor)

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

/**
 * Prefix of atlas's labels. `0098`: atlas's labels carry ids of their own, never upstream's, because
 * the toggle swaps variants with a DIFFED `setStyle` (D-374) and MapLibre's style diff ignores
 * `metadata`. Under a shared id, the label would keep atlas's above-fog tag after a swap to adventure
 * — `fogBeforeId` would then put the fog under adventure's labels. A different id makes the diff
 * remove one layer and add the other, so the tag always belongs to the variant on screen.
 */
export const ATLAS_LABEL_PREFIX = "atlas_label_"

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
 * ATLAS: the road fill layers are copied in the stock fill colour at 0.5 opacity and inserted just
 * under the first label, and those copies and every label are tagged `ABOVE_FOG_METADATA`, which is
 * how `fogBeforeId` knows to put the fog under them (D-368). On explored ground a copy is invisible
 * — the fill colour at 0.5 over the identical opaque fill — and over the fog it is the street
 * grid's pale ghost, traceable into unexplored ground. The trace web goes between the copies and
 * the labels (D-368, amending D-307 for atlas), so the copies never wash it out.
 *
 * ADVENTURE: nothing is tagged; the fog goes over the whole basemap and its labels (05 §4.4 rule 1).
 */
export function basemapLayers(source: string, variant: BasemapVariant): StyleLayer[] {
  const base = layers(source, BASEMAP_FLAVOR, { lang: "en" })

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
      const label = { ...l, id: `${ATLAS_LABEL_PREFIX}${l.id}` } as StyleLayer
      out.push(aboveFog(l.id === "address_label" ? ({ ...label, minzoom: ATLAS_ADDRESS_MINZOOM } as StyleLayer) : label))
    } else {
      out.push(l)
    }
  }
  if (!placed) out.push(...ghosts)
  return out
}
