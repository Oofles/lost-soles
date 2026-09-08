import { gridDisk, type H3Index } from "h3-js"

/**
 * THE CROSS-ADAPTER EQUIVALENCE HARNESS. Ticket `0155`;
 * `docs/contracts/ingestion-contract.md` §5 check 3; `0027`'s T3.
 *
 * > *"The same physical run ingested via two adapters yields the same H3 cell set within
 * > tolerance."*
 *
 * ─── WHAT THIS PROTECTS, AND IT IS THE ONLY CHECK THAT PROTECTS IT ──────────
 *
 * T1 and T2 assert the boundary's SHAPE — no vendor type in the domain, one importer of the
 * adapter directory. A replacement adapter can satisfy both, typecheck cleanly, and still emit
 * a subtly different trace: a rounded coordinate, a point dropped at a gap, a different reading
 * of where a pause ended. That difference becomes a different cell set, and **the map never
 * re-fogs (D-020)** — cell writes are append-only, so this is not a bug you notice and fix, it
 * is wrong ground written permanently into a map with no undo.
 *
 * T1/T2 check that the pipes are connected. This checks that the same water comes out.
 *
 * ─── WHAT IT DELIBERATELY DOES NOT DO ───────────────────────────────────────
 *
 *   - It does not say either adapter is RIGHT. Two adapters can agree and both be wrong about
 *     the world. This is an equivalence test, not a correctness test.
 *   - It does not catch shared blindness — two decimated sources agree beautifully. That is
 *     check 5, the fidelity floor, which shipped with `0038`.
 *   - It does not exercise the real ingestion path. No queue, no S3, no DynamoDB: it is a pure
 *     comparison of `normalize()` → `traceToCells()` output.
 *
 * ─── WHY THE HARNESS LIVES HERE AND THE DRIVER DOES NOT ─────────────────────
 *
 * The driver that feeds it the PRIMARY adapter's fixture has to name that adapter, and D-188
 * refuses test files an exemption from `check-boundaries.mjs` — `0027` asked for one and was
 * turned down. So the driver lives inside the adapter's own directory (the precedent
 * `fog-projection.test.ts` set) and dies with it on migration day.
 *
 * **Everything worth having in advance is in this file, and it does not.** `0027`'s Notes:
 * *"a cell-set equivalence harness that already exists is the difference between a one-week
 * migration and a rewrite."* The tolerance, its justification, the adjacency rule and the
 * failure message are the parts that would otherwise be argued about under time pressure on
 * the day the decision has already been made. A new adapter writes a twenty-line driver.
 */

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE TOLERANCE, AND THE MEASUREMENT IT IS SET FROM.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * **Measured on the checked-in run (2,537 fixes, 6,043 m, 45 res-10 cells), by re-projecting
 * it at successively coarser coordinate precision:**
 *
 * | precision | metres | cells differing | isolated |
 * |---|---|---|---|
 * | 7 dp | 0.01 m | **0** | 0 |
 * | 6 dp | 0.1 m  | **0** | 0 |
 * | 5 dp | 1.1 m  | **0** | 0 |
 * | 4 dp | 11 m   | 5 of 49 (10.2%) | 0 |
 *
 * So the honest headline is that at any precision a real GPX carries, **the two adapters agree
 * exactly** — `REVEAL_R_M`'s 65 m radius is simply not sensitive to metre-scale disagreement,
 * and the driver asserts exact equality rather than settling for the tolerance.
 *
 * The tolerance exists anyway, and it is not decoration: it is the bar a FUTURE adapter has to
 * clear, fixed now so migration day is a measurement rather than an argument. 2% is chosen
 * because it sits between the two rows that matter — comfortably above the 0% every realistic
 * precision produces, and far below the 10.2% that an 11 m coordinate error produces.
 *
 * ─── WHAT IT ABSORBS ────────────────────────────────────────────────────────
 *
 * Float rounding at a cell edge. A res-10 cell is ~131 m across; a fix within a metre of a
 * boundary can land either side of it, and the disc of candidates it qualifies shifts by one
 * cell. That is a difference about arithmetic, not about where the runner went.
 *
 * ─── WHAT IT MUST NOT ABSORB, AND WHY THE PERCENTAGE ALONE IS NOT ENOUGH ────
 *
 * A dropped segment. A collapsed loop. A pause read differently. Those are differences about
 * the ROUTE, and on a long run they can be small as a percentage — losing 200 m off the end of
 * a 6 km run is 3 cells of 45, under 7%, and a tolerance chosen only by percentage would let it
 * through.
 *
 * `isolated` is what refuses them. Rounding at a boundary can only move cells that are ALREADY
 * adjacent to the agreed set; a dropped segment removes a contiguous run whose far end touches
 * nothing both adapters kept. So a differing cell with no neighbour in the intersection fails
 * the comparison **regardless of the percentage** — see `assertEquivalentCellSets`.
 */
