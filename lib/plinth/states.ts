/**
 * THE HOME SCREEN'S STATES, THE PARTS THAT ARE NOT PRESENTATION. Ticket `0087`, `06-ui-ux.md` §2.4.
 */

import { HOLD_PENDING } from "@/lib/fog/home-territory"
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

/** `0273`. What `useLatestRun` says its answer speaks for (`LatestAnswer`), structurally. */
export interface AnswerTag {
  generation: number | null
  network: boolean
}

/**
 * `0273`. DOES THE LATEST-RUN ANSWER ON SCREEN SPEAK FOR THE EXPLORED SET ON SCREEN?
 *
 * Only for the same generation, and a CACHED answer only for a CACHED set: both are what the last
 * session left, so a cold start still draws its fog before any request (`06` §4.8). A set the
 * network has moved — a delta or a full fetch — needs the network's answer for that generation,
 * because the run that moved it is exactly the one the cache cannot know about.
 */
export function answersFor(
  answer: AnswerTag | null,
  explored: { generation: number | null; source: string },
): boolean {
  if (!answer || answer.generation !== explored.generation) return false
  return answer.network || explored.source === "cache"
}

/**
 * `0273`. WHAT `/` HOLDS BACK, OR THAT IT CANNOT SAY YET. `"pending"` until the latest-run answer
 * speaks for the explored set (`answersFor`) and, when there is a run, its `seen` flag has been read;
 * then `heldCells`. The fog freezes on its last frame while pending (`homeTerritoryView`), so the
 * "nothing is held while `seen` is unknown" rule above no longer has to choose between a flash and a
 * guess: it waits.
 */
export function homeHold(
  latest: RunFeatureCollection,
  seen: boolean | null,
  answered: boolean,
): readonly string[] | null | typeof HOLD_PENDING {
  if (!answered) return HOLD_PENDING
  if (latest.features[0] && seen === null) return HOLD_PENDING
  return heldCells(latest, seen)
}
