/**
 * `/log`'S ROWS, FROM THE REGISTRY AND NOTHING ELSE. Tickets 0068 and 0071, D-061, D-282.
 *
 * `06-ui-ux.md` §6.1: `/log` is "a list of rows generated from the skill registry", and adding a
 * workout type is adding a row to a YAML file. So this module is the whole of what the page
 * knows about workout types, and it knows it by READING: no skill id, no exercise id and no
 * per-type branch appears here or in `app/log/`. `src/rules/no-skill-names.test.ts` greps
 * both for every id the registry carries.
 *
 * One row per `exercises[]` entry of every enabled activity skill, in `displayOrder` —
 * "registry order, forever" (§6.5). Declaring an exercise IS declaring the row hand-loggable:
 * D-286 dropped the `logMode` filter (`reps | duration`), because Vigil is `logMode: trace` and
 * its treadmill exercise is still logged by hand. There is no `trace-manual` mode (D-282).
 */

import type { WorkoutEntry, EntrySet } from "@/lib/log/workout-entry"
import { OPTIONAL_FIELDS_BY_ENTRY, entryFieldFor } from "@/lib/log/workout-entry"
import { SET_FIELDS } from "@/src/scoring/units"
import type { RuleExercise, RuleSkill } from "@/src/rules/schema"

/**
 * THE STEPPER'S STEP, BY ENTRY KIND (D-282). `RuleExercise` carries no `step`, and the
 * design's numbers — pushups ±5, situps ±5, plank ±15 s — are exactly a function of `entry`.
 * Keyed on a schema enum, like `SET_FIELDS` on a kernel, so a new exercise over an existing
 * entry kind is still a YAML row and nothing else.
 */
export const STEP_BY_ENTRY: Record<RuleExercise["entry"], number> = {
  count: 5,
  seconds: 15,
  /** Kilometres. `0240`, D-286. */
  distance: 0.5,
}

/**
 * Decimal places the row's number keeps, by entry kind. A count and a time are whole; a
 * distance is shown and stepped in kilometres to 0.1 (D-286).
 */
export const DECIMALS_BY_ENTRY: Record<RuleExercise["entry"], number> = {
  count: 0,
  seconds: 0,
  distance: 1,
}

/**
 * What one unit on the row is in the SET, by entry kind. A set carries integers; a distance row
 * shows kilometres and its set carries whole metres (`WorkoutSet.distanceM`, D-286).
 */
export const SET_SCALE_BY_ENTRY: Record<RuleExercise["entry"], number> = {
  count: 1,
  seconds: 1,
  distance: 1000,
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
  /** `DECIMALS_BY_ENTRY[entry]`: 0 for counts and seconds, 1 for kilometres. */
  decimals: number
  /** The entry may carry an optional time beside its number (a distance's, D-286). */
  optionalTime: boolean
  /** The registry's `minUnitsForCredit`, as a whole unit. The stepper never goes below it. */
  min: number
  /** A fresh install's starting value: the exercise's first `quickValue` (D-282). */
  fallback: number
}

/** Every row `/log` renders, in `displayOrder`. */
export function logRows(registry: { skills: readonly RuleSkill[] }): LogRow[] {
  return [...registry.skills]
    .filter((s) => s.enabled && s.kind === "activity")
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .flatMap((skill) =>
      (skill.exercises ?? []).map((ex): LogRow => {
        const decimals = DECIMALS_BY_ENTRY[ex.entry]
        const unit = 10 ** -decimals
        const min = Math.max(unit, roundTo(Math.ceil(skill.minUnitsForCredit / unit) * unit, decimals))
        return {
          skillId: skill.id,
          skillName: skill.name,
          exerciseId: ex.id,
          label: ex.label.toLowerCase(),
          entry: ex.entry,
          step: STEP_BY_ENTRY[ex.entry],
          decimals,
          optionalTime: OPTIONAL_FIELDS_BY_ENTRY[ex.entry].includes(SET_FIELDS.seconds),
          min,
          fallback: Math.max(min, ex.quickValues[0] ?? min),
        }
      }),
    )
}

