/**
 * WHAT ONE RUN EARNED, PER SKILL. Ticket `0078`. `06-ui-ux.md` §3.2 beat 2, §3.3.
 *
 * The end state's ledger, un-animated. A plain fold over the run's `XpLedgerEntry` rows (`byActivity`,
 * T4 GSI1) — no scoring happens here, and nothing branches on a skill id (D-031): a skill is a
 * key, its name comes from the ruleset.
 *
 * Two of `0081`'s tally rules are applied now because they are true of any rendering of this ledger,
 * animated or not:
 *
 *   - **never a zero** (§3.5): a skill that earned nothing is omitted, not shown at `+0`;
 *   - **ordered by XP gained, descending**, not by registry order.
 *
 * Bars, levels, the reason breakdown and the count-up are `0081`'s.
 */

export interface ActivityLedgerRow {
  skillId: string
  reason: string
  xpAwarded: number
  xpRulesVersion: number
  isFloor: boolean
}

export interface RunLedgerLine {
  skillId: string
  xp: number
}

export interface RunLedger {
  lines: RunLedgerLine[]
  totalXp: number
}

/**
 * ONE RULESET'S ROWS. A replay deletes an activity's non-floor rows and rewrites them under the new
 * version (D-142), so a run normally carries one version. If a replay is caught mid-flight both are
 * present for a moment, and summing them would show the run earning twice: the newest wins.
 * Floor rows are never per-activity (`activityId: "__floor__"`) and are excluded for the same reason.
 */
export function runLedger(rows: readonly ActivityLedgerRow[]): RunLedger {
  const scored = rows.filter((r) => !r.isFloor)
  if (scored.length === 0) return { lines: [], totalXp: 0 }
  const version = Math.max(...scored.map((r) => r.xpRulesVersion))

  const bySkill = new Map<string, number>()
  for (const r of scored) {
    if (r.xpRulesVersion !== version) continue
    bySkill.set(r.skillId, (bySkill.get(r.skillId) ?? 0) + r.xpAwarded)
  }

  const lines = [...bySkill]
    .map(([skillId, xp]) => ({ skillId, xp }))
    .filter((l) => l.xp > 0)
    .sort((a, b) => b.xp - a.xp || (a.skillId < b.skillId ? -1 : 1))
  return { lines, totalXp: lines.reduce((sum, l) => sum + l.xp, 0) }
}
