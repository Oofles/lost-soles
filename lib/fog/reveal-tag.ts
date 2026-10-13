import { ARC_ALWAYS, ARC_FROST_OFFSET, ARC_GOLD_OFFSET, ARC_OUT_OFFSET, INSTANCE_FLOATS } from "./mask"

/**
 * THE REVEAL, AS ONE INSTANCE STREAM. Ticket `0079`. `06-ui-ux.md` §3.2 beat 1.
 *
 * Beat 1 needs the mask to be a function of `revealProgress` as well as of the cell set. The mask
 * shader got one seam for it — a per-instance `arc` and a `u_reveal` uniform (`mask.ts`) — and this
 * file decides what goes in that seam.
 *
 * ─── TWO STREAMS IN, ONE OUT, AND NOTHING DERIVED TWICE ─────────────────────
 *
 * The obvious design tags the reveal cells and splats them over the steady-state stream. It is
 * wrong in three places, all of them away from the res-11 corridor where it would be tested:
 *
 *   - D-238's bridge elision depends on NEIGHBOURS. A cell that becomes interior when the run's
 *     cells land loses bridges it had before; a bridge between a reveal cell and a persisted one
 *     appears. Neither is a reveal cell.
 *   - `0058`'s coarse buckets carry a FRACTION per parent. A res-6 parent half-run before and
 *     two-thirds-run after is one disc at two different weights, not a new disc.
 *   - The cull keeps only what is in the padded viewport, for both.
 *
 * So the controller culls BOTH sets through the shipped derivation — `pre` (the explored set
 * without the reveal cells) and `post` (with them), same bucket resolution, same padded box — and
 * this file diffs the results. Every instance lands in exactly one of three classes:
 *
 *   in both       `ARC_ALWAYS`                      drawn at every progress
 *   post only     its reveal arc                   fades in as the lantern passes
 *                 (+ `ARC_GOLD_OFFSET` / `ARC_FROST_OFFSET` when its nearest reveal cell is new /
 *                 re-armed — `0080`'s bloom; the fade-in itself is identical)
 *   pre only      `ARC_OUT_OFFSET` + a reveal arc   drawn until its replacement is at full weight
 *
 * and the ticket's safety property then holds BY CONSTRUCTION rather than by tuning:
 *
 *   p = 1   post-only and in-both at weight exactly 1.0, pre-only discarded: the post stream, the
 *           same instances in the same order — bit-for-bit what the steady state draws.
 *   p = 0   pre-only and in-both at 1.0, post-only discarded: the pre stream as a multiset, and
 *           `MAX` is order-independent — what the steady state drew before the run.
 *
 * The post stream is emitted FIRST AND IN ITS OWN ORDER on purpose: `uploadInstances` takes its
 * origin from the first instance, and keeping it the post stream's means the `p = 1` upload is
 * literally the steady-state upload with arcs attached.
 *
 * ─── PRE-ONLY INSTANCES TURN OFF LATE, NEVER EARLY ──────────────────────────
 *
 * A pre-only instance is something the post stream replaces: a coarse parent at its old fraction
 * (replaced by the same disc at a higher one), or a bridge D-238 elides once the run's cells make its
 * endpoints interior. It switches off at the LATEST arc among the reveal cells near it, by which time
 * everything that replaces it is at full weight — so the mask never dips on the way through. Its
 * in-weight and its out-switch are computed from the same quantised arc by the same shader function,
 * so "at full weight" and "switched off" are one comparison, not two that could disagree.
 *
 * Nothing here is per frame. It runs once per buffer rebuild, the same cadence as the cull.
 */

/** One reveal cell, as the tagger needs it: its mercator centre and its arc position, `0..1`. */
export interface RevealPoint {
  x: number
  y: number
  arc: number
  /**
   * `0080`. The server's verdict on this cell (`0048`, served by `0251`), which decides how it
   * blooms as it clears: `new` gold, `rearmed` frost. Absent means silent — the scrub's whole-route
   * set, and any run classified before the verdicts were stored. *"A missing bloom is a smaller lie
   * than a wrong one."* Never derived here.
   */
  ground?: "new" | "rearmed"
}

/**
 * `0080`. The arc slot for a fading-in instance: its arc, plus the offset that says how it blooms.
 * The offsets are whole numbers and the arc is quantised, so the sum is exact in float32.
 */
function fadeInArc(point: RevealPoint): number {
  if (point.ground === "new") return ARC_GOLD_OFFSET + point.arc
  if (point.ground === "rearmed") return ARC_FROST_OFFSET + point.arc
  return point.arc
}

/**
 * Arcs snap DOWN to a multiple of this, so `arc + ARC_OUT_OFFSET` is exact in float32 (2 plus a
 * multiple of 2^-16 needs 18 significant bits) and the shader's in-weight and out-switch for one
 * arc agree to the bit. 2^-16 of a marathon is 64 cm.
 */
export const ARC_QUANTUM = 2 ** -16

export function quantiseArc(arc: number): number {
  const clamped = arc < 0 ? 0 : arc > 1 ? 1 : arc
  return Math.floor(clamped / ARC_QUANTUM) * ARC_QUANTUM
}

/**
 * How far around a pre-only instance to look for the reveal cells that replace it, in multiples of
 * its own disc radius. A D-238 bridge's elision is decided by the six neighbours of each endpoint,
 * all within ~2 radii of the bridge's centre; 2.5 covers them with margin. At a coarse bucket the
 * radius is the parent's, so this reaches every reveal child the parent's fraction counts.
 */
