import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb"
import { describe, expect, it, vi } from "vitest"

import { computeActivityId } from "@/src/domain/activity-id"
import { acceptIngest, INGEST_RECEIPT_TABLE } from "@/src/pipeline/ingest-receipt"
import { activityItem } from "@/src/pipeline/persist"
import { retractActivity } from "@/src/pipeline/retract"
import { retractMessage } from "@/src/pipeline/retract-message"
import { loadRuleSet } from "@/src/rules/load"
import { totalLevel } from "@/src/scoring/levels"

import { chroniclePage, latestRun, runById, traceWebRuns, type RunReadDeps } from "./server"
import { xpBeforeRun } from "./tally-server"

/**
 * Ticket `0287`. A SOURCE-SIDE DELETE, END TO END THROUGH THE READERS: one ACTIVE run and one run
 * the shipped `retractActivity` tombstones, in one stateful world (T3, the receipt table, T4, and
 * the S3 objects the readers GET). The lists drop the tombstoned run; the map's cells, its permanent
 * web, the ledger and Total Level are byte-for-byte what they were (D-020, D-135, `02` §4.7).
 *
 * Rows are built by the shipped writer (`activityItem`), as `server.test.ts` explains. Geometry is
 * synthetic, near Point Nemo (D-199).
 */

const USER = "u-1"
const SOURCE = "gpslogger"
const EXTERNAL = "9001"
const KEY = "k-delete"
const ACTIVITY_TABLE = "TestActivity"
const LEDGER_TABLE = "TestLedger"
const KEPT = "a-kept"
/** The NEWER of the two runs, so `latestRun` has to fall back past it. */
const GONE = computeActivityId(USER, SOURCE, EXTERNAL)

const RULES = loadRuleSet(1)
const [SKILL_A, SKILL_B] = RULES.skills.filter((s) => s.enabled).map((s) => s.id)

const GEOMETRY = { type: "MultiLineString" as const, coordinates: [[[-123.393, -48.876], [-123.392, -48.875]]] }
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))

/** The S3 the readers see. `getObject` has already gunzipped in production; these are plain bytes. */
const objects = new Map<string, Uint8Array>()
vi.mock("@/lib/fog/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/fog/server")>()),
  getObject: async (key: string) => objects.get(key),
  defaultFogReadDeps: () => ({ s3: {}, bucket: "bkt" }),
}))

const activity = (id: string, startedAt: string, over: Record<string, unknown> = {}) => ({
  ...activityItem({
    activityId: id,
    userId: USER,
    kind: "run",
    hasTrace: true,
    traceRef: `users/${USER}/traces/${id}.segments.json.gz`,
    source: { source: SOURCE, externalId: id },
    startedAt,
    startedAtLocal: startedAt.slice(0, 19),
    timezone: "UTC",
    ingestedAt: startedAt,
    distanceM: 5000,
    name: id,
    sets: [],
  } as unknown as Parameters<typeof activityItem>[0]),
  xpAwarded: 120,
  cellCount: 40,
  newCellCount: 12,
  ...over,
})

