import type { ActivityKind, GeoPoint } from "@/src/domain/activity"
import { MAX_IMPLIED_SPEED_MS, impliedSpeedMs } from "@/src/domain/geo"

/**
 * TRACE SANITATION. Ticket 0037, `03-integrations.md` §2.2 and `05-fog-of-war.md` §9.5.
 *
 * A run through a tunnel or an urban canyon produces `latlng` points that jump hundreds of
 * metres. **One bad fix paints a revealed corridor across the city, and D-020 makes it
 * permanent.** Under-revealing is recoverable; over-revealing is not. That asymmetry is the
 * whole argument for this file, and it is why the gate is deliberately tight rather than
 * merely safe.
 *
 * PURE, and separate from `normalize.ts` so the static import walk in `normalize.test.ts`
 * covers it too. No clock, no network, no randomness — it is part of the migration seam.
 */

/**
 * THE OUTLIER GATE AND THE HAVERSINE NOW LIVE IN `src/domain/geo.ts`. Ticket `0045`.
 *
 * They moved because they grew a second consumer on the far side of the D-100 boundary:
 * `src/domain/fog.ts` splits a trace on the same implied speed this file gates on, and
 * `src/domain/` may not import from an adapter. Re-declaring the number here would have
 * been the restated-constant failure D-193 names — two owners of one value, drifting
 * apart the first time either is measured again. D-197's reasoning is unchanged and
 * travelled with the table; only its address did.
 */



export interface SanitizedTrace {
  /** The accepted fixes, in order. Never interpolated, never re-timed. */
  points: GeoPoint[]
  /**
   * `[i, i+1]` pairs, indices INTO `points`, marking where at least one fix was dropped
   * between two accepted ones. These are merged into `Trace.gaps` by `normalize` — see
   * D-198 for why `gaps` carries both meanings rather than growing a second field.
   */
  breaks: Array<[number, number]>
  /** How many fixes were thrown away. Recorded on `SourceRef.meta`; see D-197. */
  rejected: number
}

/**
 * How many fixes ahead the anchor decision may look. ONE.
 *
 * Named rather than inlined because it is the single tunable in `chooseAnchor` and it
 * deserves the same visibility as the gate it sits beside — but note that raising it is
 * not free. A deeper lookahead buys robustness against several consecutive bad fixes and
 * pays for it by being able to discard a genuine start: a trace that legitimately begins
 * with a sprint out of a doorway looks, from far enough away, like a lead-in of noise.
 * Depth 1 can only ever discard the FIRST fix, which bounds the damage of being wrong at
 * exactly one point — the same fix the unpatched algorithm would have kept and built an
 * entire wrong trace on.
 */
export const ANCHOR_CORROBORATION_LOOKAHEAD = 1

/**
 * WHERE THE TRACE ACTUALLY STARTS — the index of the first fix to trust as an anchor.
 *
 * The problem, precisely. The gate asks "is the step from the last accepted fix to this one
 * plausible?", which assumes the last accepted fix is real. At index 0 that assumption has
 * no evidence behind it: `p0` is accepted because it is first, not because anything
 * corroborated it. A cold GPS fix hundreds of metres out — the ordinary behaviour of a
 * watch that has been indoors, so this is the FIRST run after a break, not an exotic case —
 * therefore becomes an anchor that rejects the real track behind it.
 *
 * THE RULE: a fix earns the anchor by being corroborated, and one plausible step is
 * corroboration. So look at the first two steps and let them vote.
 *
 *   p0 -> p1 plausible                    p0 is corroborated. Start at 0. The clean case,
 *                                         and the overwhelmingly common one — this is the
 *                                         only branch a normal trace ever takes.
 *   p0 -> p1 implausible, p1 -> p2 fine   p1 is corroborated and p0 is not. p0 is the
 *                                         outlier. Start at 1, counting p0 as rejected.
 *   both implausible                      Nothing is corroborated and the evidence does not
 *                                         name a culprit. Fall back to §2.2 as written:
 *                                         start at 0 and let the gate work. Guessing here
 *                                         would trade a known behaviour for an arbitrary
 *                                         one.
 *
 * WHY NOT THE ALTERNATIVES (`0172`'s Notes). "Re-anchor after N consecutive rejections"
 * needs a magic N and would also re-anchor inside a genuine long tunnel, which is the one
 * place the trace must NOT be stitched back together. "Median of the first k fixes" is more
 * robust and can move the recorded start of the run, which is a worse failure than the one
 * it fixes — the start point is where the operator's front door is.
 *
 * WHAT THIS DOES NOT DO, deliberately: it never runs anywhere but the start. Past index 0
 * the anchor has been corroborated by at least one accepted transition, so the gate's
 * assumption holds and there is nothing to repair.
 */
