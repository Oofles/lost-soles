import { scoredRows, type ActivityLedgerRow } from "@/lib/runs/ledger"
import type { RuleSet } from "@/src/rules/schema"
import { levelForXp, levelProgress, totalLevel, totalXp } from "@/src/scoring/levels"

/**
 * BEAT 2'S NUMBERS. Ticket `0081`. `06-ui-ux.md` §3.2 beat 2, §3.5's two tally rules.
 *
 * Everything the tally displays, computed once from three inputs and nothing else: this run's
 * `XpLedgerEntry` rows, where each skill stood before the run (`xpBeforeRun`, D-296), and the
 * ruleset for names, units and the curve. It READS; it never scores. Pure, so the animated tally and
 * the still end state show the same numbers by construction — the clock (`beat2.ts`) only decides
 * how much of each one is showing.
 *
 * No skill id is named here (D-031). The "km never run before" line is found by DATA: the
 * `new_ground` row of any skill whose unit is `km`.
 */

export interface TallyPart {
  reason: string
  xp: number
}

export interface TallyLine {
  skillId: string
  /** This run's XP for the skill. Never 0: a zero is omitted, not shown (§3.5). */
  xp: number
  /** The reason breakdown, XP descending — the full truth, behind a click. */
  parts: TallyPart[]
  /** `null` when "before" could not be read: the row still shows its `+xp`, without a bar. */
  standing: {
    levelAfter: number
    levelUp: boolean
    /** XP still needed after the run for `levelAfter + 1`. 0 at the cap. */
    xpToNext: number
    /** The bar's fill before the run, `0..1` within the level it started in. */
    barFrom: number
    /** Where the fill stops. `1` when the run crossed a level: it fills, holds, and never wraps. */
    barTo: number
  } | null
}

export interface Tally {
  lines: TallyLine[]
  /** Σ `lines[].xp` — `SUM(ledger)` for the activity (I-15's per-run half). */
  runXp: number
  /** Kilometres of new ground, or `null` when the run had none (never a zero). */
  newKm: number | null
  /** Total XP `old → new`, over enabled skills; `null` without "before". */
  total: { before: number; after: number } | null
  /** D-145: Σ level over every enabled skill, after the run. `null` without "before". */
  totalLevel: number | null
}

export function tallyFor(
  rows: readonly ActivityLedgerRow[],
  xpBefore: Readonly<Record<string, number>> | null,
  rules: Pick<RuleSet, "curve" | "skills">,
): Tally {
  const scored = scoredRows(rows)

  const bySkill = new Map<string, TallyPart[]>()
  for (const r of scored) {
    const parts = bySkill.get(r.skillId) ?? []
    const same = parts.find((p) => p.reason === r.reason)
    if (same) same.xp += r.xpAwarded
    else parts.push({ reason: r.reason, xp: r.xpAwarded })
    bySkill.set(r.skillId, parts)
  }

  const before = new Map(Object.entries(xpBefore ?? {}))
  const after = new Map(before)
  const lines: TallyLine[] = []
  for (const [skillId, parts] of bySkill) {
    const xp = parts.reduce((s, p) => s + p.xp, 0)
    if (xp <= 0) continue
    parts.sort((a, b) => b.xp - a.xp || (a.reason < b.reason ? -1 : 1))
    const was = before.get(skillId) ?? 0
    after.set(skillId, was + xp)
    lines.push({ skillId, xp, parts, standing: xpBefore ? standing(was, was + xp, rules.curve) : null })
  }
  // By XP gained, descending (§3.5) — not registry order. Ties by id, so the order is stable.
  lines.sort((a, b) => b.xp - a.xp || (a.skillId < b.skillId ? -1 : 1))

  const kmSkills = new Set(rules.skills.filter((s) => s.unit === "km").map((s) => s.id))
  const km = Math.max(0, ...scored.filter((r) => r.reason === "new_ground" && kmSkills.has(r.skillId)).map((r) => r.units ?? 0))

  return {
    lines,
    runXp: lines.reduce((s, l) => s + l.xp, 0),
    newKm: km > 0 ? km : null,
    total: xpBefore ? { before: totalXp(before, rules.skills), after: totalXp(after, rules.skills) } : null,
    totalLevel: xpBefore ? totalLevel(after, rules.skills, rules.curve) : null,
  }
}

function standing(was: number, now: number, curve: RuleSet["curve"]): NonNullable<TallyLine["standing"]> {
  const from = levelProgress(was, curve)
  const to = levelProgress(now, curve)
  const levelUp = levelForXp(now, curve) > levelForXp(was, curve)
  return {
    levelAfter: to.level,
    levelUp,
    xpToNext: to.xpToNext,
    barFrom: from.fraction,
    barTo: levelUp ? 1 : to.fraction,
  }
}

/** `3.18 km` — two decimals, as §3.2's line has it. */
export function kmText(km: number): string {
  return `${km.toFixed(2)} km`
}
