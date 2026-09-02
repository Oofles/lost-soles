import { readFileSync } from "node:fs"

import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb"
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  CAPTURE_GUARD_TABLE,
  claimIdempotencyKey,
  consumeRateBudget,
  RATE_PER_DAY,
  RATE_PER_HOUR,
  recordIdempotentResult,
  releaseIdempotencyKey,
  __setDocClient,
} from "./capture-store"

/**
 * Ticket 0019. DynamoDB is stubbed at the document-client boundary — a "unit test"
 * that provisions a real table is not one, and would make the suite unrunnable in
 * CI and rate-limited against itself on a second run.
 *
 * What is NOT stubbed is the key derivation, the conditional expressions or the TTL
 * arithmetic. Those are the parts that carry the guarantees, so the assertions below
 * read the actual command input rather than trusting that a call was made.
 */

const conditionalFailure = () =>
  new ConditionalCheckFailedException({ $metadata: {}, message: "the conditional request failed" })

/**
 * Only the fields these tests assert on. Spelled out rather than reached for with
 * `any`, so a rename in `capture-store.ts` — `ConditionExpression` losing its
 * capital, say — fails the typecheck instead of quietly asserting `undefined`
 * against `undefined` and passing.
 */
interface SentCommand {
  input: {
    TableName: string
    Key: Record<string, string>
    Item: Record<string, unknown>
    ConditionExpression: string
    UpdateExpression: string
    ExpressionAttributeValues: Record<string, unknown>
    ConsistentRead: boolean
  }
}

/** A stub whose `send` is a queue of scripted outcomes, in call order. */
function stubClient(outcomes: Array<unknown | Error>) {
  const sent: SentCommand[] = []
  const send = vi.fn(async (command: SentCommand) => {
    sent.push(command)
    const next = outcomes.shift()
    if (next instanceof Error) throw next
    return next ?? {}
  })
  __setDocClient({ send } as unknown as DynamoDBDocumentClient)
  return { sent, send }
}

afterEach(() => {
  __setDocClient(null)
  vi.restoreAllMocks()
})

const NOW = new Date("2026-09-02T14:37:00Z")
const USER = "b3f1c2d4-0000-4000-8000-000000000001"
const KEY = "8f1a0c62-4f0b-4a1e-9c3d-2b6e5a7d0f11" // gitleaks:allow

describe("the table name is stated once per side and the two agree", () => {
  it("matches the literal in amplify/backend.ts", () => {
    // The SSR compute has no CloudFormation output to read a generated name from,
    // so the name is a literal in two files. A drift between them is a runtime
    // ResourceNotFoundException on a note that was dictated once — cheap to catch
    // here, expensive to discover there.
    const backend = readFileSync(new URL("../../amplify/backend.ts", import.meta.url), "utf8")
    expect(backend).toContain(`tableName: "${CAPTURE_GUARD_TABLE}"`)
  })
})

