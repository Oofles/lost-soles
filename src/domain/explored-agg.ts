import { cellToParent, type H3Index } from "h3-js"

import { bigToCell } from "./explored-blob"
import { RES } from "./fog"

/**
 * THE ZOOM-OUT AGGREGATE. Ticket `0049`. `05-fog-of-war.md` §6.1, §7.2;
 * `02-data-model.md` T6 item type B, §6.1.
 *
 * ─── WHAT IT IS FOR ─────────────────────────────────────────────────────────
 *
 * At low zoom the renderer stops drawing 150,000 individual res-10 discs and draws one
 * shape per res-6/7/8 parent, its opacity set by the FRACTION of that parent's children
 * the user has explored (§6.1's zoom bucketing). A parent that is 3% explored and one that
 * is 90% explored must not look the same, and at that zoom the individual cells are
 * sub-pixel — so the fraction is the only thing carrying the information.
 *
 * A few KB, fetched at app load alongside the set. It is **derived from the cell array**,
 * not read back from anywhere, which is what keeps it honest: there is no state in which
 * the aggregate disagrees with the blob it shipped beside, because one produced the other.
 *
 * ─── WHY 7^(10-res) IS A CONSTANT AND NOT A COUNT ───────────────────────────
 *
 * H3's hierarchy is *approximately* seven-fold — a res-6 cell does not contain exactly
 * 2,401 res-10 cells in the strict geometric sense, because pentagons and the
 * non-nesting of hexagon boundaries make the true child set ragged. But `cellToParent` is
 * total and deterministic: **every** res-10 cell has exactly one res-6 ancestor by this
 * definition, and the count of ids whose ancestor is a given parent is 7^(10-res).
 *
 * `02` T6 fixes the denominator as that constant, and this file uses it rather than
 * counting, because the denominator must be the same number for a parent the user has
 * barely entered and one they have covered — otherwise the fraction is not comparable
 * between parents and the opacity ramp is meaningless.
 */

/** The three aggregate levels, `02` T6 item type B: `res ∈ {6, 7, 8}`. */
export const AGG_RESOLUTIONS = [6, 7, 8] as const
export type AggResolution = (typeof AGG_RESOLUTIONS)[number]

/** 7^(10-res) — 2401 / 343 / 49. A constant, per `02` T6. See the note above. */
export function totalChildren(res: AggResolution): number {
  return 7 ** (RES - res)
}

export interface AggEntry {
  exploredChildren: number
  totalChildren: number
  /** `exploredChildren / totalChildren`, rounded to 6 places. The opacity input. */
  fraction: number
}

/**
 * The shipped object. `<gen>` is in the filename AND in the body, so a reader that has
 * somehow been handed the wrong object can tell — the same reason `LSFL` carries one.
 */
export interface ExploredAgg {
  generation: number
  res: number
  levels: Record<string, Record<H3Index, AggEntry>>
}

/**
 * Rounded to six places, and the rounding is load-bearing rather than cosmetic.
 *
 * `1 / 2401` is 0.00041649312786339027 — eighteen significant digits of JSON per parent,
 * across a few hundred parents, for a number that ends up as an opacity between 0 and 1.
 * Six places is finer than any display can resolve and keeps the object in the "a few KB"
 * `05` §7.2 promises.
 */
const round6 = (n: number): number => Math.round(n * 1e6) / 1e6

/**
 * Counts children per parent at all three levels in ONE pass over the cells.
 *
 * The higher two levels are derived from the level below rather than from the cells:
 * a res-7 parent's explored count is the sum over its res-8 children's counts, because
 * `cellToParent` is transitive. That turns 3 × 150,000 H3 calls into 150,000 plus a few
 * thousand — the res-8 map has ~2,000 entries at the five-year worst case, and res-7
 * fewer still.
 */
export function computeAgg(cells: readonly bigint[], generation: number): ExploredAgg {
  const byRes8 = new Map<H3Index, number>()
  for (const cell of cells) {
    const parent = cellToParent(bigToCell(cell), 8)
    byRes8.set(parent, (byRes8.get(parent) ?? 0) + 1)
  }

  const roll = (below: Map<H3Index, number>, res: AggResolution): Map<H3Index, number> => {
    const out = new Map<H3Index, number>()
    for (const [child, count] of below) {
      const parent = cellToParent(child, res)
      out.set(parent, (out.get(parent) ?? 0) + count)
    }
    return out
  }

  const byRes7 = roll(byRes8, 7)
  const byRes6 = roll(byRes7, 6)

  const levels: Record<string, Record<H3Index, AggEntry>> = {}
  for (const [res, counts] of [
    [6, byRes6],
    [7, byRes7],
    [8, byRes8],
  ] as const) {
    const total = totalChildren(res)
    const level: Record<H3Index, AggEntry> = {}
    // Sorted so the object is byte-stable for a given cell set — which is what lets
    // `0049`'s AP-17 test compare a rebuilt aggregate to an incremental one directly.
    for (const parent of [...counts.keys()].sort()) {
      const exploredChildren = counts.get(parent)!
      level[parent] = {
        exploredChildren,
        totalChildren: total,
        fraction: round6(exploredChildren / total),
      }
    }
    levels[String(res)] = level
  }

  return { generation, res: RES, levels }
}

/**
 * The parents this activity touched, at every aggregate level.
 *
 * Two uses, and they are not the same one. `explored-cells.ts` writes T6's item type B
 * for exactly these parents; and `05` §7.4's client invalidates exactly the res-6 buckets
 * in this list when it applies a delta. One run touches 1–2 res-6 parents, which is what
 * makes both operations cheap — the third payoff of the res-6 grouping already chosen for
 * T6's partition key and the client's viewport buckets.
 */
export function touchedParents(cells: Iterable<H3Index>): Map<AggResolution, Set<H3Index>> {
  const out = new Map<AggResolution, Set<H3Index>>(AGG_RESOLUTIONS.map((r) => [r, new Set()]))
  for (const cell of cells) {
    for (const res of AGG_RESOLUTIONS) out.get(res)!.add(cellToParent(cell, res))
  }
  return out
}
