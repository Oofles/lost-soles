import { decodeLastRunBlob } from "@/src/domain/explored-blob"

import type { ExploredSet } from "./explored-set"
import { fogLastRunPath } from "./wire"
import { FogTransportError } from "./transport"

/**
 * THE `lastRunDay` SIDECAR, IN THE BROWSER. Ticket `0100` (operator, 2026-10-20, Q1 = A).
 * `05-fog-of-war.md` §7.2, `06-ui-ux.md` §4.6, D-120.
 *
 * `0054` deliberately did not fetch `explored-lastrun-r11.<gen>.bin`: the fog does not need it —
 * revealed is permanent (D-020) — and it roughly doubles the payload. Cold territory is the one view
 * that does, so this is fetched **lazily, the first time atlas is shown**, and never blocks the map.
 *
 * ─── PARALLEL TO ONE GENERATION'S CELLS, LOOKED UP BY CELL AFTER THAT ────────
 *
 * The sidecar is index-parallel to the cell array OF ITS GENERATION, and the header says which
 * (D-219), so it is fetched for the set's generation at the moment of the request and held beside
 * THAT array — the set's `cells` reference, which `applyDelta` replaces rather than mutates.
 *
 * While the set still holds that array, a lookup is an index. After a mid-session delta it is a
 * binary search, and a cell the delta added is simply not found: `undefined`, which the mask draws
 * as fresh ground (05 §7.2's *"no lastRun data loaded → assume recent"*). That is right for the new
 * cells — a delta's cells were just run — and is the known gap for the old ones: ground re-run during
 * the session keeps its old day until the next generation fetch (D-389).
 */
export class LastRunDays {
  readonly generation: number
  readonly #cells: BigUint64Array
  readonly #days: Uint16Array

  constructor(cells: BigUint64Array, days: Uint16Array, generation: number) {
    if (cells.length !== days.length) {
      throw new RangeError(
        `LastRunDays: ${days.length} days for ${cells.length} cells. The sidecar is parallel to ` +
          "one generation's cell array or it is attributed to the wrong hexagons.",
      )
    }
    this.#cells = cells
    this.#days = days
    this.generation = generation
  }

  get size(): number {
    return this.#cells.length
  }

  /**
   * The day of the cell at `index` of `cells` — the set's array as it stands now. An index when that
   * is still the array the sidecar was fetched for; a search when a delta has replaced it.
   */
  dayAt(cells: BigUint64Array, index: number): number | undefined {
    if (cells === this.#cells) return this.#days[index]
    const cell = cells[index]
    return cell === undefined ? undefined : this.dayOf(cell)
  }

  /** The day for one cell, or `undefined` when it is not in the sidecar's generation. */
  dayOf(cell: bigint): number | undefined {
    const cells = this.#cells
    let lo = 0
    let hi = cells.length - 1
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1
      const at = cells[mid]!
      if (at === cell) return this.#days[mid]
      if (at < cell) lo = mid + 1
      else hi = mid - 1
    }
    return undefined
  }
}

/** The one call the loader makes. A seam so the tests need no network. */
export type LastRunFetch = (generation: number) => Promise<Uint8Array>

export function httpLastRunFetch(fetchImpl: typeof globalThis.fetch = globalThis.fetch): LastRunFetch {
  return async (generation) => {
    /**
     * `cache: "default"` for the cell blob's reason: the route is named by generation, a generation is
     * never rewritten, and the response is `private, immutable` — a re-open costs nothing.
     */
    const response = await fetchImpl(fogLastRunPath(generation), { credentials: "same-origin", cache: "default" })
    if (!response.ok) {
      throw new FogTransportError(response.status, `GET ${fogLastRunPath(generation)} → ${response.status}`)
    }
    return new Uint8Array(await response.arrayBuffer())
  }
}

/**
 * Fetch and decode the sidecar for the set's CURRENT generation, and hold it beside the array that
 * generation's cells are in. Refuses — throws — when the bytes do not belong to that array: a
 * different generation in the header, or a different count. A refused sidecar costs the cold wash and
 * nothing else; a silently mis-parallel one paints the wrong hexagons (D-219).
 */
export async function loadLastRun(set: ExploredSet, fetchBytes: LastRunFetch): Promise<LastRunDays> {
  const generation = set.generation
  const cells = set.cells
  if (!(generation >= 1)) throw new RangeError(`loadLastRun: generation ${generation} has no sidecar`)
  const blob = decodeLastRunBlob(await fetchBytes(generation))
  if (blob.generation !== generation) {
    throw new RangeError(`loadLastRun: asked for generation ${generation}, the sidecar is ${blob.generation}`)
  }
  return new LastRunDays(cells, blob.days, generation)
}

/**
 * Today in `lastRunDay` units — whole days since 2020-01-01 UTC, the sidecar's epoch (`02` T6,
 * `src/pipeline/explored-cells.ts`'s `lastRunDay`). A DISPLAY clock: cold territory is how the map
 * looks today, so it reads `now`. Scoring never does (D-276), and nothing here reaches scoring.
 */
export function todayDay(nowMs: number): number {
  return Math.floor((nowMs - LAST_RUN_EPOCH_MS) / DAY_MS)
}

const DAY_MS = 86_400_000
const LAST_RUN_EPOCH_MS = Date.UTC(2020, 0, 1)
