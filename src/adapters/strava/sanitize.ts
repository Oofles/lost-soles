import type { ActivityKind, GeoPoint } from "@/src/domain/activity"

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
 * The implied point-to-point speed above which a fix is impossible and therefore noise.
 *
 * **A DATA TABLE, NOT A `switch`** (D-031/D-141). Adding a kind is a row.
 *
 * `03-integrations.md` §2.2 gives one number — *"~8 m/s for a run (~29 km/h — comfortably
 * above any human running pace, below GPS jump magnitudes)"* — and says nothing about any
 * other kind. **Both halves of that turned out to be wrong**: the number is too tight (see
 * `run` below) and the silence about other kinds is load-bearing. That gap is not theoretical: `rules/xp-rules-v1.yaml` has two enabled rows
 * matching `kinds: [ride]`, so rides reach this function and earn XP, and a cyclist holds
 * 8 m/s without trying. A single gate at 8 would delete most of every ride. Recorded as
 * D-197.
 *
 * (Those rows are deliberately not named here. Naming a skill in an adapter is the coupling
 * D-031 forbids, and `src/rules/no-skill-names.test.ts` fires on it — as it did on the
 * first draft of this very comment.)
 *
 * Two things this gate is NOT:
 *
 *   - **It is not a classifier.** It never changes `Activity.kind`. A run containing walk
 *     breaks is one run with one kind; walking makes you slower, and this only ever fires
 *     on impossibly fast.
 *   - **It is not a speed limit.** 30 m/s is 108 km/h, which no ride reaches — the point is
 *     that a real GPS jump is 400 m between consecutive samples, which at this trace's
 *     measured ~0.5 Hz cadence is ~200 m/s. The gate separates two populations that are
 *     three orders of magnitude apart, so its exact value matters far less than its
 *     existence.
 */
export const MAX_IMPLIED_SPEED_MS: Readonly<Record<ActivityKind, number>> = {
  /**
   * 12.5 m/s — 45 km/h — and NOT §2.2's 8, which was measured against real traces and
   * found to be too tight. `05-fog-of-war.md` §9.5 says to *"measure it on the user's real
   * first 20 runs before touching the constants"*; eight runs and 21,225 fixes were enough.
   *
   * At 8 m/s the gate rejected six fixes across those eight runs, with implied speeds of
   * 8, 8, 9, 9, 9 and 13 m/s — and **not one of them was a GPS jump.** The failure §2.2
   * describes ("points that jump hundreds of metres") is ~200 m/s at this stream's ~0.5 Hz
   * cadence, and there were ZERO of those. The operator's fastest accepted fix was 7.6 m/s,
   * so an 8 m/s gate had a 5% margin where the document promised "comfortably above any
   * human running pace".
   *
   * The cost of that was not theoretical: each rejection also writes a `gaps` entry
   * (D-198), so the tight gate was manufacturing six breaks in traces that were continuous
   * — precisely the "dotted corridor" §9.5 warns about, on the operator's favourite routes.
   *
   * 12.5 splits the observed data exactly along the line §2.2's own reasoning appeals to:
   * the men's 100 m world record peaks at ~12.4 m/s, so 12.5 admits every one of the five
   * plausible human bursts and still rejects the 13 m/s fix, which no one has ever run. It
   * leaves a 64% margin over this operator's observed maximum, against 5%.
   */
  run: 12.5,
  walk: 12.5,
  hike: 12.5,
  // A descent can exceed 20 m/s (72 km/h). 30 leaves headroom without admitting a jump.
  ride: 30,
  // No trace is expected on either, but a gate is cheap and a missing row would be a
  // `undefined` comparison that silently accepts everything.
  strength: 12.5,
  other: 30,
}

/** Metres between two fixes. Haversine on a spherical Earth — good to ~0.5% and pure. */
const EARTH_RADIUS_M = 6_371_008.8

export function metresBetween(a: GeoPoint, b: GeoPoint): number {
  const toRad = Math.PI / 180
  const dLat = (b.lat - a.lat) * toRad
  const dLng = (b.lng - a.lng) * toRad
  const lat1 = a.lat * toRad
  const lat2 = b.lat * toRad

  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

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
 * ─── THE KNOWN WEAKNESS, STATED RATHER THAN HIDDEN ──────────────────────────
 *
 * "From the previous **accepted** point" anchors on whatever was kept last, and the first
 * fix is always accepted because there is nothing to compare it against. So a cold-start
 * fix that is 400 m wrong becomes the anchor, and every genuine fix afterwards looks
 * impossible relative to it — the whole trace is rejected.
 *
 * That is §2.2's algorithm as specified, and it is implemented as specified rather than
 * quietly improved. What makes it survivable is `rejected` being carried on the activity
 * (criterion 16): a trace that lost 98% of its fixes is loudly visible rather than silently
 * empty. Filed as `0172`.
 */
export function sanitizeTracePoints(
  points: readonly GeoPoint[],
  kind: ActivityKind,
): SanitizedTrace {
  const gate = MAX_IMPLIED_SPEED_MS[kind] ?? MAX_IMPLIED_SPEED_MS.other

  const kept: GeoPoint[] = []
  const breaks: Array<[number, number]> = []
  let rejected = 0
  let brokeSinceLastAccepted = false

  for (const point of points) {
    if (kept.length === 0) {
      kept.push(point)
      continue
    }

    const previous = kept[kept.length - 1]
    const seconds = (point.t - previous.t) / 1000
    const metres = metresBetween(previous, point)

    /**
     * A non-positive interval is not a speed. Two fixes sharing a timestamp are a
     * duplicate if they are in the same place and a teleport if they are not, and
     * dividing by zero would silently make the second one `Infinity` either way — so the
     * two cases are separated here rather than left to IEEE-754.
     */
    const impliedSpeed = seconds > 0 ? metres / seconds : metres > 0 ? Infinity : 0

    if (impliedSpeed > gate) {
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
