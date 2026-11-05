/**
 * A PAST WORKOUT, AS A PLAIN RECORD. Ticket `0345`. `06-ui-ux.md` §2.6, D-486.
 *
 * `/workouts/:id`'s words: the date, what was logged, and the XP each skill earned. Nothing here
 * plays, moves or replays — there is no territory, and §6.4 already says a workout gets no reveal
 * sequence. Pure, so the page and its tests format identically.
 *
 * No `switch` on a kind, a skill or an exercise (D-031). An exercise is named by the registry's own
 * `label` (`exerciseLabels`), a skill by the ruleset's `name`, a kind by `kindLabel`; a set's measure
 * is read off whichever field it carries. A new workout type is a data row with no diff here.
 */

import type { ExerciseLabel } from "@/lib/chronicle/rows"
import { kindLabel } from "@/lib/run-kind/kind"
import { runDate, runDistance, runDuration, xpNumber } from "@/lib/runs/format"
import { runLedger, type ActivityLedgerRow } from "@/lib/runs/ledger"
import type { ChronicleSet, RunListItem } from "@/lib/runs/wire"

export interface LoggedLine {
  /** The exercise's label, as `/log` shows it: `pushups`, `upper body`. */
  what: string
  /** `40`, `2:00`, `5.00 km` — or `null` for a set that carries no measure. */
  measure: string | null
  /** A split log's share of its total (D-483), `50%`. `null` on anything that is not a split. */
  share: string | null
}

export interface XpLine {
  skillId: string
  name: string
  xp: string
}

export interface WorkoutRecordView {
  date: string
  kind: string
  name: string | null
  logged: LoggedLine[]
  /** `null` when the ledger could not be read: the record says so, quietly, rather than showing zeros. */
  xp: XpLine[] | null
  totalXp: string | null
}

function measureOf(set: ChronicleSet): string | null {
  if (set.distanceM !== undefined) return runDistance(set.distanceM)
  if (set.reps !== undefined) return xpNumber(set.reps)
  if (set.durationS !== undefined) return runDuration(set.durationS)
  return null
}

/**
 * A SPLIT, READ BACK. A split log is stored as one timed set per member with a non-zero share
 * (`apportionSplit`, D-483), so it is recognised by its shape — several sets, every one timed,
 * more than one exercise — and each share is that set's part of the whole. A plain log never has
 * more than one exercise, so it never reads as a split.
 */
function shares(sets: readonly ChronicleSet[]): (string | null)[] {
  const timed = sets.every((s) => s.durationS !== undefined && s.durationS > 0)
  const split = sets.length > 1 && timed && new Set(sets.map((s) => s.exercise)).size > 1
  if (!split) return sets.map(() => null)
  const total = sets.reduce((sum, s) => sum + (s.durationS ?? 0), 0)
  return sets.map((s) => `${Math.round(((s.durationS ?? 0) / total) * 100)}%`)
}

/** What was logged. A session with no sets (an untraced import) is its kind and its measure. */
function loggedLines(item: RunListItem, label: ExerciseLabel): LoggedLine[] {
  if (item.sets.length > 0) {
    const share = shares(item.sets)
    return item.sets.map((s, i) => ({ what: label(s.exercise), measure: measureOf(s), share: share[i] ?? null }))
  }
  const measure =
    runDistance(item.distanceM) ?? (item.durationS !== null && item.durationS > 0 ? runDuration(item.durationS) : null)
  return [{ what: kindLabel(item.kind).toLowerCase(), measure, share: null }]
}

export function workoutRecord(
  item: RunListItem,
  ledger: readonly ActivityLedgerRow[] | null,
  label: ExerciseLabel,
  skillName: (skillId: string) => string,
): WorkoutRecordView {
  const earned = ledger ? runLedger(ledger) : null
  return {
    date: runDate(item.startedAtLocal),
    kind: kindLabel(item.kind),
    name: item.name,
    logged: loggedLines(item, label),
    xp: earned ? earned.lines.map((l) => ({ skillId: l.skillId, name: skillName(l.skillId), xp: `+${xpNumber(l.xp)} XP` })) : null,
    totalXp: earned && earned.totalXp > 0 ? `${xpNumber(earned.totalXp)} XP` : null,
  }
}
