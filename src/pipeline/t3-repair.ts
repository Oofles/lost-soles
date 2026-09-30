import type { DiscoveryAward } from "@/src/domain/discovery"
import { foldActivities } from "@/src/domain/fold"
import { matchable, revealsGround } from "@/src/rules/reveals-ground"
import type { RuleSet } from "@/src/rules/schema"
import type { XpLedgerEntry } from "@/src/scoring"

import { REPLAY_ACTIVITY_ID, type ActivityScoreWrite, type ReplayActivity, type ReplayStore } from "./xp-replay"

/**
 * DOES T3 AGREE WITH THE LEDGER — AND, WHEN IT DOES NOT, THE ONE-OFF REPAIR. Ticket `0226`, D-261.
 *
 * T3 carries two denormalised copies of what T4 and the fold decide: the score (`xpAwarded`,
 * `xpRulesVersion`, `0062`) and the discovery award (`0048`, `05` §3.2). Both drift silently —
 * rows written before the columns existed, `0220`'s reingest overwrite, and every replay before
 * `0224`/`0226` taught step 3 to write them back. Nothing user-visible reads them until
 * capability 12, which is exactly why the check is kept as a tool rather than trusted.
 *
 * THE REPAIR IS THE REPLAY'S STEP 3 WITHOUT THE REPLAY. Same fold over `cells.bin`, same
 * ground-scored rule, same `writeActivityScores` — but no ledger rewrite, no floors, no
 * `ReplayRun`, no generation bump. A repair is not a rebalance, and a `ReplayRun` row is a
 * chronicle entry (D-258).
 *
 * The score comes from the LEDGER as it stands, not from rescoring: T4 is the record, and T3 is
 * made to say what T4 says.
 */

/** T3's score and award columns, as `listActivities` returns them. Absent on pre-`0048`/`0062` rows. */
type StoredScores = Partial<{
  xpAwarded: number
  xpRulesVersion: number | null
  cellCount: number
  newCellCount: number
  rearmedCellCount: number
  cooledCellCount: number
  deferredCellCount: number
  fogAlgoVersion: number
}>

const scoresOf = (a: ReplayActivity) => a as ReplayActivity & StoredScores

/** Activity rows only: floors (`__floor__`) and ReplayRuns are not any activity's. */
function activityRows(ledger: readonly XpLedgerEntry[]): XpLedgerEntry[] {
  return ledger.filter((e) => !e.isFloor && e.activityId !== REPLAY_ACTIVITY_ID)
}

export interface T3Mismatch {
  activityId: string
  startedAt: string
  field: "xpAwarded" | "newCellCount" | "rearmedCellCount"
  t3: number
  ledger: number
}

/**
 * The discovery rows' reasons, and the T3 count each one's `units` carries (`discoveryRows`,
 * `src/scoring/propagate.ts`). Matched by REASON, not by skill: which skill earns discovery is a
 * registry row (D-031), and every discovery skill's row carries the same raw count.
 */
const COUNT_OF_REASON = { cells_new: "newCellCount", cells_rearmed: "rearmedCellCount" } as const

/**
 * THE CHECK. Per activity: `xpAwarded` against the SUM of its ledger rows, and T3's
 * `newCellCount`/`rearmedCellCount` against the `units` on its `cells_new`/`cells_rearmed` rows
 * (no row: 0). Pure over what the store returned, so the CLI runs it before and after a repair
 * against the same reads.
 */
export function auditT3(activities: readonly ReplayActivity[], ledger: readonly XpLedgerEntry[]): T3Mismatch[] {
  const xp = new Map<string, number>()
  const counts = new Map<string, Record<(typeof COUNT_OF_REASON)[keyof typeof COUNT_OF_REASON], number>>()
  for (const e of activityRows(ledger)) {
    xp.set(e.activityId, (xp.get(e.activityId) ?? 0) + e.xpAwarded)
    const count = COUNT_OF_REASON[e.reason as keyof typeof COUNT_OF_REASON]
    if (count === undefined) continue
    const c = counts.get(e.activityId) ?? { newCellCount: 0, rearmedCellCount: 0 }
    c[count] = Math.max(c[count], e.units)
    counts.set(e.activityId, c)
  }
  const out: T3Mismatch[] = []
  for (const a of [...activities].sort((x, y) => (x.startedAt < y.startedAt ? -1 : 1))) {
    const t3 = scoresOf(a)
    const base = { activityId: a.activityId, startedAt: a.startedAt }
    const want = { xpAwarded: xp.get(a.activityId) ?? 0, ...(counts.get(a.activityId) ?? { newCellCount: 0, rearmedCellCount: 0 }) }
    for (const field of ["xpAwarded", "newCellCount", "rearmedCellCount"] as const) {
      const stored = t3[field] ?? 0
      if (stored !== want[field]) out.push({ ...base, field, t3: stored, ledger: want[field] })
    }
  }
  return out
}

