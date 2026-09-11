import { gridDisk, latLngToCell } from "h3-js"

import { cellToBig, encodeExploredBlob } from "@/src/domain/explored-blob"
import { RES } from "@/src/domain/fog"

import { ExploredSet } from "../explored-set"

/**
 * THE SYNTHETIC DATASETS §6.4 ASKS FOR. Ticket `0059`. `05-fog-of-war.md` §6.4.
 *
 * *"Test with synthetic datasets at 50k / 150k / 500k cells, generated once and checked in as a
 * fixture. Real data will not reach 500k for years (R3 §2), and by then the assumption will be
 * untested unless we test it now."*
 *
 * ─── SOLID GROUND, WHICH IS THE WORST CASE AND NOT THE REALISTIC ONE ────────
 *
 * A real explored set is a web of 131 m corridors: sparse, stringy, and mostly empty inside its own
 * bounding box. A solid disc is the opposite, and it is what these fixtures are, because every number
 * §6.4 asserts is a CEILING. `visibleInstanceCount` is bounded by screen area only when the screen is
 * full; a corridor fixture would pass the ceiling by being sparse rather than by being culled, which
 * is a test that cannot fail for the reason it was written.
 *
 * D-238's bridge elision is the other half of the same argument and it cuts the other way: solid
 * ground is where the elision does the most work (3 adjacent pairs per cell, all interior) and a
 * corridor is where it does the least (91% of bridges kept). So the solid disc is the worst case for
 * instance count and the *best* case for bridging, and §6.4 records both numbers rather than one.
 *
 * ─── THE SIZES ARE `3k² + 3k + 1`, NOT ROUND NUMBERS ────────────────────────
 *
 * `gridDisk` produces whole rings. Truncating one to land on exactly 150,000 would leave a partial
 * outer ring — a disc with a bite out of it — and the bite is the one part of the shape whose culling
 * behaviour differs from everywhere else. So the k is chosen for the nearest whole disc and the exact
 * count is reported rather than rounded. `cull.test.ts` already used k = 128 / 224 / 408 for this
 * reason; these are the same three.
 *
 * ─── WHERE ─────────────────────────────────────────────────────────────────
 *
 * 30°N, 100°E — the middle of western China, nobody's home address, and the same origin
 * `cull.test.ts` uses for its instance-count canary. **Latitude is load-bearing here**: a z14 viewport
 * covers 1.7x less ground at Point Nemo's 48.9°S than it does at the operator's latitude, so a ceiling
 * measured at Nemo understates it by that factor. It is a synthetic coordinate under D-199 in the
 * sense that matters — no trace, no street, no person — and §6.4's recorded numbers name it.
 *
 * **The checked-in fixture is not what the phone measures frame time against**, and that distinction
 * is `camera-path.ts`'s to explain: there is no basemap here, and fog over an empty background is a
 * frame time that leaves out most of the frame.
 */

/** 30°N 100°E. Western China; synthetic; the latitude is the reason. See the header. */
export const PERF_ORIGIN = { lat: 30, lng: 100 } as const

export interface PerfDataset {
  /** The `?fog=perf` value and the fixture's filename stem. */
  readonly label: "50k" | "150k" | "500k"
  /** `gridDisk` radius in cells. */
  readonly k: number
  /** `3k² + 3k + 1`, stated so a wrong `k` is a failing assertion rather than a different fixture. */
  readonly cells: number
}

export const DATASETS: readonly PerfDataset[] = [
  { label: "50k", k: 128, cells: 49_537 },
  { label: "150k", k: 224, cells: 151_201 },
  { label: "500k", k: 408, cells: 500_617 },
]

export function datasetFor(label: string): PerfDataset | null {
  return DATASETS.find((dataset) => dataset.label === label) ?? null
}

/** `3k² + 3k + 1` — the size of a `gridDisk` of radius k on a hex grid, pentagons aside. */
export function discSize(k: number): number {
  return 3 * k * k + 3 * k + 1
}

/**
 * A solid disc of `k` rings around `centre`, as the ascending unique bigints the wire format wants.
 *
 * **Sorted by h3 id, not by geometry**, because that is what `encodeExploredBlob` requires and what
 * `ExploredSet` guarantees to its consumers. The delta-varint encoding is at its WORST on this input
 * — an h3 id's low bits are the child path, so a spatially compact set is not an arithmetically
 * compact one — which is the right direction for a fixture that exists to find ceilings.
 */
export function syntheticCells(centre: { lat: number; lng: number }, k: number): bigint[] {
  return gridDisk(latLngToCell(centre.lat, centre.lng, RES), k)
    .map(cellToBig)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}

/** The same disc as an `ExploredSet`, for the paths that never touch bytes. */
export function syntheticSet(
  centre: { lat: number; lng: number },
  k: number,
  generation = 1,
): ExploredSet {
  return ExploredSet.fromCells(BigUint64Array.from(syntheticCells(centre, k)), generation)
}

/**
 * THE FIXTURE BYTES, THROUGH THE SHIPPED WRITER.
 *
 * `encodeExploredBlob` is the function `explored-blob-store.ts` calls to write the real
 * `explored-r10.bin` that the real browser really fetches. Hand-rolling the varints here would
 * produce a fixture that certifies the decoder against a format nothing writes — and the fixture
 * would be written by the same person writing the reader, so it would encode the same
 * misunderstanding and then certify it.
 */
export function syntheticBlob(dataset: PerfDataset, centre = PERF_ORIGIN): Uint8Array {
  return encodeExploredBlob(syntheticCells(centre, dataset.k), 1)
}

/** Where `fixtures.test.ts` writes them and where the browser fetches them from. */
export function fixtureUrl(label: string): string {
  return `/fog-fixtures/fog-${label}.bin`
}