const OUT_REACH = 2.5

export interface TagStats {
  inBoth: number
  postOnly: number
  preOnly: number
  corridor: number
}

/**
 * The merged stream. `post` and `pre` are `INSTANCE_FLOATS`-strided cull results; `corridor`, when
 * given, is `0057`'s optimistic route with each disc's own arc — it is not in either stream (the
 * layer appends it), so it is post-only by definition.
 *
 * With no reveal cells there is nothing to animate and `post` comes back as it went in — the
 * caller's steady state, untouched.
 */
export function tagReveal(
  post: Float32Array,
  pre: Float32Array,
  points: readonly RevealPoint[],
  corridor: { instances: Float32Array; arcs: Float32Array } | null = null,
  stats?: TagStats,
): Float32Array {
  const F = INSTANCE_FLOATS
  const postCount = Math.floor(post.length / F)
  const preCount = Math.floor(pre.length / F)
  const corridorCount = corridor ? Math.floor(corridor.instances.length / F) : 0

  if (points.length === 0) {
    if (stats) Object.assign(stats, { inBoth: postCount, postOnly: 0, preOnly: 0, corridor: 0 })
    return post
  }

  /**
   * THE IDENTITY OF AN INSTANCE IS ITS FOUR GEOMETRY FLOATS, BY BIT PATTERN. Both streams come out of
   * one deterministic derivation, so the same disc is the same 16 bytes in both — and anything that
   * is not byte-identical genuinely draws something different and must be treated as such. The arc
   * slot is excluded: it is what this function writes.
   */
  const postBits = new Uint32Array(post.buffer, post.byteOffset, postCount * F)
  const preBits = new Uint32Array(pre.buffer, pre.byteOffset, preCount * F)
  const key = (bits: Uint32Array, i: number) => {
    const at = i * F
    return `${bits[at]},${bits[at + 1]},${bits[at + 2]},${bits[at + 3]}`
  }

  /** Pre instances not yet matched, by identity. A multiset: two bridges can share a midpoint. */
  const unmatched = new Map<string, number>()
  for (let i = 0; i < preCount; i++) {
    const k = key(preBits, i)
    unmatched.set(k, (unmatched.get(k) ?? 0) + 1)
  }

  const quantised = points.map((p) => ({ x: p.x, y: p.y, arc: quantiseArc(p.arc), ground: p.ground }))
  const out = new Float32Array((postCount + preCount + corridorCount) * F)
  let n = 0
  let inBoth = 0
  let postOnly = 0

  for (let i = 0; i < postCount; i++) {
    const at = i * F
    out.set(post.subarray(at, at + F - 1), n * F)
    const k = key(postBits, i)
    const left = unmatched.get(k) ?? 0
    if (left > 0) {
      unmatched.set(k, left - 1)
      out[n * F + F - 1] = ARC_ALWAYS
      inBoth++
    } else {
      // `0080`: a bridge or a coarse parent blooms as the reveal cell it is nearest to does.
      out[n * F + F - 1] = fadeInArc(nearest(quantised, post[at]!, post[at + 1]!))
      postOnly++
    }
    n++
  }

  let preOnly = 0
  for (let i = 0; i < preCount; i++) {
    const k = key(preBits, i)
    const left = unmatched.get(k) ?? 0
    if (left === 0) continue
    unmatched.set(k, left - 1)
    const at = i * F
    out.set(pre.subarray(at, at + F - 1), n * F)
    out[n * F + F - 1] =
      ARC_OUT_OFFSET + latestArcNear(quantised, pre[at]!, pre[at + 1]!, OUT_REACH * pre[at + 2]!)
    n++
    preOnly++
  }

  // Corridor discs never bloom: they are `0057`'s optimistic guess, not a cell anyone classified.
  for (let i = 0; i < corridorCount; i++) {
    const at = i * F
    out.set(corridor!.instances.subarray(at, at + F - 1), n * F)
    out[n * F + F - 1] = quantiseArc(corridor!.arcs[i] ?? 0)
    n++
  }

  if (stats) Object.assign(stats, { inBoth, postOnly, preOnly, corridor: corridorCount })
  return out.subarray(0, n * F)
}

/**
 * The reveal cell nearest a post-only instance. For a reveal cell's own disc that is the
 * cell itself, at distance 0; for a bridge, one of its endpoints; for a coarse parent, the nearest
 * child. Brute force, because the post-only set is the DIFFERENCE between the two streams — a run's
 * worth, not a viewport's — and the reveal set is ~130 cells (R3 §2).
 */
function nearest(points: readonly RevealPoint[], x: number, y: number): RevealPoint {
  let best = Infinity
  let at = points[0]!
  for (const p of points) {
    const dx = p.x - x
    const dy = p.y - y
    const d = dx * dx + dy * dy
    if (d < best) {
      best = d
      at = p
    }
  }
  return at
}

/** The latest arc among reveal cells within `reach`; the nearest one's if none is that close. */
function latestArcNear(points: readonly RevealPoint[], x: number, y: number, reach: number): number {
  const reach2 = reach * reach
  let latest = -1
  for (const p of points) {
    const dx = p.x - x
    const dy = p.y - y
    if (dx * dx + dy * dy <= reach2 && p.arc > latest) latest = p.arc
  }
  return latest >= 0 ? latest : nearest(points, x, y).arc
}