describe("idempotency (§6.4/9)", () => {
  it("claims an unseen key with a conditional put and a 24-hour TTL", async () => {
    const { sent } = stubClient([{}])
    await expect(claimIdempotencyKey(USER, KEY, NOW)).resolves.toEqual({ kind: "claimed" })

    const input = sent[0].input
    expect(input.TableName).toBe(CAPTURE_GUARD_TABLE)
    expect(input.ConditionExpression).toBe("attribute_not_exists(pk)")
    expect(input.Item.pk).toBe(`IDEM#${USER}#${KEY}`)
    expect(input.Item.state).toBe("pending")
    expect(input.Item.ttl).toBe(Math.floor(NOW.getTime() / 1000) + 24 * 60 * 60)
  })

  it("replays a completed key with the ORIGINAL path and sha", async () => {
    // Criterion 9. The whole reason 0022's retry queue is safe to build.
    const { sent } = stubClient([
      conditionalFailure(),
      { Item: { state: "done", path: "tickets/inbox/2026-09-02T1437-a.md", commitSha: "deadbeef" } },
    ])

    await expect(claimIdempotencyKey(USER, KEY, NOW)).resolves.toEqual({
      kind: "replay",
      result: { path: "tickets/inbox/2026-09-02T1437-a.md", commitSha: "deadbeef" },
    })
    // A stale read here would replay a path that does not exist yet.
    expect(sent[1].input.ConsistentRead).toBe(true)
  })

  it("reports a fresh pending claim as in-flight rather than committing twice", async () => {
    stubClient([
      conditionalFailure(),
      { Item: { state: "pending", claimedAt: NOW.getTime() - 5_000 } },
    ])
    await expect(claimIdempotencyKey(USER, KEY, NOW)).resolves.toEqual({ kind: "in-flight" })
  })

  it("takes over an ABANDONED claim, conditionally on it not having changed", async () => {
    // A Lambda killed mid-commit leaves a `pending` nobody will ever finish. Honouring
    // it for the full 24 hours would make a note un-resendable under its own key —
    // permanent loss of the thing this endpoint exists to preserve.
    const claimedAt = NOW.getTime() - 300_000
    const { sent } = stubClient([
      conditionalFailure(),
      { Item: { state: "pending", claimedAt } },
      {},
    ])

    await expect(claimIdempotencyKey(USER, KEY, NOW)).resolves.toEqual({ kind: "claimed" })
    // Conditional on the claim it READ, so two requests cannot both adopt the same
    // stale claim.
    expect(sent[2].input.ConditionExpression).toBe("claimedAt = :seen")
    expect(sent[2].input.ExpressionAttributeValues[":seen"]).toBe(claimedAt)
  })

  it("yields to whoever wins the takeover race", async () => {
    stubClient([
      conditionalFailure(),
      { Item: { state: "pending", claimedAt: NOW.getTime() - 300_000 } },
      conditionalFailure(),
    ])
    await expect(claimIdempotencyKey(USER, KEY, NOW)).resolves.toEqual({ kind: "in-flight" })
  })

  it("retries the claim when the record vanished between the put and the read", async () => {
    // The TTL fired, or a failed attempt released it, in the microseconds between.
    stubClient([conditionalFailure(), { Item: undefined }, {}])
    await expect(claimIdempotencyKey(USER, KEY, NOW)).resolves.toEqual({ kind: "claimed" })
  })

  it("PROPAGATES a non-conditional DynamoDB failure instead of guessing", async () => {
    // D-176. "The store could not answer" and "the key is unused" are different
    // facts, and a control that returns the same value for both has failed open.
    stubClient([new Error("ProvisionedThroughputExceeded")])
    await expect(claimIdempotencyKey(USER, KEY, NOW)).rejects.toThrow(
      "ProvisionedThroughputExceeded",
    )
  })

  it("records the result so the next send of the key replays it", async () => {
    const { sent } = stubClient([{}])
    await recordIdempotentResult(
      USER,
      KEY,
      { path: "tickets/inbox/2026-09-02T1437-a.md", commitSha: "cafe" },
      NOW,
    )
    expect(sent[0].input.Item).toMatchObject({
      pk: `IDEM#${USER}#${KEY}`,
      state: "done",
      path: "tickets/inbox/2026-09-02T1437-a.md",
      commitSha: "cafe",
    })
  })

  it("swallows a failure while releasing, because the caller is already failing", async () => {
    // Replacing a useful 429 with an opaque 500 because the cleanup failed would be
    // strictly worse for the operator. The TTL is the backstop.
    stubClient([new Error("throttled")])
    await expect(releaseIdempotencyKey(USER, KEY)).resolves.toBeUndefined()
  })
})

describe("rate limits (§6.4/5)", () => {
  it("increments the hour and day buckets, each with a TTL that is not refreshed", async () => {
    const { sent } = stubClient([{}, {}])
    await expect(consumeRateBudget(USER, NOW)).resolves.toEqual({ ok: true })

    expect(sent[0].input.Key.pk).toBe(`RATE#${USER}#hour:2026-09-02T14`)
    expect(sent[1].input.Key.pk).toBe(`RATE#${USER}#day:2026-09-02`)

    for (const command of sent) {
      // Criterion 8: the counter row carries a TTL. `if_not_exists` is what makes it
      // real — a TTL rewritten on every increment is a row that never expires, which
      // satisfies the criterion in letter and defeats it in fact.
      expect(command.input.UpdateExpression).toContain("if_not_exists(#ttl, :ttl)")
    }
  })

  it("REFUSES the increment at the cap rather than counting past it", async () => {
    // Criterion 8. The conditional is what keeps a runaway retry loop from writing
    // a counter of 4,000 that is only compared afterwards.
    const { sent } = stubClient([conditionalFailure()])
    await expect(consumeRateBudget(USER, NOW)).resolves.toEqual({ ok: false, window: "hour" })
    expect(sent[0].input.ConditionExpression).toBe(
      "attribute_not_exists(#count) OR #count < :max",
    )
    expect(sent[0].input.ExpressionAttributeValues[":max"]).toBe(RATE_PER_HOUR)
  })

  it("does not touch the day bucket once the hour bucket has refused", async () => {
    const { send } = stubClient([conditionalFailure()])
    await consumeRateBudget(USER, NOW)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it("catches the daily cap even when the hour is clear", async () => {
    const { sent } = stubClient([{}, conditionalFailure()])
    await expect(consumeRateBudget(USER, NOW)).resolves.toEqual({ ok: false, window: "day" })
    expect(sent[1].input.ExpressionAttributeValues[":max"]).toBe(RATE_PER_DAY)
  })

  it("PROPAGATES a non-conditional failure rather than reporting the caller under budget", async () => {
    stubClient([new Error("ResourceNotFoundException")])
    await expect(consumeRateBudget(USER, NOW)).rejects.toThrow("ResourceNotFoundException")
  })

  it("scopes every counter to one user", async () => {
    const { sent } = stubClient([{}, {}])
    await consumeRateBudget("someone-else", NOW)
    expect(sent[0].input.Key.pk).toContain("someone-else")
    expect(sent[0].input.Key.pk).not.toContain(USER)
  })

  it("holds the caps §6.4/5 states", () => {
    expect(RATE_PER_HOUR).toBe(30)
    expect(RATE_PER_DAY).toBe(200)
  })
})
