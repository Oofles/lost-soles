import type { DiscoveryAward } from "@/src/domain/discovery"
import type { RuleSkill } from "@/src/rules/schema"

import type { GroundSplit } from "./ground"
import { scoreGround } from "./ground"
import type { XpLedgerEntry } from "./ledger"
import { scoreWithPropagation } from "./propagate"
import { scoreUnits, type ScorableActivity } from "./units"

/**
 * ONE ACTIVITY'S WHOLE AWARD — the `0060 → 0061 → 0062 → 0064` chain as one call.
 *
 * Shared by ingest (`process-activity.ts`) and the XP replay (`0066`) so a rebalance scores an
 * activity exactly the way ingest would have under the same rules. Two copies of this chain
 * would drift the first time either was edited, and the replay would then disagree with ingest
 * on a v1 → v1 run — which is precisely the "unchanged ruleset is a no-op" check.
 */
export function scoreActivity(
  activity: ScorableActivity & { activityId: string; userId: string; startedAt: string },
  registry: { version: number; skills: RuleSkill[] },
  split: GroundSplit | null,
  award: Pick<DiscoveryAward, "newCellCount" | "rearmedCellCount">,
  awardedAt: string,
): XpLedgerEntry[] {
  return scoreWithPropagation(scoreGround(scoreUnits(activity, registry), registry, split), award, {
    activity,
    rules: registry,
    awardedAt,
  })
}
