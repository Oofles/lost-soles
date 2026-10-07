import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3"
import { BatchGetCommand, GetCommand, QueryCommand, TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb"
import { describe, expect, it } from "vitest"

import type { Activity } from "@/src/domain/activity"
import { NO_CELLS } from "@/src/domain/discovery"
import { TRACE } from "@/src/pipeline/__fixtures__/process-rig"
import { UnknownKindError } from "@/src/pipeline/kind-override"
import { planRescore, rescoreKind, type KindRescoreDeps } from "@/src/pipeline/kind-rescore"
import { activityItem } from "@/src/pipeline/persist"
import { ReplayInProgressError } from "@/src/pipeline/xp-ledger"
import { loadRuleSet } from "@/src/rules/load"
import { scoreActivity, xpBySkill, type XpLedgerEntry } from "@/src/scoring"

/**
 * Ticket `0243`, D-284, D-285. The re-score entry point, against an in-memory T1–T4 that APPLIES
 * each transaction — so "no skill's XP goes down" is asserted on the ledger it leaves behind, not
 * on the shape of the request.
 */

const V2 = loadRuleSet(2)
const USER = "u-1"
const T3 = "Activity-t"
const T4 = "XpLedgerEntry-t"
const T2 = "SkillState-t"
const T1 = "Profile-t"
const CELLS = "Cells-t"

function activity(kind: Activity["kind"]): Activity {
  return {
    activityId: "act-1",
    userId: USER,
    kind,
    startedAt: "2026-09-06T03:00:00.000Z",
    startedAtLocal: "2026-09-05T21:00:00",
    timezone: "America/Denver",
    elapsedS: 1800,
    distanceM: 5000,
    source: { source: "gpslogger", externalId: "9001", sourceTypeRaw: "x", fetchedAt: "2026-09-06T09:00:00.000Z" },
    raw: null,
    traceRef: null,
    hasTrace: true,
    sets: [],
    dedupeKey: "d",
    ingestedAt: "2026-09-06T09:00:02.000Z",
    revision: 1,
  } as Activity
}

/** A user whose one activity was ingested as `kind` and scored under v2, as ingest would have. */
function world(kind: Activity["kind"], opts: { replayInProgress?: boolean } = {}) {
  const a = activity(kind)
  const rows = scoreActivity(a, V2, null, NO_CELLS, a.ingestedAt)
  const t3 = new Map<string, Record<string, unknown>>([
    [a.activityId, activityItem(a, NO_CELLS, undefined, { xpAwarded: rows.reduce((s, r) => s + r.xpAwarded, 0), xpRulesVersion: 2 })],
  ])
  const ledger = new Map<string, XpLedgerEntry>(rows.map((r) => [r.id, r]))
  const skills = new Map<string, number>([...xpBySkill(rows)])
  const transacts: TransactWriteCommand["input"][] = []
  const overridePuts: PutObjectCommand["input"][] = []
  let cellWrites = 0

  const ddb = {
    async send(c: unknown) {
      if (c instanceof GetCommand) return { Item: t3.get(String(c.input.Key!.id)) }
      if (c instanceof QueryCommand) {
        if (c.input.TableName === T4) {
          return { Items: [...ledger.values()].filter((e) => e.activityId === c.input.ExpressionAttributeValues![":a"] && !e.isFloor) }
        }
        return { Items: [...skills].map(([skillId, xp]) => ({ userId: USER, skillId, xpLedgerSum: xp, displayedXp: xp })) }
      }
      if (c instanceof TransactWriteCommand) {
        transacts.push(c.input)
        const items = c.input.TransactItems!
        const last = items[items.length - 1]!
        const guard = last.Update ?? last.ConditionCheck
        if (opts.replayInProgress && guard?.TableName === T1) {
          throw Object.assign(new Error("cancelled"), {
            name: "TransactionCanceledException",
            CancellationReasons: items.map((_, i) => ({ Code: i === items.length - 1 ? "ConditionalCheckFailed" : "None" })),
          })
        }
        for (const i of items) {
          if (i.Delete?.TableName === T4) ledger.delete(String(i.Delete.Key!.id))
          if (i.Put?.TableName === T4) ledger.set(String(i.Put.Item!.id), i.Put.Item as XpLedgerEntry)
          if (i.Update?.TableName === T2) {
            const id = String(i.Update.Key!.skillId)
            skills.set(id, (skills.get(id) ?? 0) + Number(i.Update.ExpressionAttributeValues![":xp"]))
          }
          if (i.Update?.TableName === T3) {
            const row = t3.get(String(i.Update.Key!.id))!
            const v = i.Update.ExpressionAttributeValues!
            Object.assign(row, { kind: v[":kind"], derivedKind: v[":derived"], kindOverride: v[":mirror"] })
            if (":xp" in v) Object.assign(row, { xpAwarded: v[":xp"], xpRulesVersion: v[":ver"] })
          }
        }
        return {}
      }
      throw new Error(`unexpected ${String(c)}`)
    },
  }

  const deps: KindRescoreDeps = {
    ddb,
    activityTable: T3,
    ledger: { ledgerTable: T4, skillStateTable: T2, profileTable: T1 },
    overrides: {
      bucket: "b",
      s3: { send: async (c: PutObjectCommand) => void overridePuts.push(c.input) } as never,
    },
    registry: V2,
    cells: {
      table: CELLS,
      concurrency: 1,
      sleep: async () => {},
      ddb: {
        async send(c: unknown) {
          if (c instanceof BatchGetCommand) return { Responses: { [CELLS]: [] } }
          if (c instanceof UpdateCommand) cellWrites += 1
          return {}
        },
      },
    } as never,
    blobs: {
      bucket: "b",
      table: CELLS,
      now: () => new Date("2026-10-07T12:00:01.000Z"),
      ddb: { send: async () => ({ Attributes: { generation: 2 } }) } as never,
      s3: {
        async send(c: unknown) {
          if (c instanceof GetObjectCommand) throw Object.assign(new Error("none"), { name: "NoSuchKey" })
          return { ETag: '"e"' }
        },
      } as never,
    },
    loadTrace: async () => TRACE,
    now: () => new Date("2026-10-07T12:00:00.000Z"),
    rand: () => 0.5,
  }

  /** Per skill, Σ every row — floors included. What SkillState must equal (I-15). */
  const totals = () => {
    const out = new Map<string, number>()
    for (const e of ledger.values()) out.set(e.skillId, (out.get(e.skillId) ?? 0) + e.xpAwarded)
    return out
  }

  return { deps, t3, ledger, skills, transacts, overridePuts, totals, cellWrites: () => cellWrites }
}

const REQ = { userId: USER, activityId: "act-1", setBy: "operator" }

describe("refusals come before any write", () => {
  it("an unknown kind is refused and nothing is written", async () => {
    const w = world("ride")
    await expect(rescoreKind({ ...REQ, kind: "swim" }, w.deps)).rejects.toThrow(UnknownKindError)
    expect(w.overridePuts).toHaveLength(0)
    expect(w.transacts).toHaveLength(0)
    expect(w.cellWrites()).toBe(0)
  })

  it("another user's activity is refused", async () => {
    const w = world("ride")
    await expect(rescoreKind({ ...REQ, userId: "someone-else", kind: "walk" }, w.deps)).rejects.toThrow(/not someone-else's/)
    expect(w.overridePuts).toHaveLength(0)
  })

  it("the kind it already has is reported, not rewritten", async () => {
    const w = world("ride")
    const out = await rescoreKind({ ...REQ, kind: "ride" }, w.deps)
    expect(out.outcome).toBe("unchanged")
    expect(w.overridePuts).toHaveLength(0)
    expect(w.transacts).toHaveLength(0)
  })
})

describe("ride → walk: the new skill gains in full, the old one keeps what it had (D-284)", () => {
  it("records the fact under raw/ with the derived kind, the new kind, who and when", async () => {
    const w = world("ride")
    await rescoreKind({ ...REQ, kind: "walk" }, w.deps)
    expect(w.overridePuts).toHaveLength(1)
    expect(w.overridePuts[0]!.Key).toMatch(/^raw\/u-1\/gpslogger\/9001\.kind-override\/20261007T120000000Z-\w+\.json$/)
    expect(JSON.parse(String(w.overridePuts[0]!.Body))).toMatchObject({
      derivedKind: "ride",
      kind: "walk",
      setBy: "operator",
      setAt: "2026-10-07T12:00:00.000Z",
    })
  })

  it("no skill's XP goes down, and the ones the walk trains go up (D-135)", async () => {
    const w = world("ride")
    const before = w.totals()
    const out = await rescoreKind({ ...REQ, kind: "walk" }, w.deps)
    const after = w.totals()

    for (const [skill, xp] of before) expect(after.get(skill) ?? 0).toBeGreaterThanOrEqual(xp)
    expect(after.get("wayfaring") ?? 0).toBeGreaterThan(0)
    // Roving's whole award is retained, as a floor — the double count the operator accepted.
    expect(out.outcome === "applied" && out.xp?.floors.roving).toBe(before.get("roving"))
    // And SkillState moved by exactly what the ledger did (I-15).
    for (const [skill, xp] of after) expect(w.skills.get(skill)).toBe(xp)
  })

  it("the old rows are gone and the floor is the only row left for the old skill", async () => {
    const w = world("ride")
    await rescoreKind({ ...REQ, kind: "walk" }, w.deps)
    const roving = [...w.ledger.values()].filter((e) => e.skillId === "roving")
    expect(roving).toHaveLength(1)
    expect(roving[0]).toMatchObject({ isFloor: true, reason: "retained_floor" })
    expect(roving[0]!.id).toMatch(/#kind-20261007T120000000Z-/)
  })

  it("the T3 row carries the new kind, the derived one, and the provenance", async () => {
    const w = world("ride")
    await rescoreKind({ ...REQ, kind: "walk" }, w.deps)
    const row = w.t3.get("act-1")!
    expect(row.kind).toBe("walk")
    expect(row.derivedKind).toBe("ride")
    expect(row.kindOverride).toMatchObject({ kind: "walk", derivedKind: "ride", setBy: "operator" })
  })

  it("reveals the cells — and awards no discovery for them (D-284 c, D-260)", async () => {
    const w = world("ride")
    const out = await rescoreKind({ ...REQ, kind: "walk" }, w.deps)
    expect(out.outcome === "applied" && out.cellsRevealed).toBeGreaterThan(0)
    expect(w.cellWrites()).toBeGreaterThan(0)
    expect([...w.ledger.values()].some((e) => e.skillId === "cartography")).toBe(false)
  })

  it("the cell writes carry firstRunAt = the activity's startedAt, never the clock", async () => {
    const w = world("ride")
    const updates: UpdateCommand["input"][] = []
    const inner = w.deps.cells.ddb.send.bind(w.deps.cells.ddb)
    w.deps.cells.ddb = {
      async send(c: never) {
        if ((c as unknown) instanceof UpdateCommand) updates.push((c as UpdateCommand).input)
        return inner(c)
      },
    } as never
    await rescoreKind({ ...REQ, kind: "walk" }, w.deps)
    const values = updates.flatMap((u) => Object.values(u.ExpressionAttributeValues ?? {}))
    expect(values).toContain("2026-09-06T03:00:00.000Z")
    expect(values).not.toContain("2026-10-07T12:00:00.000Z")
  })

  it("rates the walk's ground as recent (D-285): Wayfaring at the recent multiplier", async () => {
    const w = world("ride")
    const out = await rescoreKind({ ...REQ, kind: "walk" }, w.deps)
    // 5 km × 100 XP/km × 0.5 recent-ground multiplier.
    expect(out.outcome === "applied" && out.xp?.gained.wayfaring).toBe(250)
  })
})

describe("walk → run: nothing would gain, so nothing is written to the ledger", () => {
  it("writes the kind and reports that no skill gained", async () => {
    const w = world("walk")
    const before = [...w.ledger.values()]
    const out = await rescoreKind({ ...REQ, kind: "run" }, w.deps)

    expect(out.outcome === "applied" && out.xp).toBeNull()
    expect(out.outcome === "applied" && out.message).toMatch(/no skill would gain/)
    expect([...w.ledger.values()]).toEqual(before)
    expect(w.t3.get("act-1")!.kind).toBe("run")
    // The kind mirror alone, still guarded by the replay flag.
    const items = w.transacts[0]!.TransactItems!
    expect(items).toHaveLength(2)
    expect(items[1]!.ConditionCheck?.TableName).toBe(T1)
  })

  it("and writes no cells: the walk already revealed them", async () => {
    const w = world("walk")
    await rescoreKind({ ...REQ, kind: "run" }, w.deps)
    expect(w.cellWrites()).toBe(0)
  })
})

describe("walk → ride: the map keeps what the walk revealed (D-020, D-284 b)", () => {
  it("writes no cell, deletes no cell, and Wayfaring is retained as a floor", async () => {
    const w = world("walk")
    const before = w.totals()
    await rescoreKind({ ...REQ, kind: "ride" }, w.deps)
    expect(w.cellWrites()).toBe(0)
    const after = w.totals()
    expect(after.get("wayfaring")).toBe(before.get("wayfaring"))
    expect(after.get("roving") ?? 0).toBeGreaterThan(0)
  })
})

describe("the concurrency guard", () => {
  it("a replay holding the ledger refuses the re-score, and nothing in the ledger moves", async () => {
    const w = world("ride", { replayInProgress: true })
    const before = [...w.ledger.values()]
    await expect(rescoreKind({ ...REQ, kind: "walk" }, w.deps)).rejects.toThrow(ReplayInProgressError)
    expect([...w.ledger.values()]).toEqual(before)
    expect(w.t3.get("act-1")!.kind).toBe("ride")
  })

  it("the Profile item is the replay flag's, conditioned exactly as ingest's is", async () => {
    const w = world("ride")
    await rescoreKind({ ...REQ, kind: "walk" }, w.deps)
    const items = w.transacts[0]!.TransactItems!
    expect(items[items.length - 1]!.Update!.ConditionExpression).toMatch(/replayInProgress/)
  })
})

describe("planRescore", () => {
  it("is null when no skill gains — even if every row would change", () => {
    const old = scoreActivity(activity("walk"), V2, null, NO_CELLS, "t")
    const fresh = scoreActivity(activity("run"), V2, null, NO_CELLS, "t")
    expect(planRescore({ old, fresh, userId: USER, version: 2, runKey: "k", setAt: "t" })).toBeNull()
  })
})
