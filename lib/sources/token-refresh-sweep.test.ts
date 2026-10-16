import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { OAuthProviderError } from "@/src/adapters/errors"
import type { OAuthConnector } from "@/src/adapters/types"

import {
  acquireRefreshLease,
  listRefreshCandidates,
  loadCredentials,
  markNeedsReauth,
  releaseRefreshLease,
  rotateTokens,
  type CredentialLoad,
  type SourceAccountStatus,
} from "./source-account-store"
import { accessTokenFor } from "./token-refresh"
import {
  SWEEP_HORIZON_SECONDS,
  SWEEP_INTERVAL_SECONDS,
  sweepExpiringTokens as runSweep,
} from "./token-refresh-sweep"

/**
 * Ticket 0094 — the scheduled sweep, end to end through the REAL refresh path.
 *
 * ─── WHAT IS REAL AND WHAT IS FAKED ──────────────────────────────────────────
 *
 * Real: the sweep, and `accessTokenFor` — the lease, the rotation ordering, the
 * dead-grant marking — which is the exact function `process-activity` reaches through
 * `oauthCredentialsFor` (`lib/sources/adapter-credentials.ts`, a one-line wrapper) for
 * its first API request. `lib/log` is unmocked, so the log-leak assertions read what
 * would actually reach CloudWatch.
 *
 * Faked: the PROVIDER, as a small HTTP service behind `fetch` that behaves the way
 * `03-integrations.md` §2.2 says Strava does — six-hour, 40-hex access tokens, a refresh
 * token that ROTATES on every exchange and dies the moment its successor is issued,
 * `invalid_grant` as a 400, bearer checks on the API — with a connector shaped like the
 * real one (exchange over `fetch`, `OAuthProviderError` on a non-2xx). It is neutral
 * rather than the real Strava connector because `lib/` may not name the vendor (D-100,
 * `check-boundaries.mjs`); the real connector's response parsing is
 * `src/adapters/strava/oauth.test.ts`'s job. And the T7 STORE, as an in-memory table
 * honouring the two conditions the real one enforces (lease, and rotation keyed on the
 * previous refresh token); the real store's command shapes, including the scan's
 * projection and filter, are asserted in `source-account-store.test.ts`.
 *
 * The clock is faked (Date only) so a six-hour token can be walked through its life.
 */

/** `vi.hoisted` because the mock factory below runs before any ordinary `const`. */
const { CLIENT_SECRET } = vi.hoisted(() => ({
  CLIENT_SECRET: "c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00",
}))

vi.mock("@/lib/sources/source-account-store", () => ({
  listRefreshCandidates: vi.fn(),
  loadCredentials: vi.fn(),
  acquireRefreshLease: vi.fn(),
  releaseRefreshLease: vi.fn(),
  rotateTokens: vi.fn(),
  markNeedsReauth: vi.fn(),
}))

vi.mock("@/lib/sources/oauth-credentials", () => ({
  getOAuthClientCredentials: vi.fn(async () => ({
    clientId: "12345",
    clientSecret: CLIENT_SECRET,
  })),
}))

const USER = "b3f1c2d4-0000-4000-8000-000000000001"
const SOURCE = "acme"
const SIX_HOURS = 6 * 60 * 60
/** Epoch seconds at which the test connection was made. */
const T0 = 1794700000

let hexCounter = 0
/** A provider-shaped token: forty hex characters, unique per call. */
function hexToken(): string {
  hexCounter += 1
  return (hexCounter.toString(16).padStart(8, "0") + "a1b2c3d4").repeat(5).slice(0, 40)
}

// ─── The clock ───────────────────────────────────────────────────────────────

const nowSeconds = () => Math.floor(Date.now() / 1000)
const setClock = (epochSeconds: number) => vi.setSystemTime(epochSeconds * 1000)

// ─── A small provider ──────────────────────────────────────────────────────────

const TOKEN_URL = "https://provider.test/oauth/token"
const API_BASE = "https://provider.test/api/"

interface FakeProvider {
  validRefresh: string
  access: Map<string, number>
  tokenEndpoint: "up" | "down" | "revoked"
  exchanges: number
  /** Every token the provider has ever issued, for the log-leak sweep. */
  issued: string[]
}
let provider: FakeProvider

