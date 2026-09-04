import { describe, expect, it, vi } from "vitest"

import {
  acquireRefreshLease,
  loadCredentials,
  markNeedsReauth,
  releaseRefreshLease,
  rotateTokens,
} from "@/lib/sources/source-account-store"
import { accessTokenFor, REFRESH_SKEW_SECONDS } from "@/lib/sources/token-refresh"

import { SourceNeedsReauthError } from "../errors"
import type { OAuthConnector } from "../types"
import { createStravaClient } from "./client"

vi.mock("@/lib/sources/source-account-store", () => ({
  loadCredentials: vi.fn(),
  acquireRefreshLease: vi.fn(),
  releaseRefreshLease: vi.fn(),
  rotateTokens: vi.fn(),
  markNeedsReauth: vi.fn(),
}))

vi.mock("@/lib/sources/oauth-credentials", () => ({
  getOAuthClientCredentials: vi.fn(async () => ({ clientId: "id", clientSecret: "shh" })),
}))

/**
 * Ticket 0033 — the 401 policy, and the ordering criterion end to end.
 *
 * The client is deliberately thin: it knows the API host and it knows that 401 means
 * "this credential did not work". Everything else about tokens — when to refresh, what
 * to persist, when to give up — belongs to `lib/sources/token-refresh.ts`, which is why
 * `accessToken` arrives here as a function rather than as a string.
 */

const OK = () => new Response("{}", { status: 200 })
const UNAUTHORIZED = () => new Response("Unauthorized", { status: 401 })

function harness(responses: Array<() => Response>, tokens: string[] = ["t1", "t2"]) {
  const calls: Array<{ url: string; authorization: string }> = []
  const issued = [...tokens]

  const fetchStub = vi.fn(async (url: URL | RequestInfo, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>
    calls.push({ url: String(url), authorization: headers.authorization })
    return (responses.shift() ?? OK)()
  })

  const accessToken = vi.fn(async () => issued.shift() ?? "exhausted")
  const markNeedsReauth = vi.fn(async () => {})

  const client = createStravaClient({
    accessToken,
    markNeedsReauth,
    fetch: fetchStub as unknown as typeof fetch,
  })

  return { client, calls, fetchStub, accessToken, markNeedsReauth }
}

describe("the authenticated request", () => {
  it("sends the token as a Bearer header against the v3 API", async () => {
    const { client, calls } = harness([OK])
    await client.get("/athlete/activities", { per_page: "30" })

    expect(calls[0].url).toBe("https://www.strava.com/api/v3/athlete/activities?per_page=30")
    expect(calls[0].authorization).toBe("Bearer t1")
  })

  it("does not refresh when the request succeeds", async () => {
    const { client, accessToken } = harness([OK])
    await client.get("/athlete")
    expect(accessToken).toHaveBeenCalledTimes(1)
    expect(accessToken).toHaveBeenCalledWith()
  })

  it("passes a non-401 failure straight back, without touching the credential", async () => {
    // A 429 or a 500 is not an authorization problem, and treating it as one would
    // spend a refresh — and eventually a NEEDS_REAUTH — on an outage.
    const { client, accessToken, markNeedsReauth } = harness([() => new Response("", { status: 429 })])

    const res = await client.get("/athlete")
    expect(res.status).toBe(429)
    expect(accessToken).toHaveBeenCalledTimes(1)
    expect(markNeedsReauth).not.toHaveBeenCalled()
  })
})

