import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb"
import { GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb"
import { describe, expect, it } from "vitest"

import { computeActivityId } from "@/src/domain/activity-id"
import {
  acceptIngest,
  claimForScoring,
  doneTransactItem,
  INGEST_RECEIPT_TABLE,
  markFailed,
  PROCESSING_STALE_MS,
  readReceipt,
  receiptTtl,
  recordDelivery,
  type IngestReceipt,
  type ReceiptDdb,
} from "@/src/pipeline/ingest-receipt"

/**
 * Ticket 0040. DynamoDB is stubbed at the document-client boundary, following
 * `oauth-state-store.test.ts`: the key derivation, the conditional expressions and the
 * TTL arithmetic all run for real, because those are the parts carrying the guarantee.
 * A stub that also evaluated conditions would be a second, wrong implementation of
 * DynamoDB — so the tests assert the EXPRESSIONS SENT, and separately assert the
 * behaviour when DynamoDB reports a condition failed.
 */

const KEY = "e3b0c44298fc1c149afbf4c8996fb924"
const USER = "b3f1c2d4-0000-4000-8000-000000000001"
const NOW = new Date("2026-09-06T12:00:00.000Z")

type Sent = PutCommand | UpdateCommand | GetCommand

/** Replies in order; an `Error` in the list is thrown instead of returned. */
function stub(outcomes: Array<unknown> = []) {
  const sent: Sent[] = []
  const ddb = {
    async send(command: Sent) {
      sent.push(command)
      const next = outcomes.shift()
      if (next instanceof Error) throw next
      return (next ?? {}) as Record<string, unknown>
    },
  } as ReceiptDdb
  return { ddb, sent, deps: { ddb, now: () => NOW } }
}

const conditionFailed = () =>
  new ConditionalCheckFailedException({ $metadata: {}, message: "the conditional request failed" })

const receipt = (over: Partial<IngestReceipt> = {}): IngestReceipt => ({
  ingestKey: KEY,
  keyKind: "ACCEPT",
  status: "QUEUED",
  userId: USER,
  activityId: "a1",
  source: "gpslogger",
  attempts: 1,
  acceptedAt: NOW.toISOString(),
  ttl: receiptTtl(NOW),
  ...over,
})

const ACCEPT = { ingestKey: KEY, userId: USER, activityId: "a1", source: "gpslogger" as const }

describe("the table name", () => {
  /**
   * The SSR compute reads this literal at runtime and has no CloudFormation output to
   * be handed a generated name through, so `amplify/backend.ts` states the same string.
   * Asserted rather than trusted to stay in step — the same guard the other two
   * explicitly-named tables carry.
   */
  it("is the literal amplify/backend.ts declares", () => {
    expect(INGEST_RECEIPT_TABLE).toBe("LostSolesIngestReceipt")
  })
})

describe("receiptTtl", () => {
  /** T8: epoch SECONDS. A millisecond value is silently ignored by DynamoDB — the item
   *  would simply never expire, and the table would grow forever holding nothing. */
  it("is 90 days out, in epoch seconds", () => {
    const ttl = receiptTtl(NOW)
    expect(ttl).toBe(Math.floor(NOW.getTime() / 1000) + 90 * 24 * 60 * 60)
    /** Sanity: a seconds value for 2026 is ~1.8e9, a milliseconds one ~1.8e12. */
    expect(ttl).toBeLessThan(2e10)
  })
})

describe("layer 1 — the accept gate", () => {
  it("PUTs conditionally on the key not existing, as QUEUED with zero attempts", async () => {
    const { deps, sent } = stub()

    expect(await acceptIngest(ACCEPT, deps)).toEqual({ kind: "accepted" })

    const input = (sent[0] as PutCommand).input
    expect(input.TableName).toBe(INGEST_RECEIPT_TABLE)
    expect(input.ConditionExpression).toBe("attribute_not_exists(ingestKey)")
    expect(input.Item).toMatchObject({
      ingestKey: KEY,
      keyKind: "ACCEPT",
      status: "QUEUED",
      userId: USER,
      activityId: "a1",
      /** ZERO. An accept is not a delivery — see `recordDelivery`. */
      attempts: 0,
      ttl: receiptTtl(NOW),
    })
  })

  /**
   * THE REPLAY GATE (§4 step 3). A duplicate is a normal outcome and must not surface
   * as an error, because the endpoint's correct response to one is `200` and silence.
   */
  it("reports a duplicate rather than throwing when the condition fails", async () => {
    const { deps, sent } = stub([conditionFailed()])

    expect(await acceptIngest(ACCEPT, deps)).toEqual({ kind: "duplicate" })
    expect(sent).toHaveLength(1)
  })

  /** Anything that is not a condition failure is a real fault and must not be swallowed. */
  it("propagates a non-conditional error", async () => {
    const { deps } = stub([new Error("ProvisionedThroughputExceeded")])
    await expect(acceptIngest(ACCEPT, deps)).rejects.toThrow("ProvisionedThroughputExceeded")
  })

  it("carries the deterministic activityId, never a fresh one (I-5)", async () => {
    const { deps, sent } = stub()
    const activityId = computeActivityId(USER, "gpslogger", "18736594040123457")

    await acceptIngest({ ...ACCEPT, activityId }, deps)

    expect((sent[0] as PutCommand).input.Item?.activityId).toBe(activityId)
    expect(activityId).toBe(computeActivityId(USER, "gpslogger", "18736594040123457"))
  })
})

describe("attempts counts DELIVERIES", () => {
  /**
   * T8: "`ADD 1` per delivery; ≥ 4 means the DLQ has it". That sentence is only true if
   * the increment happens OUTSIDE the score gate's conditional update — a failed
   * `ConditionExpression` writes nothing, so folding them together would skip exactly
   * the delivery worth counting (D-206).
   */
  it("increments unconditionally on status, in its own write", async () => {
    const { deps, sent } = stub([{ Attributes: { attempts: 3 } }])

    expect(await recordDelivery(KEY, deps)).toBe(3)

    const input = (sent[0] as UpdateCommand).input
    expect(input.UpdateExpression).toBe("ADD attempts :one")
    expect(input.ConditionExpression).toBe("attribute_exists(ingestKey)")
    /** No mention of status anywhere — that is the whole point. */
    expect(JSON.stringify(input)).not.toContain("PROCESSING")
  })

  /**
   * `UpdateItem` UPSERTS. Without the `attribute_exists` guard this would CREATE a
   * receipt for a job that never passed the accept gate — a phantom row in the table
   * whose only purpose is recording what was accepted.
   */
  it("refuses to conjure a receipt for a job that was never accepted", async () => {
    const { deps } = stub([conditionFailed()])
    await expect(recordDelivery(KEY, deps)).rejects.toBeInstanceOf(ConditionalCheckFailedException)
  })
})

describe("layer 2 — the score gate", () => {
  it("claims a QUEUED receipt, guarded on QUEUED or a stale PROCESSING", async () => {
    const { deps, sent } = stub([{ Attributes: receipt({ status: "PROCESSING", attempts: 1 }) }])

    expect(await claimForScoring(KEY, deps)).toEqual({ kind: "claimed", attempts: 1 })

    const input = (sent[0] as UpdateCommand).input
    expect(input.UpdateExpression).toBe("SET #status = :processing, processingStartedAt = :now")
    expect(input.ConditionExpression).toBe(
      "attribute_exists(ingestKey) AND (#status = :queued OR " +
        "(#status = :processing AND processingStartedAt < :stale))",
    )
    /** The cutoff is the Lambda timeout behind `now`, not an arbitrary constant. */
    expect(input.ExpressionAttributeValues?.[":stale"]).toBe(
      new Date(NOW.getTime() - PROCESSING_STALE_MS).toISOString(),
    )
    expect(PROCESSING_STALE_MS).toBe(15 * 60 * 1000)
  })

  /**
   * CRITERION 7, the case where it holds in full. A duplicate that finds a finished
   * winner returns the winner's numbers rather than recomputing them — which, with
   * rules that may have changed since, would not be the same answer (§4: "XP is derived
   * and stored, not recomputed on read").
   */
  it("returns the winner's numbers when the winner has already finished", async () => {
    const { deps, sent } = stub([
      conditionFailed(),
      { Item: receipt({ status: "DONE", xpAwarded: 412, newCellCount: 97 }) },
    ])

    expect(await claimForScoring(KEY, deps)).toEqual({
      kind: "duplicate",
      status: "DONE",
      xpAwarded: 412,
      newCellCount: 97,
    })

    /** The read is on the LOSING path only — the happy path is still one round trip. */
    expect(sent).toHaveLength(2)
    expect(sent[1]).toBeInstanceOf(GetCommand)
  })

  /**
   * CRITERION 7, the case where it cannot. The winner is still in flight, so there are
   * no numbers to return; the honest answer is the status. The loser exits WITHOUT
   * WRITING and SQS redelivers — which is the waiting mechanism that already exists,
   * and is why this does not poll.
   */
  it("exits with the status, and no write, while the winner is still working", async () => {
    const { deps, sent } = stub([conditionFailed(), { Item: receipt({ status: "PROCESSING" }) }])

    const result = await claimForScoring(KEY, deps)

    expect(result).toEqual({ kind: "duplicate", status: "PROCESSING" })
    expect(result).not.toHaveProperty("xpAwarded", expect.anything())
    /** Nothing after the failed claim mutated anything. */
    expect(sent.filter((c) => c instanceof PutCommand || c instanceof UpdateCommand)).toHaveLength(1)
  })

  /**
   * CRASH RECOVERY. An invocation killed mid-flight leaves `PROCESSING` behind. Without
   * the stale clause that receipt would outlive the work it was guarding and silently
   * block its own retry — the activity would never import again.
   */
  it("reclaims a PROCESSING receipt older than the Lambda timeout", async () => {
    const stale = new Date(NOW.getTime() - PROCESSING_STALE_MS - 1000)
    const { deps, sent } = stub([
      { Attributes: receipt({ status: "PROCESSING", processingStartedAt: stale.toISOString() }) },
    ])

    expect(await claimForScoring(KEY, deps)).toMatchObject({ kind: "claimed" })

    /**
     * The reclaim is DynamoDB's to decide, so what is asserted here is that the cutoff
     * handed to it would admit this receipt and reject a fresh one.
     */
    const cutoff = (sent[0] as UpdateCommand).input.ExpressionAttributeValues?.[":stale"] as string
    expect(stale.toISOString() < cutoff).toBe(true)
    expect(NOW.toISOString() < cutoff).toBe(false)
  })

  it("propagates a non-conditional error rather than treating it as a duplicate", async () => {
    const { deps } = stub([new Error("ThrottlingException")])
    await expect(claimForScoring(KEY, deps)).rejects.toThrow("ThrottlingException")
  })
})

describe("two concurrent identical jobs (criterion 7)", () => {
  /**
   * The race, played out: both callers count their delivery, both attempt the claim,
   * DynamoDB's conditional update admits exactly one. The loser reaches no work and
   * writes nothing; once the winner is DONE it reads back the winner's numbers.
   */
  it("lets exactly one through, and the other returns the same result", async () => {
    const winner = stub([{ Attributes: receipt({ status: "PROCESSING" }) }])
    const loser = stub([conditionFailed(), { Item: receipt({ status: "DONE", xpAwarded: 412, newCellCount: 97 }) }])

    const first = await claimForScoring(KEY, winner.deps)
    const second = await claimForScoring(KEY, loser.deps)

    expect(first.kind).toBe("claimed")
    expect(second.kind).toBe("duplicate")

    /** Exactly one caller may proceed to score. */
    expect([first, second].filter((r) => r.kind === "claimed")).toHaveLength(1)

    /** And both agree on the outcome, which is what "the same result" means. */
    const done = doneTransactItem({ ingestKey: KEY, xpAwarded: 412, newCellCount: 97 })
    expect(done.Update?.ExpressionAttributeValues?.[":xpAwarded"]).toBe(
      (second as { xpAwarded?: number }).xpAwarded,
    )
  })
})

describe("layer 3 — the DONE transition is a descriptor, not a write", () => {
  /**
   * §4 layer 3: "XP and the receipt commit or fail together. There is no window in
   * which XP is awarded and the receipt is not advanced." That is only true if this
   * transition rides inside 0041's `TransactWriteItems` — so this module returns an
   * item and never sends one.
   */
  it("is a plain object with no client call", async () => {
    const { deps, sent } = stub()

    const item = doneTransactItem({ ingestKey: KEY, xpAwarded: 412, newCellCount: 97 })

    expect(sent).toHaveLength(0)
    expect(item.Update).toMatchObject({
      TableName: INGEST_RECEIPT_TABLE,
      Key: { ingestKey: KEY },
      ConditionExpression: "#status = :processing",
    })
    expect(item.Update?.ExpressionAttributeValues).toMatchObject({
      ":done": "DONE",
      ":xpAwarded": 412,
      ":newCellCount": 97,
    })
    /** Nothing in this module sends it — 0041 composes it into its own transaction. */
    expect(deps.ddb).toBeDefined()
  })

  /** T8: on DONE the receipt carries the numbers, so a duplicate reads rather than recomputes. */
  it("writes xpAwarded and newCellCount on the same update as the status", async () => {
    const item = doneTransactItem({ ingestKey: KEY, xpAwarded: 0, newCellCount: 0 })
    expect(item.Update?.UpdateExpression).toBe(
      "SET #status = :done, xpAwarded = :xpAwarded, newCellCount = :newCellCount",
    )
  })

  /** Guarded, so a transaction built from a receipt nobody claimed fails as a whole. */
  it("is conditional on the receipt being PROCESSING", async () => {
    const item = doneTransactItem({ ingestKey: KEY, xpAwarded: 1, newCellCount: 1 })
    expect(item.Update?.ConditionExpression).toBe("#status = :processing")
    expect(item.Update?.ExpressionAttributeValues?.[":processing"]).toBe("PROCESSING")
  })
})

describe("markFailed", () => {
  it("closes only a claim the caller holds", async () => {
    const { deps, sent } = stub()

    await markFailed(KEY, deps)

    const input = (sent[0] as UpdateCommand).input
    expect(input.UpdateExpression).toBe("SET #status = :failed")
    expect(input.ConditionExpression).toBe("#status = :processing")
  })

  /**
   * Losing this race means the receipt is no longer PROCESSING — the work finished, or
   * another attempt reclaimed it. Throwing here would mask the ORIGINAL failure that
   * led the caller to call this in the first place.
   */
  it("is silent when the receipt is no longer PROCESSING", async () => {
    const { deps } = stub([conditionFailed()])
    await expect(markFailed(KEY, deps)).resolves.toBeUndefined()
  })

  it("still propagates a real fault", async () => {
    const { deps } = stub([new Error("InternalServerError")])
    await expect(markFailed(KEY, deps)).rejects.toThrow("InternalServerError")
  })
})

describe("readReceipt", () => {
  /**
   * CONSISTENT READ. The caller is deciding whether another invocation has already
   * awarded XP; an eventually-consistent read can answer with a receipt from before the
   * winner's write, which is the one moment the answer must not be stale.
   */
  it("reads consistently", async () => {
    const { deps, sent } = stub([{ Item: receipt({ status: "DONE" }) }])

    expect(await readReceipt(KEY, deps)).toMatchObject({ status: "DONE" })
    expect((sent[0] as GetCommand).input.ConsistentRead).toBe(true)
  })

  it("returns undefined for a receipt that has aged out", async () => {
    const { deps } = stub([{}])
    expect(await readReceipt(KEY, deps)).toBeUndefined()
  })
})
