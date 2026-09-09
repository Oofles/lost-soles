import { layers, namedFlavor } from "@protomaps/basemaps"
import { Protocol } from "pmtiles"

import outputs from "@/amplify_outputs.json"

/**
 * THE ONE PLACE THE APP KNOWS WHERE THE GROUND COMES FROM. Ticket 0052, D-226.
 *
 * 0052's Notes require exactly this: capability 15 swaps the stock flavour for the
 * parchment fork by changing this module and nothing else. A tile URL or a colour
 * literal anywhere in a component is what makes that a refactor instead of an edit.
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
export const BASEMAP_ARCHIVE = "basemap-fl-20260908.pmtiles"

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

/** `pmtiles://https://d….cloudfront.net/basemap-fl-YYYYMMDD.pmtiles` */
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
 * The stock `light` flavour, unmodified — 0052 makes "a diff against the published
 * style is empty" an acceptance criterion, and `basemap-style.test.ts` asserts it
 * layer for layer against `@protomaps/basemaps` itself.
 *
 * THE GROUND IS GENERIC ON PURPOSE. `09-roadmap.md` §2.3 calls it "present but ugly",
 * which is a statement of intent and not a defect report: the parchment fork is
 * capability 15, deliberately after the milestone, because colour work must never
 * delay the reveal. Do not add an override here. The correct place for the first one
 * is capability 15's fork, and the test below will fail if it lands early.
 */
export function basemapStyle() {
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
    layers: layers(BASEMAP_SOURCE, namedFlavor("light"), { lang: "en" }),
  }
}
