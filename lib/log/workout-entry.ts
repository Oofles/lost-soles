/**
 * THE `/log` WIRE SHAPE — what one quick log sends, and the boundary that refuses a bad one.
 * Ticket 0070, D-062, D-280.
 *
 * `WorkoutEntry` is a REQUEST BODY, not a table. What persists is the canonical `Activity`
 * (`docs/contracts/ingestion-contract.md` §2), whose `sets: WorkoutSet[]` already carries sets
 * from day one; the manual adapter (`0069`) turns an entry into one. A second persisted type
 * holding the same sets would be two answers to "what did I log", and they would drift.
 *
 * WHY `lib/log/` AND NOT `src/adapters/manual/`. Every directory under `src/adapters/` must be
 * a registered adapter (`registry.test.ts`), and registering it is `0069`'s job. This module is
 * the `/log` route's input boundary (`0068`); the adapter consumes what it returns.
 *
 * THE RULE THIS FILE EXISTS FOR (`06-ui-ux.md` §6.6): **a quick log writes one set, not a
 * scalar.** Thirty pushups is `sets: [{ reps: 30 }]`, never `reps: 30`. The post-MVP sets
 * editor then lands as a UI that sends a longer list — not as a migration of every row.
 *
 * Which field a set carries is NOT a union written here. The exercise's registry row names a
 * measure (`reps:pushup`), and the scorer's `setFieldOf` maps the measure's kernel to the field
 * (`reps`, `durationS`). The boundary validates through that same map, so it and the scorer
 * cannot disagree, and a new exercise over an existing kernel is a registry row only (D-031).
 */

import type { Activity, WorkoutSet } from "@/src/domain/activity"
import type { RuleSkill } from "@/src/rules/schema"
import { SET_FIELDS, setFieldOf, type SetField } from "@/src/scoring/units"

/**
 * One set as the client sends it. The exercise is NOT repeated per set on the wire — an entry
 * is one exercise — and is stamped onto each set when it becomes an `Activity`.
 *
 * Deliberately open: a future `restSeconds` is an optional key on this object, and a reader
 * that does not know it ignores it (criterion 8). No field is reserved for it now.
 */
export type EntrySet = Omit<WorkoutSet, "exercise">

export interface WorkoutEntry {
  /** A registry `exercises[].id` — `pushup`, `plank`. Data, never a union (D-031). */
  exerciseId: string
  /** ALWAYS a list, never empty. One click writes a list of one. */
  sets: EntrySet[]
  /** UTC instant with a real `Z`. May be back-dated; becomes `Activity.startedAt`, which is
   *  what scoring reads (D-020's "scoring uses `activity.startedAt`, never `now()`"). */
  occurredAt: string
  /** Client-minted, so a retried click is one log, not two. */
  idempotencyKey: string
}

export type WorkoutEntryErrorCode =
  | "NOT_AN_OBJECT"
  | "UNKNOWN_EXERCISE"
  | "NO_SETS"
  | "BAD_SET"
  | "BAD_OCCURRED_AT"
  | "BAD_IDEMPOTENCY_KEY"

/** The one named error the `/log` boundary throws. `code` says which rule failed. */
export class WorkoutEntryError extends Error {
  readonly code: WorkoutEntryErrorCode

  constructor(code: WorkoutEntryErrorCode, message: string) {
    super(message)
    this.name = "WorkoutEntryError"
    this.code = code
  }
}

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/
const MAX_IDEMPOTENCY_KEY = 128

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

const isPositiveInt = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v > 0

/**
 * The set field an exercise's entries carry, resolved through the registry: the activity row
 * listing the exercise, its measure, the measure's kernel. Null if no row logs this exercise.
 */
export function entryFieldFor(
  exerciseId: string,
  registry: { skills: readonly RuleSkill[] },
): SetField | null {
  for (const skill of registry.skills) {
    if (skill.kind !== "activity" || !skill.enabled || !skill.match) continue
    if (!skill.exercises?.some((e) => e.id === exerciseId)) continue
    const resolved = setFieldOf(skill.match.measure)
    if (resolved && resolved.exercise === exerciseId) return resolved.field
  }
  return null
}

