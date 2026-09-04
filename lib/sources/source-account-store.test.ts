import { readFileSync } from "node:fs"

import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  getSourceAccountSummary,
  markDisconnected,
  putConnectedAccount,
  readAccessTokenForRevocation,
  SOURCE_ACCOUNT_TABLE,
  __setDocClient,
} from "./source-account-store"

/** Ticket 0032 criteria 4, 5 and 7. */

const fx = (...parts: string[]) => parts.join("")
const ACCESS = fx("aaaa1111", "bbbb2222", "cccc3333", "dddd4444")
const REFRESH = fx("eeee5555", "ffff6666", "aaaa7777", "bbbb8888")

interface SentCommand {
  input: {
    TableName: string
    Key: Record<string, string>
    Item: Record<string, unknown>
    UpdateExpression: string
    ProjectionExpression: string
    ExpressionAttributeNames: Record<string, string>
    ExpressionAttributeValues: Record<string, unknown>
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

afterEach(() => {
  __setDocClient(null)
  vi.restoreAllMocks()
})

const NOW = new Date("2026-09-04T14:37:00Z")
const USER = "b3f1c2d4-0000-4000-8000-000000000001"

describe("the table name is stated once per side and the two agree", () => {
  it("matches the literal in amplify/backend.ts", () => {
    const backend = readFileSync(new URL("../../amplify/backend.ts", import.meta.url), "utf8")
    expect(backend).toContain(`tableName: "${SOURCE_ACCOUNT_TABLE}"`)
  })

  it("is a RETAIN table — T7 is the one thing the rebuild drill cannot restore", () => {
    // 02-data-model.md §1.1/§8, I-2. DESTROY here would make a stack teardown
    // silently delete the only non-rebuildable data in the system.
    const backend = readFileSync(new URL("../../amplify/backend.ts", import.meta.url), "utf8")
    const block = backend.slice(backend.indexOf(`tableName: "${SOURCE_ACCOUNT_TABLE}"`))
    expect(block.slice(0, block.indexOf("})"))).toContain("RemovalPolicy.RETAIN")
  })
})

describe("writing the row on a successful connect", () => {
  it("stores exactly what criteria 4 and 5 name", async () => {
    const { sent } = stubClient([{}])
    await putConnectedAccount({
      userId: USER,
      sourceId: "acme",
      externalOwnerId: "134815",
      accessToken: ACCESS,
      refreshToken: REFRESH,
      expiresAt: 1794700000,
      scopes: ["read", "activity:read_all"],
      now: NOW,
    })

    const item = sent[0].input.Item
    expect(sent[0].input.TableName).toBe(SOURCE_ACCOUNT_TABLE)
    expect(item.pk).toBe(`U#${USER}`)
    expect(item.sk).toBe("SRC#acme")

    // Criterion 4: a STRING, because some sources' ids are int64 and JSON.parse
    // corrupts them past 2^53.
    expect(item.externalOwnerId).toBe("134815")
    expect(typeof item.externalOwnerId).toBe("string")

    // Criterion 5: taken from the provider's response, never a TTL constant.
    expect(item.expiresAt).toBe(1794700000)

    expect(item.status).toBe("ACTIVE")
    expect(item.scopes).toEqual(new Set(["read", "activity:read_all"]))
    expect(item.connectedAt).toBe(NOW.toISOString())
  })

  it("holds no hardcoded expiry — a different response gives a different expiresAt", async () => {
    const { sent } = stubClient([{}, {}])
    const base = {
      userId: USER,
      sourceId: "acme",
      externalOwnerId: "1",
      accessToken: ACCESS,
      refreshToken: REFRESH,
      scopes: ["activity:read_all"],
      now: NOW,
    }
    await putConnectedAccount({ ...base, expiresAt: 1794700000 })
    await putConnectedAccount({ ...base, expiresAt: 1800000123 })

    expect(sent[0].input.Item.expiresAt).toBe(1794700000)
    expect(sent[1].input.Item.expiresAt).toBe(1800000123)
  })
})

describe("reading", () => {
  it("does not ask DynamoDB for the token attributes on the general read", async () => {
    const { sent } = stubClient([
      {
        Item: {
          sourceId: "acme",
          externalOwnerId: "134815",
          scopes: new Set(["activity:read_all"]),
          expiresAt: 1794700000,
          status: "ACTIVE",
          connectedAt: NOW.toISOString(),
        },
      },
    ])

    const summary = await getSourceAccountSummary(USER, "acme")

    const projection = sent[0].input.ProjectionExpression
    expect(projection).not.toContain("accessToken")
    expect(projection).not.toContain("refreshToken")
    expect(summary?.scopes).toEqual(["activity:read_all"])
    expect(summary?.status).toBe("ACTIVE")
  })

  it("returns null when the source was never connected", async () => {
    stubClient([{}])
    await expect(getSourceAccountSummary(USER, "acme")).resolves.toBeNull()
  })

  it("reads the access token only through the named revocation door", async () => {
    const { sent } = stubClient([{ Item: { accessToken: ACCESS } }])
    await expect(readAccessTokenForRevocation(USER, "acme")).resolves.toBe(ACCESS)
    expect(sent[0].input.ProjectionExpression).toBe("accessToken")
  })

  it("returns null rather than an empty string when there is no token to revoke", async () => {
    stubClient([{ Item: {} }])
    await expect(readAccessTokenForRevocation(USER, "acme")).resolves.toBeNull()
  })
})

describe("disconnect — criterion 7", () => {
  it("REMOVES the tokens and sets DISCONNECTED", async () => {
    const { sent } = stubClient([{}])
    await markDisconnected({ userId: USER, sourceId: "acme", now: NOW })

    const input = sent[0].input
    expect(input.Key.pk).toBe(`U#${USER}`)
    expect(input.Key.sk).toBe("SRC#acme")

    // REMOVE, not overwrite-with-empty. A blanked token is still a field something
    // might later read as a string; an absent attribute is absent. There is no reason
    // to keep a dead credential (02-data-model.md §1.1).
    expect(input.UpdateExpression).toContain("REMOVE accessToken, refreshToken")
    expect(input.ExpressionAttributeValues[":disconnected"]).toBe("DISCONNECTED")
  })

  it("is idempotent — no condition on the row existing", async () => {
    // The operator who taps disconnect twice, or whose first tap timed out after the
    // write, gets the same end state rather than an error about the state they asked
    // for already being true.
    const { sent } = stubClient([{}])
    await markDisconnected({ userId: USER, sourceId: "acme", now: NOW })
    expect(sent[0].input).not.toHaveProperty("ConditionExpression")
  })
})
