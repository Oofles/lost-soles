import { GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb"
import { describe, expect, it, vi } from "vitest"

import type { RetractConfirmation } from "@/src/adapters/types"
import { computeActivityId } from "@/src/domain/activity-id"

import { acceptIngest, INGEST_RECEIPT_TABLE } from "./ingest-receipt"
import { retractActivity } from "./retract"
import { retractMessage, isRetractMessage, type RetractMessage } from "./retract-message"

/**
 * Ticket 0282 — the worker half of a source-side deletion: receipt, confirmation, tombstone.
 *
 * A STATEFUL fake of the two tables a retract touches, so "nothing else was written" is a
 * comparison of the whole store rather than a list of calls someone remembered to check. It
 * understands exactly the expressions this path sends and throws on anything else, so a new write
 * cannot sneak past it.
 */
const ACTIVITY_TABLE = "Activity-testapi-NONE"
const USER = "u-1"
const SOURCE = "gpslogger"
const EXTERNAL = "9001"
const KEY = "k-delete"
const ACTIVITY_ID = computeActivityId(USER, SOURCE, EXTERNAL)

type Row = Record<string, unknown>

function store() {
  const tables = new Map<string, Map<string, Row>>([
    [INGEST_RECEIPT_TABLE, new Map()],
    [ACTIVITY_TABLE, new Map()],
  ])
  const writes: string[] = []
  const conditional = () => Object.assign(new Error("condition"), { name: "ConditionalCheckFailedException" })
  const ddb = {
    async send(command: PutCommand | UpdateCommand | GetCommand): Promise<Record<string, unknown>> {
      const input = command.input as Record<string, unknown> & { TableName: string; Key?: Row }
      const table = tables.get(input.TableName)
      if (!table) throw new Error(`fake: unknown table ${input.TableName}`)
      if (command instanceof GetCommand) {
        const row = table.get(String(Object.values(input.Key!)[0]))
        return row ? { Item: { ...row } } : {}
      }
      if (command instanceof PutCommand) {
        const item = command.input.Item as Row
        if (table.has(String(item.ingestKey))) throw conditional()
        table.set(String(item.ingestKey), { ...item })
        writes.push(`put ${input.TableName}`)
        return {}
      }
      const key = String(Object.values(input.Key!)[0])
      const row = table.get(key)
      const values = (input.ExpressionAttributeValues ?? {}) as Row
      const expr = String(input.UpdateExpression)
      const cond = String(input.ConditionExpression ?? "")
      if (cond === "attribute_exists(ingestKey)" && !row) throw conditional()
      if (cond.startsWith("attribute_exists(id) AND userId = :uid")) {
        if (!row || row.userId !== values[":uid"] || row.status === values[":tombstoned"]) throw conditional()
      }
      writes.push(`update ${input.TableName} ${expr}`)
      if (expr === "ADD attempts :one") {
        row!.attempts = Number(row!.attempts ?? 0) + 1
        return { Attributes: { attempts: row!.attempts } }
      }
      if (expr.startsWith("SET #status = :done")) {
        Object.assign(row!, { status: "DONE", xpAwarded: 0, newCellCount: 0 })
        return {}
      }
      if (expr === "SET #status = :tombstoned, updatedAt = :now") {
        Object.assign(row!, { status: values[":tombstoned"], updatedAt: values[":now"] })
        return {}
      }
      throw new Error(`fake: unsupported update ${expr}`)
    },
  }
  return { tables, writes, ddb }
}

/** An ACTIVE row as `persist` writes it, trimmed to what a retract could plausibly touch. */
const ACTIVE_ROW: Row = {
  id: ACTIVITY_ID,
  userId: USER,
  status: "ACTIVE",
  xpAwarded: 120,
  cellCount: 40,
  newCellCount: 12,
  cellsRef: `users/${USER}/cells/${ACTIVITY_ID}.bin`,
  traceRef: `users/${USER}/traces/${ACTIVITY_ID}.json`,
  updatedAt: "2026-10-01T00:00:00.000Z",
}

async function world(opts: { row?: Row | null; answer?: RetractConfirmation | Error } = {}) {
  const s = store()
  if (opts.row !== null) s.tables.get(ACTIVITY_TABLE)!.set(ACTIVITY_ID, { ...(opts.row ?? ACTIVE_ROW) })
  await acceptIngest({ ingestKey: KEY, userId: USER, activityId: ACTIVITY_ID, source: SOURCE }, { ddb: s.ddb as never })
  const confirm = vi.fn(async () => {
    if (opts.answer instanceof Error) throw opts.answer
    return opts.answer ?? "gone"
  })
  const deps = {
    confirm,
    receipt: { ddb: s.ddb as never },
    persist: { ddb: s.ddb as never, activityTable: ACTIVITY_TABLE },
    now: () => new Date("2026-10-18T12:00:00.000Z"),
  }
  const message: RetractMessage = retractMessage({
    source: SOURCE,
    userId: USER,
    externalId: EXTERNAL,
    ingestKey: KEY,
    now: new Date("2026-10-18T11:59:00.000Z"),
  })
  return { ...s, deps, confirm, message }
}

describe("a confirmed deletion (gone)", () => {
  it("tombstones the T3 row, and changes nothing else on it — XP, cells and route stay (D-020, D-135)", async () => {
    const w = await world()
    expect(await retractActivity(w.message, w.deps)).toBe("tombstoned")
    expect(w.tables.get(ACTIVITY_TABLE)!.get(ACTIVITY_ID)).toEqual({
      ...ACTIVE_ROW,
      status: "TOMBSTONED",
      updatedAt: "2026-10-18T12:00:00.000Z",
    })
  })

  it("writes only the receipt and the one T3 update: no ledger, cell, blob or other table", async () => {
    const w = await world()
    w.writes.length = 0
    await retractActivity(w.message, w.deps)
    expect(w.writes).toEqual([
      `update ${INGEST_RECEIPT_TABLE} ADD attempts :one`,
      `update ${ACTIVITY_TABLE} SET #status = :tombstoned, updatedAt = :now`,
      expect.stringMatching(new RegExp(`^update ${INGEST_RECEIPT_TABLE} SET #status = :done`)),
    ])
  })

  it("closes the receipt DONE with the honest zeros", async () => {
    const w = await world()
    await retractActivity(w.message, w.deps)
    expect(w.tables.get(INGEST_RECEIPT_TABLE)!.get(KEY)).toMatchObject({ status: "DONE", attempts: 1, xpAwarded: 0, newCellCount: 0 })
  })

  it("asks the source about exactly the message's activity", async () => {
    const w = await world()
    await retractActivity(w.message, w.deps)
    expect(w.confirm).toHaveBeenCalledWith(w.message)
  })

  it("a redelivery after the tombstone is `already-tombstoned` and changes nothing", async () => {
    const w = await world()
    await retractActivity(w.message, w.deps)
    const before = JSON.stringify([...w.tables.get(ACTIVITY_TABLE)!])
    expect(await retractActivity(w.message, w.deps)).toBe("already-tombstoned")
    expect(JSON.stringify([...w.tables.get(ACTIVITY_TABLE)!])).toBe(before)
  })

  it("an activity we never imported is `no-activity`: a retract never creates a row", async () => {
    const w = await world({ row: null })
    expect(await retractActivity(w.message, w.deps)).toBe("no-activity")
    expect(w.tables.get(ACTIVITY_TABLE)!.size).toBe(0)
  })

  it("another user's row is never touched", async () => {
    const w = await world({ row: { ...ACTIVE_ROW, userId: "someone-else" } })
    expect(await retractActivity(w.message, w.deps)).toBe("no-activity")
    expect(w.tables.get(ACTIVITY_TABLE)!.get(ACTIVITY_ID)!.status).toBe("ACTIVE")
  })
})

describe("a forged or stale deletion (present) — §4.1: worthless", () => {
  it("writes nothing to T3, closes the receipt, and says so", async () => {
    const w = await world({ answer: "present" })
    expect(await retractActivity(w.message, w.deps)).toBe("forged-or-stale")
    expect(w.tables.get(ACTIVITY_TABLE)!.get(ACTIVITY_ID)).toEqual(ACTIVE_ROW)
    expect(w.tables.get(INGEST_RECEIPT_TABLE)!.get(KEY)!.status).toBe("DONE")
  })
})

describe("what stops before the provider is asked", () => {
  it("a message with no receipt (never passed the accept gate) throws and asks nobody", async () => {
    const w = await world()
    const forged = { ...w.message, ingestKey: "never-accepted" }
    await expect(retractActivity(forged, w.deps)).rejects.toMatchObject({ name: "ConditionalCheckFailedException" })
    expect(w.confirm).not.toHaveBeenCalled()
    expect(w.tables.get(ACTIVITY_TABLE)!.get(ACTIVITY_ID)!.status).toBe("ACTIVE")
  })

  it("a confirmation that cannot answer throws, writing no tombstone and leaving the receipt open", async () => {
    const w = await world({ answer: new Error("provider 503") })
    await expect(retractActivity(w.message, w.deps)).rejects.toThrow("provider 503")
    expect(w.tables.get(ACTIVITY_TABLE)!.get(ACTIVITY_ID)!.status).toBe("ACTIVE")
    expect(w.tables.get(INGEST_RECEIPT_TABLE)!.get(KEY)!.status).toBe("QUEUED")
  })
})

describe("RetractMessage", () => {
  it("is told apart from an IngestJob and a DisconnectMessage by command", () => {
    expect(isRetractMessage({ command: "retract", source: SOURCE, userId: USER, externalId: EXTERNAL, ingestKey: KEY })).toBe(true)
    expect(isRetractMessage({ command: "ingest", source: SOURCE, userId: USER, externalId: EXTERNAL, ingestKey: KEY })).toBe(false)
    expect(isRetractMessage({ command: "disconnect", source: SOURCE, userId: USER })).toBe(false)
    expect(isRetractMessage({ command: "retract", source: SOURCE, userId: USER })).toBe(false)
    expect(isRetractMessage(null)).toBe(false)
  })
})
