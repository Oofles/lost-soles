import type { H3Index } from "h3-js"

import { ExploredSet } from "./explored-set"
import { withoutCells } from "./reveal"

/**
 * WHAT `/` DRAWS FOG OVER. Ticket `0087`, `06-ui-ux.md` §2.4.
 *
 * Two rules, and both are about the home map only — `/run/:id` plays its reveal over whatever set
 * it has, empty included (`0079`):
 *
 * 1. **An unseen run is held back.** Its NEW cells (the server's verdict, `0251`) are left out, so
 *    home shows territory as of before the run and the reveal is the sequence's. Re-armed cells are
 *    NOT held back: they were explored before the run, and D-020's map never re-fogs — not even for
 *    the length of a sequence nobody has opened yet.
 * 2. **No territory, no fog.** With nothing to show, the answer is `null` and the caller creates NO
 *    fog layer — not one at opacity 0. "Nothing ever imported", a cleared cache before the network
 *    answers, and "the only run is the unseen first one" are all a zero-cell mask and all behave
 *    the same: clean parchment. The first thing the fog ever does is burn back.
 *
 * Returns `set` itself when nothing is held (so `applyDelta`'s in-place invalidation still reaches
 * the buckets), a new set when cells are held, and `null` when nothing would be drawn.
 */
export function homeTerritory(set: ExploredSet | null, hold: readonly H3Index[]): ExploredSet | null {
  if (!set || set.size === 0) return null
  if (hold.length === 0) return set
  const cells = withoutCells(set.cells, hold)
  if (cells === set.cells) return set
  return cells.length === 0 ? null : ExploredSet.fromCells(cells, -1)
}

/**
 * `0273`. The hold is not known yet: the explored set has moved (or loaded) and the
 * `/api/runs/latest` answer that says which of its cells belong to an unseen run has not arrived,
 * or the `seen` flag for that run is still being read.
 */
export const HOLD_PENDING = "pending"

/** A known hold (possibly none), or `HOLD_PENDING`. */
export type HomeHold = readonly H3Index[] | typeof HOLD_PENDING

/**
 * `0273`. HOME'S TERRITORY OVER TIME, WHICH NEVER RUNS AHEAD OF ITS HOLD.
 *
 * The explored-set delta for a newly landed run reaches the client one request BEFORE the latest-run
 * refetch that names the run, so for that one request the hold is unknown. Drawing the live set in
 * that window shows the run's new ground and then fogs it back over when the hold lands — the flash
 * this ticket fixes. So while the hold is pending, home keeps drawing exactly what it last drew
 * under a known hold, and the delta waits.
 *
 * Nothing drawn is ever re-fogged by waiting: the frozen view IS the last frame. With nothing drawn
 * yet (a first visit whose latest-run cache is empty), pending is `null` — no layer — exactly as
 * before the set itself had loaded (D-319's "a cleared cache before the network answers").
 *
 * Cheap: `applyDelta` swaps in a NEW cells array rather than writing the old one, so remembering the
 * array reference is the snapshot. A copy is made only if the live set itself was being drawn and
 * has since been mutated in place, and then only once per pending stretch.
 */
export function homeTerritoryView(): (set: ExploredSet | null, hold: HomeHold) => ExploredSet | null {
  /** The view last returned under a known hold, and its cells at that moment. `null`: nothing drawn. */
  let shown: { view: ExploredSet; cells: BigUint64Array } | null = null

  return (set, hold) => {
    if (!set || set.size === 0) {
      shown = null
      return null
    }
    if (hold !== HOLD_PENDING) {
      const view = homeTerritory(set, hold)
      shown = view ? { view, cells: view.cells } : null
      return view
    }
    if (!shown) return null
    // Unchanged since it was drawn (a pending `seen` read, say): keep the identity, and its store.
    if (shown.view.cells === shown.cells) return shown.view
    // The live set was drawn and a delta has since landed in it. Freeze what was on screen.
    shown = { view: ExploredSet.fromCells(shown.cells, -1), cells: shown.cells }
    return shown.view
  }
}
