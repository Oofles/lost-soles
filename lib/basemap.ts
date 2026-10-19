import { Protocol } from "pmtiles"

import outputs from "@/amplify_outputs.json"
import { basemapLayers, type BasemapVariant } from "@/lib/basemap-style"
import { FOG_LAYER_ID, fogBeforeId } from "@/lib/map-layers"

/**
 * THE ONE PLACE THE APP KNOWS WHERE THE GROUND COMES FROM. Ticket 0052, D-226.
 *
 * 0052's Notes require exactly this: capability 15 swaps the stock style for the
 * two-variant fork (`0097`, `lib/basemap-style.ts`) by changing this module and nothing
 * else. A tile URL or a colour literal anywhere in a component is what makes that a
 * refactor instead of an edit.
 */

/**
 * THE ARCHIVE KEY CARRIES ITS SOURCE BUILD DATE, and that is a correctness device
 * rather than bookkeeping.
 *
 * Replacing an archive in place under a stable key is a real bug with pmtiles, not
 * just a staleness annoyance: the client caches the archive's directory, then reads
 * byte ranges against it. Serve those ranges from a DIFFERENT archive and the offsets
 * still resolve — to the wrong bytes. The reader gets coherent-looking garbage rather
 * than an error. A dated key makes that unrepresentable; the cost is this one line
 * changing whenever the extract is regenerated, which the capability doc records.
 */
/*
 * ONE ARCHIVE, MORE THAN ONE REGION (ticket 0284). Florida's 0052 bbox, unchanged, plus the 1°
 * tile around each out-of-Florida area holding a traced activity, cut in one multi-region
 * `pmtiles extract` from `docs/capabilities/assets/0284/basemap-region.geojson`. One archive keeps
 * one MapLibre source and one name-lookup reader (`lib/place-names.ts`, D-302); a gap between the
 * regions has no tiles and renders as the background, exactly as everywhere off the map did before.
 * Its header bounds are the union of the regions, so nothing here reads them for a camera: the
 * extract fallback is `EXTRACT_FALLBACK` in `lib/map-camera.ts`, inside the Florida region.
 */
export const BASEMAP_ARCHIVE = "basemap-20261018.pmtiles"

/** The MapLibre source id. Referenced by every layer the flavour generates. */
export const BASEMAP_SOURCE = "protomaps"

/**
 * Protomaps and OpenStreetMap, both required. ODbL obliges the OSM credit and
 * Protomaps asks for its own; 0052 makes their visible presence an acceptance
 * criterion. MapLibre renders this into the attribution control as HTML.
 */
export const BASEMAP_ATTRIBUTION =
  '<a href="https://protomaps.com">Protomaps</a> © ' +
  '<a href="https://openstreetmap.org/copyright">OpenStreetMap</a>'

/**
 * READ THROUGH A CAST, for the reason `app/sync-action.ts` sets out at length:
 * `amplify_outputs.json` is gitignored and generated per environment, so the TYPE of
 * that import is whatever file is on disk at typecheck time. A structural read and a
 * loud failure is the only thing that behaves the same locally, in CI (which copies
 * the example file) and in a real deploy.
 *
 * A CLOUDFRONT DOMAIN IS NOT A SECRET. It serves an open street map cut from a public
 * planet build; anyone can fetch the same bytes from build.protomaps.com.
 */
export function basemapTilesUrl(): string {
  const custom = (outputs as { custom?: { basemapTilesUrl?: string } }).custom
  const url = custom?.basemapTilesUrl
  if (!url) {
    throw new Error(
      "amplify_outputs.json has no custom.basemapTilesUrl. It is written by " +
        "backend.addOutput in amplify/backend.ts (ticket 0052); a missing value means " +
        "this build predates that deploy.",
    )
  }
  return url
}

/** `pmtiles://https://d….cloudfront.net/basemap-YYYYMMDD.pmtiles` */
export function basemapArchiveUrl(): string {
  return `pmtiles://${basemapTilesUrl()}/${BASEMAP_ARCHIVE}`
}

/**
 * The MapLibre `addProtocol` handler for `pmtiles://`.
 *
 * TAKES THE MAPLIBRE MODULE AS AN ARGUMENT rather than importing it. `maplibre-gl` is
 * ticket 0053's dependency, pinned there, loaded through `next/dynamic` with
 * `ssr: false` because WebGL has no server rendering. Importing it here would drag a
 * WebGL bundle into every module that wants to know the tile URL, and would put a
 * dependency in 0052 that 0053 is the ticket for.
 */
export function registerPmtilesProtocol(maplibre: {
  addProtocol: (name: string, handler: Protocol["tile"]) => void
}): Protocol {
  const protocol = new Protocol()
  maplibre.addProtocol("pmtiles", protocol.tile)
  return protocol
}