function startProvider(initialAccess: string, initialRefresh: string, expiresAt: number) {
  provider = {
    validRefresh: initialRefresh,
    access: new Map([[initialAccess, expiresAt]]),
    tokenEndpoint: "up",
    exchanges: 0,
    issued: [initialAccess, initialRefresh],
  }
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

async function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input)
  if (url === TOKEN_URL) {
    provider.exchanges += 1
    if (provider.tokenEndpoint === "down") return json(503, { message: "Service Unavailable" })
    const body = new URLSearchParams(String(init?.body ?? ""))
    if (provider.tokenEndpoint === "revoked" || body.get("refresh_token") !== provider.validRefresh) {
      return json(400, { message: "Bad Request", errors: [{ code: "invalid" }] })
    }
    const accessToken = hexToken()
    const refreshToken = hexToken()
    const expiresAt = nowSeconds() + SIX_HOURS
    // ROTATION, and the old refresh token dies the moment the new one is issued.
    provider.validRefresh = refreshToken
    provider.access.set(accessToken, expiresAt)
    provider.issued.push(accessToken, refreshToken)
    return json(200, {
      token_type: "Bearer",
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_at: expiresAt,
      expires_in: SIX_HOURS,
    })
  }
  if (url.startsWith(API_BASE)) {
    const auth = new Headers(init?.headers).get("authorization") ?? ""
    const bearer = auth.replace(/^Bearer\s+/i, "")
    const expiry = provider.access.get(bearer)
    if (expiry === undefined || nowSeconds() >= expiry) return json(401, { message: "Authorization Error" })
    return json(200, { id: 1 })
  }
  throw new Error(`unexpected fetch to ${url}`)
}

/** "A subsequent API call" — one authenticated read, as the adapter would make it. */
const callApi = (accessToken: string) =>
  fetch(`${API_BASE}athlete`, {
    headers: { authorization: `Bearer ${accessToken}` },
  })

/**
 * A connector with the real one's shape: the exchange over `fetch`, a non-2xx thrown as
 * `OAuthProviderError` so `credentialIsDead` classifies it exactly as in production.
 */
const connector = {
  source: SOURCE,
  requiredScopes: ["activity:read_all"],
  credentialParameters: { clientId: "ACME_CLIENT_ID", clientSecret: "ACME_CLIENT_SECRET" },
  async refreshTokens({
    refreshToken,
    credentials,
  }: {
    refreshToken: string
    credentials: { clientId: string; clientSecret: string }
  }) {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      body: new URLSearchParams({
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    })
    if (!res.ok) throw new OAuthProviderError("Acme", "token refresh", res.status)
    const body = (await res.json()) as { access_token: string; refresh_token: string; expires_at: number }
    return { accessToken: body.access_token, refreshToken: body.refresh_token, expiresAt: body.expires_at }
  },
} as unknown as OAuthConnector

const sweepExpiringTokens = () =>
  runSweep({ connectorFor: (id) => (id === SOURCE ? connector : undefined) })

/** What `process-activity` does for its first API request: resolve a token, the ordinary way. */
const workerToken = () => accessTokenFor({ userId: USER, sourceId: SOURCE, connector })

// ─── An in-memory T7 ─────────────────────────────────────────────────────────

interface Row {
  userId: string
  sourceId: string
  accessToken: string
  refreshToken: string
  expiresAt: number
  scopes: string[]
  status: SourceAccountStatus
  leaseUntil: number
}
let table: Map<string, Row>
const keyOf = (userId: string, sourceId: string) => `${userId}|${sourceId}`
const theRow = () => table.get(keyOf(USER, SOURCE))!