/**
 * Validate an untrusted `/log` body. Returns a clean `WorkoutEntry` — unknown keys dropped at
 * every level — or throws `WorkoutEntryError` naming the first rule it broke.
 *
 * A set must carry its exercise's field as a positive integer, and no OTHER kernel's field:
 * `{ reps: 30, durationS: 60 }` on pushups is refused rather than half-scored. `weightKg` is
 * the one optional extra, because the contract already carries it.
 */
export function parseWorkoutEntry(
  input: unknown,
  registry: { skills: readonly RuleSkill[] },
): WorkoutEntry {
  if (!isRecord(input)) throw new WorkoutEntryError("NOT_AN_OBJECT", "a workout entry must be a JSON object")

  const { exerciseId, sets, occurredAt, idempotencyKey } = input

  if (typeof exerciseId !== "string" || exerciseId === "") {
    throw new WorkoutEntryError("UNKNOWN_EXERCISE", "exerciseId must be a non-empty string")
  }
  const field = entryFieldFor(exerciseId, registry)
  if (!field) {
    throw new WorkoutEntryError(
      "UNKNOWN_EXERCISE",
      `no enabled skill logs exercise ${JSON.stringify(exerciseId)}`,
    )
  }

  if (!Array.isArray(sets)) throw new WorkoutEntryError("NO_SETS", "sets must be a list")
  if (sets.length === 0) {
    throw new WorkoutEntryError("NO_SETS", "sets is empty — a log with no sets records no work")
  }

  const otherFields = Object.values(SET_FIELDS).filter((f) => f !== field)
  const clean: EntrySet[] = sets.map((s, i) => {
    if (!isRecord(s)) throw new WorkoutEntryError("BAD_SET", `sets[${i}] must be an object`)
    if (!isPositiveInt(s[field])) {
      throw new WorkoutEntryError("BAD_SET", `sets[${i}].${field} must be a positive integer`)
    }
    const stray = otherFields.find((f) => s[f] !== undefined)
    if (stray) {
      throw new WorkoutEntryError(
        "BAD_SET",
        `sets[${i}] carries ${stray}, but ${JSON.stringify(exerciseId)} is measured in ${field}`,
      )
    }
    const set: EntrySet = { [field]: s[field] }
    if (s.weightKg !== undefined) {
      if (typeof s.weightKg !== "number" || !Number.isFinite(s.weightKg) || s.weightKg <= 0) {
        throw new WorkoutEntryError("BAD_SET", `sets[${i}].weightKg must be a positive number`)
      }
      set.weightKg = s.weightKg
    }
    return set
  })

  if (typeof occurredAt !== "string" || !ISO_UTC.test(occurredAt) || Number.isNaN(Date.parse(occurredAt))) {
    throw new WorkoutEntryError("BAD_OCCURRED_AT", "occurredAt must be an ISO 8601 UTC instant ending in Z")
  }

  if (
    typeof idempotencyKey !== "string" ||
    idempotencyKey === "" ||
    idempotencyKey.length > MAX_IDEMPOTENCY_KEY
  ) {
    throw new WorkoutEntryError(
      "BAD_IDEMPOTENCY_KEY",
      `idempotencyKey must be a non-empty string of at most ${MAX_IDEMPOTENCY_KEY} characters`,
    )
  }

  return { exerciseId, sets: clean, occurredAt, idempotencyKey }
}

/**
 * The part of an `Activity` an entry decides: WHEN (back-dating included) and WHAT. Identity,
 * kind, source and archive are the manual adapter's (`0069`).
 */
export function entryActivityFields(entry: WorkoutEntry): Pick<Activity, "startedAt" | "sets"> {
  return {
    startedAt: entry.occurredAt,
    sets: entry.sets.map((s) => ({ ...s, exercise: entry.exerciseId })),
  }
}
