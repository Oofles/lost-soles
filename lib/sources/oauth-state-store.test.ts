import { readFileSync } from "node:fs"

import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb"
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb"
import { afterEach, describe, expect, it, vi } from "vitest"

import { consumeState, issueState, OAUTH_STATE_TABLE, __setDocClient } from "./oauth-state-store"

/**
 * Ticket 0032 criterion 2. DynamoDB is stubbed at the document-client boundary; the
 * key derivation, the conditional expressions and the expiry arithmetic run for real,
 * because those are the parts carrying the guarantee.
 */

interface SentCommand {
  input: {
    TableName: string
    Key: Record<string, string>
    Item: Record<string, unknown>
    ConditionExpression: string
    ReturnValues: string
  }
}

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

const conditionalFailure = () =>
  new ConditionalCheckFailedException({ $metadata: {}, message: "the conditional request failed" })

afterEach(() => {
  __setDocClient(null)
  vi.restoreAllMocks()
})

const NOW = new Date("2026-09-04T14:37:00Z")
const NOW_S = Math.floor(NOW.getTime() / 1000)
const USER = "b3f1c2d4-0000-4000-8000-000000000001"

/**
 * Not a hex-shaped fixture, deliberately. `scripts/check-design-tokens.mjs` reads
 * `#abc` in a composite key as a three-digit CSS colour and fails the build — the
 * defect ticket 0146 carries, and the reason `capture-store.ts` joins its window
 * marker with `:` rather than `#`. Until 0146 lands, fixtures here stay unhexish.
 */
const NONCE = "the-nonce-value"

describe("the table name is stated once per side and the two agree", () => {
  it("matches the literal in amplify/backend.ts", () => {
    const backend = readFileSync(new URL("../../amplify/backend.ts", import.meta.url), "utf8")
    expect(backend).toContain(`tableName: "${OAUTH_STATE_TABLE}"`)
  })
})

describe("issuing a nonce", () => {
  it("writes a row bound to the user and source, with both expiries", async () => {
    const { sent } = stubClient([{}])
    const { state } = await issueState({ userId: USER, sourceId: "acme", now: NOW })

    const input = sent[0].input
    expect(input.TableName).toBe(OAUTH_STATE_TABLE)
    expect(input.Item.pk).toBe(`STATE#${state}`)
    expect(input.Item.userId).toBe(USER)
    expect(input.Item.sourceId).toBe("acme")
    // Ten minutes, twice: DynamoDB's lazy TTL and the one actually enforced on read.
    expect(input.Item.ttl).toBe(NOW_S + 600)
    expect(input.Item.expiresAt).toBe(NOW_S + 600)
    expect(input.ConditionExpression).toBe("attribute_not_exists(pk)")
  })

  it("produces a URL-safe value with real entropy, different every time", async () => {
    stubClient([{}, {}])
    const a = await issueState({ userId: USER, sourceId: "acme", now: NOW })
    const b = await issueState({ userId: USER, sourceId: "acme", now: NOW })

    expect(a.state).not.toBe(b.state)
    // base64url: no padding, nothing needing percent-encoding on the round trip
    // through the provider's redirect.
    expect(a.state).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(a.state.length).toBeGreaterThanOrEqual(40)
  })

  it("fails closed when DynamoDB cannot record it", async () => {
    // No stored nonce means no CSRF check on the callback. A connect that skipped it
    // would be worse than one that did not happen.
    stubClient([new Error("dynamo is down")])
    await expect(issueState({ userId: USER, sourceId: "acme", now: NOW })).rejects.toThrow()
  })
})

describe("consuming a nonce — the four rejections of criterion 2", () => {
  it("consumes a valid nonce with a conditional DELETE, returning its binding", async () => {
    const { sent } = stubClient([
      { Attributes: { userId: USER, sourceId: "acme", expiresAt: NOW_S + 300 } },
    ])

    await expect(consumeState(NONCE, NOW)).resolves.toEqual({ userId: USER, sourceId: "acme" })

    const input = sent[0].input
    // The DELETE is the claim. A read-then-delete has a window in which a replayed
    // callback and the original both see a valid nonce — and a replayed callback is
    // exactly the request that arrives twice.
    expect(input.Key.pk).toBe(`STATE#${NONCE}`)
    expect(input.ConditionExpression).toBe("attribute_exists(pk)")
    expect(input.ReturnValues).toBe("ALL_OLD")
  })

  it("rejects a MISSING state without touching DynamoDB at all", async () => {
    const { send } = stubClient([])
    await expect(consumeState(null, NOW)).resolves.toBeNull()
    await expect(consumeState("", NOW)).resolves.toBeNull()
    expect(send).not.toHaveBeenCalled()
  })

  it("rejects an UNKNOWN state", async () => {
    stubClient([conditionalFailure()])
    await expect(consumeState("never-issued", NOW)).resolves.toBeNull()
  })

  it("rejects an ALREADY-CONSUMED state — the second call finds nothing", async () => {
    stubClient([
      { Attributes: { userId: USER, sourceId: "acme", expiresAt: NOW_S + 300 } },
      conditionalFailure(),
    ])
    await expect(consumeState(NONCE, NOW)).resolves.not.toBeNull()
    await expect(consumeState(NONCE, NOW)).resolves.toBeNull()
  })

  it("rejects an EXPIRED state even though DynamoDB still returned the row", async () => {
    // DynamoDB's TTL sweep runs up to 48 hours late, so the row being readable proves
    // nothing about it being live. This check is why the ten minutes is real.
    stubClient([{ Attributes: { userId: USER, sourceId: "acme", expiresAt: NOW_S - 1 } }])
    await expect(consumeState("stale", NOW)).resolves.toBeNull()
  })

  it("rejects a row with no usable binding rather than guessing", async () => {
    stubClient([{ Attributes: { expiresAt: NOW_S + 300 } }])
    await expect(consumeState("odd", NOW)).resolves.toBeNull()
  })

  it("fails closed — a DynamoDB error is not a rejection, it is an error", async () => {
    // Returning null here would look identical to "invalid nonce" and would be a
    // silent CSRF bypass the day DynamoDB throttles. Same rule as capture-store.
    stubClient([new Error("dynamo is down")])
    await expect(consumeState(NONCE, NOW)).rejects.toThrow()
  })
})
