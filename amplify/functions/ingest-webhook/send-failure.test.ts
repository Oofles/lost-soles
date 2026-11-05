import { createHash } from "node:crypto"

import { GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb"
import type { LambdaFunctionURLEvent } from "aws-lambda"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { IngestJob } from "@/src/adapters/types"
import type { SourceId } from "@/src/domain/activity"
import { computeActivityId } from "@/src/domain/activity-id"
import { INGEST_RECEIPT_TABLE, releaseUnsentReceipt } from "@/src/pipeline/ingest-receipt"
import { needsEnqueue } from "@/lib/sources/sync"

import { handleWebhook, type WebhookDeps } from "./handler"

/**
 * Ticket 0292 — THE HOLE BETWEEN THE TWO WRITES, per aspect. The webhook accepts, then sends; a
 * failed send answers 500 and Strava retries. For a `create` the sweep fills the hole; for an
 * `update` or a `delete` nothing mints the key again, so the webhook releases the receipt to
 * `RECLAIMABLE` and the retry re-claims it.
 *
 * The fake receipt table evaluates the three Put conditions the code sends, BY THEIR TEXT, so a
 * changed condition fails here rather than passing against a fake that ignores it.
 */
vi.mock("@/src/adapters/strava/subscription", () => ({ STRAVA_SUBSCRIPTION_ID: 120475 }))

const logs: string[] = []
vi.spyOn(console, "info").mockImplementation((line: unknown) => {
  logs.push(String(line))
})
afterEach(() => {
  logs.length = 0
})

const KNOWN_OWNER = "51449053"
const OWNER_SUB = "5488e4b8-d081-7014-748e-edd1937f8083"
const PATH = "/api/webhooks/strava"
const SOURCE = PATH.split("/").pop() as SourceId
const OBJECT = "1360128428"
const EVENT_TIME = 1760000000

const keyOf = (suffix: string) => createHash("sha256").update(`strava:${KNOWN_OWNER}:${OBJECT}:${suffix}`).digest("hex")
const CREATE_KEY = keyOf("create")
const UPDATE_KEY = keyOf(`update:${EVENT_TIME}`)
const DELETE_KEY = keyOf("delete")

const post = (aspect: "create" | "update" | "delete"): LambdaFunctionURLEvent =>
  ({
    rawPath: PATH,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      object_type: "activity",
      object_id: Number(OBJECT),
      aspect_type: aspect,
      updates: aspect === "update" ? { title: "x" } : {},
      owner_id: Number(KNOWN_OWNER),
      subscription_id: 120475,
      event_time: EVENT_TIME,
    }),
    isBase64Encoded: false,
    requestContext: { http: { method: "POST" } },
  }) as unknown as LambdaFunctionURLEvent

const RELEASE_CONDITION = "#status = :queued AND attempts = :zero"

function world(opts: { releaseThrows?: boolean } = {}) {
  const receipts = new Map<string, Record<string, unknown>>()
  const fail = () => Object.assign(new Error("condition"), { name: "ConditionalCheckFailedException" })
  const ddb = {
    async send(command: PutCommand | UpdateCommand | GetCommand): Promise<Record<string, unknown>> {
      const input = command.input as Record<string, unknown>
      if (input.TableName !== INGEST_RECEIPT_TABLE) throw new Error("fake: wrong table")
      if (command instanceof GetCommand) {
        const row = receipts.get(String((input.Key as { ingestKey: string }).ingestKey))
        return row ? { Item: { ...row } } : {}
      }
      if (command instanceof UpdateCommand) {
        // Only the flood counter reaches UpdateItem from the webhook (D-349).
        const key = String((input.Key as { ingestKey: string }).ingestKey)
        expect(key.startsWith("rate#")).toBe(true)
        const next = Number(receipts.get(key)?.eventCount ?? 0) + 1
        receipts.set(key, { eventCount: next })
        return { Attributes: { eventCount: next } }
      }
      const item = input.Item as Record<string, unknown>
      const existing = receipts.get(String(item.ingestKey))
      const condition = String(input.ConditionExpression)
      let ok: boolean
      if (condition === "attribute_not_exists(ingestKey)") ok = !existing
      else if (condition === "attribute_not_exists(ingestKey) OR #status = :reclaimable") ok = !existing || existing.status === "RECLAIMABLE"
      else if (condition === RELEASE_CONDITION) {
        if (opts.releaseThrows) throw Object.assign(new Error("throttled"), { name: "ProvisionedThroughputExceededException" })
        ok = !!existing && existing.status === "QUEUED" && existing.attempts === 0
      } else throw new Error(`fake: unsupported condition ${condition}`)
      if (!ok) throw fail()
      receipts.set(String(item.ingestKey), { ...item })
      return {}
    },
  }
  const sent: string[] = []
  let sendFails = false
  const deps: WebhookDeps = {
    receipt: { ddb: ddb as never, now: () => new Date("2026-10-19T12:00:00Z") },
    async send(body) {
      if (sendFails) throw Object.assign(new Error("queue down"), { name: "QueueDoesNotExist" })
      sent.push(body)
    },
  }
  return {
    receipts,
    sent,
    deps,
    ddb,
    failSends: (v: boolean) => {
      sendFails = v
    },
  }
}

