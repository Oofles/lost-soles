/**
 * A CHRONICLE ROW, AS WORDS. Ticket `0088`. `06-ui-ux.md` §2.5; D-013.
 *
 * Pure, so the panel and its tests format identically. A row is the date, the activity's kind, its
 * headline measure — the distance for anything with one, the logged sets for a session, else its
 * duration — and its new-cell count where it has one. Nothing here is computed from other rows:
 * there is no week, no month, no total and no gap. A list has no holes in it (D-013).
 *
 * No `switch` on a kind or an exercise (D-031): the kind is labelled by `kindLabel`, an exercise
 * by the registry's own `label`, and a new workout type is a new row in the YAML with no diff here.
 */

import { runDate, runDistance, runDuration, xpNumber } from "@/lib/runs/format"
import { runHref, type ChronicleSet, type RunListItem } from "@/lib/runs/wire"
import { kindLabel } from "@/lib/run-kind/kind"

export interface ChronicleRowView {
  activityId: string
  /** `/run/:id` with no autoplay intent: §3.1, *"Chronicle → any past run"* opens the end state. */
  href: string
  date: string
  kind: string
  name: string | null
  measure: string | null
  /** `21 new`, or `null` — a row with no new cells says nothing about cells (D-316). */
  newCells: string | null
}

/** Exercise id → its plain-English label, from whatever registry the caller holds. */
export type ExerciseLabel = (exerciseId: string) => string

/** The labels a registry declares, lower-cased as `/log` shows them; an unknown id is shown as itself. */
export function exerciseLabels(registry: { skills: readonly { exercises?: readonly { id: string; label: string }[] }[] }): ExerciseLabel {
  const map = new Map<string, string>()
  for (const s of registry.skills) for (const e of s.exercises ?? []) map.set(e.id, e.label.toLowerCase())
  return (id) => map.get(id) ?? id
}

/** A logged session's sets: `40 pushups`, `2:00 plank`, `5.00 km treadmill`. `null` for no sets. */
export function workoutSummary(sets: readonly ChronicleSet[], label: ExerciseLabel): string | null {
  const parts = sets.flatMap((s) => {
    const what = label(s.exercise)
    if (s.distanceM !== undefined) {
      const d = runDistance(s.distanceM)
      return d ? [`${d} ${what}`] : []
    }
    if (s.reps !== undefined) return [`${xpNumber(s.reps)} ${what}`]
    if (s.durationS !== undefined) return [`${runDuration(s.durationS)} ${what}`]
    return [what]
  })
  return parts.length > 0 ? parts.join(", ") : null
}

export function chronicleRow(item: RunListItem, label: ExerciseLabel): ChronicleRowView {
  const measure =
    runDistance(item.distanceM) ??
    workoutSummary(item.sets, label) ??
    (item.durationS !== null && item.durationS > 0 ? runDuration(item.durationS) : null)
  return {
    activityId: item.activityId,
    href: runHref(item.activityId),
    date: runDate(item.startedAtLocal),
    kind: kindLabel(item.kind),
    name: item.name,
    measure,
    newCells: item.newCellCount !== null && item.newCellCount > 0 ? `${xpNumber(item.newCellCount)} new` : null,
  }
}

/**
 * WHICH ROW CARRIES THE GOLD MARK. At most one: the latest traced run, when `0084`'s per-device
 * `seen` flag says this device has not seen it — the same run, by the same rule, as the plinth's
 * `1 new run` line (`0087`). Operator, wave 1 of `13`: marking every unseen run turned the whole
 * list gold after a backfill, which §3.3 rules out ("unseen-flagged off"). A logged workout is
 * never "unseen" — the user entered it — and an untraced activity has no reveal to offer.
 * `items` are newest first, as every Chronicle page is. One function, so the rule has one home.
 */
export function latestTraced<T extends Pick<RunListItem, "traced">>(items: readonly T[]): T | undefined {
  return items.find((r) => r.traced)
}

export function unseenIds(
  items: readonly (Pick<RunListItem, "traced" | "activityId"> & { backfilled?: true })[],
  seen: ReadonlyMap<string, boolean>,
): Set<string> {
  const latest = latestTraced(items)
  // `0257`: a run that came in with a historical import is never new, on any device — the import's
  // one aggregate reveal stands for it, whatever this device's `seen` store says.
  if (!latest || latest.backfilled) return new Set()
  return seen.get(latest.activityId) === false ? new Set([latest.activityId]) : new Set()
}
