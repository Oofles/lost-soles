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

import type { Activity, ActivityKind, WorkoutSet } from "@/src/domain/activity"
import type { RuleExercise, RuleSkill, RuleSplit } from "@/src/rules/schema"
import { SET_FIELDS, SET_FIELD_BY_ENTRY, setFieldOf, type SetField } from "@/src/scoring/units"

/**
 * One set as the client sends it. The exercise is NOT repeated per set on the wire — an entry
 * is one exercise — and is stamped onto each set when it becomes an `Activity`.
 *
 * Deliberately open: a future `restSeconds` is an optional key on this object, and a reader
 * that does not know it ignores it (criterion 8). No field is reserved for it now.
 */
export type EntrySet = Omit<WorkoutSet, "exercise"> & {
  /**
   * Only on a SPLIT log (D-483, ticket 0342), where one entry spans several exercises: the
   * member this set belongs to. Never taken from the client — `parseWorkoutEntry` writes it while
   * apportioning the split, and a plain entry's sets never carry it.
   */
  exercise?: string
}

/** One member's share of a split log, in percent. */
export interface SplitShare {
  exerciseId: string
  percent: number
}

/** What a split log says on the wire: the total, and how it divides (D-483). */
export interface SplitSpec {
  durationS: number
  shares: SplitShare[]
}

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
  /**
   * The client's IANA zone (`Intl.DateTimeFormat().resolvedOptions().timeZone`), or absent.
   * Added by `0069` (D-281): `Activity.startedAtLocal` drives game-day bucketing and a UTC
   * instant alone cannot produce it. Context about WHEN, never a claim about what it is worth.
   */
  timezone?: string
  /**
   * What the log IS — `0240`, D-286. NEVER taken from the client: `parseWorkoutEntry` stamps it
   * from the exercise's registry row (`kind`, default `strength`), and that stamped entry is
   * what is archived, so `normalize()` reads it without a registry and an archive written before
   * D-286 (no `kind`) still reads as the strength log it was.
   */
  kind?: ActivityKind
  /**
   * A split log (D-483): `exerciseId` names a `RuleSet.splits[]` entry, and this is what the user
   * said. `sets` is then DERIVED from it, one per non-zero share, each carrying its member
   * `exercise`, by `apportionSplit` on both sides of the wire. Only this goes over the wire.
   */
  split?: SplitSpec
}

export type WorkoutEntryErrorCode =
  | "NOT_AN_OBJECT"
  | "UNKNOWN_EXERCISE"
  | "NO_SETS"
  | "BAD_SET"
  | "BAD_OCCURRED_AT"
  | "BAD_IDEMPOTENCY_KEY"
  | "BAD_TIMEZONE"
  | "BAD_SPLIT"

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

/** A zone `Intl` can format in. Throws `RangeError` on anything else, including `""`. */
export function isIanaZone(v: unknown): v is string {
  if (typeof v !== "string" || v === "") return false
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: v })
    return true
  } catch {
    return false
  }
}

const isPositiveInt = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v > 0

/**
 * The field a set carries: a set-summing kernel's (`reps`, `durationS`), or `distanceM` for a
 * distance entry (D-286). A distance is NOT a scoring kernel — the adapter folds it into
 * `Activity.distanceM`, which the row's `distanceKm` measure already reads.
 */
export type EntryField = SetField | "distanceM"

/**
 * Optional companions a set may carry beside its field, by entry kind (D-286). A distance may
 * carry its time; nothing else may carry another kernel's field. Keyed on the schema's entry
 * enum, like `/log`'s `STEP_BY_ENTRY`, so a new exercise over an existing entry is data only.
 */
export const OPTIONAL_FIELDS_BY_ENTRY: Record<RuleExercise["entry"], readonly SetField[]> = {
  count: [],
  seconds: [],
  distance: [SET_FIELDS.seconds],
  minutes: [],
}

/** The enabled activity row that logs `exerciseId`, and the exercise itself. */
export function exerciseOf(
  exerciseId: string,
  registry: { skills: readonly RuleSkill[] },
): { skill: RuleSkill; exercise: RuleExercise } | null {
  for (const skill of registry.skills) {
    if (skill.kind !== "activity" || !skill.enabled || !skill.match) continue
    const exercise = skill.exercises?.find((e) => e.id === exerciseId)
    if (exercise) return { skill, exercise }
  }
  return null
}

/**
 * The set field an exercise's entries carry, resolved through the registry: the activity row
 * listing the exercise, its measure, the measure's kernel — or, for a distance entry on a
 * `distanceKm` row, `distanceM` (D-286). Null if no row logs this exercise.
 */
