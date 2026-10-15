import { cellArea, gridDisk, UNITS } from "h3-js"

import type { RuleSet } from "@/src/rules/schema"
import { bigToCell, cellToBig } from "@/src/domain/explored-blob"
import { discoveryCredits, discoveryRows } from "@/src/scoring/propagate"
import { ledgerEntries } from "@/src/scoring/ledger"

/**
 * THE DERIVED STATS FEED. Ticket `0090`. `05-fog-of-war.md` §8.2–§8.4.
 *
 * One place that computes the numbers the plinth, the tally and the chronicle lines read. Everything
 * here is DERIVED: nothing is persisted, nothing is an authority, and a wrong number is fixed by
 * recomputing it — never by writing a correction.
 *
 * ─── PER RUN (§8.2): READ, NEVER RECOMPUTED ─────────────────────────────────
 *
 * `runTerritory` takes the counts the projection stored on the activity row (`persist.ts`, 05 §3.2)
 * and NO CELL SET: there is no argument through which it could reclassify anything. Recomputing
 * would give a different answer anyway — by the time anyone reads a run, its own cells are in the
 * store and every one of them classifies as cooled (`discovery.ts`, R3 §4(e)).
 *
 * Credit and XP are not stored either (D-272). They come from the run's own ruleset row through
 * the ledger's own derivation: `discoveryCredits` sums the rows `discoveryRows` would write, and
 * `cartographyXp` rates those same rows through `ledgerEntries`, rounding once PER ROW (I-19,
 * D-256). That is why `04` §8.2's 148 new + 58 re-armed is 318 + 62 = 380 XP and not
 * `round(177 × 2.15)` = 381 — the ticket's `round(credits × XP_PER_CELL)` predates both D-256 and
 * D-276, and the tally would show the ledger's 380.
 *
 * ─── LIFETIME (§8.3): MEMOISED PER GENERATION, AND SLICED ───────────────────
 *
 * The cell count is the loaded set's `size` — O(1), and the plinth's whole need. Area and frontier
 * length touch every cell (~3 µs each through h3), half a second at a year-five 150k cells, so
 * `lifetimeTerritory` runs in time slices that yield between frames, and `lifetimeFeed` memoises the
 * result per (set, generation): a second read at the same generation does no work at all.
 *
 * ─── NO PERIOD AGGREGATES ───────────────────────────────────────────────────
 *
 * Nothing here takes a date range, and nothing may (`06-ui-ux.md` §2.3, N2). "This week's distance"
 * would be trivial and is refused: the moment it is on a screen, a goal follows.
 */

// ─── Per run ───────────────────────────────────────────────────────────────

/**
 * The award columns the projection wrote on the activity row (T3), as `RunSummary` carries them.
 * Optional where a row may predate the column.
 */
export interface StoredRunCounts {
  newCellCount: number
  rearmedCellCount: number
  cooledCellCount?: number | null
  deferredCellCount?: number | null
  cellCount?: number | null
}

/** One run's Cartography feed. Every field is always present and always a finite number. */
export interface RunTerritory {
  /** Every cell the run touched, all classes. */
  cellCount: number
  /** Never-seen cells — "claimed". */
  newCellCount: number
  /** Cells last run more than six months before (D-120) — "remembered". */
  rearmedCellCount: number
  /** Cells run inside six months — "familiar". Earn nothing. */
  cooledCellCount: number
  /** Cells earlier than their `lastRunAt` (§3.4): nothing until a replay folds them. */
  deferredCellCount: number
  /** `discoveryCredits(counts, row)` under the run's own ruleset (D-272). */
  discoveryCredits: number
  /** Σ of the discovery ledger rows' `xpAwarded` those counts produce, rounded per row (I-19). */
  cartographyXp: number
}

/** The ruleset the run was scored under — its `xpRulesVersion`'s, never today's. */
export type RunRules = Pick<RuleSet, "version" | "skills">

const count = (n: number | null | undefined): number => (typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0)

/**
 * The discovery row: the enabled skill whose row carries `unitMultipliers`. Found by DATA, never by
 * id (D-031) — the same test `run-moment.tsx` uses to hand the frontier its weights.
 */
export function discoveryRow(rules: RunRules): RunRules["skills"][number] | null {
  return rules.skills.find((s) => s.enabled && s.unitMultipliers) ?? null
}

/**
 * THE PER-RUN FEED. Pure, and reads only what it is given: the stored counts and the run's ruleset.
 * A run with no new ground is a well-formed record of zeros — never `null`, never a throw.
 */
