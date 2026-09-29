/**
 * THE XP LEDGER ROW (T4). Ticket 0062. `02-data-model.md` §4.1–4.2, D-142, I-15, I-19.
 *
 * Every award is a row, and `SkillState.displayedXp` is a pure SUM of those rows and nothing
 * else (I-15). This module turns the scorer's `{skillId, reason, units, unitsEffective}` into
 * rows. It is PURE: no clock, no store. The DynamoDB half is `src/pipeline/xp-ledger.ts`.
 *
 * ─── ROUNDING HAPPENS HERE, ONCE ────────────────────────────────────────────
 *
 * `units` and `unitsEffective` stay floats all the way from `0060`/`0061`. `xpAwarded` is
 * `Math.round(unitsEffective × xpPerUnit)`, computed once per row at write time (I-19). If it
 * were rounded at read time, two screens summing the same rows in different orders could
 * disagree about the same total.
 *
 * ─── NO SKILL ID IS NAMED IN THIS FILE ──────────────────────────────────────
 *
 * `xpPerUnit` is read from the row passed in, and the `id` is a template over opaque strings.
 * Adding a skill is a data row (D-031/D-141).
 */

import type { RuleSkill } from "@/src/rules/schema"

/**
 * `02` §4.2, CLOSED. Every reason a row may carry in MVP. The order is the table's.
 *
 * `cells_*` and `constitution_share` are emitted by `0064`, and `retained_floor` only by the
 * replay job (`0066`). `replay_run` is not XP at all: it marks the `ReplayRun` audit row (§4.5),
 * which lives in T4's table with `xpAwarded: 0` and needs a reason like every other item (D-258). They are declared here because a ledger that cannot express a row cannot
 * accept it later without a migration (ticket Notes).
 */
export const LEDGER_REASONS = [
  "new_ground",
  "rearmed_ground",
  "recent_ground",
  "distance",
  "reps",
  "duration",
  "cells_new",
  "cells_rearmed",
  "constitution_share",
  "retained_floor",
  "replay_run",
] as const

/**
 * Reserved for post-MVP combat (D-122). NOT members of `LedgerReason`, so no MVP code path can
 * write one. They are listed so a future ruleset cannot reuse the names for something else.
 */
export const RESERVED_REASONS = ["slayer_win", "slayer_loss", "boss_phase"] as const

export type LedgerReason = (typeof LEDGER_REASONS)[number]
export type ReservedReason = (typeof RESERVED_REASONS)[number]

/** §4.1: `activityId` of a D-135 floor row, which belongs to no activity. */
export const FLOOR_ACTIVITY_ID = "__floor__"

/** T4, as stored. Field names are `02` §4.1's. */
export interface XpLedgerEntry {
  /** `${activityId}#${skillId}#${reason}#v${xpRulesVersion}` — see `ledgerId`. */
  id: string
  userId: string
  /** GSI1 partition. `FLOOR_ACTIVITY_ID` on floor rows. */
  activityId: string
  /** Opaque. Never an enum (D-031). */
  skillId: string
  reason: LedgerReason
  /** Raw measured work, e.g. km. */
  units: number
  /** After the D-120 ground split. */
  unitsEffective: number
  /** INTEGER. Rounded once, here (I-19). */
  xpAwarded: number
  /** Non-null by construction: it is part of `id`. */
  xpRulesVersion: number
  /** The D-135 marker. `false` on every rule-derived row. */
  isFloor: boolean
  /** Floor rows only (§4.6): the ruleset whose displayed total this row retains. */
  supersedesRulesVersion?: number
  /** `<startedAt>#<activityId>#<nn>` — replay order (04 §7.4). */
  seq: string
  /** Ingest wall clock. AUDIT ONLY, never a scoring input. */
  awardedAt: string
}

/** A row before it is rated: what `scoreGround` (and later `0064`) emits. */
export interface UnratedRow {
  skillId: string
  reason: LedgerReason
  units: number
  unitsEffective: number
}

/**
 * THE DETERMINISTIC ID (§4.1). With `attribute_not_exists(id)` on the put, a duplicate write is
 * a no-op. `xpRulesVersion` is inside the key, so a row cannot exist without one (I-19).
 */
