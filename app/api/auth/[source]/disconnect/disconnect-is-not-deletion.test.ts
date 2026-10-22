import { S3Client } from "@aws-sdk/client-s3"
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { connectableSources } from "@/src/adapters/registry"
import { EXPLORED_CELL_TABLE } from "@/src/pipeline/explored-cells"

/**
 * DISCONNECTING A SOURCE IS NOT DELETING AN ACCOUNT. Ticket `0106` criterion 8; `08` §6.5,
 * `02` §8.5, D-101.
 *
 * `retains-everything.test.ts` (0089) proves it by construction: every write goes to
 * `LostSolesSourceAccount` and none is a delete. This proves it by COUNTING, the way the criterion
 * asks: a world holding the user's explored cells, Chronicle activities and raw archive, the REAL
 * disconnect route run against it, and the three counts read again afterwards. Only the network,
 * the session and SSM are faked (D-229 — no real connection is touched).
 */

const SOURCE = connectableSources()[0] as string
const OWNER = "b3f1c2d4-0000-4000-8000-000000000001"
const APP_ORIGIN = "https://soles.devaultsecurity.com"
const ACTIVITY_TABLE = "Activity-test-NONE"

vi.mock("@/lib/auth/owner", () => ({
  currentUserId: async () => OWNER,
  isOwner: (id: string | undefined) => id === OWNER,
}))
vi.mock("@/lib/sources/oauth-credentials", () => ({
  getOAuthClientCredentials: async () => ({ clientId: "12345", clientSecret: ["secret", "-not-real"].join("") }),
}))

const store = await import("@/lib/sources/source-account-store")
const { NextRequest } = await import("next/server")
const { POST } = await import("./route")

type Item = Record<string, unknown>
/** Fake clients read command inputs loosely; the real SDK types are not the subject here. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any
let tables: Record<string, Item[]>
let rawObjects: string[]
let s3Calls: string[]

const count = () => ({
  exploredCells: tables[EXPLORED_CELL_TABLE]!.length,
  activities: tables[ACTIVITY_TABLE]!.length,
  raw: rawObjects.filter((k) => k.startsWith(`raw/${OWNER}/`)).length,
})

beforeEach(() => {
  tables = {
    [store.SOURCE_ACCOUNT_TABLE]: [{ pk: `U#${OWNER}`, sk: `SRC#${SOURCE}`, accessToken: "a".repeat(40), refreshToken: "r".repeat(40), status: "ACTIVE" }],
    [EXPLORED_CELL_TABLE]: [
      { pk: `U#${OWNER}#C#87abc`, sk: "8babc1" },
      { pk: `U#${OWNER}#C#87abc`, sk: "8babc2" },
      { pk: `U#${OWNER}#AGG#7`, sk: "87abc" },
    ],
    [ACTIVITY_TABLE]: [{ id: "act-1", userId: OWNER }, { id: "act-2", userId: OWNER }],
  }
  rawObjects = [`raw/${OWNER}/${SOURCE}/1/a.json`, `raw/${OWNER}/${SOURCE}/2/b.json`]
  s3Calls = []

  // A table-aware fake: reads find rows, updates merge into them, deletes remove them. If the route
  // ever deleted anything, the counts below would move.
  const send = vi.fn(async (command: { constructor: { name: string }; input: Record<string, Loose> }) => {
    const { input } = command
    const rows = (tables[input.TableName] ??= [])
    const at = () => rows.findIndex((r) => Object.entries(input.Key ?? {}).every(([k, v]) => r[k] === v))
    switch (command.constructor.name) {
      case "GetCommand":
        return { Item: rows[at()] }
      case "DeleteCommand":
        if (at() >= 0) rows.splice(at(), 1)
        return {}
      case "UpdateCommand": {
        const row = rows[at()]
        if (row && /REMOVE accessToken, refreshToken/.test(String(input.UpdateExpression))) {
          delete row.accessToken
          delete row.refreshToken
        }
        return {}
      }
      default:
        return {}
    }
  })
  store.__setDocClient({ send } as unknown as DynamoDBDocumentClient)
  // Nothing in the route has an S3 client; if one is ever added, every call it makes is seen here.
  vi.spyOn(S3Client.prototype, "send").mockImplementation(async (command: { constructor: { name: string } }) => {
    s3Calls.push(command.constructor.name)
    if (/Delete/.test(command.constructor.name)) rawObjects = []
    return {}
  })
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => "" })))
})

afterEach(() => {
  store.__setDocClient(null)
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("disconnect leaves the map, the Chronicle and the archive exactly as they were (I-7, I-30)", () => {
  it("ExploredCell, raw/ and Activity counts are unchanged, and only the tokens are gone", async () => {
    const before = count()
    expect(before).toEqual({ exploredCells: 3, activities: 2, raw: 2 })

    const res = await POST(
      new NextRequest(new URL(`${APP_ORIGIN}/api/auth/${SOURCE}/disconnect`), { method: "POST", headers: { origin: APP_ORIGIN } }),
      { params: Promise.resolve({ source: SOURCE }) },
    )
    expect(new URL(res.headers.get("location") ?? "").searchParams.get("connect")).toBe("disconnected")

    expect(count()).toEqual(before)
    expect(s3Calls).toEqual([])
    const account = tables[store.SOURCE_ACCOUNT_TABLE]![0]!
    expect(account.accessToken).toBeUndefined()
    expect(account.refreshToken).toBeUndefined()
  })
})
