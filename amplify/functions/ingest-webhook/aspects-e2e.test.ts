import { GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb"
import type { LambdaFunctionURLEvent } from "aws-lambda"
import { describe, expect, it, vi } from "vitest"

import type { IngestJob } from "@/src/adapters/types"
import type { SourceId } from "@/src/domain/activity"
import { computeActivityId } from "@/src/domain/activity-id"
import { isDisconnectMessage } from "@/src/pipeline/disconnect-message"
import { INGEST_RECEIPT_TABLE, recordDelivery } from "@/src/pipeline/ingest-receipt"
import { retractActivity } from "@/src/pipeline/retract"
import { isRetractMessage } from "@/src/pipeline/retract-message"

import { handleWebhook, type WebhookDeps } from "./handler"

/**
 * Ticket 0282 — an activity's `update` and `delete`, END TO END: the public webhook (real adapter,
 * real receipt gate, real flood counter) writes into the SAME receipt store the worker then reads,
 * and the message it sends is what the worker acts on. The unit halves are `handler.test.ts`,
 * `accept.test.ts`, `src/pipeline/retract.test.ts` and `process-activity.test.ts`.
 */
vi.mock("@/src/adapters/strava/subscription", () => ({ STRAVA_SUBSCRIPTION_ID: 120475 }))
vi.spyOn(console, "info").mockImplementation(() => {})

const KNOWN_OWNER = "51449053"
const OWNER_SUB = "5488e4b8-d081-7014-748e-edd1937f8083"
const PATH = "/api/webhooks/strava"
const SOURCE = PATH.split("/").pop() as SourceId
const ACTIVITY_TABLE = "Activity-testapi-NONE"
const ACTIVITY_ID = computeActivityId(OWNER_SUB, SOURCE, "1360128428")

const post = (body: Record<string, unknown>): LambdaFunctionURLEvent =>
  ({
    rawPath: PATH,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      object_type: "activity",
      object_id: 1360128428,
      aspect_type: "create",
      updates: {},
      owner_id: Number(KNOWN_OWNER),
      subscription_id: 120475,
      event_time: 1760000000,
      ...body,
    }),
    isBase64Encoded: false,
    requestContext: { http: { method: "POST" } },
  }) as unknown as LambdaFunctionURLEvent

/** Both tables, one store. Understands exactly the writes these two paths send. */
function world() {
  const receipts = new Map<string, Record<string, unknown>>()
  const activities = new Map<string, Record<string, unknown>>([
    [ACTIVITY_ID, { id: ACTIVITY_ID, userId: OWNER_SUB, status: "ACTIVE", xpAwarded: 120, cellCount: 40 }],
  ])
  const fail = () => Object.assign(new Error("condition"), { name: "ConditionalCheckFailedException" })
  const ddb = {
    async send(command: PutCommand | UpdateCommand | GetCommand): Promise<Record<string, unknown>> {
      const input = command.input as Record<string, unknown> & { TableName: string; Key?: Record<string, unknown> }
      const table = input.TableName === INGEST_RECEIPT_TABLE ? receipts : activities
      if (command instanceof GetCommand) {
        const row = table.get(String(Object.values(input.Key!)[0]))
        return row ? { Item: { ...row } } : {}
      }
      if (command instanceof PutCommand) {
        const item = command.input.Item as Record<string, unknown>
        const existing = receipts.get(String(item.ingestKey))
        const reopens = command.input.ConditionExpression === "attribute_not_exists(ingestKey) OR #status = :reclaimable"
        if (existing && !(reopens && existing.status === "RECLAIMABLE")) throw fail()
        receipts.set(String(item.ingestKey), { ...item })
        return {}
      }
      const key = String(Object.values(input.Key!)[0])
      const expr = String(input.UpdateExpression)
      const values = (input.ExpressionAttributeValues ?? {}) as Record<string, unknown>
      const row = table.get(key)
      if (expr.startsWith("ADD #n :one")) {
        const next = Number(row?.eventCount ?? 0) + 1
        table.set(key, { ...row, eventCount: next })
        return { Attributes: { eventCount: next } }
      }
      if (!row) throw fail()
      if (expr === "ADD attempts :one") {
        row.attempts = Number(row.attempts ?? 0) + 1
        return { Attributes: { attempts: row.attempts } }
      }
      if (expr.startsWith("SET #status = :reclaimable")) {
        if (row.status === "DONE") throw fail()
        Object.assign(row, { status: "RECLAIMABLE", xpAwarded: 0, newCellCount: 0 })
        return {}
      }
      if (expr.startsWith("SET #status = :done")) {
        Object.assign(row, { status: "DONE", xpAwarded: 0, newCellCount: 0 })
        return {}
      }
      if (expr === "SET #status = :tombstoned, updatedAt = :now") {
        if (row.userId !== values[":uid"] || row.status === "TOMBSTONED") throw fail()
        Object.assign(row, { status: "TOMBSTONED", updatedAt: values[":now"] })
        return {}
      }
      throw new Error(`fake: unsupported update ${expr}`)
    },
  }
  const sent: string[] = []
  const webhook: WebhookDeps = {
    receipt: { ddb: ddb as never, now: () => new Date("2026-10-18T12:00:00Z") },
    async send(body) {
      sent.push(body)
    },
  }
  return { receipts, activities, ddb, sent, webhook }
}