function installTable(rows: Row[]) {
  table = new Map(rows.map((r) => [keyOf(r.userId, r.sourceId), { ...r }]))

  vi.mocked(listRefreshCandidates).mockImplementation(async ({ expiringBefore }) =>
    [...table.values()]
      .filter((r) => r.status === "ACTIVE" && r.expiresAt < expiringBefore)
      .map((r) => ({ userId: r.userId, sourceId: r.sourceId, expiresAt: r.expiresAt })),
  )

  vi.mocked(loadCredentials).mockImplementation(async ({ userId, sourceId }): Promise<CredentialLoad> => {
    const row = table.get(keyOf(userId, sourceId))
    if (row === undefined || row.status === "DISCONNECTED") {
      return { ok: false, reason: "not-connected", detail: "none" }
    }
    if (row.status === "NEEDS_REAUTH") return { ok: false, reason: "needs-reauth", detail: "marked" }
    return {
      ok: true,
      credentials: {
        accessToken: row.accessToken,
        refreshToken: row.refreshToken,
        expiresAt: row.expiresAt,
        scopes: row.scopes,
        status: row.status,
        leaseUntil: row.leaseUntil,
      },
    }
  })

  vi.mocked(acquireRefreshLease).mockImplementation(async ({ userId, sourceId, leaseSeconds }) => {
    const row = table.get(keyOf(userId, sourceId))!
    if (row.leaseUntil !== 0 && row.leaseUntil >= nowSeconds()) return false
    row.leaseUntil = nowSeconds() + leaseSeconds
    return true
  })

  vi.mocked(releaseRefreshLease).mockImplementation(async ({ userId, sourceId }) => {
    table.get(keyOf(userId, sourceId))!.leaseUntil = 0
  })

  vi.mocked(rotateTokens).mockImplementation(async (input) => {
    const row = table.get(keyOf(input.userId, input.sourceId))!
    if (row.refreshToken !== input.previousRefreshToken) return { won: false }
    row.accessToken = input.accessToken
    row.refreshToken = input.refreshToken
    row.expiresAt = input.expiresAt
    row.leaseUntil = 0
    return { won: true }
  })

  vi.mocked(markNeedsReauth).mockImplementation(async ({ userId, sourceId }) => {
    const row = table.get(keyOf(userId, sourceId))!
    if (row.status !== "DISCONNECTED") row.status = "NEEDS_REAUTH"
    row.leaseUntil = 0
  })
}

/** A connection made at `connectedAt`, with Strava's six-hour token. */
function connectAt(connectedAt: number) {
  setClock(connectedAt)
  const accessToken = hexToken()
  const refreshToken = hexToken()
  startProvider(accessToken, refreshToken, connectedAt + SIX_HOURS)
  installTable([
    {
      userId: USER,
      sourceId: SOURCE,
      accessToken,
      refreshToken,
      expiresAt: connectedAt + SIX_HOURS,
      scopes: ["read", "activity:read_all"],
      status: "ACTIVE",
      leaseUntil: 0,
    },
  ])
}

// ─── Log capture ─────────────────────────────────────────────────────────────

let logged: string[]

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.stubGlobal("fetch", vi.fn(fakeFetch))
  logged = []
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, level).mockImplementation((...parts: unknown[]) => {
      logged.push(parts.map((p) => (typeof p === "string" ? p : JSON.stringify(p))).join(" "))
    })
  }
  connectAt(T0)
})

