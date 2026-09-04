import { readFileSync } from "node:fs"

import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  acquireRefreshLease,
  EXTERNAL_OWNER_INDEX,
  getSourceAccountSummary,
  loadCredentials,
  markNeedsReauth,
  resolveUserByExternalOwner,
  rotateTokens,
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
    ConditionExpression: string
    IndexName: string
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

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * TICKET 0033
 * ─────────────────────────────────────────────────────────────────────────────
 */

const CONDITIONAL_FAILURE = () => {
  const err = new Error("The conditional request failed")
  err.name = "ConditionalCheckFailedException"
  return err
}

/** Criterion 1. Not "protected by an auth rule" — ABSENT. */
describe("T7 is absent from the AppSync schema, at any auth level", () => {
  const dataResource = readFileSync(new URL("../../amplify/data/resource.ts", import.meta.url), "utf8")

  it("declares no model named after the credential table", () => {
    expect(dataResource).not.toMatch(/SourceAccount\s*:/)
    expect(dataResource).not.toContain(SOURCE_ACCOUNT_TABLE)
  })

  it("exposes only models on an explicit allowlist", () => {
    /**
     * THE ASSERTION THAT ACTUALLY HOLDS THE LINE, rather than the two above.
     *
     * "Does the schema mention SourceAccount" only catches the mistake if someone
     * spells it that way. This catches ANY new model, so adding one is a deliberate act
     * that has to come here and say what it is — which is the point: T7 must stay out of
     * AppSync forever (I-28, I-20, I-29), and the way that guarantee dies is a model
     * added for a good reason by someone who never read T7.
     *
     * A model appearing here that holds credentials is a bug even if it is not called
     * SourceAccount.
     */
    const schemaBlock = dataResource.slice(dataResource.indexOf("a.schema({"))
    const models = [...schemaBlock.matchAll(/^\s{2}(\w+)\s*:\s*a$/gm)].map((m) => m[1])

    expect(models).toEqual(["DeploySmokeTest"])
  })
})

/** Criterion 2. */
describe("the byExternalOwner index", () => {
  const backend = readFileSync(new URL("../../amplify/backend.ts", import.meta.url), "utf8")

  it("is declared KEYS_ONLY, and both sides spell the name the same way", () => {
    const block = backend.slice(backend.indexOf("addGlobalSecondaryIndex"))
    expect(block).toContain(`indexName: "${EXTERNAL_OWNER_INDEX}"`)
    expect(block.slice(0, block.indexOf("})"))).toContain("ProjectionType.KEYS_ONLY")
  })

  it("queries the index and can return nothing but keys", async () => {
    /**
     * The item shape here is what a KEYS_ONLY index actually returns: the table keys
     * and the index key, and nothing else. The assertion is that the resolver's whole
     * output is a userId — there is no field on it through which a token could travel
     * even if the projection were widened by mistake.
     */
    const { sent } = stubClient([{ Items: [{ pk: `U#${USER}`, sk: "SRC#acme", gsi1pk: "acme#134815" }] }])

    const resolved = await resolveUserByExternalOwner({ sourceId: "acme", externalOwnerId: "134815" })

    expect(resolved).toBe(USER)
    expect(sent[0].input.IndexName).toBe(EXTERNAL_OWNER_INDEX)
    expect(sent[0].input.ExpressionAttributeValues![":owner"]).toBe("acme#134815")
  })

  it("qualifies the key by source, so two providers cannot collide on an id", async () => {
    // An unqualified athlete id would let one source's webhook resolve to another
    // source's user. On a map that never re-fogs, that is permanent.
    const { sent } = stubClient([{ Items: [] }])
    await resolveUserByExternalOwner({ sourceId: "other", externalOwnerId: "134815" })
    expect(sent[0].input.ExpressionAttributeValues![":owner"]).toBe("other#134815")
  })

  it("writes gsi1pk on connect, or the row is invisible to the index", async () => {
    const { sent } = stubClient([{}])
    await putConnectedAccount({
      userId: USER,
      sourceId: "acme",
      externalOwnerId: "134815",
      accessToken: ACCESS,
      refreshToken: REFRESH,
      expiresAt: 1794700000,
      scopes: ["activity:read_all"],
      now: NOW,
    })
    expect(sent[0].input.Item.gsi1pk).toBe("acme#134815")
  })
})