export interface T3Repair {
  /** Only the ACTIVE rows whose stored columns differ from what they should say. */
  writes: ActivityScoreWrite[]
  /** The ruleset `revealsGround` was asked under: the newest version the ledger cites. */
  rulesVersion: number
}

/**
 * THE PLAN. What each ACTIVE row should say, and which of them do not say it yet.
 *
 * - `xpAwarded` is the SUM of the activity's ledger rows; `xpRulesVersion` the version they cite,
 *   `null` when there are none (ingest's `LedgerCommit` rule, `0224`).
 * - The award is the fold's (D-261), for an activity with cells of a ground-revealing kind — the
 *   same `groundScored` test replay step 3 applies. Anything else keeps the award ingest wrote.
 *
 * Tombstoned rows are never planned: they keep what they were awarded (D-258), and the store's
 * condition would refuse them anyway. They are still FOLDED — their cells stay revealed (D-020).
 */
export async function planT3Repair(
  userId: string,
  deps: {
    store: Pick<ReplayStore, "listActivities" | "readRunCells" | "listLedger">
    rules(version: number): RuleSet
  },
): Promise<T3Repair & { activities: ReplayActivity[]; ledger: XpLedgerEntry[] }> {
  const { store } = deps
  const activities = await store.listActivities(userId)
  const ledger = await store.listLedger(userId)
  const rows = activityRows(ledger)
  const rulesVersion = rows.reduce((v, e) => Math.max(v, e.xpRulesVersion), 1)
  const rules = deps.rules(rulesVersion)

  const cells = new Map(
    await Promise.all(activities.map(async (a) => [a.activityId, (await store.readRunCells(userId, a.activityId)) ?? []] as const)),
  )
  const fold = foldActivities(activities.map((a) => ({ activityId: a.activityId, startedAt: a.startedAt, cells: cells.get(a.activityId)! })))

  const byActivity = new Map<string, XpLedgerEntry[]>()
  for (const e of rows) byActivity.set(e.activityId, [...(byActivity.get(e.activityId) ?? []), e])

  const writes: ActivityScoreWrite[] = []
  for (const a of activities) {
    if (a.status !== "ACTIVE") continue
    const own = byActivity.get(a.activityId) ?? []
    const groundScored = cells.get(a.activityId)!.length > 0 && revealsGround(matchable(a), rules)
    const w: ActivityScoreWrite = {
      activityId: a.activityId,
      xpAwarded: own.reduce((s, e) => s + e.xpAwarded, 0),
      xpRulesVersion: own.length > 0 ? Math.max(...own.map((e) => e.xpRulesVersion)) : null,
      ...(groundScored ? { award: fold.awards.get(a.activityId)! } : {}),
    }
    if (drifted(scoresOf(a), w)) writes.push(w)
  }
  return { writes, rulesVersion, activities, ledger }
}

function drifted(t3: StoredScores, w: ActivityScoreWrite): boolean {
  if (t3.xpAwarded !== w.xpAwarded || (t3.xpRulesVersion ?? null) !== w.xpRulesVersion) return true
  if (!w.award) return false
  const a: DiscoveryAward = w.award
  return (
    t3.cellCount !== a.cellCount ||
    t3.newCellCount !== a.newCellCount ||
    t3.rearmedCellCount !== a.rearmedCellCount ||
    t3.cooledCellCount !== a.cooledCellCount ||
    t3.deferredCellCount !== a.deferredCellCount ||
    t3.fogAlgoVersion !== a.algoVersion
  )
}
