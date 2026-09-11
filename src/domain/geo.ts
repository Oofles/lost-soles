import type { ActivityKind, GeoPoint } from "./activity"

/**
 * SHARED TRACE GEOMETRY. Ticket `0045`.
 *
 * Two things live here, and they are here for the same reason: **each has two consumers
 * on opposite sides of the D-100 boundary, and neither may import the other.**
 *
 *   - `metresBetween` — the ingestion sanitizer measures step lengths with it; the fog
 *     projection measures densification intervals and split distances with it.
 *   - `MAX_IMPLIED_SPEED_MS` — the sanitizer gates on it (D-197); the fog projection's
 *     teleport split is defined against the same number (see below).
 *
 * Both began life in the adapter, which was right when the adapter was the only caller
 * and wrong the moment a second one appeared. `src/domain/` cannot import from
 * `src/adapters/` — `scripts/check-boundaries.mjs`'s STRICT tier greps the vendor's name
 * over this whole directory, so an import path naming an adapter fails the build, and it
 * is right to. The dependency therefore had to invert: the domain owns the values and the
 * adapter imports them, which is the direction D-100 wanted all along.
 *
 * TYPES-ONLY NEIGHBOUR: this module emits runtime code, so it deliberately does NOT live
 * in `activity.ts`. Same reasoning as `activity-id.ts` and `dedupe-key.ts` — importing a
 * domain TYPE must never drag arithmetic or `node:crypto` into a client bundle.
 *
 * PURE. No clock, no network, no randomness.
 */

/** Metres between two fixes. Haversine on a spherical Earth — good to ~0.5% and pure. */
const EARTH_RADIUS_M = 6_371_008.8

/**
 * A POSITION, WITHOUT THE CLOCK. Ticket `0057`.
 *
 * `metresBetween` took two `GeoPoint`s, which carry `t`. Distance does not depend on time and
 * never did, and the third consumer — the renderer's optimistic corridor, which interpolates
 * points that were never fixes — has no honest value to put in `t`. Widening the parameter is
 * preferable to fabricating a timestamp at the call site: an invented `t` on something the map
 * treats as a recorded position is the kind of value that later gets believed.
 *
 * Both existing callers pass a full `GeoPoint` and are unaffected.
 */
export type Located = Pick<GeoPoint, "lat" | "lng">

export function metresBetween(a: Located, b: Located): number {
  const toRad = Math.PI / 180
  const dLat = (b.lat - a.lat) * toRad
  const dLng = (b.lng - a.lng) * toRad
  const lat1 = a.lat * toRad
  const lat2 = b.lat * toRad

  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

/**
 * The implied point-to-point speed above which a fix is impossible and therefore noise.
 *
 * **A DATA TABLE, NOT A `switch`** (D-031/D-141). Adding a kind is a row.
 *
 * `03-integrations.md` §2.6 gives one number — *"~8 m/s for a run (~29 km/h — comfortably
 * above any human running pace, below GPS jump magnitudes)"* — and says nothing about any
 * other kind. **Both halves of that turned out to be wrong**: the number is too tight (see
 * `run` below) and the silence about other kinds is load-bearing. That gap is not
 * theoretical: `rules/xp-rules-v1.yaml` has two enabled rows matching `kinds: [ride]`, so
 * rides reach the sanitizer and earn XP, and a cyclist holds 8 m/s without trying. A
 * single gate at 8 would delete most of every ride. Recorded as D-197.
 *
 * (Those rows are deliberately not named here. Naming a skill outside the rules layer is
 * the coupling D-031 forbids, and `src/rules/no-skill-names.test.ts` fires on it — as it
 * did on the first draft of this comment, back when it lived in the adapter.)
 *
 * Two things this gate is NOT:
 *
 *   - **It is not a classifier.** It never changes `Activity.kind`. A run containing walk
 *     breaks is one run with one kind; walking makes you slower, and this only ever fires
 *     on impossibly fast.
 *   - **It is not a speed limit.** 30 m/s is 108 km/h, which no ride reaches — the point is
 *     that a real GPS jump is 400 m between consecutive samples, which at the measured
 *     ~0.5 Hz cadence is ~200 m/s. The gate separates two populations that are three
 *     orders of magnitude apart, so its exact value matters far less than its existence.
 */
export const MAX_IMPLIED_SPEED_MS: Readonly<Record<ActivityKind, number>> = {
  /**
   * 12.5 m/s — 45 km/h — and NOT §2.6's 8, which was measured against real traces and
   * found to be too tight. `05-fog-of-war.md` §9.5 says to *"measure it on the user's real
   * first 20 runs before touching the constants"*; eight runs and 21,225 fixes were enough.
   *
   * At 8 m/s the gate rejected six fixes across those eight runs, with implied speeds of
   * 8, 8, 9, 9, 9 and 13 m/s — and **not one of them was a GPS jump.** The failure §2.6
   * describes ("points that jump hundreds of metres") is ~200 m/s at this stream's ~0.5 Hz
   * cadence, and there were ZERO of those. The operator's fastest accepted fix was 7.6 m/s,
   * so an 8 m/s gate had a 5% margin where the document promised "comfortably above any
   * human running pace".
   *
   * The cost of that was not theoretical: each rejection also writes a `gaps` entry
   * (D-198), so the tight gate was manufacturing six breaks in traces that were continuous
   * — precisely the "dotted corridor" §9.5 warns about, on the operator's favourite routes.
   *
   * 12.5 splits the observed data exactly along the line §2.6's own reasoning appeals to:
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

/**
 * Metres per second between two fixes.
 *
 * A non-positive interval is not a speed. Two fixes sharing a timestamp are a duplicate if
 * they are in the same place and a teleport if they are not, and dividing by zero would
 * silently make the second one `Infinity` either way — so the two cases are separated here
 * rather than left to IEEE-754.
 */
export function impliedSpeedMs(from: GeoPoint, to: GeoPoint): number {
  const seconds = (to.t - from.t) / 1000
  const metres = metresBetween(from, to)
  if (seconds > 0) return metres / seconds
  return metres > 0 ? Infinity : 0
}
