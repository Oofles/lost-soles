import type { CullableBucket, MercatorBox } from "./cull"

/**
 * MATERIALISING GROUP GEOMETRY OFF THE FRAME PATH. Ticket `0202`. `05-fog-of-war.md` §6.3.
 *
 * §6.3's table budgets two different things on two different rows:
 *
 *   CPU on padded-region exit   two-level cull + VBO upload          1-5 ms, off the frame path
 *   Bucket derivation, cold     cellToParent pass + bbox precompute  30-80 ms, debounced, once
 *
 * **The code ran the second inside the first.** `cullBucket` calls `bucket.discsFor(group)`, which
 * derives that group's ids, fractions, projection and bridges the first time it is asked — and the
 * cull runs inside `FogViewportController`'s `move` handler, which MapLibre dispatches inside its own
 * frame. `0059` measured a **single pan cull at 21.1 ms gross and 0.4 ms net**: the cull was never the
 * cost, the derivation it triggered on the way was, and 21 ms is a dropped frame on its own.
 *
 * ─── WHY PREFETCH RATHER THAN A BUDGET INSIDE THE CULL ─────────────────────
 *
 * The obvious fix — materialise at most N groups per cull and finish the rest later — puts a **hole**
 * in the fog: a group with no geometry contributes no discs, so ground that is explored draws as
 * unexplored until the next slice lands. On a map whose entire premise is that it never re-fogs
 * (D-020), territory that blinks out is the single worst-looking bug available, and it is
 * indistinguishable to the eye from a data loss.
 *
 * So the cull stays exactly as it is — synchronous, complete, correct — and the derivation is done
 * **before** it is needed instead. After each rebuild the controller schedules this over a region
 * larger than the padded viewport; by the time the camera reaches that ground the groups are warm and
 * `discsFor` is a cache read. Nothing about what is drawn changes at any instant.
 *
 * ─── AND IT IS TIME-SLICED, NOT JUST DEFERRED ──────────────────────────────
 *
 * A deferred pass that materialises two hundred groups in one callback is the same 200 ms stall
 * moved to a different frame. Each slice takes a millisecond budget and returns where it got to, so
 * the work is spread across as many idle callbacks as it needs.
 */

/** §6.2's padding is 0.2. The prefetch region is wider, so ground is warm before it is reached. */
export const PREFETCH_PAD = 0.5

/**
 * How long one slice may spend deriving. Deliberately well under a frame: this runs in idle time, and
 * an idle callback that overruns its deadline delays the next frame exactly like the cull did.
 */
export const PREFETCH_SLICE_MS = 4

export interface PrefetchProgress {
  /** Group index to resume from. `groupCount` means the region is fully materialised. */
  next: number
  /** Groups materialised in this slice. Zero means everything in range was already warm. */
  derived: number
  done: boolean
}

/**
 * Materialise the groups intersecting `box`, starting at `from`, for at most `budgetMs`.
 *
 * `discsFor` is idempotent and returns the cached array for a group that is already materialised, so
 * a warm group costs one bounds compare and an array lookup. That is what makes it safe to re-walk
 * the whole region on every rebuild rather than tracking what has been done.
 */
export function prefetchSlice(
  bucket: CullableBucket,
  box: MercatorBox,
  from = 0,
  budgetMs = PREFETCH_SLICE_MS,
  now: () => number = () => performance.now(),
): PrefetchProgress {
  const started = now()
  let derived = 0
  let index = from

  for (; index < bucket.groupCount; index++) {
    const at = index * 4
    const bounds = bucket.groupBounds
    // Step 1's compare, same as `cullBucket`'s: reject a group whose bbox misses the box entirely.
    if (
      bounds[at]! > box.maxX ||
      bounds[at + 2]! < box.minX ||
      bounds[at + 1]! > box.maxY ||
      bounds[at + 3]! < box.minY
    ) {
      continue
    }
    bucket.discsFor(index)
    derived++
    /**
     * CHECKED AFTER THE WORK, NOT BEFORE. A group costs 10-90 ms to derive and the budget is 4 ms, so
     * a check-first loop would do nothing at all on every slice and never finish. One group per slice
     * is the floor, and it is the right floor: the alternative to overrunning by one group is never
     * materialising anything.
     */
    if (now() - started >= budgetMs) {
      index++
      break
    }
  }

  return { next: index, derived, done: index >= bucket.groupCount }
}