function world() {
  objects.clear()
  for (const id of [KEPT, GONE]) {
    objects.set(`users/${USER}/traces/${id}.segments.json.gz`, bytes(GEOMETRY))
    objects.set(`users/${USER}/cells/${id}.classes.json`, bytes({ new: [`cell-${id}`], rearmed: [] }))
  }
  objects.set(`users/${USER}/traces/web.json.gz`, bytes({
    v: 1,
    runs: {
      [KEPT]: { startedAt: "2026-10-01T07:00:00.000Z", lines: GEOMETRY.coordinates },
      [GONE]: { startedAt: "2026-10-10T07:00:00.000Z", lines: GEOMETRY.coordinates },
    },
  }))

  const t3 = new Map<string, Record<string, unknown>>([
    [KEPT, activity(KEPT, "2026-10-01T07:00:00.000Z")],
    [GONE, activity(GONE, "2026-10-10T07:00:00.000Z")],
  ])
  const receipts = new Map<string, Record<string, unknown>>()
  const ledger = [
    { userId: USER, seq: `2026-10-01T07:00:00.000Z#${KEPT}#00`, skillId: SKILL_A, xpAwarded: 300 },
    { userId: USER, seq: `2026-10-10T07:00:00.000Z#${GONE}#00`, skillId: SKILL_A, xpAwarded: 500 },
    { userId: USER, seq: `2026-10-10T07:00:00.000Z#${GONE}#01`, skillId: SKILL_B, xpAwarded: 200 },
  ]
  const conditional = () => Object.assign(new Error("condition"), { name: "ConditionalCheckFailedException" })

  const ddb = {
    async send(command: GetCommand | PutCommand | UpdateCommand | QueryCommand): Promise<Record<string, unknown>> {
      const input = command.input as Record<string, unknown> & { TableName: string; Key?: Record<string, unknown> }
      if (command instanceof QueryCommand) {
        if (input.TableName === LEDGER_TABLE) {
          // The two key conditions `xpBeforeRun` sends: rows before the cut, and floor rows (none here).
          const v = input.ExpressionAttributeValues as Record<string, string>
          const rows = v[":floor"] !== undefined ? [] : ledger.filter((r) => r.seq < v[":cut"]!)
          return { Items: rows.map((r) => ({ ...r })) }
        }
        if (input.TableName !== ACTIVITY_TABLE) throw new Error("fake: unknown query")
        if (input.IndexName === undefined) {
          // `runById`: the base table, by id.
          const hit = t3.get(String((input.ExpressionAttributeValues as Record<string, unknown>)[":id"]))
          return { Items: hit ? [{ ...hit }] : [] }
        }
        if (input.IndexName !== "byUserAndStart") throw new Error("fake: unknown index")
        const rows = [...t3.values()].sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))
        return { Items: rows.map((r) => ({ ...r })) }
      }
      const table = input.TableName === INGEST_RECEIPT_TABLE ? receipts : input.TableName === ACTIVITY_TABLE ? t3 : null
      if (!table) throw new Error(`fake: unknown table ${input.TableName}`)
      if (command instanceof GetCommand) {
        const row = table.get(String(Object.values(input.Key!)[0]))
        return row ? { Item: { ...row } } : {}
      }
      if (command instanceof PutCommand) {
        const item = command.input.Item as Record<string, unknown>
        if (table.has(String(item.ingestKey))) throw conditional()
        table.set(String(item.ingestKey), { ...item })
        return {}
      }
      const row = table.get(String(Object.values(input.Key!)[0]))
      const values = (input.ExpressionAttributeValues ?? {}) as Record<string, unknown>
      const expr = String(input.UpdateExpression)
      const cond = String(input.ConditionExpression ?? "")
      if (cond === "attribute_exists(ingestKey)" && !row) throw conditional()
      if (cond.startsWith("attribute_exists(id) AND userId = :uid")) {
        if (!row || row.userId !== values[":uid"] || row.status === values[":tombstoned"]) throw conditional()
      }
      if (expr === "ADD attempts :one") {
        row!.attempts = Number(row!.attempts ?? 0) + 1
        return { Attributes: { attempts: row!.attempts } }
      }
      if (expr.startsWith("SET #status = :done")) {
        Object.assign(row!, { status: "DONE" })
        return {}
      }
      if (expr === "SET #status = :tombstoned, updatedAt = :now") {
        Object.assign(row!, { status: values[":tombstoned"], updatedAt: values[":now"] })
        return {}
      }
      throw new Error(`fake: unsupported update ${expr}`)
    },
  }

  const reads: RunReadDeps = { bucket: "bkt", s3: {} as RunReadDeps["s3"], ddb: ddb as never, activityTable: ACTIVITY_TABLE }
  const ledgerDeps = { ddb: ddb as never, ledgerTable: LEDGER_TABLE }

  const tombstone = async () => {
    await acceptIngest({ ingestKey: KEY, userId: USER, activityId: GONE, source: SOURCE }, { ddb: ddb as never })
    const message = retractMessage({ source: SOURCE, userId: USER, externalId: EXTERNAL, ingestKey: KEY, now: new Date("2026-10-18T11:59:00.000Z") })
    return retractActivity(message, {
      confirm: async () => "gone",
      receipt: { ddb: ddb as never },
      persist: { ddb: ddb as never, activityTable: ACTIVITY_TABLE },
      now: () => new Date("2026-10-18T12:00:00.000Z"),
    })
  }

  /** Every skill's XP, through the shipped ledger reader, cut after all history. */
  const level = async () => {
    const xp = await xpBeforeRun(USER, { activityId: "zzz", startedAt: "2099-01-01T00:00:00.000Z" }, ledgerDeps)
    return { xp, total: totalLevel(new Map(Object.entries(xp)), RULES.skills, RULES.curve) }
  }

  return { t3, ledger, reads, tombstone, level }
}

const snapshot = () => JSON.stringify([...objects].map(([k, v]) => [k, [...v]]))

describe("0287 — a tombstoned activity leaves the lists, and nothing else", () => {
  it("before the delete, both runs list and the newer one is the last run", async () => {
    const w = world()
    expect((await chroniclePage(USER, w.reads)).items.map((i) => i.activityId)).toEqual([GONE, KEPT])
    expect((await latestRun(USER, w.reads)).features[0]!.properties.activityId).toBe(GONE)
  })

  it("the Chronicle drops it and keeps the active one", async () => {
    const w = world()
    expect(await w.tombstone()).toBe("tombstoned")
    const page = await chroniclePage(USER, w.reads)
    expect(page.items.map((i) => i.activityId)).toEqual([KEPT])
    expect(page.next).toBeNull()
  })

  it("/api/runs/latest falls back past it to the active run", async () => {
    const w = world()
    await w.tombstone()
    const latest = await latestRun(USER, w.reads)
    expect(latest.features).toHaveLength(1)
    expect(latest.features[0]!.properties.activityId).toBe(KEPT)
  })

  it("the permanent web keeps its line: the ground it revealed stays drawn (D-020)", async () => {
    const w = world()
    const before = await traceWebRuns(USER, w.reads)
    await w.tombstone()
    const after = await traceWebRuns(USER, w.reads)
    expect(after).toEqual(before)
    expect(after.map((r) => r.activityId).sort()).toEqual([KEPT, GONE].sort())
  })

  it("/run/:id still answers for it: a direct link is not a list", async () => {
    const w = world()
    await w.tombstone()
    expect(await runById(USER, GONE, w.reads)).toMatchObject({ activityId: GONE })
  })

  it("map cells, the ledger and Total Level are unchanged (D-020, D-135)", async () => {
    const w = world()
    const cellsBefore = snapshot()
    const ledgerBefore = JSON.stringify(w.ledger)
    const levelBefore = await w.level()
    const rowBefore = { ...w.t3.get(GONE)! }

    await w.tombstone()

    expect(snapshot()).toBe(cellsBefore)
    expect(JSON.stringify(w.ledger)).toBe(ledgerBefore)
    expect(await w.level()).toEqual(levelBefore)
    expect(levelBefore.xp[SKILL_A!]).toBe(800)
    // The T3 row keeps its award, its cell counts and its route: only status (and updatedAt) moved.
    expect(w.t3.get(GONE)).toEqual({ ...rowBefore, status: "TOMBSTONED", updatedAt: "2026-10-18T12:00:00.000Z" })
  })
})
