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
