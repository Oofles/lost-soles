/**
 * The scoring module (capability `09`). Everything the scorer exposes is exported from here.
 *
 * `selectActivitySkills` is RE-EXPORTED, not reimplemented: it was built in `0029`, alongside
 * the seed-time checks that call it, and a second copy would let selection drift between the
 * validator and the scorer. Ticket 0060.
 */

export { selectActivitySkills, type MatchableActivity } from "@/src/rules/select-activity-skills"
export {
  measureUnits,
  scoreUnits,
  SET_FIELDS,
  setFieldOf,
  type ScorableActivity,
  type SetField,
  type SkillUnits,
} from "./units"
export { softCap } from "./soft-cap"
export {
  groundSplit,
  lookupFromClassified,
  rateGround,
  scoreGround,
  type Ground,
  type GroundedUnits,
  type GroundLookup,
  type GroundReason,
  type GroundSplit,
} from "./ground"
export {
  FLOOR_ACTIVITY_ID,
  LEDGER_REASONS,
  ledgerEntries,
  ledgerId,
  ledgerSeq,
  RESERVED_REASONS,
  sumXp,
  xpBySkill,
  type LedgerReason,
  type ReservedReason,
  type UnratedRow,
  type XpLedgerEntry,
} from "./ledger"
export { creditedCounts, discoveryCredits, discoveryRows, feedRows, ledgerAward, scoreWithPropagation } from "./propagate"
export {
  cumulativeXp,
  levelForXp,
  levelProgress,
  stepCoefficient,
  TOTAL_LEVEL_MILESTONES,
  totalLevel,
  totalLevelCeiling,
  totalLevelRung,
  totalXp,
  xpToAdvance,
  type LevelProgress,
  type Rung,
} from "./levels"
export {
  FLOOR_SEQ_PREFIX,
  floorId,
  ratchetLevel,
  reconcile,
  waterlineOf,
  type ReconcileInput,
  type ShownState,
  type Waterline,
  type WaterlineMark,
} from "./reconcile"
export { scoreActivity } from "./score-activity"
export {
  celebrableLevelUps,
  celebrableMilestones,
  totalLevelDelta,
  type CelebrationRegistry,
  type LevelSnapshot,
  type LevelUp,
} from "./celebrate"