export function ledgerId(parts: {
  activityId: string
  skillId: string
  reason: LedgerReason
  xpRulesVersion: number
}): string {
  assertRulesVersion(parts.xpRulesVersion)
  return `${parts.activityId}#${parts.skillId}#${parts.reason}#v${parts.xpRulesVersion}`
}

/**
 * `<startedAt>#<activityId>#<nn>` (§4.1). `startedAt` is ISO 8601 UTC, so the string sorts in
 * time order. `nn` is two digits: an activity emits about five rows, and 100 would be a bug.
 */
export function ledgerSeq(startedAt: string, activityId: string, nn: number): string {
  if (!Number.isInteger(nn) || nn < 0 || nn > 99) throw new Error(`ledgerSeq: nn ${nn} out of 0..99`)
  return `${startedAt}#${activityId}#${String(nn).padStart(2, "0")}`
}

function assertRulesVersion(v: number): void {
  if (!Number.isInteger(v) || v < 1) {
    throw new Error(`xpRulesVersion must be a positive integer, got ${v} (I-19)`)
  }
}

/**
 * THE RATING STEP. One ledger row per incoming row, with `xpAwarded` rounded once.
 *
 * **A row that rounds to 0 XP is DROPPED.** §4.2: a zero-XP row inflates the ledger and says
 * nothing. That is the same rule `0060` applies to zero-unit skills and `0061` to empty ground
 * buckets.
 *
 * Throws on a duplicate `(skillId, reason)`: the id would collide with itself, and the second
 * row's XP would be silently lost by the conditional put.
 */
export function ledgerEntries(
  rows: readonly UnratedRow[],
  ctx: {
    activity: { activityId: string; userId: string; startedAt: string }
    rules: { version: number; skills: readonly Pick<RuleSkill, "id" | "xpPerUnit">[] }
    /** Ingest wall clock, ISO 8601 UTC. Stamped, never read back as an input. */
    awardedAt: string
  },
): XpLedgerEntry[] {
  const { activity, rules, awardedAt } = ctx
  assertRulesVersion(rules.version)
  const rate = new Map(rules.skills.map((s) => [s.id, s.xpPerUnit] as const))

  const out: XpLedgerEntry[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    const xpPerUnit = rate.get(row.skillId)
    if (xpPerUnit === undefined) {
      throw new Error(`ledgerEntries: ${JSON.stringify(row.skillId)} is not in ruleset v${rules.version}`)
    }
    const id = ledgerId({
      activityId: activity.activityId,
      skillId: row.skillId,
      reason: row.reason,
      xpRulesVersion: rules.version,
    })
    if (seen.has(id)) throw new Error(`ledgerEntries: duplicate row ${id}`)
    seen.add(id)

    const xpAwarded = Math.round(row.unitsEffective * xpPerUnit)
    // XP never decreases (D-135). A negative or non-finite award could never be taken back.
    if (!Number.isSafeInteger(xpAwarded) || xpAwarded < 0) {
      throw new Error(`ledgerEntries: ${id} rated to ${xpAwarded} XP — refusing to write it`)
    }
    if (xpAwarded === 0) continue

    out.push({
      id,
      userId: activity.userId,
      activityId: activity.activityId,
      skillId: row.skillId,
      reason: row.reason,
      units: row.units,
      unitsEffective: row.unitsEffective,
      xpAwarded,
      xpRulesVersion: rules.version,
      isFloor: false,
      seq: ledgerSeq(activity.startedAt, activity.activityId, out.length),
      awardedAt,
    })
  }
  return out
}

/** Σ `xpAwarded` per skill. Integer addition, so the order of the rows cannot matter. */
export function xpBySkill(entries: readonly Pick<XpLedgerEntry, "skillId" | "xpAwarded">[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const e of entries) out.set(e.skillId, (out.get(e.skillId) ?? 0) + e.xpAwarded)
  return out
}

/** Σ `xpAwarded`. */
export function sumXp(entries: readonly Pick<XpLedgerEntry, "xpAwarded">[]): number {
  let total = 0
  for (const e of entries) total += e.xpAwarded
  return total
}
