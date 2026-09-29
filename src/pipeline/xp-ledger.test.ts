import { QueryCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb"
import { describe, expect, it } from "vitest"

import type { Activity } from "@/src/domain/activity"
import { NO_CELLS } from "@/src/domain/discovery"
import { INGEST_RECEIPT_TABLE } from "@/src/pipeline/ingest-receipt"
import {
  BY_ACTIVITY_INDEX,
  isLostLedgerRace,
  ledgerPutItem,
  ledgerTransactItems,
  MAX_LEDGER_ATTEMPTS,
  levelsAfter,
  persistWithLedger,
  profileTotalsItem,
  skillStateUpdateItem,
  type LedgerDeps,
} from "@/src/pipeline/xp-ledger"
import { loadRuleSet } from "@/src/rules/load"
import { cumulativeXp, ledgerEntries, levelForXp, scoreGround, scoreUnits, type UnratedRow } from "@/src/scoring"

/**
 * Ticket 0062. `02-data-model.md` §4.3, I-15.
 *
 * Two halves. The item builders are asserted on the EXPRESSIONS SENT, as `ingest-receipt.test.ts`
 * does. The commit path runs against `Tables` below: a fake that evaluates ONLY the condition
 * and update shapes this path emits, and applies a transaction all-or-nothing. It is not a
 * DynamoDB. Atomicity against the real service is the smoke test in the ticket's `## Operator
 * validation`; what this file proves is that everything that must be atomic is in one
 * transaction, and that the retry and layer-1 logic do what they say.
 */

const RULES = loadRuleSet(1)
const ACTIVITY_TABLE = "Activity-t"
const LEDGER_TABLE = "XpLedgerEntry-t"
const STATE_TABLE = "SkillState-t"
const PROFILE_TABLE = "Profile-t"
const TABLES = { ledgerTable: LEDGER_TABLE, skillStateTable: STATE_TABLE, profileTable: PROFILE_TABLE }

type Item = Record<string, unknown>
type TransactItem = NonNullable<TransactWriteCommand["input"]["TransactItems"]>[number]

const KEY_OF: Record<string, (i: Item) => string> = {
  [ACTIVITY_TABLE]: (i) => String(i.id),
  [LEDGER_TABLE]: (i) => String(i.id),
  [STATE_TABLE]: (i) => `${i.userId}#${i.skillId}`,
  [PROFILE_TABLE]: (i) => String(i.id),
  [INGEST_RECEIPT_TABLE]: (i) => String(i.ingestKey),
}

/** Split on top-level commas, leaving `if_not_exists(a, :b)` whole. */
function clauses(s: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ""
  for (const ch of s) {
    if (ch === "(") depth++
    if (ch === ")") depth--
    if (ch === "," && depth === 0) {
      out.push(cur.trim())
      cur = ""
    } else cur += ch
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

class Tables {
  readonly data = new Map<string, Map<string, Item>>()
  transacts = 0
  /** Rows `byActivity` pretends not to see yet — a stale GSI. */
  hiddenFromGsi = new Set<string>()
  /** Runs before a transaction is evaluated: another writer getting in first. */
  beforeTransact?: (n: number) => void
  /** Forces `ConditionalCheckFailed` on this item index, on every transaction. */
  failItem?: number

  table(name: string): Map<string, Item> {
    if (!this.data.has(name)) this.data.set(name, new Map())
    return this.data.get(name)!
  }

  snapshot(): string {
    return JSON.stringify([...this.data].filter(([, m]) => m.size > 0).map(([t, m]) => [t, [...m].sort()]))
  }

  private name(n: string, names: Record<string, string> | undefined) {
    return n.startsWith("#") ? names![n]! : n
  }

  private holds(cond: string | undefined, item: Item | undefined, tx: TransactItem): boolean {
    if (!cond) return true
    const op = (tx.Put ?? tx.Update)!
    const names = op.ExpressionAttributeNames
    const values = op.ExpressionAttributeValues ?? {}
    const notExists = /^attribute_not_exists\((\S+)\)$/.exec(cond)
    if (notExists) return item?.[this.name(notExists[1]!, names)] === undefined
    const eq = /^(\S+) = (:\w+)$/.exec(cond)
    if (eq) return item !== undefined && item[this.name(eq[1]!, names)] === values[eq[2]!]
    throw new Error(`fake: unsupported condition ${cond}`)
  }

  private applyUpdate(tx: NonNullable<TransactItem["Update"]>, item: Item): Item {
    const next = { ...item }
    const values = tx.ExpressionAttributeValues ?? {}
    const [, setPart = "", addPart = ""] = /^SET (.*?)(?: ADD (.*))?$/.exec(tx.UpdateExpression!)!
    for (const c of clauses(setPart)) {
      const [lhs, rhs] = c.split(" = ") as [string, string]
      const attr = this.name(lhs, tx.ExpressionAttributeNames)
      const ine = /^if_not_exists\((\S+), (:\w+)\)$/.exec(rhs)
      next[attr] = ine ? (next[attr] ?? values[ine[2]!]) : values[rhs]
    }
    for (const c of clauses(addPart)) {
      const [attr, v] = c.split(" ") as [string, string]
      next[attr] = Number(next[attr] ?? 0) + Number(values[v])
    }
    return next
  }

  readonly ddb = {
    send: async (command: TransactWriteCommand | QueryCommand): Promise<unknown> => {
      if (command instanceof QueryCommand) return this.query(command.input)
      this.transacts += 1
      this.beforeTransact?.(this.transacts)
      const txItems = command.input.TransactItems!
      if (txItems.length > 100) throw new Error("fake: TransactWriteItems caps at 100")

      const staged: Array<[string, string, Item]> = []
      const reasons = txItems.map((tx, i) => {
        const op = (tx.Put ?? tx.Update)!
        const table = this.table(op.TableName!)
        const key = tx.Put ? KEY_OF[op.TableName!]!(tx.Put.Item!) : KEY_OF[op.TableName!]!(tx.Update!.Key!)
        const current = table.get(key)
        if (i === this.failItem || !this.holds(op.ConditionExpression, current, tx)) {
          return { Code: "ConditionalCheckFailed" }
        }
        const next = tx.Put
          ? { ...tx.Put.Item }
          : this.applyUpdate(tx.Update!, current ?? { ...tx.Update!.Key })
        staged.push([op.TableName!, key, next])
        return { Code: "None" }
      })
      if (reasons.some((r) => r.Code !== "None")) {
        throw Object.assign(new Error("Transaction cancelled"), {
          name: "TransactionCanceledException",
          CancellationReasons: reasons,
        })
      }
      for (const [t, k, v] of staged) this.table(t).set(k, v)
      return {}
    },
  }

  private query(input: QueryCommand["input"]) {
    const values = input.ExpressionAttributeValues!
    const rows = [...this.table(input.TableName!).values()]
    if (input.IndexName === BY_ACTIVITY_INDEX) {
      return {
        Items: rows.filter(
          (r) =>
            r.activityId === values[":a"] &&
            r.isFloor === values[":f"] &&
            !this.hiddenFromGsi.has(String(r.id)),
        ),
      }
    }
    return { Items: rows.filter((r) => r.userId === values[":u"]) }
  }
}

function world() {
  const t = new Tables()
  const ledger: LedgerDeps = { ddb: t.ddb, ...TABLES }
  const persist = { ddb: t.ddb, activityTable: ACTIVITY_TABLE }
  const claim = (ingestKey: string) =>
    t.table(INGEST_RECEIPT_TABLE).set(ingestKey, { ingestKey, status: "PROCESSING" })
  return { t, deps: { ledger, persist }, claim }
}

function activity(over: Partial<Activity> = {}): Activity {
  return {
    activityId: "a-1",
    userId: "u-1",
    kind: "run",
    hasTrace: true,
    traceRef: null,
    source: { source: "gpslogger", externalId: "1", sourceTypeRaw: "run", fetchedAt: "2026-09-06T09:00:00.000Z" },
    raw: { bucket: "b", key: "k", contentType: "application/json", bytes: 1, sha256: "x", archivedAt: "2026-09-06T09:00:00.000Z" },
    startedAt: "2026-09-06T03:00:00.000Z",
    startedAtLocal: "2026-09-05T21:00:00",
    timezone: "America/Denver",
    elapsedS: 1800,
    movingS: 1800,
    distanceM: 5000,
    elevationGainM: null,
    name: null,
    sets: [],
    dedupeKey: "d",
    ingestedAt: "2026-09-06T09:00:02.000Z",
    revision: 1,
    ...over,
  } as Activity
}

function entriesFor(a: Activity, rows: UnratedRow[]) {
  return ledgerEntries(rows, { activity: a, rules: RULES, awardedAt: a.ingestedAt })
}

const RUN_ROWS: UnratedRow[] = [
  { skillId: "wayfaring", reason: "new_ground", units: 3, unitsEffective: 3 },
  { skillId: "wayfaring", reason: "recent_ground", units: 2, unitsEffective: 1 },
]

const commit = (a: Activity, rows: UnratedRow[], deps: ReturnType<typeof world>["deps"], ingestKey = "k-1") =>
  persistWithLedger(
    { activity: a, ingestKey, entries: entriesFor(a, rows), rulesVersion: 1, skills: RULES.skills, curve: RULES.curve, award: NO_CELLS, rejects: undefined },
    deps,
  )

describe("the items (§4.3)", () => {
  const [entry] = entriesFor(activity(), RUN_ROWS)

  it("a ledger row is a Put conditioned on attribute_not_exists(id)", () => {
    const item = ledgerPutItem(entry!, LEDGER_TABLE)
    expect(item.Put!.ConditionExpression).toBe("attribute_not_exists(id)")
    expect(item.Put!.TableName).toBe(LEDGER_TABLE)
    expect(item.Put!.Item).toMatchObject({
      ...entry,
      __typename: "XpLedgerEntry",
      owner: "u-1::u-1",
      createdAt: entry!.awardedAt,
      skillIdReason: "wayfaring#new_ground",
      userIdSkillId: "u-1#wayfaring",
    })
  })

  it("a first SkillState ADD is conditioned on the row not existing yet", () => {
    const item = skillStateUpdateItem(
      { userId: "u-1", skillId: "wayfaring", xp: 400, prev: undefined, startedAt: "2026-09-06T03:00:00.000Z", ingestedAt: "2026-09-06T09:00:02.000Z", rulesVersion: 1, introducedIn: 1, curve: RULES.curve },
      STATE_TABLE,
    ).Update!
    expect(item.ConditionExpression).toBe("attribute_not_exists(xpLedgerSum)")
    expect(item.UpdateExpression).toMatch(/ADD xpLedgerSum :xp, displayedXp :xp$/)
    expect(item.Key).toEqual({ userId: "u-1", skillId: "wayfaring" })
    expect(item.ExpressionAttributeValues).not.toHaveProperty(":prev")
  })

  it("a later ADD is conditioned on the PRE-READ xpLedgerSum, so a lost race cancels", () => {
    const item = skillStateUpdateItem(
      {
        userId: "u-1",
        skillId: "wayfaring",
        xp: 400,
        prev: { skillId: "wayfaring", xpLedgerSum: 1234, displayedXp: 1234, firstXpAt: "2026-01-01T00:00:00.000Z", lastXpAt: "2026-12-01T00:00:00.000Z" },
        startedAt: "2026-09-06T03:00:00.000Z",
        ingestedAt: "2026-09-06T09:00:02.000Z",
        rulesVersion: 1,
        introducedIn: 1,
        curve: RULES.curve,
      },
      STATE_TABLE,
    ).Update!
    expect(item.ConditionExpression).toBe("xpLedgerSum = :prev")
    expect(item.ExpressionAttributeValues).toMatchObject({
      ":prev": 1234,
      ":xp": 400,
      // A backfilled older run moves neither end outward past what is already there.
      ":first": "2026-01-01T00:00:00.000Z",
      ":last": "2026-12-01T00:00:00.000Z",
    })
  })

  it("firstSeenRulesVersion/firstSeenAt are if_not_exists — set on creation, never moved (D-146)", () => {
    const item = skillStateUpdateItem(
      {
        userId: "u-1",
        skillId: "fixture-late",
        xp: 400,
        prev: { skillId: "fixture-late", xpLedgerSum: 10, displayedXp: 10, firstSeenRulesVersion: 3, firstSeenAt: "2026-01-01T00:00:00.000Z" },
        startedAt: "2026-09-06T03:00:00.000Z",
        ingestedAt: "2026-09-06T09:00:02.000Z",
        rulesVersion: 5,
        introducedIn: 3,
        curve: RULES.curve,
      },
      STATE_TABLE,
    ).Update!
    expect(item.UpdateExpression).toContain("firstSeenRulesVersion = if_not_exists(firstSeenRulesVersion, :intro)")
    expect(item.UpdateExpression).toContain("firstSeenAt = if_not_exists(firstSeenAt, :seen)")
    // The registry row's version, NOT the version scoring it: trained first under v5, seen in v3.
    expect(item.ExpressionAttributeValues).toMatchObject({ ":intro": 3, ":ver": 5, ":seen": "2026-09-06T03:00:00.000Z" })
  })

  const base = { userId: "u-1", skillId: "wayfaring", startedAt: "2026-09-06T03:00:00.000Z", ingestedAt: "2026-09-06T09:00:02.000Z", rulesVersion: 1, introducedIn: 1, curve: RULES.curve }

  it("a first ADD sets level and levelHighWater to what its XP buys (0219)", () => {
    const item = skillStateUpdateItem({ ...base, xp: cumulativeXp(4), prev: undefined }, STATE_TABLE).Update!
    expect(item.UpdateExpression).toContain("#level = :level, levelHighWater = :hw")
    expect(item.ExpressionAttributeNames).toMatchObject({ "#level": "level" })
    expect(item.ExpressionAttributeValues).toMatchObject({ ":level": 4, ":hw": 4 })
  })

  it("level is computed from the pre-read displayedXp plus this activity, not from xpLedgerSum", () => {
    // After a retained floor the two differ; the replay levels on displayedXp, so ingest does too.
    const prev = { skillId: "wayfaring", xpLedgerSum: 10, displayedXp: cumulativeXp(10) }
    const item = skillStateUpdateItem({ ...base, xp: cumulativeXp(11) - cumulativeXp(10), prev }, STATE_TABLE).Update!
    expect(item.ExpressionAttributeValues).toMatchObject({ ":level": 11, ":hw": 11, ":prev": 10 })
  })

  it("a pre-read levelHighWater above the computed level is left where it is (I-17)", () => {
    const prev = { skillId: "wayfaring", xpLedgerSum: cumulativeXp(5), displayedXp: cumulativeXp(5), level: 5, levelHighWater: 9 }
    const item = skillStateUpdateItem({ ...base, xp: 1, prev }, STATE_TABLE).Update!
    expect(item.ExpressionAttributeValues).toMatchObject({ ":level": 5, ":hw": 9 })
    expect(levelsAfter(prev, 1, RULES.curve)).toEqual({ level: 5, levelHighWater: 9 })
  })

  it("the level is clamped at the curve's maxLevel, and so is the high-water it sets", () => {
    const huge = cumulativeXp(RULES.curve.maxLevel + 5)
    expect(levelsAfter(undefined, huge, RULES.curve)).toEqual({ level: RULES.curve.maxLevel, levelHighWater: RULES.curve.maxLevel })
  })

  describe("profileTotalsItem — §4.3's Update Profile line", () => {
    const enabled = RULES.skills.filter((s) => s.enabled)
    const trained = enabled[0]!.id
    const other = enabled[1]!.id
    const disabled = { id: "fixture-off", enabled: false }
    const totals = (item: ReturnType<typeof profileTotalsItem>) => item.Update!.ExpressionAttributeValues!

    it("sums displayedXp and shown level over ENABLED skills; untrained counts 1, disabled counts nothing", () => {
      const states = new Map([
        // Untouched by this activity, ratcheted by an earlier replay: shows its high-water.
        [other, { skillId: other, xpLedgerSum: cumulativeXp(3), displayedXp: cumulativeXp(3), level: 3, levelHighWater: 6 }],
        ["fixture-off", { skillId: "fixture-off", xpLedgerSum: 999_999, displayedXp: 999_999 }],
      ])
      const item = profileTotalsItem(
        { userId: "u-1", states, xpBySkill: new Map([[trained, cumulativeXp(7)]]), skills: [...enabled, disabled], curve: RULES.curve, ingestedAt: "2026-09-06T09:00:02.000Z" },
        PROFILE_TABLE,
      )
      expect(item.Update!.Key).toEqual({ id: "u-1" })
      expect(totals(item)).toMatchObject({
        ":txp": cumulativeXp(7) + cumulativeXp(3),
        ":tlvl": 7 + 6 + (enabled.length - 2),
      })
    })

    it("a row written before 0219, never replayed, shows what its XP buys", () => {
      const states = new Map([[other, { skillId: other, xpLedgerSum: cumulativeXp(8), displayedXp: cumulativeXp(8) }]])
      const item = profileTotalsItem(
        { userId: "u-1", states, xpBySkill: new Map([[trained, 1]]), skills: enabled, curve: RULES.curve, ingestedAt: "2026-09-06T09:00:02.000Z" },
        PROFILE_TABLE,
      )
      expect(totals(item)[":tlvl"]).toBe(levelForXp(1, RULES.curve) + 8 + (enabled.length - 2))
    })

    it("creates the row if the replay never has: Amplify metadata is if_not_exists, and nothing is conditioned", () => {
      const item = profileTotalsItem(
        { userId: "u-1", states: new Map(), xpBySkill: new Map([[trained, 5]]), skills: enabled, curve: RULES.curve, ingestedAt: "2026-09-06T09:00:02.000Z" },
        PROFILE_TABLE,
      ).Update!
      expect(item.ConditionExpression).toBeUndefined()
      expect(item.UpdateExpression).toContain("#tn = if_not_exists(#tn, :tn)")
      expect(item.UpdateExpression).toContain("#owner = if_not_exists(#owner, :owner)")
      expect(item.UpdateExpression).toContain("totalXp = :txp, totalLevel = :tlvl")
    })
  })

  it("refuses a scored skill the registry does not carry, rather than guess a permanent version", () => {
    const a = activity()
    const entries = entriesFor(a, RUN_ROWS)
    expect(() =>
      ledgerTransactItems(entries, new Map(), a, 1, [], RULES.curve, TABLES),
    ).toThrow(/not in the registry/)
  })

  it("rows, then one ADD per skill carrying that skill's summed XP, then the Profile totals", () => {
    const a = activity()
    const entries = entriesFor(a, [
      ...RUN_ROWS,
      { skillId: "might", reason: "reps", units: 30, unitsEffective: 30 },
    ])
    const items = ledgerTransactItems(entries, new Map(), a, 1, RULES.skills, RULES.curve, TABLES)
    expect(items.map((i) => i.Put ? "put" : i.Update!.TableName === PROFILE_TABLE ? "profile" : "add")).toEqual([
      "put", "put", "put", "add", "add", "profile",
    ])
    const adds = items.filter((i) => i.Update?.TableName === STATE_TABLE).map((i) => [i.Update!.Key!.skillId, i.Update!.ExpressionAttributeValues![":xp"]])
    expect(adds).toEqual([
      ["wayfaring", 400],
      ["might", 120],
    ])
  })
})

describe("isLostLedgerRace", () => {
  const cancelled = (...codes: string[]) =>
    Object.assign(new Error("x"), { name: "TransactionCanceledException", CancellationReasons: codes.map((Code) => ({ Code })) })

  it("is true when only XP items failed their condition", () => {
    expect(isLostLedgerRace(cancelled("None", "None", "ConditionalCheckFailed"), 2)).toBe(true)
  })
  it("is false when the receipt failed: another invocation owns it, retrying cannot help", () => {
    expect(isLostLedgerRace(cancelled("None", "ConditionalCheckFailed", "None"), 2)).toBe(false)
  })
  it("is false for a non-condition cancellation (throttling, conflict)", () => {
    expect(isLostLedgerRace(cancelled("None", "None", "TransactionConflict"), 2)).toBe(false)
  })
  it("is false for any other error", () => {
    expect(isLostLedgerRace(new Error("boom"), 2)).toBe(false)
  })
})

describe("persistWithLedger — the commit", () => {
  it("rows, ADDs, the Activity put and the receipt's DONE go in ONE transaction", async () => {
    const { t, deps, claim } = world()
    claim("k-1")
    const result = await commit(activity(), RUN_ROWS, deps)

    expect(t.transacts).toBe(1)
    expect(result).toEqual({ xpAwarded: 400, rowsWritten: 2, alreadyScored: false, xpRulesVersion: 1 })
    expect([...t.table(LEDGER_TABLE).keys()]).toEqual([
      "a-1#wayfaring#new_ground#v1",
      "a-1#wayfaring#recent_ground#v1",
    ])
    expect(t.table(STATE_TABLE).get("u-1#wayfaring")).toMatchObject({ xpLedgerSum: 400, displayedXp: 400 })
    expect(t.table(ACTIVITY_TABLE).get("a-1")).toMatchObject({ xpAwarded: 400, xpRulesVersion: 1 })
    expect(t.table(INGEST_RECEIPT_TABLE).get("k-1")).toMatchObject({ status: "DONE", xpAwarded: 400 })
  })

  it("writes level/levelHighWater and the Profile totals in the same commit, and moves them on the next (0219)", async () => {
    const { t, deps, claim } = world()
    const enabledCount = RULES.skills.filter((s) => s.enabled).length
    claim("k-1")
    await commit(activity(), RUN_ROWS, deps)
    expect(t.transacts).toBe(1)
    const lvl1 = levelForXp(400, RULES.curve)
    expect(t.table(STATE_TABLE).get("u-1#wayfaring")).toMatchObject({ level: lvl1, levelHighWater: lvl1 })
    expect(t.table(PROFILE_TABLE).get("u-1")).toMatchObject({
      __typename: "Profile",
      owner: "u-1::u-1",
      totalXp: 400,
      totalLevel: lvl1 + enabledCount - 1,
    })

    claim("k-2")
    await commit(activity({ activityId: "a-2" }), RUN_ROWS, deps, "k-2")
    const lvl2 = levelForXp(800, RULES.curve)
    expect(t.table(STATE_TABLE).get("u-1#wayfaring")).toMatchObject({ displayedXp: 800, level: lvl2, levelHighWater: lvl2 })
    expect(t.table(PROFILE_TABLE).get("u-1")).toMatchObject({ totalXp: 800, totalLevel: lvl2 + enabledCount - 1 })
  })

  it("an already-scored re-delivery touches neither SkillState nor Profile", async () => {
    const { t, deps, claim } = world()
    claim("k-1")
    await commit(activity(), RUN_ROWS, deps)
    t.table(PROFILE_TABLE).get("u-1")!.totalXp = -1 // a sentinel a second write would overwrite
    t.table(INGEST_RECEIPT_TABLE).set("k-1", { ingestKey: "k-1", status: "PROCESSING" })
    await commit(activity(), RUN_ROWS, deps)
    expect(t.table(PROFILE_TABLE).get("u-1")!.totalXp).toBe(-1)
  })

  it("the SkillState row keeps the firstSeen stamp its creating commit wrote (D-146)", async () => {
    const { t, deps, claim } = world()
    claim("k-1")
    await commit(activity({ startedAt: "2026-09-06T03:00:00.000Z" }), RUN_ROWS, deps)
    claim("k-2")
    // A later, and then a backfilled EARLIER, activity: neither moves the stamp.
    await commit(activity({ activityId: "a-2", startedAt: "2026-09-10T03:00:00.000Z" }), RUN_ROWS, deps, "k-2")
    claim("k-3")
    await commit(activity({ activityId: "a-3", startedAt: "2026-01-01T03:00:00.000Z" }), RUN_ROWS, deps, "k-3")

    expect(t.table(STATE_TABLE).get("u-1#wayfaring")).toMatchObject({
      xpLedgerSum: 1200,
      firstSeenRulesVersion: 1,
      firstSeenAt: "2026-09-06T03:00:00.000Z",
      firstXpAt: "2026-01-01T03:00:00.000Z",
    })
  })

  it("re-delivering the same activity writes zero new rows, moves no XP, and does not throw", async () => {
    const { t, deps, claim } = world()
    claim("k-1")
    await commit(activity(), RUN_ROWS, deps)
    claim("k-1") // the receipt's TTL expired, or a `reingest` re-claimed it
    const again = await commit(activity(), RUN_ROWS, deps)

    expect(again).toEqual({ xpAwarded: 400, rowsWritten: 0, alreadyScored: true, xpRulesVersion: 1 })
    expect(t.table(LEDGER_TABLE).size).toBe(2)
    expect(t.table(STATE_TABLE).get("u-1#wayfaring")).toMatchObject({ xpLedgerSum: 400, displayedXp: 400 })
    expect(t.table(ACTIVITY_TABLE).get("a-1")).toMatchObject({ xpAwarded: 400 })
    expect(t.table(INGEST_RECEIPT_TABLE).get("k-1")).toMatchObject({ status: "DONE", xpAwarded: 400 })
  })

  /**
   * D-254. The second delivery re-runs the cells first, so they now carry this activity's own
   * `lastRunAt` and classify `cooled`: the SAME run comes back as 100% recent ground, under ids
   * the first delivery never wrote. The row condition alone would pay it again.
   */
  it("a re-delivery that re-classifies as recent ground still awards nothing (D-254)", async () => {
    const { t, deps, claim } = world()
    claim("k-1")
    await commit(activity(), RUN_ROWS, deps)
    claim("k-1")
    const recent: UnratedRow[] = [{ skillId: "wayfaring", reason: "recent_ground", units: 5, unitsEffective: 2.5 }]
    const again = await commit(activity(), recent, deps)

    expect(again.alreadyScored).toBe(true)
    expect(t.table(LEDGER_TABLE).size).toBe(2)
    expect(t.table(STATE_TABLE).get("u-1#wayfaring")).toMatchObject({ xpLedgerSum: 400 })
  })

  it("a lost xpLedgerSum race re-reads and retries the whole transaction", async () => {
    const { t, deps, claim } = world()
    claim("k-1")
    // Another activity's ingest lands between our pre-read and our commit, once.
    t.beforeTransact = (n) => {
      if (n !== 1) return
      const s = t.table(STATE_TABLE)
      s.set("u-1#wayfaring", { userId: "u-1", skillId: "wayfaring", xpLedgerSum: 50, displayedXp: 50 })
    }
    const result = await commit(activity(), RUN_ROWS, deps)

    expect(t.transacts).toBe(2)
    expect(result.rowsWritten).toBe(2)
    expect(t.table(STATE_TABLE).get("u-1#wayfaring")).toMatchObject({ xpLedgerSum: 450, displayedXp: 450 })
  })

  it("a concurrent duplicate that the GSI has not caught up with loses on the row condition, and the retry awards nothing", async () => {
    const { t, deps, claim } = world()
    claim("k-1")
    await commit(activity(), RUN_ROWS, deps)
    t.hiddenFromGsi = new Set(t.table(LEDGER_TABLE).keys())
    claim("k-1")
    t.beforeTransact = () => {
      t.hiddenFromGsi.clear() // the GSI catches up before the retry reads it
    }
    const again = await commit(activity(), RUN_ROWS, deps)

    expect(again.alreadyScored).toBe(true)
    expect(t.table(STATE_TABLE).get("u-1#wayfaring")).toMatchObject({ xpLedgerSum: 400 })
  })

  it(`gives up after ${MAX_LEDGER_ATTEMPTS} lost races and throws, having written nothing`, async () => {
    const { t, deps, claim } = world()
    claim("k-1")
    t.failItem = 2
    const before = t.snapshot()
    await expect(commit(activity(), RUN_ROWS, deps)).rejects.toMatchObject({ name: "TransactionCanceledException" })
    expect(t.transacts).toBe(MAX_LEDGER_ATTEMPTS)
    expect(t.snapshot()).toBe(before)
  })

  /**
   * CRITERION 6. Item order is [Activity, receipt, row, row, ADD]. Force each one to fail in
   * turn: the Activity put and the receipt fail at once, XP items after their retries, and in
   * every case not one of the five is written.
   */
  it.each([0, 1, 2, 3, 4])("a forced failure of item %i leaves none of them written", async (i) => {
    const { t, deps, claim } = world()
    claim("k-1")
    t.failItem = i
    const before = t.snapshot()
    await expect(commit(activity(), RUN_ROWS, deps)).rejects.toMatchObject({ name: "TransactionCanceledException" })
    expect(t.transacts).toBe(i < 2 ? 1 : MAX_LEDGER_ATTEMPTS)
    expect(t.snapshot()).toBe(before)
  })

  it("an activity that earns nothing still commits, with xpAwarded 0 and no version", async () => {
    const { t, deps, claim } = world()
    claim("k-1")
    const result = await commit(activity({ distanceM: 0 }), [], deps)
    expect(result).toEqual({ xpAwarded: 0, rowsWritten: 0, alreadyScored: false, xpRulesVersion: null })
    expect(t.table(ACTIVITY_TABLE).get("a-1")).toMatchObject({ xpAwarded: 0, xpRulesVersion: null })
  })
})

describe("I-15 — displayedXp == SUM(xpAwarded), per (userId, skillId), over a seeded fixture", () => {
  it("holds after 60 activities for two users, a third of them delivered twice", async () => {
    const { t, deps, claim } = world()
    let seed = 20260928
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31
      return seed / 2 ** 31
    }

    for (let i = 0; i < 60; i++) {
      const userId = i % 2 === 0 ? "u-1" : "u-2"
      const strength = rand() < 0.3
      const a = activity({
        activityId: `a-${i}`,
        userId,
        kind: strength ? "strength" : "run",
        hasTrace: !strength && rand() < 0.8,
        source: { source: strength ? "manual" : "gpslogger" } as Activity["source"],
        distanceM: strength ? undefined : rand() * 20_000,
        sets: strength
          ? [
              { exercise: "pushup", reps: Math.floor(rand() * 60) },
              { exercise: "plank", durationS: Math.floor(rand() * 300) },
            ]
          : [],
        startedAt: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(),
      })
      const split = a.hasTrace ? { new: rand() * 5000, rearmed: rand() * 2000, recent: rand() * 5000 } : null
      const rows = scoreGround(scoreUnits(a, RULES), RULES, split)
      const deliveries = rand() < 0.33 ? 2 : 1
      for (let d = 0; d < deliveries; d++) {
        claim(`k-${i}`)
        await commit(a, rows, deps, `k-${i}`)
      }
    }

    const ledgerSums = new Map<string, number>()
    for (const row of t.table(LEDGER_TABLE).values()) {
      const key = `${row.userId}#${row.skillId}`
      ledgerSums.set(key, (ledgerSums.get(key) ?? 0) + Number(row.xpAwarded))
    }
    const states = t.table(STATE_TABLE)
    expect(states.size).toBeGreaterThanOrEqual(4)
    expect([...states.keys()].sort()).toEqual([...ledgerSums.keys()].sort())
    for (const [key, state] of states) {
      expect(state.displayedXp, key).toBe(ledgerSums.get(key))
      expect(state.xpLedgerSum, key).toBe(ledgerSums.get(key))
    }
  })
})
