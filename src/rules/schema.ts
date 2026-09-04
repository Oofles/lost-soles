/**
 * The shape of `rules/xp-rules-vN.yaml`, and the closed vocabularies it draws on.
 *
 * Transcribed from `02-data-model.md` §3.2 (the `RuleSkill` item shape) and §3.4 (`match`),
 * which `04-game-design.md` §1.3 names as **authoritative for this schema**.
 *
 * NO SKILL ID APPEARS IN THIS FILE, or anywhere else under `src/`. Skills are rows
 * (D-031, D-141); a union type of skill ids is the same failure as a `switch` on one, and
 * `no-skill-names.test.ts` enforces it mechanically.
 *
 * Ticket 0028.
 */

import type { ActivityKind, SourceId } from "@/src/domain/activity"

/**
 * The four kernels. **A closed set, and closing it is the design** (`02` §3.7): data cannot
 * be turned all the way down, and a YAML dialect that can express anything is a programming
 * language with no debugger. Adding a fifth is the one event that legitimately requires code.
 */
export type LogMode = "trace" | "reps" | "duration" | "derived"

/** Which quantity off the `Activity` becomes the unit count (J2). `02` §3.7 fixes the set. */
export type Measure =
  | "distanceKm"
  | "cells"
  | "share"
  | `reps:${string}`
  | `seconds:${string}`

/** `true` and `false` read `Activity.hasTrace`; `"any"` ignores it. THE Vigil discriminator. */
export type RequiresTrace = boolean | "any"

export interface RuleMatch {
  /** `ActivityKind` values. Absent or empty means ANY — not none. */
  kinds?: ActivityKind[]
  requiresTrace: RequiresTrace
  /** `"any"`, or an explicit allowlist. The escape hatch; rarely used. */
  sources: "any" | SourceId[]
  measure: Measure
}

/** D-120. `null` means NOT ground-scored — a different claim from `{1,1,1}`. */
export interface Multipliers {
  new: number
  rearmed: number
  recent: number
}

export interface RuleFeed {
  skill: string
  /** Constitution's 1/3 lives here, on the FEEDER row — never as a constant in the scorer. */
  rate: number
}

export interface RuleExercise {
  id: string
  label: string
  entry: "count" | "seconds"
  quickValues: number[]
}

export interface RuleSkill {
  id: string
  name: string
  kind: "activity" | "meta"
  enabled: boolean
  displayOrder: number
  logMode: LogMode
  unit: string
  /** Null on `kind: meta` — meta skills are NEVER matched (`02` §3.4). */
  match: RuleMatch | null
  matchPriority?: number
  xpPerUnit: number
  softCapUnits: number | null
  sanityCeilingUnits: number | null
  minUnitsForCredit: number
  groundMultipliers: Multipliers | null
  /** D-120 discovery credit, scored per CELL rather than per km of ground. */
  unitMultipliers?: Multipliers | null
  feeds: RuleFeed[]
  exercises?: RuleExercise[]
}

/** D-130. One curve for every skill — D-131 explicitly rejected per-skill constants. */
export interface RuleCurve {
  stepFormula: string
  maxLevel: number
  deepMaxLevel: number
}

export interface RuleSet {
  version: number
  effectiveFrom: string
  curve: RuleCurve
  skills: RuleSkill[]
}

/* ── Closed vocabularies, as runtime values ─────────────────────────────────────────────
 *
 * The domain is TYPES ONLY by design (0025), so a validator that must check a value at
 * runtime needs the members as data. They live here rather than in `src/domain/` so that
 * property is not disturbed — and the compile-time assertions below bind them to the
 * domain's unions, so the two cannot drift silently.
 */

export const ACTIVITY_KINDS = ["run", "walk", "hike", "ride", "strength", "other"] as const
export const LOG_MODES = ["trace", "reps", "duration", "derived"] as const
export const FIXED_MEASURES = ["distanceKm", "cells", "share"] as const
export const MEASURE_PREFIXES = ["reps:", "seconds:"] as const

// These four are bound to the domain's unions by compile-time assertions in
// `schema.types.test.ts` — kept there, not here, because such an assertion's only consumer
// is `tsc` and ESLint reads it as an unused binding. `eslint.config.mjs` grants the
// `_`-prefixed exemption to `*.types.test.ts` only, and widening it would reopen D-164.