/** Criterion 11. */
describe("loading credentials", () => {
  const row = (over: Record<string, unknown> = {}) => ({
    Item: {
      accessToken: ACCESS,
      refreshToken: REFRESH,
      expiresAt: 1794700000,
      scopes: new Set(["read", "activity:read_all"]),
      status: "ACTIVE",
      ...over,
    },
  })

  it("returns the tokens when the row is healthy", async () => {
    stubClient([row()])
    const load = await loadCredentials({
      userId: USER,
      sourceId: "acme",
      requiredScopes: ["activity:read_all"],
    })
    expect(load).toEqual({
      ok: true,
      credentials: {
        accessToken: ACCESS,
        refreshToken: REFRESH,
        expiresAt: 1794700000,
        scopes: ["read", "activity:read_all"],
        status: "ACTIVE",
        leaseUntil: 0,
      },
    })
  })

  it("checks the required scopes on EVERY load, not only at connect", async () => {
    // The connect check can only see the grant it was handed. This one sees the row as
    // it is now — which is what catches a row written by an older build or edited by
    // hand in the console.
    const { sent } = stubClient([row({ scopes: new Set(["read"]) }), {}])

    const load = await loadCredentials({
      userId: USER,
      sourceId: "acme",
      requiredScopes: ["activity:read_all"],
      now: NOW,
    })

    expect(load).toMatchObject({ ok: false, reason: "needs-reauth" })
    // And it does not merely refuse — it writes the state, so the settings screen and
    // the behaviour agree instead of showing a healthy connection that cannot work.
    expect(sent[1].input.ExpressionAttributeValues![":needs"]).toBe("NEEDS_REAUTH")
  })

  it("refuses a NEEDS_REAUTH row without touching the provider — the anti-storm line", async () => {
    stubClient([row({ status: "NEEDS_REAUTH" })])
    const load = await loadCredentials({
      userId: USER,
      sourceId: "acme",
      requiredScopes: ["activity:read_all"],
    })
    expect(load).toMatchObject({ ok: false, reason: "needs-reauth" })
  })

  it("distinguishes a disconnected row from a broken one", async () => {
    stubClient([row({ status: "DISCONNECTED" })])
    await expect(
      loadCredentials({ userId: USER, sourceId: "acme", requiredScopes: [] }),
    ).resolves.toMatchObject({ ok: false, reason: "not-connected" })
  })

  it("treats a missing row as not-connected", async () => {
    stubClient([{}])
    await expect(
      loadCredentials({ userId: USER, sourceId: "acme", requiredScopes: [] }),
    ).resolves.toMatchObject({ ok: false, reason: "not-connected" })
  })

  it("treats a row whose tokens were removed as not-connected", async () => {
    // What `markDisconnected` leaves behind if the status write were ever missed.
    stubClient([row({ accessToken: undefined, refreshToken: undefined })])
    await expect(
      loadCredentials({ userId: USER, sourceId: "acme", requiredScopes: [] }),
    ).resolves.toMatchObject({ ok: false, reason: "not-connected" })
  })
})