/**
 * The basemap style (ticket `0097`), in the variant asked for. Label density and the atlas
 * variant's above-fog layers are `lib/basemap-style.ts`'s; the colours are the stock `light`
 * flavour's (D-373). This function only binds them to the ONE source and the ONE archive. Both
 * variants share both (05 §5.2).
 */
export function basemapStyle(variant: BasemapVariant) {
  return {
    version: 8 as const,
    glyphs: "https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf",
    sprite: "https://protomaps.github.io/basemaps-assets/sprites/v4/light",
    sources: {
      [BASEMAP_SOURCE]: {
        type: "vector" as const,
        url: basemapArchiveUrl(),
        attribution: BASEMAP_ATTRIBUTION,
      },
    },
    layers: basemapLayers(BASEMAP_SOURCE, variant),
  }
}

/* ─── `0098`: swapping the variant under a live map ──────────────────────────── */

/** The slice of a style these touch: what `map.getStyle()` returns and `setStyle` takes. */
interface StyleLike {
  sources: Record<string, unknown>
  layers: ReadonlyArray<{ id: string; type: string; source?: unknown }>
  [key: string]: unknown
}

/** A layer the basemap owns: its background, or anything drawn from its one source. */
function isBasemapLayer(l: { type: string; source?: unknown }): boolean {
  return l.type === "background" || l.source === BASEMAP_SOURCE
}

/**
 * `setStyle`'s `transformStyle` for a variant swap: THE NEXT BASEMAP, WITH EVERY APP LAYER CARRIED
 * ACROSS. Pure, so `basemap.test.ts` runs MapLibre's own style diff over it.
 *
 * Without it a diffed `setStyle` removes the route, the trace web and the landmarks — they are in
 * the current style and not in `basemapStyle(variant)`, and the diff's job is to make the one into
 * the other. Their sources likewise. With it, the diff sees them unchanged and leaves them alone.
 *
 * WHERE THEY GO. An app layer that sat below the first label (the trace web, D-307; beat inks) goes
 * below the next variant's first label — which in atlas lands it above the road copies and so above
 * the fog (D-368). Everything else (landmarks, the route) goes on top, in the order it had. The fog
 * is a custom layer, which a style serialisation never contains; `swapBasemap` re-places it.
 */
export function carryAppLayers<S extends StyleLike>(prev: S | undefined, next: S): S {
  if (!prev) return next
  const prevFirstSymbol = prev.layers.findIndex((l) => l.type === "symbol")
  const below: S["layers"][number][] = []
  const above: S["layers"][number][] = []
  prev.layers.forEach((l, i) => {
    if (isBasemapLayer(l)) return
    if (prevFirstSymbol !== -1 && i < prevFirstSymbol) below.push(l)
    else above.push(l)
  })
  const base = [...next.layers]
  const firstSymbol = base.findIndex((l) => l.type === "symbol")
  const at = firstSymbol === -1 ? base.length : firstSymbol
  const layers = [...base.slice(0, at), ...below, ...base.slice(at), ...above]
  const sources = { ...next.sources }
  for (const [id, source] of Object.entries(prev.sources)) {
    if (id !== BASEMAP_SOURCE && !(id in sources)) sources[id] = source
  }
  return { ...next, sources, layers }
}

/** The slice of MapLibre's `Map` a swap needs. Structural, so a test drives it with a plain object. */
export interface SwapHost {
  setStyle(style: unknown, options: { diff: true; transformStyle: (prev: never, next: never) => unknown }): unknown
  getLayer(id: string): unknown
  moveLayer(id: string, beforeId?: string): void
  getStyle(): { layers?: ReadonlyArray<{ id: string; metadata?: unknown }> } | undefined
}

/**
 * SWAP THE VARIANT IN PLACE. `0098`, operator Q1 = B, D-NEW-c.
 *
 * A DIFFED `setStyle`: MapLibre adds, removes and re-filters only the layers that differ, keeps the
 * one source and its loaded tiles, keeps the custom fog layer (which no serialisation contains, so
 * no diff can remove it), and **never touches the camera** — the diff skips centre, zoom, bearing
 * and pitch outright, and this style carries none. Then the fog is moved to where `fogBeforeId`
 * says, because its placement relative to the labels is decided per variant (D-368): under atlas's
 * first above-fog layer, or over adventure's whole basemap.
 */
export function swapBasemap(map: SwapHost, variant: BasemapVariant): void {
  map.setStyle(basemapStyle(variant), {
    diff: true,
    transformStyle: ((prev: StyleLike | undefined, next: StyleLike) => carryAppLayers(prev, next)) as never,
  })
  if (map.getLayer(FOG_LAYER_ID)) map.moveLayer(FOG_LAYER_ID, fogBeforeId(map))
}
