/**
 * The scoring module (capability `09`). Everything the scorer exposes is exported from here.
 *
 * `selectActivitySkills` is RE-EXPORTED, not reimplemented: it was built in `0029`, alongside
 * the seed-time checks that call it, and a second copy would let selection drift between the
 * validator and the scorer. Ticket 0060.
 */

export { selectActivitySkills, type MatchableActivity } from "@/src/rules/select-activity-skills"
export { measureUnits, scoreUnits, type ScorableActivity, type SkillUnits } from "./units"
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