/** Criterion 9's mechanism. */
describe("the refresh lease", () => {
  it("is taken only when nobody holds one, or the holder's has expired", async () => {
    const { sent } = stubClient([{}])
    const got = await acquireRefreshLease({
      userId: USER,
      sourceId: "acme",
      leaseSeconds: 15,
      now: NOW,
    })

    expect(got).toBe(true)
    const nowSeconds = Math.floor(NOW.getTime() / 1000)
    expect(sent[0].input.ConditionExpression).toBe(
      "attribute_exists(pk) AND (attribute_not_exists(#lease) OR #lease < :now)",
    )
    expect(sent[0].input.ExpressionAttributeValues![":until"]).toBe(nowSeconds + 15)
    expect(sent[0].input.ExpressionAttributeValues![":now"]).toBe(nowSeconds)
  })

  it("reports a refusal as `false` rather than throwing — a held lease is not an error", async () => {
    stubClient([CONDITIONAL_FAILURE()])
    await expect(
      acquireRefreshLease({ userId: USER, sourceId: "acme", leaseSeconds: 15, now: NOW }),
    ).resolves.toBe(false)
  })

  it("still throws on a real failure, so an outage cannot look like contention", async () => {
    stubClient([new Error("ProvisionedThroughputExceededException")])
    await expect(
      acquireRefreshLease({ userId: USER, sourceId: "acme", leaseSeconds: 15, now: NOW }),
    ).rejects.toThrow(/Throughput/)
  })
})

/** Criterion 7 — the conditional write, at the level of the command it issues. */
describe("rotating the tokens", () => {
  const rotate = (over: Record<string, unknown> = {}) =>
    rotateTokens({
      userId: USER,
      sourceId: "acme",
      previousRefreshToken: REFRESH,
      accessToken: "new-access",
      refreshToken: "new-refresh",
      expiresAt: 1794721600,
      now: NOW,
      ...over,
    })

  it("is conditional on the PREVIOUS refresh token value", async () => {
    const { sent } = stubClient([{}])
    await expect(rotate()).resolves.toEqual({ won: true })

    expect(sent[0].input.ConditionExpression).toBe("refreshToken = :previous")
    expect(sent[0].input.ExpressionAttributeValues![":previous"]).toBe(REFRESH)
    expect(sent[0].input.ExpressionAttributeValues![":refresh"]).toBe("new-refresh")
  })

  it("drops the lease in the same write that stores the tokens", async () => {
    // Two writes would leave a window in which the tokens are current but the
    // connection still looks locked.
    const { sent } = stubClient([{}])
    await rotate()
    expect(sent[0].input.UpdateExpression).toContain("REMOVE #lease")
  })

  it("reports losing the race as `won: false`, which is not an error", async () => {
    stubClient([CONDITIONAL_FAILURE()])
    await expect(rotate()).resolves.toEqual({ won: false })
  })

  it("rethrows anything that is not a refused condition", async () => {
    stubClient([new Error("ResourceNotFoundException")])
    await expect(rotate()).rejects.toThrow(/ResourceNotFound/)
  })
})

describe("marking a connection as needing re-authorization", () => {
  it("keeps the tokens, unlike disconnect", async () => {
    /**
     * NEEDS_REAUTH is a DIAGNOSIS, not a decision. The refresh token may be perfectly
     * good and the failure misjudged; deleting it would turn a recoverable mistake into
     * the unrecoverable one this file exists to prevent. Disconnect removes credentials
     * because the user asked. Nobody asked here.
     */
    const { sent } = stubClient([{}])
    await markNeedsReauth({ userId: USER, sourceId: "acme", detail: "two 401s", now: NOW })

    const update = sent[0].input.UpdateExpression
    expect(update).not.toContain("accessToken")
    expect(update).not.toContain("refreshToken")
    expect(sent[0].input.ExpressionAttributeValues![":needs"]).toBe("NEEDS_REAUTH")
    expect(sent[0].input.ExpressionAttributeValues![":detail"]).toBe("two 401s")
  })

  it("will not resurrect a row the operator disconnected", async () => {
    const { sent } = stubClient([{}])
    await markNeedsReauth({ userId: USER, sourceId: "acme", detail: "x", now: NOW })
    expect(sent[0].input.ConditionExpression).toContain("#s <> :disconnected")
  })

  it("is idempotent — marking an already-marked row is not an error", async () => {
    stubClient([CONDITIONAL_FAILURE()])
    await expect(
      markNeedsReauth({ userId: USER, sourceId: "acme", detail: "x", now: NOW }),
    ).resolves.toBeUndefined()
  })
})