/** `0301`. The raw archive the retraction record goes to; its own behaviour is `retract.test.ts`. */
const RAW_ARCHIVE = { s3: { send: async () => ({}) }, bucket: "raw" }

describe("a delete, webhook to tombstone", () => {
  it("a confirmed deletion tombstones the run and keeps its XP and cells; the receipt ends DONE", async () => {
    const w = world()
    expect(await handleWebhook(post({ aspect_type: "delete" }), w.webhook)).toEqual({ statusCode: 200, body: "" })
    expect(w.sent).toHaveLength(1)
    const message: unknown = JSON.parse(w.sent[0]!)
    if (!isRetractMessage(message)) throw new Error("expected a RetractMessage on the queue")

    const confirm = vi.fn(async () => "gone" as const)
    const outcome = await retractActivity(message, {
      confirm,
      receipt: { ddb: w.ddb as never },
      persist: { ddb: w.ddb as never, activityTable: ACTIVITY_TABLE },
      archive: RAW_ARCHIVE,
    })
    expect(outcome).toBe("tombstoned")
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ externalId: "1360128428", userId: OWNER_SUB }))
    expect(w.activities.get(ACTIVITY_ID)).toMatchObject({ status: "TOMBSTONED", xpAwarded: 120, cellCount: 40 })
    expect(w.receipts.get(message.ingestKey)).toMatchObject({ status: "DONE", attempts: 1, activityId: ACTIVITY_ID })
  })

  it("a forged deletion (the source still has the run) leaves it ACTIVE", async () => {
    const w = world()
    await handleWebhook(post({ aspect_type: "delete" }), w.webhook)
    const message = JSON.parse(w.sent[0]!)
    const outcome = await retractActivity(message, {
      confirm: async () => "present",
      receipt: { ddb: w.ddb as never },
      persist: { ddb: w.ddb as never, activityTable: ACTIVITY_TABLE },
      archive: RAW_ARCHIVE,
    })
    expect(outcome).toBe("forged-or-stale")
    expect(w.activities.get(ACTIVITY_ID)!.status).toBe("ACTIVE")
  })

  /** Ticket 0288 — the reproduction steps, end to end. */
  it("a forged deletion does not pre-empt the genuine one; the genuine one's redeliveries are duplicates", async () => {
    const w = world()
    const worker = (answer: "gone" | "present") => {
      const message: unknown = JSON.parse(w.sent.at(-1)!)
      if (!isRetractMessage(message)) throw new Error("expected a RetractMessage on the queue")
      return retractActivity(message, {
        confirm: async () => answer,
        receipt: { ddb: w.ddb as never },
        persist: { ddb: w.ddb as never, activityTable: ACTIVITY_TABLE },
        archive: RAW_ARCHIVE,
      })
    }

    // 1–2. The forgery: Strava still has the run.
    await handleWebhook(post({ aspect_type: "delete" }), w.webhook)
    expect(await worker("present")).toBe("forged-or-stale")
    expect(w.activities.get(ACTIVITY_ID)!.status).toBe("ACTIVE")

    // 3. The genuine delete, same key: re-claimed, confirmed, tombstoned.
    await handleWebhook(post({ aspect_type: "delete" }), w.webhook)
    expect(w.sent).toHaveLength(2)
    expect(await worker("gone")).toBe("tombstoned")
    expect(w.activities.get(ACTIVITY_ID)!.status).toBe("TOMBSTONED")

    // Strava's retries of it: one receipt, no further message, no second tombstone.
    await handleWebhook(post({ aspect_type: "delete" }), w.webhook)
    await handleWebhook(post({ aspect_type: "delete" }), w.webhook)
    expect(w.sent).toHaveLength(2)
    expect([...w.receipts.values()].find((r) => r.status === "DONE")).toBeDefined()
  })
})

describe("an update, webhook to the worker's fetch path", () => {
  it("queues an ordinary IngestJob whose receipt the worker's first step finds", async () => {
    const w = world()
    await handleWebhook(post({ aspect_type: "update", updates: { title: "x" } }), w.webhook)
    const message: unknown = JSON.parse(w.sent[0]!)
    // The worker's routing: neither special shape, so it is read as a job.
    expect(isRetractMessage(message)).toBe(false)
    expect(isDisconnectMessage(message)).toBe(false)
    const job = message as IngestJob
    // `command: "ingest"`: the fetch path, never 0192's archive replay.
    expect(job.command).toBe("ingest")
    expect(await recordDelivery(job.ingestKey, { ddb: w.ddb as never })).toBe(1)
    expect(w.receipts.get(job.ingestKey)).toMatchObject({ status: "QUEUED", activityId: ACTIVITY_ID })
  })
})