export function entryFieldFor(
  exerciseId: string,
  registry: { skills: readonly RuleSkill[] },
): EntryField | null {
  const found = exerciseOf(exerciseId, registry)
  if (!found) return null
  const measure = found.skill.match!.measure
  if (found.exercise.entry === "distance") return measure === "distanceKm" ? "distanceM" : null
  // D-483: a scaled exercise carries its own entry's field, whatever its skill tallies.
  if (found.exercise.scale !== undefined) return SET_FIELD_BY_ENTRY[found.exercise.entry]
  const resolved = setFieldOf(measure)
  return resolved && resolved.exercise === exerciseId ? resolved.field : null
}

/** The kind a log of `exerciseId` is: the exercise's `kind`, else `strength` (D-286). A split
 *  logs its members' kind, which the validator holds to one (D-483). */
export function exerciseKind(
  exerciseId: string,
  registry: { skills: readonly RuleSkill[]; splits?: readonly RuleSplit[] },
): ActivityKind {
  const split = splitOf(exerciseId, registry)
  const id = split ? split.members[0]! : exerciseId
  return exerciseOf(id, registry)?.exercise.kind ?? "strength"
}

/** The split `id` names, or null. D-483. */
export function splitOf(
  id: string,
  registry: { splits?: readonly RuleSplit[] },
): RuleSplit | null {
  return registry.splits?.find((s) => s.id === id) ?? null
}

/**
 * A split's total, divided by share into whole-second sets — one per non-zero share, in member
 * order (D-483). Each share is floored; the seconds left over go to the largest share, ties to
 * the first member. So the sets always sum to exactly the total, and the same input apportions
 * the same way on the client (its optimistic award) and the server (what is scored).
 *
 * Throws `BAD_SPLIT` on anything a user could not have meant: an unknown member, a member twice,
 * a share that is not a multiple of the split's step, or shares that do not sum to 100.
 */
export function apportionSplit(split: RuleSplit, spec: SplitSpec): EntrySet[] {
  const bad = (m: string) => new WorkoutEntryError("BAD_SPLIT", m)
  if (!isPositiveInt(spec.durationS)) throw bad("split.durationS must be a positive integer")
  if (!Array.isArray(spec.shares) || spec.shares.length === 0) throw bad("split.shares must be a non-empty list")
  const byMember = new Map<string, number>()
  for (const [i, s] of spec.shares.entries()) {
    if (!isRecord(s) || typeof s.exerciseId !== "string") throw bad(`split.shares[${i}] must be { exerciseId, percent }`)
    if (!split.members.includes(s.exerciseId)) {
      throw bad(`split.shares[${i}]: ${JSON.stringify(s.exerciseId)} is not part of ${JSON.stringify(split.id)}`)
    }
    if (byMember.has(s.exerciseId)) throw bad(`split.shares[${i}]: ${JSON.stringify(s.exerciseId)} is listed twice`)
    const p = s.percent
    if (typeof p !== "number" || !Number.isInteger(p) || p < 0 || p > 100 || p % split.shareStep !== 0) {
      throw bad(`split.shares[${i}].percent must be a whole multiple of ${split.shareStep} from 0 to 100`)
    }
    byMember.set(s.exerciseId, p)
  }
  const total = [...byMember.values()].reduce((a, b) => a + b, 0)
  if (total !== 100) throw bad(`split shares sum to ${total}%, not 100%`)

  const parts = split.members
    .map((id) => ({ id, percent: byMember.get(id) ?? 0 }))
    .filter((p) => p.percent > 0)
    .map((p) => ({ ...p, seconds: Math.floor((spec.durationS * p.percent) / 100) }))
  const left = spec.durationS - parts.reduce((a, p) => a + p.seconds, 0)
  // `parts` is in member order, so the first of equal largest shares is the first member.
  const largest = parts.reduce((best, p) => (p.percent > best.percent ? p : best), parts[0]!)
  largest.seconds += left
  return parts.map((p) => ({ exercise: p.id, [SET_FIELDS.seconds]: p.seconds }))
}