afterEach(() => {
  /**
   * CRITERION 5, ON EVERY TEST. Whatever path a test took — refresh, rotation, dead
   * grant, outage — no token Strava issued and not the client secret appears in any
   * line written at any level.
   */
  const secrets = [...provider.issued, CLIENT_SECRET]
  for (const line of logged) {
    for (const secret of secrets) expect(line, "a credential reached a log line").not.toContain(secret)
  }
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// ─── The tests ───────────────────────────────────────────────────────────────

describe("the schedule's window (criterion 2)", () => {
  it("is the gap between runs plus the five-minute skew", () => {
    expect(SWEEP_INTERVAL_SECONDS).toBe(4 * 60 * 60)
    expect(SWEEP_HORIZON_SECONDS).toBe(4 * 60 * 60 + 300)
  })

  it("leaves a token further out than the window untouched", async () => {
    // One second outside: expiry is exactly the horizon away.
    setClock(T0 + SIX_HOURS - SWEEP_HORIZON_SECONDS)
    const before = { ...theRow() }

    const result = await sweepExpiringTokens()

    expect(result).toMatchObject({ examined: 0, refreshed: 0 })
    expect(provider.exchanges).toBe(0)
    expect(theRow()).toEqual(before)
  })

  it("refreshes a token inside the window", async () => {
    setClock(T0 + SIX_HOURS - SWEEP_HORIZON_SECONDS + 1)
    const before = { ...theRow() }

    const result = await sweepExpiringTokens()

    expect(result).toMatchObject({ examined: 1, refreshed: 1, failed: 0, needsReauth: 0 })
    expect(provider.exchanges).toBe(1)
    expect(theRow().accessToken).not.toBe(before.accessToken)
  })

  it("asks the store for exactly that cutoff", async () => {
    setClock(T0 + 3600)
    await sweepExpiringTokens()
    expect(listRefreshCandidates).toHaveBeenCalledWith({
      expiringBefore: T0 + 3600 + SWEEP_HORIZON_SECONDS,
    })
  })

  it("touches only the rows that are due, among several", async () => {
    setClock(T0 + 5 * 3600)
    const due = theRow()
    const other = {
      ...due,
      userId: "b3f1c2d4-0000-4000-8000-000000000002",
      expiresAt: T0 + 5 * 3600 + SIX_HOURS,
    }
    table.set(keyOf(other.userId, other.sourceId), { ...other })

    const result = await sweepExpiringTokens()

    expect(result).toMatchObject({ examined: 1, refreshed: 1 })
    expect(table.get(keyOf(other.userId, SOURCE))).toEqual(other)
  })
})

describe("the write-back (criteria 3 and 4)", () => {
  it("stores the ROTATED refresh token Strava returned", async () => {
    setClock(T0 + 5 * 3600)
    const oldRefresh = theRow().refreshToken

    await sweepExpiringTokens()

    expect(theRow().refreshToken).not.toBe(oldRefresh)
    expect(theRow().refreshToken).toBe(provider.validRefresh)
  })

  it("moves expiresAt to the new expiry, and the next API call succeeds with the stored token", async () => {
    setClock(T0 + 5 * 3600)
    await sweepExpiringTokens()

    expect(theRow().expiresAt).toBe(T0 + 5 * 3600 + SIX_HOURS)

    // Past the ORIGINAL expiry, where the old token is dead at Strava.
    setClock(T0 + SIX_HOURS + 60)
    const token = await workerToken()
    expect((await callApi(token)).status).toBe(200)
    // And the caller did not need a refresh of its own to get there.
    expect(provider.exchanges).toBe(1)
  })

  it("survives a whole day of runs on rotation alone — every run's write-back is the next run's key", async () => {
    for (let run = 1; run <= 6; run += 1) {
      setClock(T0 + run * SWEEP_INTERVAL_SECONDS)
      const result = await sweepExpiringTokens()
      expect(result.failed + result.needsReauth, `run ${run}`).toBe(0)
    }
    const token = await workerToken()
    expect((await callApi(token)).status).toBe(200)
    expect(theRow().status).toBe("ACTIVE")
  })
})

describe("a dead grant (criterion 7)", () => {
  it("marks the connection NEEDS_REAUTH and makes exactly one exchange", async () => {
    setClock(T0 + 5 * 3600)
    provider.tokenEndpoint = "revoked"

    const result = await sweepExpiringTokens()

    expect(result).toMatchObject({ examined: 1, needsReauth: 1, refreshed: 0, failed: 0 })
    expect(provider.exchanges).toBe(1)
    expect(markNeedsReauth).toHaveBeenCalledTimes(1)
    expect(theRow().status).toBe("NEEDS_REAUTH")
    // The leak check in afterEach is only meaningful if this path logged at all.
    expect(logged.some((line) => line.includes("needs re-authorization"))).toBe(true)
  })

  it("is not offered to the next run, so a revoked grant costs one call, ever", async () => {
    setClock(T0 + 5 * 3600)
    provider.tokenEndpoint = "revoked"
    await sweepExpiringTokens()

    setClock(T0 + 9 * 3600)
    const next = await sweepExpiringTokens()

    expect(next.examined).toBe(0)
    expect(provider.exchanges).toBe(1)
  })

  it("keeps the tokens in the row — NEEDS_REAUTH is a diagnosis, not a deletion", async () => {
    setClock(T0 + 5 * 3600)
    provider.tokenEndpoint = "revoked"
    const before = { ...theRow() }
    await sweepExpiringTokens()
    expect(theRow().refreshToken).toBe(before.refreshToken)
  })
})

describe("a transient failure (criterion 8)", () => {
  it("leaves the row exactly as it was", async () => {
    setClock(T0 + 5 * 3600)
    provider.tokenEndpoint = "down"
    const before = { ...theRow() }

    const result = await sweepExpiringTokens()

    expect(result).toMatchObject({ examined: 1, failed: 1, refreshed: 0, needsReauth: 0 })
    expect(provider.exchanges).toBe(1)
    expect(markNeedsReauth).not.toHaveBeenCalled()
    expect(theRow()).toEqual(before)
  })

  it("is retried by the next scheduled run, and that one succeeds", async () => {
    setClock(T0 + 2 * 3600)
    provider.tokenEndpoint = "down"
    expect((await sweepExpiringTokens()).failed).toBe(1)

    provider.tokenEndpoint = "up"
    setClock(T0 + 2 * 3600 + SWEEP_INTERVAL_SECONDS)
    const next = await sweepExpiringTokens()

    expect(next).toMatchObject({ refreshed: 1, failed: 0 })
    expect(theRow().status).toBe("ACTIVE")
    expect(theRow().expiresAt).toBe(nowSeconds() + SIX_HOURS)
  })

  it("does not throw — a thrown handler would buy EventBridge retries minutes later", async () => {
    setClock(T0 + 5 * 3600)
    provider.tokenEndpoint = "down"
    await expect(sweepExpiringTokens()).resolves.toBeDefined()
  })
})

/**
 * CRITERION 9 — the failure this ticket prevents, documented by running both ways.
 *
 * WHAT "THE REACTIVE FAILURE" IS, PRECISELY. 0033 already refreshes inline at
 * `expiresAt - 300s`, so the worker does not 401 on an expired token — it refreshes
 * first. The failure is what happens when that inline exchange lands on a bad minute at
 * the token endpoint: the webhook-triggered ingest needs a token, the only way to get one
 * is an exchange, and the exchange fails. Without the schedule, the token endpoint's
 * health at the moment a webhook arrives decides whether the run imports.
 *
 * The scenario: connected at T0, a run finishes and its webhook arrives just after the
 * six-hour expiry, and the provider's token endpoint is having a bad few minutes right
 * then. `workerToken()` is `accessTokenFor` called exactly as `oauthCredentialsFor` calls
 * it for `process-activity`'s first API request (amplify/functions/process-activity/handler.ts).
 */
describe("the reactive failure the schedule removes (criterion 9)", () => {
  const WEBHOOK_AT = T0 + SIX_HOURS + 60

  async function processActivityFetchesItsToken(): Promise<number> {
    const token = await workerToken()
    return (await callApi(token)).status
  }

  it("WITH THE SCHEDULER DISABLED: the ingest fails, because its token depends on an exchange at webhook time", async () => {
    setClock(WEBHOOK_AT)
    provider.tokenEndpoint = "down"

    await expect(processActivityFetchesItsToken()).rejects.toThrow(/token refresh failed with HTTP 503/)
    expect(provider.exchanges).toBe(1)
  })

  it("WITH THE SCHEDULER ENABLED: the same webhook, the same outage, and the ingest succeeds with zero exchanges of its own", async () => {
    // The runs the schedule would have made since connecting.
    for (const at of [T0 + SWEEP_INTERVAL_SECONDS]) {
      setClock(at)
      expect((await sweepExpiringTokens()).failed).toBe(0)
    }
    const exchangesBeforeWebhook = provider.exchanges

    setClock(WEBHOOK_AT)
    provider.tokenEndpoint = "down"

    await expect(processActivityFetchesItsToken()).resolves.toBe(200)
    expect(provider.exchanges).toBe(exchangesBeforeWebhook)
  })
})