export function chooseAnchor(points: readonly GeoPoint[], gate: number): number {
  // Two points cannot corroborate anything — there is no second step to consult.
  if (points.length < 2 + ANCHOR_CORROBORATION_LOOKAHEAD) return 0
  if (impliedSpeedMs(points[0], points[1]) <= gate) return 0
  if (impliedSpeedMs(points[1], points[2]) <= gate) return 1
  return 0
}


/**
 * Drop implausible fixes and mark where the trace broke.
 *
 * §2.2's algorithm, transcribed: *"Reject a point whose implied speed from the previous
 * accepted point exceeds ~8 m/s. Drop the point, keep the previous, continue. Do not
 * interpolate across the gap; a straight line through a dropout also reveals ground that
 * may not have been run. Break the trace into segments and project each independently."*
 *
 * **The segments are expressed as breaks, not as a list of arrays** (D-198). A caller that
 * wants segments splits `points` on `breaks`; a caller that only needs to know where not to
 * draw reads `breaks` and ignores the rest. Returning arrays-of-arrays would have made the
 * common case — "is there a break between these two points?" — the awkward one.
 *
 * ─── THE BOUNDARY CASE §2.2 DOES NOT COVER, FIXED IN 0172 ───────────────────
 *
 * "From the previous **accepted** point" has to start somewhere, and §2.2 is silent on
 * where. `0037` implemented the literal reading — accept the first fix unconditionally,
 * because there is nothing to compare it against — and recorded the consequence rather
 * than quietly improving it: a cold-start fix that is 400 m wrong becomes the anchor, and
 * every genuine fix afterwards looks impossible relative to it.
 *
 * See `chooseAnchor` below for the fix. The general shape is worth naming: EVERY
 * "compare against the previous accepted value" filter has this weakness at its boundary,
 * so the next adapter to land (D-112 GPSLogger, D-113 Health Connect) inherits it if it
 * shares this file — which is the argument for fixing it here rather than per adapter.
 */
export function sanitizeTracePoints(
  points: readonly GeoPoint[],
  kind: ActivityKind,
): SanitizedTrace {
  const gate = MAX_IMPLIED_SPEED_MS[kind] ?? MAX_IMPLIED_SPEED_MS.other

  /**
   * The lead-in the anchor decision discarded — 0 in every ordinary trace, 1 when the
   * first fix was an uncorroborated outlier. Counted as rejected, because it was: it is a
   * fix that arrived and is not in the output.
   *
   * No `break` is recorded for it. `breaks` marks ground a corridor must not be drawn
   * ACROSS (D-198), and there is nothing on the near side of the first accepted fix to
   * draw from — the same reasoning that leaves a run of rejections at the very end of a
   * trace unmarked.
   */
  const start = chooseAnchor(points, gate)

  const kept: GeoPoint[] = []
  const breaks: Array<[number, number]> = []
  let rejected = start
  let brokeSinceLastAccepted = false

  for (let i = start; i < points.length; i++) {
    const point = points[i]
    if (kept.length === 0) {
      kept.push(point)
      continue
    }

    const previous = kept[kept.length - 1]

    if (impliedSpeedMs(previous, point) > gate) {
      rejected++
      brokeSinceLastAccepted = true
      continue
    }

    // The break is recorded only once a fix on the FAR side has been accepted. A run of
    // rejections at the very end of a trace leaves no break, which is right: there is
    // nothing beyond it for the renderer to draw a corridor to.
    if (brokeSinceLastAccepted) {
      breaks.push([kept.length - 1, kept.length])
      brokeSinceLastAccepted = false
    }

    kept.push(point)
  }

  return { points: kept, breaks, rejected }
}