describe("a 401", () => {
  it("refreshes once, keyed on the token that failed, and retries", async () => {
    const { client, calls, accessToken } = harness([UNAUTHORIZED, OK])

    const res = await client.get("/athlete")

    expect(res.status).toBe(200)
    expect(calls.map((c) => c.authorization)).toEqual(["Bearer t1", "Bearer t2"])
    /**
     * `knownStale` and not `force: true`. The difference shows up under concurrency: a
     * boolean would refresh unconditionally and discard a token another refresher had
     * just obtained, which is a retry storm assembled from two correct-looking parts.
     */
    expect(accessToken).toHaveBeenNthCalledWith(2, { knownStale: "t1" })
  })

  it("retries exactly once — a second 401 stops everything", async () => {
    const { client, fetchStub, markNeedsReauth } = harness([UNAUTHORIZED, UNAUTHORIZED])

    await expect(client.get("/athlete")).rejects.toBeInstanceOf(SourceNeedsReauthError)

    // TWO requests, not three, not five with backoff. Criterion 10's "no retry storm"
    // is this number.
    expect(fetchStub).toHaveBeenCalledTimes(2)
    expect(markNeedsReauth).toHaveBeenCalledTimes(1)
    expect(markNeedsReauth).toHaveBeenCalledWith("two consecutive 401s across a refresh")
  })

  it("marks the connection before it throws, so the state outlives the request", async () => {
    /**
     * If the throw came first, the caller's error handling would run against a row that
     * still claims `ACTIVE` — and the settings screen would show a healthy connection
     * that cannot do anything. The write is what turns a failure into a button.
     */
    const order: string[] = []
    const client = createStravaClient({
      accessToken: async () => "t1",
      markNeedsReauth: async () => {
        order.push("mark")
      },
      fetch: (async () => {
        order.push("fetch")
        return UNAUTHORIZED()
      }) as unknown as typeof fetch,
    })

    await expect(client.get("/athlete")).rejects.toBeInstanceOf(SourceNeedsReauthError)
    expect(order).toEqual(["fetch", "fetch", "mark"])
  })

  it("carries no credential in the error it throws", async () => {
    const { client } = harness([UNAUTHORIZED, UNAUTHORIZED], ["secret-token-1", "secret-token-2"])

    await client.get("/athlete").then(
      () => expect.unreachable(),
      (err: Error) => {
        expect(err.message).not.toContain("secret-token")
        expect(err.message).toContain("strava")
      },
    )
  })
})

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * CRITERION 6, END TO END — the ordering across the seam.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `token-refresh.test.ts` proves the write happens before `accessTokenFor` returns.
 * This wires the REAL refresh module to this client over a fake table and asserts the
 * whole sequence in one list: exchange, persist, request. That is the criterion's "the
 * write happens BEFORE the new access token is used for any API call — asserted by
 * ordering, not by comment".
 *
 * A stubbed `accessToken` would not do. It would assert the stub's own ordering and
 * pass just as happily if the real module returned before its write.
 */
describe("the refreshed token reaches the API only after it has been persisted", () => {
  it("orders the exchange, the write and the request", async () => {
    const events: string[] = []
    const expiresAt = 1794700000

    // The row, and the one condition that matters: a rotation applies only if the row
    // still holds the refresh token the caller keyed on.
    const row = {
      accessToken: "access-v1",
      refreshToken: "refresh-v1",
      expiresAt,
      scopes: ["activity:read_all"],
      status: "ACTIVE" as const,
      leaseUntil: 0,
    }

    vi.mocked(loadCredentials).mockImplementation(async () => ({
      ok: true,
      credentials: { ...row },
    }))
    vi.mocked(acquireRefreshLease).mockResolvedValue(true)
    vi.mocked(releaseRefreshLease).mockResolvedValue(undefined)
    vi.mocked(markNeedsReauth).mockResolvedValue(undefined)
    vi.mocked(rotateTokens).mockImplementation(async (input) => {
      expect(input.previousRefreshToken).toBe("refresh-v1")
      row.accessToken = input.accessToken
      row.refreshToken = input.refreshToken
      row.expiresAt = input.expiresAt
      events.push("persist")
      return { won: true }
    })

    const connector = {
      source: "strava",
      requiredScopes: ["activity:read_all"],
      refreshTokens: async () => {
        events.push("exchange")
        return {
          accessToken: "access-v2",
          refreshToken: "refresh-v2",
          expiresAt: expiresAt + 21600,
        }
      },
    } as unknown as OAuthConnector

    // A clock inside the skew window, so the very next call refreshes.
    const now = () => new Date((expiresAt - REFRESH_SKEW_SECONDS + 1) * 1000)

    const client = createStravaClient({
      accessToken: (opts) =>
        accessTokenFor(
          { userId: "u", sourceId: "strava", connector, knownStale: opts?.knownStale },
          { now, sleep: async () => {} },
        ),
      markNeedsReauth: async () => {},
      fetch: (async (_url: unknown, init?: RequestInit) => {
        const headers = (init?.headers ?? {}) as Record<string, string>
        events.push(`request:${headers.authorization}`)
        return OK()
      }) as unknown as typeof fetch,
    })

    await client.get("/athlete/activities")

    expect(events).toEqual(["exchange", "persist", "request:Bearer access-v2"])
    // And the rotated refresh token is what the row now holds — the point of the write.
    expect(row.refreshToken).toBe("refresh-v2")
  })
})