export function runTerritory(stored: StoredRunCounts, rules: RunRules): RunTerritory {
  const newCellCount = count(stored.newCellCount)
  const rearmedCellCount = count(stored.rearmedCellCount)
  const cooledCellCount = count(stored.cooledCellCount)
  const deferredCellCount = count(stored.deferredCellCount)
  const counts = { newCellCount, rearmedCellCount }

  const row = discoveryRow(rules)
  const credits = row ? discoveryCredits(counts, row) : 0
  const xp = row
    ? ledgerEntries(discoveryRows(counts, [row]), {
        // Only `xpAwarded` is read back: the identity fields exist because `ledgerEntries` builds
        // whole rows, and nothing here is written anywhere.
        activity: { activityId: "derived", userId: "derived", startedAt: "1970-01-01T00:00:00Z" },
        rules,
        awardedAt: "1970-01-01T00:00:00Z",
      }).reduce((s, e) => s + e.xpAwarded, 0)
    : 0

  return {
    cellCount: count(stored.cellCount) || newCellCount + rearmedCellCount + cooledCellCount + deferredCellCount,
    newCellCount,
    rearmedCellCount,
    cooledCellCount,
    deferredCellCount,
    discoveryCredits: credits,
    cartographyXp: xp,
  }
}

// ─── Lifetime ──────────────────────────────────────────────────────────────

/** What lifetime totals read of the explored set. `ExploredSet` satisfies it. */
export interface LoadedExplored {
  readonly generation: number
  readonly size: number
  /** Ascending, unique — the decoded `explored-r10.bin` itself. */
  readonly cells: BigUint64Array
}

/**
 * Lifetime cells revealed: the loaded blob's own size. Not a cached number, not a count from a
 * server — the plinth reads this so that it can only ever say what the map is drawing.
 */
export function lifetimeCells(set: Pick<LoadedExplored, "size"> | null): number | null {
  return set ? set.size : null
}

export interface LifetimeTerritory {
  /** The manifest generation these totals are for. */
  generation: number
  /** `exploredSet.size`. */
  cells: number
  /** `Σ cellArea(c, 'km2')` — per cell, because cell area varies with latitude (§8.3). */
  areaKm2: number
  /** Explored cells with at least one unexplored `gridDisk(c, 1)` neighbour (§8.3). */
  frontierLength: number
}

/** How long one slice may run before yielding, in ms. Well inside a 16.7 ms frame. */
export const SLICE_BUDGET_MS = 6

/** Cells between clock reads: ~0.4 ms of work at ~3 µs a cell, so a slice overruns by little. */
const CHECK_EVERY = 128

export interface SliceDeps {
  /** Monotonic ms. */
  now(): number
  /** Resolves on a later task, giving the frame back. */
  yield(): Promise<void>
}

const defaultSlices: SliceDeps = {
  now: () => performance.now(),
  yield: () => new Promise((resolve) => setTimeout(resolve, 0)),
}

/** Membership by binary search over one captured array — `ExploredSet.has`'s method, pinned. */
function within(cells: BigUint64Array, target: bigint): boolean {
  let lo = 0
  let hi = cells.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1
    const v = cells[mid]
    if (v === target) return true
    if (v < target) lo = mid + 1
    else hi = mid - 1
  }
  return false
}

/**
 * §8.3's set-derived totals, in slices of at most `SLICE_BUDGET_MS`. Membership is asked of the
 * array captured at the start, not of `set.has`: a delta applied between slices REPLACES the set's
 * array (`applyDelta`), so the walk finishes consistently against the generation it is labelled
 * with, and the caller's memo recomputes for the new one.
 */
export async function lifetimeTerritory(set: LoadedExplored, deps: SliceDeps = defaultSlices): Promise<LifetimeTerritory> {
  const cells = set.cells
  const generation = set.generation
  let areaKm2 = 0
  let frontierLength = 0
  let sliceStart = deps.now()
  for (let i = 0; i < cells.length; i++) {
    const cell = bigToCell(cells[i])
    areaKm2 += cellArea(cell, UNITS.km2)
    for (const n of gridDisk(cell, 1)) {
      if (n !== cell && !within(cells, cellToBig(n))) {
        frontierLength++
        break
      }
    }
    if ((i + 1) % CHECK_EVERY === 0 && deps.now() - sliceStart >= SLICE_BUDGET_MS) {
      await deps.yield()
      sliceStart = deps.now()
    }
  }
  return { generation, cells: cells.length, areaKm2, frontierLength }
}

/**
 * MEMOISED ON GENERATION. The returned reader computes once per (set, generation) and hands every
 * later caller the same promise — two reads at one generation are one computation, and a render
 * never triggers work by itself. `compute` is injectable so a test can count calls.
 */
export function lifetimeFeed(
  compute: (set: LoadedExplored) => Promise<LifetimeTerritory> = (set) => lifetimeTerritory(set),
): (set: LoadedExplored) => Promise<LifetimeTerritory> {
  let last: { set: LoadedExplored; generation: number; totals: Promise<LifetimeTerritory> } | null = null
  return (set) => {
    if (last && last.set === set && last.generation === set.generation) return last.totals
    const totals = compute(set)
    last = { set, generation: set.generation, totals }
    return totals
  }
}