export const MAX_CELL_SET_DIVERGENCE = 0.02

export interface CellSetComparison {
  /** Cells both adapters produced. */
  intersection: Set<H3Index>
  /** In the first set only. */
  onlyA: H3Index[]
  /** In the second set only. */
  onlyB: H3Index[]
  /** `|symmetric difference| / |union|`. 0 when the sets are equal; 1 when disjoint. */
  divergence: number
  /**
   * Differing cells with NO neighbour in the intersection. Rounding cannot produce one; a
   * dropped segment, a collapsed loop or a misread pause all can.
   */
  isolated: H3Index[]
}

export function compareCellSets(
  a: ReadonlySet<H3Index>,
  b: ReadonlySet<H3Index>,
): CellSetComparison {
  const intersection = new Set([...a].filter((c) => b.has(c)))
  const onlyA = [...a].filter((c) => !b.has(c))
  const onlyB = [...b].filter((c) => !a.has(c))
  const unionSize = a.size + onlyB.length

  const isolated = [...onlyA, ...onlyB].filter(
    (c) => !gridDisk(c, 1).some((neighbour) => intersection.has(neighbour)),
  )

  return {
    intersection,
    onlyA,
    onlyB,
    divergence: unionSize === 0 ? 0 : (onlyA.length + onlyB.length) / unionSize,
    isolated,
  }
}

/**
 * Throws unless the two cell sets are equivalent. The message is the point: it has to be
 * readable by whoever is halfway through a source migration at the moment it fires.
 */
export function assertEquivalentCellSets(
  a: ReadonlySet<H3Index>,
  b: ReadonlySet<H3Index>,
  labels: { a: string; b: string },
  tolerance: number = MAX_CELL_SET_DIVERGENCE,
): CellSetComparison {
  const result = compareCellSets(a, b)
  const over = result.divergence > tolerance
  if (!over && result.isolated.length === 0) return result

  /**
   * EVERY reason that applies, not the first one found. The two failures mean different things
   * — one says "too much moved", the other says "the wrong SHAPE moved" — and a run that
   * triggers both is a worse finding than either. Isolation is listed first because it is
   * categorical: no tolerance makes a detached region acceptable.
   */
  const reasons = [
    result.isolated.length
      ? `${result.isolated.length} differing cell(s) touch nothing both adapters agreed on — ` +
        "that is a dropped segment or a collapsed loop, not rounding at a cell edge"
      : "",
    over
      ? `${(result.divergence * 100).toFixed(2)}% of the union differs, over the ${(
          tolerance * 100
        ).toFixed(2)}% tolerance`
      : "",
  ].filter(Boolean)

  throw new Error(
    [
      `CROSS-ADAPTER CELL SETS DISAGREE: "${labels.a}" and "${labels.b}" projected the same ` +
        `physical run to different territory.`,
      ``,
      ...reasons.map((r) => `  ${r}.`),
      `  ${labels.a}: ${a.size} cells   ${labels.b}: ${b.size} cells   ` +
        `agreed: ${result.intersection.size}`,
      `  only in ${labels.a}: ${sample(result.onlyA)}`,
      `  only in ${labels.b}: ${sample(result.onlyB)}`,
      result.isolated.length ? `  isolated: ${sample(result.isolated)}` : ``,
      ``,
      `THE MAP NEVER RE-FOGS (D-020). Cell writes are append-only, so this is not a bug you`,
      `notice and fix — it is wrong ground written permanently into a map with no undo. An`,
      `adapter that passes D-100 and D-121.1 has proved only that the boundary has the right`,
      `SHAPE; this is the check that the same water comes out of it.`,
      ``,
      `Do not widen the tolerance to make this pass. If the disagreement cannot be justified`,
      `in a sentence, the adapters genuinely disagree and that is the finding.`,
    ]
      .filter((line) => line !== ``)
      .join("\n"),
  )
}

const sample = (cells: readonly H3Index[]): string =>
  cells.length === 0
    ? "(none)"
    : `${cells.slice(0, 5).join(", ")}${cells.length > 5 ? ` … +${cells.length - 5}` : ""}`
