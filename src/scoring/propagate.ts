/**
 * META-SKILL PROPAGATION. Ticket 0064. `02-data-model.md` §3.1 (J4) and §3.4, `04` §1.1,
 * §8.2 steps 8–9, D-120.
 *
 * Meta skills are never selected by the matcher. They arrive by two routes, both data:
 *
 * - **Discovery credit** — a meta row with `unitMultipliers` is scored per CELL from the fog
 *   subsystem's `DiscoveryAward` (`05` §8.2). New and re-armed cells each become one row.
 *   Recent ("cooled") and deferred cells have no ledger reason at all: they emit NO ROW, not a
 *   row of zero. That is asymmetric with activity XP, which pays half on recent ground, and the
 *   asymmetry is deliberate (0061) — do not "tidy" it into one multiplier.
 * - **Feeds** — every rated activity row whose skill carries `feeds` contributes
 *   `xpAwarded × rate` to each target. The rate is the FEEDER row's attribute; this file holds
 *   no share constant.
 *
 * ─── ONE SHARE ROW PER TARGET PER ACTIVITY (D-255) ─────────────────────────
 *
 * A strength session training two skills feeds Constitution from both, into ONE
 * `constitution_share` row: `round(Σ feederXp × rate)`. The ledger id is
 * `activityId#skillId#reason#v` (0062), so two share rows for one activity would collide on
 * it — and `04` §8.3 and `02` §4.2 already describe a single row.
 *
 * ─── ONE LEVEL DEEP, NOT RECURSIVE ─────────────────────────────────────────
 *
 * Shares are computed from ACTIVITY rows only, and the targets' own `feeds` are never read.
 * There is no loop here that could follow a chain. A meta row with `feeds` is refused at seed
 * time (`META_FEEDS`, `validate.ts`), which is what makes that safe rather than lucky.
 *
 * ─── POST-MULTIPLIER, POST-ROUNDING ────────────────────────────────────────
 *
 * The share is taken from `xpAwarded` — after the ground multipliers and after I-19's single
 * rounding — so a half-XP re-run feeds half the Constitution, and the share agrees with the
 * activity rows the tally itemises.
 *
 * No skill id appears in this file (I-25, D-031). Pure: no clock, no store.
 */

import { CREDIT_NEW, CREDIT_REARM, type DiscoveryAward } from "@/src/domain/discovery"
import type { RuleSkill } from "@/src/rules/schema"

import { ledgerEntries, type LedgerReason, type UnratedRow, type XpLedgerEntry } from "./ledger"

type PropagationSkill = Pick<RuleSkill, "id" | "kind" | "enabled" | "xpPerUnit" | "unitMultipliers" | "feeds">

/** The two cell classes that can earn discovery credit, and the reason each is written as. */
const CELL_REASONS: readonly { count: "newCellCount" | "rearmedCellCount"; ground: "new" | "rearmed"; reason: LedgerReason }[] = [
  { count: "newCellCount", ground: "new", reason: "cells_new" },
  { count: "rearmedCellCount", ground: "rearmed", reason: "cells_rearmed" },
]

/**
 * Discovery-credit rows. One per (discovery skill, earning class) with a non-zero count and a
 * non-zero multiplier. `units` is the raw cell count; `unitsEffective` carries the multiplier,
 * and `ledgerEntries` applies `xpPerUnit` — so every number here is read off the row.
 */
export function discoveryRows(
  award: Pick<DiscoveryAward, "newCellCount" | "rearmedCellCount">,
  skills: readonly PropagationSkill[],
): UnratedRow[] {
  const out: UnratedRow[] = []
  for (const skill of skills) {
    const mult = skill.unitMultipliers
    if (!skill.enabled || !mult) continue
    for (const { count, ground, reason } of CELL_REASONS) {
      const units = award[count]
      if (units <= 0 || mult[ground] <= 0) continue
      out.push({ skillId: skill.id, reason, units, unitsEffective: units * mult[ground] })
    }
  }
  return out
}

