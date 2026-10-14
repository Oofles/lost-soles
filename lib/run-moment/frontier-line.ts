import type { RouteTraceGeometry } from "@/lib/runs/wire"
import type { Located } from "@/src/domain/geo"
import type { FrontierCluster } from "@/src/domain/frontier"

/**
 * BEAT 5'S LINE, FROM THE FRONTIER PRIMITIVE. Ticket `0083`. `06-ui-ux.md` §3.2 beat 5.
 *
 * `src/domain/frontier.ts` ranks clusters; this picks the one the line names and words it. Nothing
 * here is stored, counted or remembered: the line is recomputed from the explored set each time the
 * end state draws, so it cannot repeat, escalate or count down — there is no state for it to do so
 * with (D-013).
 */

/** A cluster at least half unexplored, in the scorer's units, before it is called "unclaimed". */
export const FRONTIER_MIN_NOVELTY = 0.5

/** Not the ground the run started on: closer than this is the doorstep, not a frontier. */
export const FRONTIER_MIN_DISTANCE_M = 250

/** Where the frontier is measured from: the run's first fix, or — untraced — the home camera. */
export function frontierOrigin(route: RouteTraceGeometry | undefined, home: Located | null): Located | null {
  const first = route?.coordinates.find((line) => line.length > 0)?.[0]
  if (first) return { lng: first[0], lat: first[1] }
  return home
}

export function pickFrontier(clusters: readonly FrontierCluster[]): FrontierCluster | null {
  return clusters.find((c) => c.noveltyFraction >= FRONTIER_MIN_NOVELTY && c.distanceM >= FRONTIER_MIN_DISTANCE_M) ?? null
}

const COMPASS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"]

export function compassWord(bearing: number): string {
  return COMPASS[Math.round((((bearing % 360) + 360) % 360) / 45) % 8]
}

/**
 * `Unclaimed ground 1.2 km north — Millbrook`, or without the name when none is known (`0256`).
 * Naming unexplored ground is deliberate (D-302): a name says a destination exists; the fog still
 * keeps what it looks like.
 */
export function frontierText(c: Pick<FrontierCluster, "distanceM" | "bearing">, place?: string | null): string {
  const line = `Unclaimed ground ${(c.distanceM / 1000).toFixed(1)} km ${compassWord(c.bearing)}`
  return place ? `${line} — ${place}` : line
}
