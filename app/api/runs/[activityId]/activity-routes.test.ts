import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * `/api/runs/[activityId]/ledger` and `/api/runs/[activityId]/kind` — ticket `0331`, D-472.
 *
 * The session, the readers and the Lambda client are mocked; the routing, the Origin check, the
 * payload sent to `set-activity-kind` and the error mapping are real.
 */

let signedInAs: string | undefined

vi.mock("@/lib/auth/owner", () => ({
  currentUserId: async () => signedInAs,
}))

const activityLedger = vi.fn()
vi.mock("@/lib/runs/ledger-server", () => ({
  defaultActivityLedgerDeps: () => ({ ddb: {}, ledgerTable: "T4" }),
  activityLedger: (...a: unknown[]) => activityLedger(...a),
}))

const activityKind = vi.fn()
vi.mock("@/lib/run-kind/server", () => ({
  defaultActivityKindDeps: () => ({ ddb: {}, activityTable: "T3" }),
  activityKind: (...a: unknown[]) => activityKind(...a),
}))

vi.mock("@/lib/aws-server", () => ({
  customOutput: (key: string) => `fn:${key}`,
}))

/** What the route sent to Lambda, decoded. */
const sent: { FunctionName?: string; payload: Record<string, unknown> }[] = []
let reply: { FunctionError?: string; Payload?: Uint8Array } = {}
vi.mock("@/lib/http/invoke-as-user", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/http/invoke-as-user")>()
  return {
    ...real,
    defaultLambda: () => ({
      send: async (command: { input: { FunctionName?: string; Payload?: Uint8Array } }) => {
        sent.push({
          FunctionName: command.input.FunctionName,
          payload: JSON.parse(new TextDecoder().decode(command.input.Payload)) as Record<string, unknown>,
        })
        return reply
      },
    }),
  }
})

const ledgerRoute = await import("./ledger/route")
const kindRoute = await import("./kind/route")

const ctx = (activityId: string) => ({ params: Promise.resolve({ activityId }) })
const get = (path: string) => new Request(`https://soles.devaultsecurity.com${path}`)
const post = (path: string, body: unknown, origin: string | null = "https://soles.devaultsecurity.com") =>
  new Request(`https://soles.devaultsecurity.com${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(origin ? { origin } : {}) },
    body: JSON.stringify(body),
  })
const json = (v: unknown) => new TextEncoder().encode(JSON.stringify(v))

beforeEach(() => {
  activityLedger.mockReset()
  activityLedger.mockResolvedValue([])
  activityKind.mockReset()
  activityKind.mockResolvedValue(null)
  sent.length = 0
  reply = { Payload: json({ outcome: "applied", activityId: "a-1", kind: "run", gained: [], retained: [], cellsRevealed: 0, message: "m" }) }
})

describe("signed out", () => {
  it("every method 404s and nothing is read or invoked", async () => {
    signedInAs = undefined
    for (const r of [
      await ledgerRoute.GET(get("/api/runs/a-1/ledger"), ctx("a-1")),
      await kindRoute.GET(get("/api/runs/a-1/kind"), ctx("a-1")),
      await kindRoute.POST(post("/api/runs/a-1/kind", { kind: "run" }), ctx("a-1")),
    ]) {
      expect(r.status).toBe(404)
      expect(await r.json()).toEqual({ error: "not found" })
      expect(r.headers.get("cache-control")).toBe("no-store, private")
    }
    expect(activityLedger).not.toHaveBeenCalled()
    expect(activityKind).not.toHaveBeenCalled()
    expect(sent).toEqual([])
  })
})

describe("signed in", () => {
  beforeEach(() => {
    signedInAs = "u-session"
  })

  it("ledger: the activity's rows, filtered by the session's uid; a uid in the query is ignored", async () => {
    activityLedger.mockResolvedValueOnce([{ skillId: "athletics", reason: "distance", xpAwarded: 40, xpRulesVersion: 4, isFloor: false }])
    const r = await ledgerRoute.GET(get("/api/runs/a-1/ledger?uid=u-other"), ctx("a-1"))
    expect(r.status).toBe(200)
    expect(activityLedger.mock.calls[0]!.slice(0, 2)).toEqual(["u-session", "a-1"])
  })

  it("kind GET: the row, or null, for the session's uid", async () => {
    activityKind.mockResolvedValueOnce({ kind: "run", derivedKind: "walk", kindOverride: { kind: "run" } })
    const r = await kindRoute.GET(get("/api/runs/a-1/kind?userId=u-other"), ctx("a-1"))
    expect(await r.json()).toEqual({ activity: { kind: "run", derivedKind: "walk", kindOverride: { kind: "run" } } })
    expect(activityKind.mock.calls[0]!.slice(0, 2)).toEqual(["u-session", "a-1"])
  })

  it("kind POST: invokes set-activity-kind with the session's uid; body userId and activityId go nowhere", async () => {
    const r = await kindRoute.POST(post("/api/runs/a-1/kind", { kind: "run", userId: "u-other", activityId: "a-other" }), ctx("a-1"))
    expect(r.status).toBe(200)
    expect(sent).toEqual([{ FunctionName: "fn:setActivityKindFunctionName", payload: { activityId: "a-1", kind: "run", userId: "u-session" } }])
  })

  it("kind POST: a request with no Origin is not CSRF and is served", async () => {
    const r = await kindRoute.POST(post("/api/runs/a-1/kind", { kind: "run" }, null), ctx("a-1"))
    expect(r.status).toBe(200)
    expect(sent).toHaveLength(1)
  })

  it("kind POST: a handler refusal is a 422 carrying the handler's message, a crash a bare 502", async () => {
    reply = { FunctionError: "Unhandled", Payload: json({ errorType: "Error", errorMessage: "REFUSED:UNKNOWN_KIND: no such kind \"x\"" }) }
    const refused = await kindRoute.POST(post("/api/runs/a-1/kind", { kind: "x" }), ctx("a-1"))
    expect(refused.status).toBe(422)
    expect(await refused.json()).toEqual({ errors: [{ message: "REFUSED:UNKNOWN_KIND: no such kind \"x\"" }] })

    reply = { FunctionError: "Unhandled", Payload: json({ errorType: "Error", errorMessage: "BUSY: replay" }) }
    expect((await kindRoute.POST(post("/api/runs/a-1/kind", { kind: "run" }), ctx("a-1"))).status).toBe(503)

    reply = { FunctionError: "Unhandled", Payload: json({ errorType: "TypeError", errorMessage: "table arn:aws:dynamodb:… exploded" }) }
    const crashed = await kindRoute.POST(post("/api/runs/a-1/kind", { kind: "run" }), ctx("a-1"))
    expect(crashed.status).toBe(502)
    expect(JSON.stringify(await crashed.json())).not.toContain("arn:")
  })
})

describe("D-471: a foreign Origin", () => {
  it.each(["https://school-hub.devaultsecurity.com", "https://evil.example", "http://soles.devaultsecurity.com"])(
    "kind POST from %s is 403 and set-activity-kind is not invoked",
    async (origin) => {
      signedInAs = "u-session"
      const r = await kindRoute.POST(post("/api/runs/a-1/kind", { kind: "run" }, origin), ctx("a-1"))
      expect(r.status).toBe(403)
      expect(r.headers.get("cache-control")).toBe("no-store, private")
      expect(sent).toEqual([])
    },
  )
})
