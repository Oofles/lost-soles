import type { DrillStore, ObjectMeta } from "../../../src/pipeline/rebuild-drill-back"
import type { XpLedgerEntry } from "../../../src/scoring"
import type { ActivityScoreWrite, SkillStateWrite } from "../../../src/pipeline/xp-replay"

/**
 * THE CI DRILL'S TARGET: a `DrillStore` held in memory. Ticket `0104`; D-406 (the target is a
 * parameter), D-408 (every create is conditioned on absence).
 *
 * `runDrillBackHalf` is written against the narrow `DrillStore` seam precisely so that the same
 * steps 4–8 run against a real parallel stack (`dynamoDrillStore`, `npm run drill`) and against
 * this (`npm run drill:ci`). Nothing here is drill logic — it is the storage the logic writes to.
 *
 * Creates refuse a key that already exists, exactly as the DynamoDB and S3 conditions do, so a
 * harness bug that wrote twice would fail here as it would against AWS rather than overwrite.
 * The read-backs (`getObject`, `readSkillStates`, `readLedger`) return what was STORED, so step 5's
 * fold-from-the-files and step 8's checks 4 and 5 read the facts back rather than trusting memory.
 */

type Item = Record<string, unknown>

export class MemoryDrillStore implements DrillStore {
  readonly objects = new Map<string, { body: Uint8Array; meta: ObjectMeta }>()
  readonly activities = new Map<string, Item>()
  readonly cellItems = new Map<string, Item>()
  readonly ledger = new Map<string, XpLedgerEntry>()
  readonly skillStates = new Map<string, SkillStateWrite>()
  profile: Item | undefined
  generation: number | undefined
  mirroredGeneration: number | undefined

  async putObject(key: string, body: Uint8Array, meta: ObjectMeta): Promise<void> {
    if (this.objects.has(key)) throw new Error(`PreconditionFailed: ${key} already exists in the target`)
    this.objects.set(key, { body: Uint8Array.from(body), meta })
  }

  async getObject(key: string): Promise<Uint8Array | undefined> {
    return this.objects.get(key)?.body
  }

  async putActivity(item: Item): Promise<void> {
    const id = String(item.id)
    if (this.activities.has(id)) throw new Error(`ConditionalCheckFailed: activity ${id} already exists`)
    this.activities.set(id, { ...item })
  }

  async putCellItems(items: readonly Item[]): Promise<void> {
    for (const item of items) {
      const key = `${String(item.pk)}|${String(item.sk)}`
      if (this.cellItems.has(key)) throw new Error(`ConditionalCheckFailed: cell item ${key} already exists`)
      this.cellItems.set(key, { ...item })
    }
  }

  async putLedger(entries: readonly XpLedgerEntry[]): Promise<void> {
    for (const e of entries) {
      if (this.ledger.has(e.id)) throw new Error(`ConditionalCheckFailed: ledger row ${e.id} already exists`)
      this.ledger.set(e.id, { ...e })
    }
  }

  async writeActivityScores(rows: readonly ActivityScoreWrite[]): Promise<void> {
    for (const w of rows) {
      const item = this.activities.get(w.activityId)
      if (!item) throw new Error(`ConditionalCheckFailed: no activity ${w.activityId} to score`)
      Object.assign(item, { xpAwarded: w.xpAwarded, xpRulesVersion: w.xpRulesVersion, ...(w.award ? { award: w.award } : {}) })
    }
  }

  async writeSkillStates(_userId: string, rows: readonly SkillStateWrite[]): Promise<void> {
    for (const w of rows) this.skillStates.set(w.skillId, { ...w })
  }

  async putProfile(userId: string, totals: { totalXp: number; totalLevel: number; ledgerRulesVersion: number }): Promise<void> {
    if (this.profile) throw new Error(`ConditionalCheckFailed: profile ${userId} already exists`)
    this.profile = { id: userId, ...totals }
  }

  async raiseGeneration(_userId: string, generation: number): Promise<boolean> {
    if (this.generation !== undefined) return false
    this.generation = generation
    return true
  }

  async mirrorGeneration(_userId: string, generation: number): Promise<void> {
    if (!this.profile) throw new Error("ConditionalCheckFailed: no profile to mirror the generation onto")
    if (this.mirroredGeneration !== undefined && this.mirroredGeneration >= generation) {
      throw new Error("ConditionalCheckFailed: exploredGeneration would not advance")
    }
    this.mirroredGeneration = generation
  }

  async readSkillStates(_userId: string, skillIds: readonly string[]) {
    return skillIds.flatMap((skillId) => {
      const w = this.skillStates.get(skillId)
      // `xp` is both columns by construction (I-15); `skillStateThawItem` writes it to both.
      return w ? [{ skillId, displayedXp: w.xp, xpLedgerSum: w.xp }] : []
    })
  }

  async readLedger(ids: readonly string[]) {
    return ids.flatMap((id) => {
      const e = this.ledger.get(id)
      return e ? [{ id, skillId: e.skillId, xpAwarded: e.xpAwarded }] : []
    })
  }
}