describe.each([
  ["update", UPDATE_KEY, "queued"],
  ["delete", DELETE_KEY, "retract-queued"],
] as const)("a send failure on an %s", (aspect, key, outcome) => {
  it("answers 500, leaves the key RECLAIMABLE, and Strava's retry queues it", async () => {
    const w = world()
    w.failSends(true)
    expect(await handleWebhook(post(aspect), w.deps)).toEqual({ statusCode: 500, body: "" })
    expect(w.receipts.get(key)).toMatchObject({ status: "RECLAIMABLE", attempts: 0, userId: OWNER_SUB })
    expect(w.receipts.get(key)?.activityId).toBe(computeActivityId(OWNER_SUB, SOURCE, OBJECT))
    expect(logs.join("\n")).toContain('"decision":"send-failed-released"')

    w.failSends(false)
    expect(await handleWebhook(post(aspect), w.deps)).toEqual({ statusCode: 200, body: "" })
    expect(w.sent.map((m) => JSON.parse(m).ingestKey)).toEqual([key])
    expect(w.receipts.get(key)).toMatchObject({ status: "QUEUED", attempts: 0 })
    expect(logs.join("\n")).toContain(`"outcome":"${outcome}"`)

    // And once queued, a further redelivery is a duplicate again.
    await handleWebhook(post(aspect), w.deps)
    expect(w.sent).toHaveLength(1)
  })

  it("if the release itself fails, still answers 500 and logs it; nothing throws past the handler", async () => {
    const w = world({ releaseThrows: true })
    w.failSends(true)
    expect(await handleWebhook(post(aspect), w.deps)).toEqual({ statusCode: 500, body: "" })
    expect(w.receipts.get(key)).toMatchObject({ status: "QUEUED" })
    const all = logs.join("\n")
    expect(all).toContain('"decision":"release-failed"')
    expect(all).toContain('"errorClass":"ProvisionedThroughputExceededException"')
    // The send's error is what the 500 reports, not the release's.
    expect(all).toContain('"status":500,"errorClass":"QueueDoesNotExist"')
  })
})

describe("a send failure on a create", () => {
  it("leaves the key QUEUED, the retry stays a duplicate, and the sweep's needsEnqueue re-sends it", async () => {
    const w = world()
    w.failSends(true)
    expect(await handleWebhook(post("create"), w.deps)).toEqual({ statusCode: 500, body: "" })
    expect(w.receipts.get(CREATE_KEY)).toMatchObject({ status: "QUEUED", attempts: 0 })
    expect(logs.join("\n")).not.toContain("send-failed")

    w.failSends(false)
    await handleWebhook(post("create"), w.deps)
    expect(w.sent).toHaveLength(0)
    expect(logs.join("\n")).toContain('"outcome":"duplicate"')

    const job = { ingestKey: CREATE_KEY, source: SOURCE, externalId: OBJECT } as IngestJob
    expect(await needsEnqueue(job, OWNER_SUB, { receipt: w.deps.receipt as never })).toBe(true)
  })
})

describe("releaseUnsentReceipt's condition", () => {
  const RECEIPT = { ingestKey: "k", userId: OWNER_SUB, activityId: "a", source: SOURCE }

  it.each([
    ["DONE", 1],
    ["PROCESSING", 1],
    ["FAILED", 3],
    ["QUEUED", 1],
  ])("never reopens a %s key (attempts %i)", async (status, attempts) => {
    const w = world()
    w.receipts.set("k", { ...RECEIPT, status, attempts })
    expect(await releaseUnsentReceipt(RECEIPT, w.deps.receipt)).toBe("kept")
    expect(w.receipts.get("k")).toMatchObject({ status, attempts })
  })

  it("never mints a row that does not exist", async () => {
    const w = world()
    expect(await releaseUnsentReceipt(RECEIPT, w.deps.receipt)).toBe("kept")
    expect(w.receipts.has("k")).toBe(false)
  })

  it("is a conditional PutItem on the receipt table, so the webhook needs no new grant", async () => {
    const calls: unknown[] = []
    await releaseUnsentReceipt(RECEIPT, {
      ddb: {
        async send(c) {
          calls.push(c)
          return {}
        },
      },
    })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toBeInstanceOf(PutCommand)
    const input = (calls[0] as PutCommand).input
    expect(input.TableName).toBe(INGEST_RECEIPT_TABLE)
    expect(input.ConditionExpression).toBe(RELEASE_CONDITION)
    expect(input.ExpressionAttributeValues).toEqual({ ":queued": "QUEUED", ":zero": 0 })
    expect(input.Item).toMatchObject({ status: "RECLAIMABLE", attempts: 0, keyKind: "ACCEPT" })
  })
})
