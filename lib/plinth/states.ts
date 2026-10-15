/**
 * THE HOME SCREEN'S STATES, THE PARTS THAT ARE NOT PRESENTATION. Ticket `0087`, `06-ui-ux.md` §2.4.
 */

import type { RunFeatureCollection } from "@/lib/runs/wire"

/**
 * Activity ids whose fresh line has already pulsed in this page load. Module scope on purpose: it
 * survives re-renders AND client-side navigation (home → `/skills` → home), and a reload — a cold
 * open, §3.1's "app opened cold with an unseen import" — starts it empty.
 */
const pulsed = new Set<string>()

/**
 * `true` the first time it is asked about a run, `false` every time after: the line pulses ONCE and
 * then stops, and never re-pulses (§2.4, §3.1). The caller asks once per run and holds the answer
 * (a memo), so the CSS class it gates is set on the first render and never toggled — a class that
 * never changes is an animation that never restarts.
 */
export function firstPulse(activityId: string): boolean {
  if (pulsed.has(activityId)) return false
  pulsed.add(activityId)
  return true
}

/** For tests. */
export function resetPulses(): void {
  pulsed.clear()
}

const NONE: readonly string[] = []

/**
 * WHAT `/` HOLDS BACK. `null` — nothing held, the corridor drawn — unless the latest run is known to
 * be unseen; then its NEW cells (`0251`'s verdict, carried on `/api/runs/latest`), possibly none for
 * a run never classified. While `seen` is unknown nothing is held: holding on a guess would fog
 * ground on a run that was seen.
 */
export function heldCells(latest: RunFeatureCollection, seen: boolean | null): readonly string[] | null {
  const run = latest.features[0]?.properties
  if (!run || seen !== false) return null
  return run.newCells ?? NONE
}
