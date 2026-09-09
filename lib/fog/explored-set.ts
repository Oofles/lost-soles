import type { H3Index } from "h3-js"

import { bigToCell, type DeltaBlob } from "@/src/domain/explored-blob"
import { parentOf } from "@/src/domain/fog"

import { decodeExplored, decodeStats, now } from "./decode"

/**
 * THE EXPLORED SET, IN THE BROWSER. Ticket `0054`. `05-fog-of-war.md` §7.1, §7.4;
 * `02-data-model.md` §6.3, §6.5.
 *
 * ─── TWO REPRESENTATIONS, DELIBERATELY, AND THIS IS THE MEMORY BUDGET ───────
 *
 * `05` §7.1: *"Decode to a sorted `BigUint64Array` … **and** build a `Set<string>` for
 * O(1) membership. Both, deliberately: the typed array is what the render buckets
 * iterate; the `Set` is what stats and `has()` queries use."*
 *
 * `02` §6.3 prices it, and the prices are not close:
 *
 *   sorted BigUint64Array   50k cells → 400 KB      150k → 1.2 MB
 *   Set<string>             50k cells → ~7 MB       150k → ~20 MB
 *
 * **The typed array is free; the `Set` is the entire memory cost of the fog on a
 * mid-range Android (D-124).** §6.3 records the exit in advance rather than leaving it to
 * be discovered in a slow-phone bug report: *"if the cell count ever passes ~100k, drop
 * the `Set` and answer `has()` by binary search on the array already in memory"* — 17
 * comparisons, no allocation. That is a one-method change to this class and nothing else,
 * which is why every consumer is required to go through `has()` rather than reaching for
 * the `Set`. The `Set` is therefore private and there is no accessor for it.
 *
 * ─── THE CLIENT NEVER INVENTS CELLS ─────────────────────────────────────────
 *
 * `05` §7.4, last bullet. The only two ways a cell enters this structure are a decoded
 * `LSFG` and a decoded `LSFD`, both of which came from the server. There is no `add()`.
 * The optimistic "draw the just-uploaded polyline into the mask" trick (§4.4) writes to a
 * TEXTURE and is discarded on the next rebuild; it must never write here.
 */

/**
 * A derived render bucket that needs telling when a res-6 parent's contents changed.
 * Implemented by `0058`'s zoom bucketing; declared here because `applyDelta` is what
 * calls it and the criterion asks for a spy on it.
 *
 * `05` §7.4: *"Invalidate only what changed. This is why cells are grouped by res-6
 * parent."* One run touches 1–2 parents, so a mid-session update is sub-millisecond of
 * work and one VBO upload — the alternative, rebuilding every bucket, is the difference
 * between a new run appearing and the whole map visibly re-rendering (this ticket's third
 * operator check).
 */
export interface BucketInvalidator {
  invalidateParents(parents: readonly H3Index[]): void
}

/**
 * `delta.fromGen !== state.generation`. `02` §6.5 requires the assertion and names the
 * remedy: *"on mismatch, fall back to a full fetch."*
 *
 * A DISTINCT TYPE FROM `BlobFormatError`, and the distinction is the whole point. A
 * format error means the bytes cannot be trusted and the client must refuse to render
 * (§6.4's version-skew rule). A skew error means the bytes are fine and merely do not
 * apply here — recoverable by fetching the full blob, and refusing to render over it
 * would blank a map for a chain that simply moved on.
 */
export class DeltaSkewError extends Error {
  constructor(
    readonly expected: number,
    readonly actual: number,
  ) {
    super(
      `delta declares fromGen ${actual} but the set is at generation ${expected}. ` +
        "Falling back to a full fetch (02 §6.5).",
    )
    this.name = "DeltaSkewError"
  }
}

/** What one applied hop changed. Consumed by `0058`'s buckets and `0079`'s animation. */
export interface AppliedDelta {
  /** Cells the set did not already hold, ascending. Typically 40–130 (R3 §2). */
  added: H3Index[]
  /** `unique(added.map(c => cellToParent(c, 6)))` — the only buckets that were dirtied. */
  parents: H3Index[]
  /** The generation the set is now at — `delta.toGen`. */
  generation: number
}

export class ExploredSet {
  /** Ascending, unique. What the render buckets iterate (`05` §7.1). */
  #cells: BigUint64Array
  /** O(1) membership. Private — see the header's note about §6.3's exit. */
  #members: Set<string>
  #generation: number
  #invalidators: BucketInvalidator[] = []

  private constructor(cells: BigUint64Array, members: Set<string>, generation: number) {
    this.#cells = cells
    this.#members = members
    this.#generation = generation
  }

  /**
   * THE WARM-START PATH. `02` §6.4 step 1: IndexedDB stores the **decoded** array, so a
   * returning session pays the `Set` build and nothing else — no LEB128, no varints.
   *
   * Criterion 3 asserts `decodeStats.blobDecodes` is still 0 after a boot that came
   * through here, which is only meaningful because this constructor genuinely cannot
   * reach a decoder.
   */
  static fromCells(cells: BigUint64Array, generation: number): ExploredSet {
    const members = new Set<string>()
    for (let i = 0; i < cells.length; i++) members.add(bigToCell(cells[i]!))
    return new ExploredSet(cells, members, generation)
  }