function parseSplit(input: Record<string, unknown>, split: RuleSplit): { split: SplitSpec; sets: EntrySet[] } {
  if (input.sets != null) {
    throw new WorkoutEntryError("BAD_SPLIT", `${JSON.stringify(split.id)} is a split: it carries split, not sets`)
  }
  const raw = input.split
  if (!isRecord(raw)) throw new WorkoutEntryError("BAD_SPLIT", "a split log needs split: { durationS, shares }")
  const shares = Array.isArray(raw.shares)
    ? raw.shares.map((s) => (isRecord(s) ? { exerciseId: s.exerciseId, percent: s.percent } : s))
    : raw.shares
  const spec = { durationS: raw.durationS, shares } as SplitSpec
  const sets = apportionSplit(split, spec)
  return { split: { durationS: spec.durationS, shares: spec.shares.map((s) => ({ exerciseId: s.exerciseId, percent: s.percent })) }, sets }
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
  registry: { skills: readonly RuleSkill[]; splits?: readonly RuleSplit[] },
): WorkoutEntry {
  if (!isRecord(input)) throw new WorkoutEntryError("NOT_AN_OBJECT", "a workout entry must be a JSON object")

  const { exerciseId, sets, occurredAt, idempotencyKey, timezone } = input

  if (typeof exerciseId !== "string" || exerciseId === "") {
    throw new WorkoutEntryError("UNKNOWN_EXERCISE", "exerciseId must be a non-empty string")
  }
  const split = splitOf(exerciseId, registry)
  if (split) {
    // D-483: the sets are derived here from what the user said, never sent.
    const parsed = parseSplit(input, split)
    return { exerciseId, ...parsed, ...parseEnvelope(occurredAt, idempotencyKey, timezone), kind: exerciseKind(exerciseId, registry) }
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

  const optional = OPTIONAL_FIELDS_BY_ENTRY[exerciseOf(exerciseId, registry)!.exercise.entry]
  const otherFields = [...Object.values(SET_FIELDS), "distanceM" as const].filter(
    (f) => f !== field && !(optional as readonly string[]).includes(f),
  )
  const clean: EntrySet[] = sets.map((s, i) => {
    if (!isRecord(s)) throw new WorkoutEntryError("BAD_SET", `sets[${i}] must be an object`)
    if (!isPositiveInt(s[field])) {
      throw new WorkoutEntryError("BAD_SET", `sets[${i}].${field} must be a positive integer`)
    }
    // `!= null`: GraphQL hands an unset nullable input field over as `null` (0069).
    const stray = otherFields.find((f) => s[f] != null)
    if (stray) {
      throw new WorkoutEntryError(
        "BAD_SET",
        `sets[${i}] carries ${stray}, but ${JSON.stringify(exerciseId)} is measured in ${field}`,
      )
    }
    const set: EntrySet = { [field]: s[field] }
    for (const extra of optional) {
      if (s[extra] == null) continue
      if (!isPositiveInt(s[extra])) {
        throw new WorkoutEntryError("BAD_SET", `sets[${i}].${extra} must be a positive integer when given`)
      }
      set[extra] = s[extra]
    }
    if (s.weightKg != null) {
      if (typeof s.weightKg !== "number" || !Number.isFinite(s.weightKg) || s.weightKg <= 0) {
        throw new WorkoutEntryError("BAD_SET", `sets[${i}].weightKg must be a positive number`)
      }
      set.weightKg = s.weightKg
    }
    return set
  })

  return { exerciseId, sets: clean, ...parseEnvelope(occurredAt, idempotencyKey, timezone), kind: exerciseKind(exerciseId, registry) }
}

/** WHEN and WHICH LOG — the half of an entry that is the same for a row and a split. */
function parseEnvelope(
  occurredAt: unknown,
  idempotencyKey: unknown,
  timezone: unknown,
): Pick<WorkoutEntry, "occurredAt" | "idempotencyKey" | "timezone"> {
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

  if (timezone !== undefined && timezone !== null && !isIanaZone(timezone)) {
    throw new WorkoutEntryError("BAD_TIMEZONE", `timezone must be an IANA zone id, got ${JSON.stringify(timezone)}`)
  }

  return {
    occurredAt,
    idempotencyKey,
    ...(typeof timezone === "string" ? { timezone } : {}),
  }
}

/**
 * The part of an `Activity` an entry decides: WHEN (back-dating included), WHAT, and what it IS.
 * Identity, source and archive are the manual adapter's (`0069`).
 *
 * `kind` is the stamped one, else `strength` (an entry archived before D-286). `distanceM` is
 * the sum of the sets' distances, absent when none carries one — so a distance log reaches the
 * row's `distanceKm` measure exactly as a synced traceless run does. `elapsedS` sums the sets'
 * seconds: a plank's time under tension, or a distance's optional time.
 */
export function entryActivityFields(
  entry: WorkoutEntry,
): Pick<Activity, "startedAt" | "sets" | "kind" | "elapsedS"> & Partial<Pick<Activity, "distanceM">> {
  // A split's sets name their member (D-483); every other entry's sets are its one exercise.
  const sets = entry.sets.map((s) => ({ ...s, exercise: s.exercise ?? entry.exerciseId }))
  const distances = sets.filter((s) => typeof s.distanceM === "number")
  return {
    startedAt: entry.occurredAt,
    sets,
    kind: entry.kind ?? "strength",
    elapsedS: sets.reduce((sum, s) => sum + (s.durationS ?? 0), 0),
    ...(distances.length > 0 ? { distanceM: distances.reduce((sum, s) => sum + s.distanceM!, 0) } : {}),
  }
}
