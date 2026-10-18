import type { LambdaFunctionURLEvent } from "aws-lambda"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Ticket 0286 — the verify token is read on a GET only, and a POST cold start makes no SSM call and
 * constructs nothing. Driven through the REAL handler and the REAL Strava adapter, with only the
 * SSM module replaced by a counter, and `fetch` replaced so a real network call would be caught.
 */
const reader = vi.hoisted(() => ({
  constructed: 0,
  reads: [] as string[],
  answer: undefined as string | undefined,
  fail: false,
}))
vi.mock("./ssm-reader", () => ({
  createParameterReader: () => {
    reader.constructed++
    return async (name: string) => {
      reader.reads.push(name)
      if (reader.fail) throw Object.assign(new Error(`boom ${reader.answer}`), { name: "ParameterReadError" })
      return reader.answer
    }
  },
}))
vi.mock("@/src/adapters/strava/subscription", () => ({ STRAVA_SUBSCRIPTION_ID: 120475 }))

const { handleWebhook } = await import("./handler")
const { lazyWebhookSecret } = await import("./webhook-secret")
type WebhookDeps = import("./handler").WebhookDeps

const PATH = "/api/webhooks/strava"
const PARAM = "/amplify/shared/app/WEBHOOK_TOKEN_UNDER_TEST"
const TOKEN = "lazyTokenUnderTestP4w9Zk2"
const CHALLENGE = "abc123XYZ"
const KNOWN_OWNER = 51449053

function req(method: string, over: { query?: Record<string, string>; body?: unknown } = {}): LambdaFunctionURLEvent {
  return {
    rawPath: PATH,
    headers: { "content-type": "application/json" },
    queryStringParameters: over.query ?? {},
    body: over.body === undefined ? "" : JSON.stringify(over.body),
    isBase64Encoded: false,
    requestContext: { http: { method } },
  } as unknown as LambdaFunctionURLEvent
}

const createEvent = {
  object_type: "activity",
  object_id: 1360128428,
  aspect_type: "create",
  updates: {},
  owner_id: KNOWN_OWNER,
  subscription_id: 120475,
  event_time: 1516126040,
}

function deps(): WebhookDeps & { sent: string[] } {
  const sent: string[] = []
  return {
    sent,
    receipt: {
      ddb: {
        async send(command) {
          const input = (command as { input: Record<string, unknown> }).input
          return "UpdateExpression" in input ? { Attributes: { eventCount: 1 } } : {}
        },
      },
      now: () => new Date("2026-10-18T12:00:00Z"),
    },
    async send(body) {
      sent.push(body)
    },
    // The PRODUCTION getter, over the mocked SSM module.
    webhookSecret: lazyWebhookSecret(PARAM),
  }
}

const logged: string[] = []
const fetchSpy = vi.fn(async () => {
  throw new Error("no network call may happen in this test")
})
beforeEach(() => {
  reader.constructed = 0
  reader.reads.length = 0
  reader.answer = TOKEN
  reader.fail = false
  vi.stubGlobal("fetch", fetchSpy)
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, level).mockImplementation((...a: unknown[]) => {
      logged.push(a.map(String).join(" "))
    })
  }
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  fetchSpy.mockClear()
  logged.length = 0
})

const handshake = (token = TOKEN) =>
  req("GET", { query: { "hub.mode": "subscribe", "hub.challenge": CHALLENGE, "hub.verify_token": token } })

describe("a POST cold start makes no SSM call (criterion 1)", () => {
  it("importing the handler constructs no SSM reader", () => {
    expect(reader.constructed).toBe(0)
  })

  it("a create that is enqueued, a dropped event and a deauthorization read nothing from SSM", async () => {
    const d = deps()
    expect((await handleWebhook(req("POST", { body: createEvent }), d)).statusCode).toBe(200)
    expect(d.sent).toHaveLength(1) // the create really went the whole way
    await handleWebhook(req("POST", { body: { ...createEvent, owner_id: 1 } }), d)
    await handleWebhook(
      req("POST", {
        body: { ...createEvent, object_type: "athlete", aspect_type: "update", object_id: KNOWN_OWNER, updates: { authorized: "false" } },
      }),
      d,
    )
    expect(reader.constructed).toBe(0)
    expect(reader.reads).toEqual([])
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe("the GET handshake reads the token lazily (criterion 2)", () => {
  it("reads the named parameter once, answers the exact bytes, and caches it", async () => {
    const d = deps()
    const res = await handleWebhook(handshake(), d)
    expect(res.statusCode).toBe(200)
    expect(res.body).toBe(`{"hub.challenge":"${CHALLENGE}"}`)
    expect(reader.reads).toEqual([PARAM])

    // Strava may re-validate; the same sandbox pays nothing the second time.
    expect((await handleWebhook(handshake(), d)).statusCode).toBe(200)
    expect(reader.reads).toEqual([PARAM])
  })

  it("a wrong token is still a bare 400", async () => {
    expect(await handleWebhook(handshake("wrongTokenGuess"), deps())).toEqual({ statusCode: 400, body: "" })
  })

  it("an unreadable token fails closed — and the failure is not cached", async () => {
    reader.fail = true
    const d = deps()
    expect(await handleWebhook(handshake(), d)).toEqual({ statusCode: 400, body: "" })
    reader.fail = false
    expect((await handleWebhook(handshake(), d)).statusCode).toBe(200)
    expect(reader.reads).toEqual([PARAM, PARAM])
  })

  it("an empty token fails closed", async () => {
    reader.answer = ""
    expect(await handleWebhook(handshake(""), deps())).toEqual({ statusCode: 400, body: "" })
  })

  it("no parameter name configured fails closed without calling SSM", async () => {
    const d = { ...deps(), webhookSecret: lazyWebhookSecret(undefined) }
    expect(await handleWebhook(handshake(), d)).toEqual({ statusCode: 400, body: "" })
    expect(reader.reads).toEqual([])
  })
})

describe("the token never reaches a log line", () => {
  it("not on success, a wrong token, or a read failure whose message quotes it", async () => {
    const d = deps()
    await handleWebhook(handshake(), d)
    await handleWebhook(handshake("wrongTokenGuess"), d)
    reader.fail = true
    await handleWebhook(handshake(), deps())
    expect(logged.length).toBeGreaterThan(0)
    expect(logged.join("\n")).not.toContain(TOKEN)
    expect(logged.join("\n")).toContain("webhook-secret-unavailable")
  })
})
