/**
 * `/log`'S ROWS, FROM THE REGISTRY AND NOTHING ELSE. Tickets 0068 and 0071, D-061, D-282.
 *
 * `06-ui-ux.md` §6.1: `/log` is "a list of rows generated from the skill registry", and adding a
 * workout type is adding a row to a YAML file. So this module is the whole of what the page
 * knows about workout types, and it knows it by READING: no skill id, no exercise id and no
 * per-type branch appears here or in `app/log/`. `src/rules/no-skill-names.test.ts` greps
 * both for every id the registry carries.
 *
 * One row per `exercises[]` entry of every enabled activity skill whose `logMode` is something
 * a hand can log (`reps | duration`), in `displayOrder` — "registry order, forever" (§6.5).
 * There is no `trace-manual` row: no such `logMode` exists (D-282).
 */

import type { WorkoutEntry, EntrySet } from "@/lib/log/workout-entry"
import { entryFieldFor } from "@/lib/log/workout-entry"
import type { RuleExercise, RuleSkill } from "@/src/rules/schema"

/** The `logMode`s a person logs by hand on `/log`. `trace` arrives through an adapter. */
const HAND_LOGGED = new Set(["reps", "duration"])

/**
 * THE STEPPER'S STEP, BY ENTRY KIND (D-282). `RuleExercise` carries no `step`, and the
 * design's numbers — pushups ±5, situps ±5, plank ±15 s — are exactly a function of `entry`.
 * Keyed on a schema enum, like `SET_FIELDS` on a kernel, so a new exercise over an existing
 * entry kind is still a YAML row and nothing else.
 */
export const STEP_BY_ENTRY: Record<RuleExercise["entry"], number> = {
  count: 5,
  seconds: 15,
}

export interface LogRow {
  /** Opaque. Read from the registry, compared to nothing. */
  skillId: string
  skillName: string
  exerciseId: string
  /** The plain-English unit label (`pushups`, `plank`) — never `reps` or `seconds` (§6.4). */
  label: string
  entry: RuleExercise["entry"]
  step: number
  /** The registry's `minUnitsForCredit`, as a whole unit. The stepper never goes below it. */
  min: number
  /** A fresh install's starting value: the exercise's first `quickValue` (D-282). */
  fallback: number
}

/** Every row `/log` renders, in `displayOrder`. */
export function logRows(registry: { skills: readonly RuleSkill[] }): LogRow[] {
  return [...registry.skills]
    .filter((s) => s.enabled && s.kind === "activity" && HAND_LOGGED.has(s.logMode))
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .flatMap((skill) =>
      (skill.exercises ?? []).map((ex): LogRow => {
        const min = Math.max(1, Math.ceil(skill.minUnitsForCredit))
        return {
          skillId: skill.id,
          skillName: skill.name,
          exerciseId: ex.id,
          label: ex.label.toLowerCase(),
          entry: ex.entry,
          step: STEP_BY_ENTRY[ex.entry],
          min,
          fallback: Math.max(min, ex.quickValues[0] ?? min),
        }
      }),
    )
}

/** Clamped at the row's minimum (never below), and a whole number — sets carry integers. */
export function clampValue(row: Pick<LogRow, "min">, value: number): number {
  if (!Number.isFinite(value)) return row.min
  return Math.max(row.min, Math.round(value))
}

/** One press of `−` (`-1`) or `+` (`+1`). */
export function stepValue(row: Pick<LogRow, "min" | "step">, value: number, direction: 1 | -1): number {
  return clampValue(row, value + direction * row.step)
}

/** `30` for a count, `1:30` for seconds. What the number on the row shows. */
export function formatValue(row: Pick<LogRow, "entry">, value: number): string {
  if (row.entry !== "seconds") return String(value)
  const m = Math.floor(value / 60)
  const s = value % 60
  return `${m}:${String(s).padStart(2, "0")}`
}

/**
 * What the typed number means, or `null` if it means nothing. A seconds row takes `1:30` or a
 * bare `90`; a count row takes an integer. Not clamped here — the caller clamps, so a typed `0`
 * becomes the minimum rather than being refused.
 */
export function parseValue(row: Pick<LogRow, "entry">, text: string): number | null {
  const t = text.trim()
  if (row.entry === "seconds") {
    const mmss = /^(\d{1,3}):([0-5]\d)$/.exec(t)
    if (mmss) return Number(mmss[1]) * 60 + Number(mmss[2])
  }
  return /^\d{1,5}$/.test(t) ? Number(t) : null
}

/**
 * The one set a quick log writes (`06` §6.6: a list of one, never a scalar). WHICH field it
 * carries is the registry's answer through the measure's kernel — `entryFieldFor`, the same map
 * the server validates with — not a branch on `entry` here.
 */
export function entrySetFor(
  row: Pick<LogRow, "exerciseId">,
  value: number,
  registry: { skills: readonly RuleSkill[] },
): EntrySet {
  const field = entryFieldFor(row.exerciseId, registry)
  if (!field) throw new Error(`no enabled skill logs exercise ${JSON.stringify(row.exerciseId)}`)
  return { [field]: value }
}

/**
 * The entry one click sends. `occurredAt` is the instant of the CLICK, not of the flush, because
 * a log held for its undo window and then queued offline still happened when it happened, and
 * because a retry must carry it or the archive writes a second object (D-281).
 */
export function entryFor(
  row: Pick<LogRow, "exerciseId">,
  value: number,
  registry: { skills: readonly RuleSkill[] },
  at: { now: Date; idempotencyKey: string; timezone: string | undefined },
): WorkoutEntry {
  return {
    exerciseId: row.exerciseId,
    sets: [entrySetFor(row, value, registry)],
    occurredAt: at.now.toISOString(),
    idempotencyKey: at.idempotencyKey,
    ...(at.timezone ? { timezone: at.timezone } : {}),
  }
}