/**
 * THE INVERSE OF `discoveryRows`: the cell counts an activity's ledger rows credited. `0233`.
 * Every discovery skill's row carries the same raw count, so it is read by REASON, never by
 * skill (D-031); no row is 0.
 */
export function creditedCounts(entries: readonly Pick<XpLedgerEntry, "reason" | "units">[]): Record<"newCellCount" | "rearmedCellCount", number> {
  const out = { newCellCount: 0, rearmedCellCount: 0 }
  for (const e of entries) {
    const hit = CELL_REASONS.find((c) => c.reason === e.reason)
    if (hit) out[hit.count] = Math.max(out[hit.count], e.units)
  }
  return out
}

/**
 * THE AWARD T3 RECORDS FOR AN ACTIVITY THE LEDGER ALREADY SCORED, when T3 holds no award to keep
 * (a row written before `0048`'s columns, re-ingested by `--adopt`). `0233`, D-271.
 *
 * T3 says what T4 says: new and rearmed are what the rows credited. Of the rest, this delivery's
 * cooled cells stay cooled and everything else is DEFERRED — ground this run covered and was never
 * credited for, which only a replay settles (`05` §3.4). Taking the fresh classification instead
 * is how a 2025 run came to claim 2 new cells its ledger never paid for.
 */
export function ledgerAward(fresh: DiscoveryAward, entries: readonly Pick<XpLedgerEntry, "reason" | "units">[]): DiscoveryAward {
  const credited = creditedCounts(entries)
  const newCellCount = Math.min(credited.newCellCount, fresh.cellCount)
  const rearmedCellCount = Math.min(credited.rearmedCellCount, fresh.cellCount - newCellCount)
  const rest = fresh.cellCount - newCellCount - rearmedCellCount
  const cooledCellCount = Math.min(fresh.cooledCellCount, rest)
  return {
    ...fresh,
    newCellCount,
    rearmedCellCount,
    cooledCellCount,
    deferredCellCount: rest - cooledCellCount,
    discoveryCredits: newCellCount * CREDIT_NEW + rearmedCellCount * CREDIT_REARM,
  }
}

/**
 * Feed rows, from RATED activity rows. `units` is the feeder XP that fed the target; the
 * target's `xpPerUnit` then applies to `unitsEffective` (1 for Constitution — the share arrives
 * pre-computed).
 */
export function feedRows(
  rated: readonly Pick<XpLedgerEntry, "skillId" | "xpAwarded">[],
  skills: readonly PropagationSkill[],
): UnratedRow[] {
  const byId = new Map(skills.map((s) => [s.id, s] as const))
  const acc = new Map<string, { units: number; unitsEffective: number }>()

  for (const row of rated) {
    const feeder = byId.get(row.skillId)
    if (!feeder || feeder.kind !== "activity") continue
    for (const { skill: target, rate } of feeder.feeds) {
      if (!byId.get(target)?.enabled) continue
      const a = acc.get(target) ?? { units: 0, unitsEffective: 0 }
      a.units += row.xpAwarded
      a.unitsEffective += row.xpAwarded * rate
      acc.set(target, a)
    }
  }

  return [...acc].map(([skillId, a]) => ({ skillId, reason: "constitution_share", ...a }))
}

/**
 * THE WHOLE AWARD for one activity: its activity rows, then discovery credit, then shares —
 * `04` §8.2's row order. Activity rows are rated first so the shares see post-rounding XP;
 * then everything is rated in one `ledgerEntries` call so `seq` numbers the full set.
 */
export function scoreWithPropagation(
  activityRows: readonly UnratedRow[],
  award: Pick<DiscoveryAward, "newCellCount" | "rearmedCellCount">,
  ctx: Parameters<typeof ledgerEntries>[1] & {
    rules: { version: number; skills: readonly PropagationSkill[] }
  },
): XpLedgerEntry[] {
  const rated = ledgerEntries(activityRows, ctx)
  const meta = [...discoveryRows(award, ctx.rules.skills), ...feedRows(rated, ctx.rules.skills)]
  return ledgerEntries([...activityRows, ...meta], ctx)
}