function roundTo(value: number, decimals: number): number {
  const f = 10 ** decimals
  return Math.round(value * f) / f
}

/** Clamped at the row's minimum (never below), and rounded to the row's decimals — whole for a
 *  count or a time, 0.1 km for a distance. */
export function clampValue(row: Pick<LogRow, "min"> & Partial<Pick<LogRow, "decimals">>, value: number): number {
  if (!Number.isFinite(value)) return row.min
  return Math.max(row.min, roundTo(value, row.decimals ?? 0))
}

/** One press of `−` (`-1`) or `+` (`+1`). */
export function stepValue(
  row: Pick<LogRow, "min" | "step"> & Partial<Pick<LogRow, "decimals">>,
  value: number,
  direction: 1 | -1,
): number {
  return clampValue(row, value + direction * row.step)
}

/** `30` for a count, `1:30` for seconds, `5.0 km` for a distance. What the number on the row shows. */
export function formatValue(row: Pick<LogRow, "entry">, value: number): string {
  if (row.entry === "distance") return `${value.toFixed(DECIMALS_BY_ENTRY.distance)} km`
  if (row.entry !== "seconds") return String(value)
  return formatTime(value)
}

/** `1:30`, or `1:02:05` past the hour. A plank's time, or a distance's optional time. */
export function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  const ss = String(s).padStart(2, "0")
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`
}

/** `h:mm:ss`, `m:ss` or bare minutes, as seconds; `null` for anything else or zero. */
export function parseTime(text: string): number | null {
  const t = text.trim()
  const hms = /^(\d{1,2}):([0-5]\d):([0-5]\d)$/.exec(t)
  if (hms) return Number(hms[1]) * 3600 + Number(hms[2]) * 60 + Number(hms[3]) || null
  const ms = /^(\d{1,3}):([0-5]\d)$/.exec(t)
  if (ms) return Number(ms[1]) * 60 + Number(ms[2]) || null
  return /^\d{1,3}$/.test(t) ? Number(t) * 60 || null : null
}

/**
 * What the typed number means, or `null` if it means nothing. A seconds row takes `1:30` or a
 * bare `90`; a count row takes an integer. Not clamped here — the caller clamps, so a typed `0`
 * becomes the minimum rather than being refused.
 */
export function parseValue(row: Pick<LogRow, "entry">, text: string): number | null {
  const t = text.trim()
  if (row.entry === "distance") {
    const km = /^(\d{1,3}(?:[.,]\d{1,2})?)\s*(?:km)?$/i.exec(t)
    return km ? Number(km[1].replace(",", ".")) : null
  }
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
  row: Pick<LogRow, "exerciseId"> & Partial<Pick<LogRow, "entry">>,
  value: number,
  registry: { skills: readonly RuleSkill[] },
  extra?: { durationS?: number },
): EntrySet {
  const field = entryFieldFor(row.exerciseId, registry)
  if (!field) throw new Error(`no enabled skill logs exercise ${JSON.stringify(row.exerciseId)}`)
  const scale = row.entry ? SET_SCALE_BY_ENTRY[row.entry] : 1
  const set: EntrySet = { [field]: Math.round(value * scale) }
  // A distance's optional time (D-286). The server refuses it on any entry that does not allow it.
  if (extra?.durationS) set.durationS = extra.durationS
  return set
}

/**
 * The entry one click sends. `occurredAt` is the instant of the CLICK, not of the flush, because
 * a log held for its undo window and then queued offline still happened when it happened, and
 * because a retry must carry it or the archive writes a second object (D-281).
 */
export function entryFor(
  row: Pick<LogRow, "exerciseId"> & Partial<Pick<LogRow, "entry">>,
  value: number,
  registry: { skills: readonly RuleSkill[] },
  at: { now: Date; idempotencyKey: string; timezone: string | undefined; durationS?: number },
): WorkoutEntry {
  return {
    exerciseId: row.exerciseId,
    sets: [entrySetFor(row, value, registry, { durationS: at.durationS })],
    occurredAt: at.now.toISOString(),
    idempotencyKey: at.idempotencyKey,
    ...(at.timezone ? { timezone: at.timezone } : {}),
  }
}
