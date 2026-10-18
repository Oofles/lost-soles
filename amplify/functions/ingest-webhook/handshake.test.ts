import type { LambdaFunctionURLEvent } from "aws-lambda"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { handleWebhook, type WebhookDeps } from "./handler"

/**
 * Ticket 0092 — the GET handshake through the REAL handler and the REAL adapter, asserted on the
 * bytes the Function URL would put on the wire. The adapter's own tests (`src/adapters/strava/
 * handshake.test.ts`) cover the rules; this proves the transport does not reshape the answer —
 * a handler that ran the body through `JSON.stringify` would pass every adapter test and fail
 * the real handshake.
 *
 * A separate file from `handler.test.ts` so the POST path's tests stay untouched (0093).
 */
const PATH = "/api/webhooks/strava"
const TOKEN = "handlerTestTokenR8m2Kx5Vq"
const CHALLENGE = "15f7d1a91c1f40f8a748fd134752feb3"

function get(query: Record<string, string>): LambdaFunctionURLEvent {
  return {
    rawPath: PATH,
    headers: {},
    queryStringParameters: query,
    isBase64Encoded: false,
    requestContext: { http: { method: "GET" } },
  } as unknown as LambdaFunctionURLEvent
}

/** No AWS call may happen on a GET; both of these throw if one does. */
const deps: WebhookDeps = {
  receipt: {
    ddb: {
      send() {
        throw new Error("the handshake must not touch DynamoDB")
      },
    },
  },
  send() {
    throw new Error("the handshake must not enqueue")
  },
}

const logged: string[] = []
beforeEach(() => {
  vi.stubEnv("STRAVA_WEBHOOK_VERIFY_TOKEN", TOKEN)
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, level).mockImplementation((...a: unknown[]) => {
      logged.push(a.map(String).join(" "))
    })
  }
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  logged.length = 0
})

describe("the handshake on the wire (criteria 1 and 2)", () => {
  it("200, application/json, body EXACTLY {\"hub.challenge\":\"<X>\"}", async () => {
    const res = await handleWebhook(
      get({ "hub.mode": "subscribe", "hub.challenge": CHALLENGE, "hub.verify_token": TOKEN }),
      deps,
    )
    expect(res.statusCode).toBe(200)
    expect(res.headers).toEqual({ "content-type": "application/json" })
    expect(res.body).toBe(`{"hub.challenge":"${CHALLENGE}"}`)
    expect(res.body).not.toMatch(/hub_challenge|hubChallenge/)
  })
})

describe("a wrong token (criterion 3)", () => {
  it("is a bare 400 and the supplied token is in no log line", async () => {
    const supplied = "attackerSuppliedToken777"
    const res = await handleWebhook(
      get({ "hub.mode": "subscribe", "hub.challenge": CHALLENGE, "hub.verify_token": supplied }),
      deps,
    )
    expect(res).toEqual({ statusCode: 400, body: "" })
    expect(logged.join("\n")).not.toContain(supplied)
    expect(logged.join("\n")).not.toContain(TOKEN)
  })
})

describe("a hostile challenge (criterion 5)", () => {
  it("never reaches the response body", async () => {
    const res = await handleWebhook(
      get({ "hub.mode": "subscribe", "hub.challenge": '"><script>', "hub.verify_token": TOKEN }),
      deps,
    )
    expect(res).toEqual({ statusCode: 400, body: "" })
  })
})

describe("a bare GET — a scanner", () => {
  it("is a bare 400", async () => {
    expect(await handleWebhook(get({}), deps)).toEqual({ statusCode: 400, body: "" })
  })
})
