import { readFileSync } from "node:fs"
import { join } from "node:path"

import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { connectableSources, getOAuthConnector } from "@/src/adapters/registry"

/**
 * Ticket 0089 criteria 3 and 5, through the REAL route and the REAL store. Only the
 * DynamoDB client, the session, SSM and the network are faked.
 *
 * `oauth-routes.test.ts` proves the order (revoke, then tear down) with the store
 * mocked. This proves what that file cannot: every write the disconnect makes, end to
 * end, goes to `LostSolesSourceAccount`, removes the tokens, and deletes nothing. The
 * map (`ExploredCell`, the explored blob), the ledger and the Chronicle's `Activity`
 * rows are never addressed, so they are unchanged by construction. No real connection
 * is touched (D-229).
 */

const SOURCE = connectableSources()[0] as string
const CONNECTOR = getOAuthConnector(SOURCE)
const OWNER = "b3f1c2d4-0000-4000-8000-000000000001"
const APP_ORIGIN = "https://soles.devaultsecurity.com"
const fx = (...parts: string[]) => parts.join("")
const ACCESS = fx("aaaa1111", "bbbb2222", "cccc3333", "dddd4444")

vi.mock("@/lib/auth/owner", () => ({
  currentUserId: async () => OWNER,
  isOwner: (id: string | undefined) => id === OWNER,
}))
vi.mock("@/lib/sources/oauth-credentials", () => ({
  getOAuthClientCredentials: async () => ({ clientId: "12345", clientSecret: fx("secret", "-not-real") }),
}))

const store = await import("@/lib/sources/source-account-store")
const { NextRequest } = await import("next/server")
const { POST } = await import("./route")

interface Sent {
  constructor: { name: string }
  input: { TableName?: string; UpdateExpression?: string; Key?: Record<string, string> }
}

let sent: Sent[]
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  sent = []
  const send = vi.fn(async (command: Sent) => {
    sent.push(command)
    // The token read for revocation, then the teardown.
    return command.constructor.name === "GetCommand" ? { Item: { accessToken: ACCESS } } : {}
  })
  store.__setDocClient({ send } as unknown as DynamoDBDocumentClient)
  fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => "" }))
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  store.__setDocClient(null)
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

const disconnect = () =>
  POST(
    new NextRequest(new URL(`${APP_ORIGIN}/api/auth/${SOURCE}/disconnect`), {
      method: "POST",
      headers: { origin: APP_ORIGIN },
    }),
    { params: Promise.resolve({ source: SOURCE }) },
  )

describe("disconnect touches the source account and nothing else", () => {
  it("revokes at the provider, then removes the tokens from LostSolesSourceAccount", async () => {
    const res = await disconnect()
    expect(res.status).toBe(303)
    expect(new URL(res.headers.get("location") ?? "").searchParams.get("connect")).toBe("disconnected")

    // Revoked with the provider, with the token the row held.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [, init] = fetchMock.mock.calls[0] as [string, { body: unknown }]
    expect(String(init.body)).toContain(ACCESS)

    const update = sent.find((c) => c.constructor.name === "UpdateCommand")
    expect(update?.input.UpdateExpression).toContain("REMOVE accessToken, refreshToken")
    expect(update?.input.Key?.sk).toBe(`SRC#${SOURCE}`)
  })

  it("addresses no table but LostSolesSourceAccount, and deletes no row at all", async () => {
    await disconnect()
    expect(sent.length).toBeGreaterThan(0)
    for (const command of sent) {
      expect(command.input.TableName).toBe(store.SOURCE_ACCOUNT_TABLE)
      expect(command.constructor.name).not.toMatch(/Delete|BatchWrite|TransactWrite/)
    }
  })

  it("the route imports nothing that can reach the map, the ledger or the chronicle", () => {
    const src = readFileSync(join(process.cwd(), "app/api/auth/[source]/disconnect/route.ts"), "utf8")
    const imports = [...src.matchAll(/from "([^"]+)"/g)].map((m) => m[1])
    expect(imports.sort()).toEqual(
      [
        "next/server",
        "@/lib/app-origin",
        "@/lib/log",
        "@/lib/sources/oauth-credentials",
        "@/lib/sources/source-account-store",
        "../shared",
      ].sort(),
    )
    // The connector name is used only so this file stays vendor-free.
    expect(CONNECTOR.source).toBe(SOURCE)
  })
})