  /**
   * THE COLD PATH. `LSFG` bytes → both representations.
   *
   * Throws `BlobFormatError` on an unknown `version`, a `res` that is not 10, a non-zero
   * reserved byte or any flag this decoder cannot honour. **Every one of those is a
   * refusal to render, not a warning** (`02` §6.4) — the caller in `boot.ts` discards the
   * cache and says so on screen.
   */
  static fromBlob(bytes: Uint8Array): ExploredSet {
    const started = now()
    const blob = decodeExplored(bytes)
    const set = ExploredSet.fromCells(BigUint64Array.from(blob.cells), blob.generation)
    /**
     * MEASURED ACROSS BOTH HALVES, on purpose. `02` §6.3 prices *"decode + Set
     * construction"* as one line — ~50 ms at 150k — and the `Set` is the expensive half.
     * A number that timed only the varint parse would report the map as fast while the
     * phone spent most of its budget in the loop below it.
     */
    decodeStats.lastBlobMs = now() - started
    return set
  }

  get generation(): number {
    return this.#generation
  }

  get size(): number {
    return this.#cells.length
  }

  /** Ascending, unique. Read-only by contract: `0058` iterates it, nothing mutates it. */
  get cells(): BigUint64Array {
    return this.#cells
  }

  /** O(1) today, a 17-comparison binary search if §6.3's exit is ever taken. */
  has(cell: H3Index): boolean {
    return this.#members.has(cell)
  }

  /**
   * Registers a derived bucket. Returns its own removal, so a React effect can hand the
   * return value straight back as its cleanup rather than inventing a key to unregister
   * by.
   */
  addInvalidator(invalidator: BucketInvalidator): () => void {
    this.#invalidators.push(invalidator)
    return () => {
      const at = this.#invalidators.indexOf(invalidator)
      if (at >= 0) this.#invalidators.splice(at, 1)
    }
  }

  /**
   * ONE HOP OF THE CHAIN. `05` §7.4's `applyDelta`, `02` §6.5.
   *
   * The order below is the pseudocode's order and each step earns its place:
   *
   *   1. `assert delta.fromGen == state.generation`   — else a full fetch
   *   2. merge the adds into the sorted array
   *   3. add them to the `Set`
   *   4. invalidate ONLY the touched res-6 parents
   *   5. `state.generation = delta.toGen`
   *
   * An EMPTY delta is a real and common answer — a run over entirely known ground — and
   * it still advances the generation. `explored-blob-store.ts` writes one deliberately so
   * that "no new cells" is not indistinguishable from "the object is missing, take the
   * 300 KB path".
   */
  applyDelta(delta: DeltaBlob): AppliedDelta {
    if (delta.fromGen !== this.#generation) {
      throw new DeltaSkewError(this.#generation, delta.fromGen)
    }

    if (delta.added.length === 0) {
      this.#generation = delta.toGen
      return { added: [], parents: [], generation: delta.toGen }
    }

    const merged = new BigUint64Array(this.#cells.length + delta.added.length)
    const added: H3Index[] = []
    /**
     * Insertion-ordered, which is `unique()` over an ascending input: res-10 children of
     * one res-6 parent are contiguous in id order, so this is nearly always 1 or 2
     * entries and the `Set` never grows past a handful.
     */
    const parents = new Set<H3Index>()

    let i = 0
    let j = 0
    let k = 0
    while (i < this.#cells.length || j < delta.added.length) {
      const base = i < this.#cells.length ? this.#cells[i]! : undefined
      const incoming = j < delta.added.length ? delta.added[j]! : undefined

      if (incoming === undefined || (base !== undefined && base < incoming)) {
        merged[k++] = base!
        i++
      } else if (base === undefined || incoming < base) {
        merged[k++] = incoming!
        /**
         * The hex string is needed for the `Set` regardless, so the parent is computed
         * off it rather than converting twice. `parentOf` is `cellToParent(c, 6)` —
         * `src/domain/fog.ts` owns it because it is one of the few h3 calls that
         * legitimately crosses resolutions, and it lives next to the constant that says
         * crossing is otherwise forbidden (D-115).
         */
        const cell = bigToCell(incoming!)
        this.#members.add(cell)
        added.push(cell)
        parents.add(parentOf(cell))
        j++
      } else {
        /**
         * ALREADY EXPLORED. The server computed the adds against the previous generation,
         * so this should not happen — but a duplicate must collapse rather than be
         * written twice, because everything downstream (`cellCount`, the render buckets,
         * the delta encoder's strictly-ascending precondition) assumes uniqueness. It is
         * also NOT an error: D-020 makes the set append-only, so re-adding ground that is
         * already revealed is a no-op by definition, never a conflict.
         */
        merged[k++] = base!
        i++
        j++
      }
    }

    this.#cells = k === merged.length ? merged : merged.slice(0, k)
    this.#generation = delta.toGen

    const touched = [...parents]
    // §7.4: *"for res in state.buckets.keys(): invalidateParents(touchedParents)"*. Every
    // registered bucket, once, with the same list — the buckets differ by zoom, not by
    // which parents changed.
    if (touched.length > 0) {
      for (const invalidator of this.#invalidators) invalidator.invalidateParents(touched)
    }

    return { added, parents: touched, generation: delta.toGen }
  }
}
