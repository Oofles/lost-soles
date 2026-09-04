import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  OAuthProviderError,
  SourceNeedsReauthError,
  SourceNotConnectedError,
} from "@/src/adapters/errors"
import type { OAuthConnector, OAuthRefresh } from "@/src/adapters/types"

import {
  acquireRefreshLease,
  loadCredentials,
  markNeedsReauth,
  releaseRefreshLease,
  rotateTokens,
  type CredentialLoad,
  type SourceAccountStatus,
} from "./source-account-store"
import { accessTokenFor, REFRESH_SKEW_SECONDS } from "./token-refresh"

/**
 * Ticket 0033 — the refresh lifecycle. `03-integrations.md` §2.2 calls this "the single
 * most common integration bug", so these tests are written against the failure modes
 * rather than against the happy path.
 *
 * ─── WHAT IS FAKED, AND WHY THAT IS HONEST ───────────────────────────────────
 *
 * The store is replaced with an IN-MEMORY TABLE that reproduces DynamoDB's conditional
 * semantics: a lease is granted only if none is held or the held one has expired, and a
 * rotation applies only if the row still holds the refresh token the caller keyed on.
 *
 * That is a reimplementation, and a reimplementation can drift from the thing it
 * imitates — so the split matters. `source-account-store.test.ts` asserts the REAL
 * module issues commands carrying exactly those conditions, against the real command
 * shapes. This file assumes those conditions hold and asserts that the orchestration on
 * top of them is correct. Neither test could do the other's job: a stubbed `send` cannot
 * express a race, and a real DynamoDB cannot be made to crash between two statements.
 */

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

vi.mock("@/lib/log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const USER = "b3f1c2d4-0000-4000-8000-000000000001"
const SOURCE = "acme"

/** Epoch seconds. The row's own value — never a constant inside the code under test. */
const EXPIRES_AT = 1794700000
/** Comfortably inside the window: more than the skew left to run. */
const FRESH_CLOCK = (EXPIRES_AT - REFRESH_SKEW_SECONDS - 60) * 1000
/** Inside the skew window, so a refresh is due. */
const STALE_CLOCK = (EXPIRES_AT - REFRESH_SKEW_SECONDS + 1) * 1000

interface Row {
  accessToken?: string
  refreshToken?: string
  expiresAt: number
  scopes: string[]
  status: SourceAccountStatus
  leaseUntil: number
}

/** The event log. Ordering assertions read this; nothing else does. */
let events: string[] = []
let row: Row
let clock: number

/**
 * Wires the mocked store to a single in-memory row, honouring the two conditions the
 * real table enforces. Every test starts from a healthy connection and breaks exactly
 * one thing.
 */
function installTable(over: Partial<Row> = {}) {
  row = {
    accessToken: "access-v1",
    refreshToken: "refresh-v1",
    expiresAt: EXPIRES_AT,
    scopes: ["read", "activity:read_all"],
    status: "ACTIVE",
    leaseUntil: 0,
    ...over,
  }

  vi.mocked(loadCredentials).mockImplementation(async ({ requiredScopes }): Promise<CredentialLoad> => {
    events.push("load")
    if (row.status === "DISCONNECTED") {
      return { ok: false, reason: "not-connected", detail: "disconnected" }
    }
    if (row.status === "NEEDS_REAUTH") {
      return { ok: false, reason: "needs-reauth", detail: "marked" }
    }
    if (row.accessToken === undefined || row.refreshToken === undefined) {
      return { ok: false, reason: "not-connected", detail: "no tokens" }
    }
    const missing = requiredScopes.filter((s) => !row.scopes.includes(s))
    if (missing.length > 0) {
      row.status = "NEEDS_REAUTH"
      return { ok: false, reason: "needs-reauth", detail: `missing ${missing.join(", ")}` }
    }
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

  vi.mocked(acquireRefreshLease).mockImplementation(async ({ leaseSeconds, now }) => {
    const nowSeconds = Math.floor((now ?? new Date(clock)).getTime() / 1000)
    if (row.leaseUntil !== 0 && row.leaseUntil >= nowSeconds) {
      events.push("lease-refused")
      return false
    }
    row.leaseUntil = nowSeconds + leaseSeconds
    events.push("lease-taken")
    return true
  })

  vi.mocked(releaseRefreshLease).mockImplementation(async () => {
    row.leaseUntil = 0
    events.push("lease-released")
  })

  vi.mocked(rotateTokens).mockImplementation(async (input) => {
    // THE CONDITION. Applies only if the row still holds what the caller keyed on.
    if (row.refreshToken !== input.previousRefreshToken) {
      events.push("rotate-refused")
      return { won: false }
    }
    row.accessToken = input.accessToken
    row.refreshToken = input.refreshToken
    row.expiresAt = input.expiresAt
    row.leaseUntil = 0
    events.push(`persist:${input.refreshToken}`)
    return { won: true }
  })

  vi.mocked(markNeedsReauth).mockImplementation(async () => {
    if (row.status !== "DISCONNECTED") row.status = "NEEDS_REAUTH"
    row.leaseUntil = 0
    events.push("needs-reauth")
  })
}

/** A connector that is nothing but the two members this path uses. */
function connectorThat(
  refresh: (input: { refreshToken: string }) => Promise<OAuthRefresh>,
): OAuthConnector {
  return {
    source: SOURCE,
    requiredScopes: ["activity:read_all"],
    refreshTokens: vi.fn(async (input) => {
      events.push("exchange")
      return refresh(input)
    }),
  } as unknown as OAuthConnector
}

/** The ordinary provider: rotates the refresh token, as Strava says it may. */
const rotating = (n: number) =>
  connectorThat(async () => ({
    accessToken: `access-v${n}`,
    refreshToken: `refresh-v${n}`,
    expiresAt: EXPIRES_AT + 21600,
  }))

const at = (connector: OAuthConnector, knownStale?: string) =>
  accessTokenFor(
    { userId: USER, sourceId: SOURCE, connector, knownStale },
    { now: () => new Date(clock), sleep: async () => {} },
  )

beforeEach(() => {
  events = []
  clock = FRESH_CLOCK
  installTable()
})

afterEach(() => vi.clearAllMocks())

/** Criterion 5. */
describe("refresh fires at expiresAt - 300s, from the stored value", () => {
  it("returns the stored token untouched while there is more than the skew left", async () => {
    const connector = rotating(2)
    await expect(at(connector)).resolves.toBe("access-v1")
    expect(connector.refreshTokens).not.toHaveBeenCalled()
    expect(events).toEqual(["load"])
  })

  it("refreshes the moment the clock crosses expiresAt - 300s", async () => {
    clock = STALE_CLOCK
    await expect(at(rotating(2))).resolves.toBe("access-v2")
  })

  it("is one second wide, not approximately — at exactly the boundary it refreshes", async () => {
    // `now < expiresAt - skew` is the rule. At equality the token is due.
    clock = (EXPIRES_AT - REFRESH_SKEW_SECONDS) * 1000
    await expect(at(rotating(2))).resolves.toBe("access-v2")

    installTable()
    events = []
    clock = (EXPIRES_AT - REFRESH_SKEW_SECONDS - 1) * 1000
    await expect(at(rotating(3))).resolves.toBe("access-v1")
  })

  it("is driven by the ROW, not a constant — two rows differ at the same instant", async () => {
    /**
     * The criterion says "driven by the stored value, not a constant TTL", and this is
     * what makes that observable. A hardcoded six-hour TTL would treat these two rows
     * identically; the stored `expiresAt` is the only thing that distinguishes them.
     */
    clock = STALE_CLOCK
    await expect(at(rotating(2))).resolves.toBe("access-v2")

    // Same instant, a row whose provider handed back a longer life.
    installTable({ expiresAt: EXPIRES_AT + 86400 })
    const connector = rotating(9)
    await expect(at(connector)).resolves.toBe("access-v1")
    expect(connector.refreshTokens).not.toHaveBeenCalled()
  })
})

/** Criterion 6. */
describe("a rotated refresh token is persisted before its access token is usable", () => {
  it("stores the NEW refresh token, not the one it sent", async () => {
    clock = STALE_CLOCK
    await at(rotating(2))
    expect(row.refreshToken).toBe("refresh-v2")
    expect(row.expiresAt).toBe(EXPIRES_AT + 21600)
  })

  it("persists BEFORE returning — asserted by ordering", async () => {
    clock = STALE_CLOCK
    const token = await at(rotating(2))
    events.push(`use:${token}`)

    /**
     * The assertion that is the ticket. The write is not merely present, it is BEFORE
     * the point at which the caller can do anything with the token — and it is the
     * statement immediately after the exchange, with nothing between them.
     */
    expect(events).toEqual([
      "load",
      "lease-taken",
      "load",
      "exchange",
      "persist:refresh-v2",
      "use:access-v2",
    ])
  })

  it("returns NOTHING when the persist fails, so an unpersisted token cannot escape", async () => {
    clock = STALE_CLOCK
    vi.mocked(rotateTokens).mockRejectedValue(new Error("ProvisionedThroughputExceeded"))
    await expect(at(rotating(2))).rejects.toThrow(/Throughput/)
  })

  it("persists even when the provider hands back the SAME refresh token", async () => {
    /**
     * Strava usually does. The write is unconditional-on-sameness on purpose: a branch
     * that skips it when the value is unchanged is right 99 times, and the 100th — where
     * it did rotate and the comparison was against a stale read — is the permanent
     * orphan. `expiresAt` has to move regardless.
     */
    clock = STALE_CLOCK
    const connector = connectorThat(async ({ refreshToken }) => ({
      accessToken: "access-v2",
      refreshToken,
      expiresAt: EXPIRES_AT + 21600,
    }))

    await expect(at(connector)).resolves.toBe("access-v2")
    expect(events).toContain("persist:refresh-v1")
    expect(row.expiresAt).toBe(EXPIRES_AT + 21600)
  })
})

/** Criterion 7. */
describe("two concurrent refreshes", () => {
  it("lets exactly one win the write, and the loser takes the winner's value", async () => {
    clock = STALE_CLOCK

    /**
     * BOTH REFRESHERS HOLD THE LEASE. That is not a contrived setup — it is what
     * happens when a lease expires while its holder is mid-exchange, and it is the exact
     * case the condition exists for. The lease makes the race rare; the condition makes
     * it safe, and only the second of those is load-bearing.
     */
    vi.mocked(acquireRefreshLease).mockResolvedValue(true)

    let openGate = () => {}
    const gate = new Promise<void>((resolve) => (openGate = resolve))

    let announceArrival = () => {}
    const reachedProvider = new Promise<void>((resolve) => (announceArrival = resolve))

    const slow = connectorThat(async () => {
      announceArrival()
      await gate
      return { accessToken: "access-slow", refreshToken: "refresh-slow", expiresAt: EXPIRES_AT + 1 }
    })
    const fast = rotating(2)

    const pSlow = at(slow)
    await reachedProvider
    const pFast = at(fast)
    // The fast one completes its whole refresh while the slow one is still at the gate.
    const fastToken = await pFast
    openGate()
    const slowToken = await pSlow

    // Both exchanges happened — the provider was called twice, which is the cost of
    // losing the lease, not a correctness problem.
    expect(events.filter((e) => e === "exchange")).toHaveLength(2)

    // But exactly ONE write applied, and it is the fast one's.
    expect(events.filter((e) => e.startsWith("persist:"))).toEqual(["persist:refresh-v2"])
    expect(events).toContain("rotate-refused")
    expect(row.refreshToken).toBe("refresh-v2")

    // The loser did not overwrite. It retried against the winner's value.
    expect(fastToken).toBe("access-v2")
    expect(slowToken).toBe("access-v2")
  })

  it("never leaves the row holding a token the provider rotated away", async () => {
    // The failure this whole design prevents: an unconditional write applying the
    // slower exchange last, so the row ends up holding a dead refresh token that looks
    // alive until the next refresh fails.
    clock = STALE_CLOCK
    vi.mocked(acquireRefreshLease).mockResolvedValue(true)

    let openGate = () => {}
    const gate = new Promise<void>((resolve) => (openGate = resolve))
    let announceArrival = () => {}
    const reachedProvider = new Promise<void>((resolve) => (announceArrival = resolve))

    const slow = connectorThat(async () => {
      announceArrival()
      await gate
      return { accessToken: "access-slow", refreshToken: "refresh-slow", expiresAt: EXPIRES_AT + 1 }
    })

    const pSlow = at(slow)
    await reachedProvider
    await at(rotating(2))
    openGate()
    await pSlow

    expect(row.refreshToken).not.toBe("refresh-slow")
  })
})

/** Criterion 8, as amended before the work started — see the ticket's Resolution. */
describe("a crash between the token response and the persist", () => {
  it("leaves the OLD refresh token in place and the connection usable", async () => {
    clock = STALE_CLOCK

    // The crash: the process dies after the provider answered and before the write
    // landed. Modelled as the write never happening.
    vi.mocked(rotateTokens).mockRejectedValueOnce(new Error("process died"))
    await expect(at(rotating(2))).rejects.toThrow("process died")

    // NOTHING WAS HALF-WRITTEN. The row is exactly as it was: the old refresh token,
    // still ACTIVE, not marked as needing a human, nothing blanked.
    expect(row.refreshToken).toBe("refresh-v1")
    expect(row.accessToken).toBe("access-v1")
    expect(row.status).toBe("ACTIVE")
    expect(vi.mocked(markNeedsReauth)).not.toHaveBeenCalled()
  })

  it("recovers on the next attempt, re-using the refresh token it still holds", async () => {
    clock = STALE_CLOCK
    vi.mocked(rotateTokens).mockRejectedValueOnce(new Error("process died"))
    await expect(at(rotating(2))).rejects.toThrow("process died")

    // The retry sends the SAME refresh token, because that is what the row still holds.
    events = []
    const second = rotating(3)
    await expect(at(second)).resolves.toBe("access-v3")
    expect(second.refreshTokens).toHaveBeenCalledWith(
      expect.objectContaining({ refreshToken: "refresh-v1" }),
    )
  })

  it("hands the lease back when the failure unwinds, rather than blocking the retry", async () => {
    /**
     * The distinction the code makes explicitly: an error that unwinds releases the
     * lease, so the retry above is immediate. A HARD crash cannot run any cleanup at
     * all, and that is the case the fifteen-second expiry exists for — the two together
     * are why a mid-refresh failure costs a retry rather than a connection.
     */
    clock = STALE_CLOCK
    vi.mocked(rotateTokens).mockRejectedValueOnce(new Error("process died"))
    await expect(at(rotating(2))).rejects.toThrow("process died")
    expect(row.leaseUntil).toBe(0)
  })
})

/** Criterion 9. */
describe("the lease serializes refreshes for one connection", () => {
  it("makes a second concurrent refresh wait rather than issue its own exchange", async () => {
    clock = STALE_CLOCK

    let openGate = () => {}
    const gate = new Promise<void>((resolve) => (openGate = resolve))
    let announceArrival = () => {}
    // Counting microtasks would work today and break the first time a line is added to
    // the code under test. The winner says when it is at the provider instead.
    const reachedProvider = new Promise<void>((resolve) => (announceArrival = resolve))

    const winner = connectorThat(async () => {
      announceArrival()
      await gate
      return { accessToken: "access-v2", refreshToken: "refresh-v2", expiresAt: EXPIRES_AT + 21600 }
    })

    const pWinner = at(winner)
    await reachedProvider

    const loser = rotating(9)
    const pLoser = accessTokenFor(
      { userId: USER, sourceId: SOURCE, connector: loser },
      {
        now: () => new Date(clock),
        // The loser's wait is where the winner is allowed to finish. This is what makes
        // the test deterministic rather than dependent on a real timer.
        sleep: async () => {
          openGate()
          await pWinner
        },
      },
    )

    const [a, b] = await Promise.all([pWinner, pLoser])

    expect(a).toBe("access-v2")
    expect(b).toBe("access-v2")
    // THE ASSERTION. One exchange, not two — the loser no-opped onto the winner's work.
    expect(events.filter((e) => e === "exchange")).toHaveLength(1)
    expect(events).toContain("lease-refused")
    expect(loser.refreshTokens).not.toHaveBeenCalled()
  })

  it("does not spend an exchange when the row was already refreshed under the lease", async () => {
    // The lease was free, but between the first read and taking it someone else
    // finished. The correct number of provider calls is zero.
    clock = STALE_CLOCK
    vi.mocked(acquireRefreshLease).mockImplementation(async () => {
      row.accessToken = "access-someone-else"
      row.expiresAt = EXPIRES_AT + 86400
      return true
    })

    const connector = rotating(2)
    await expect(at(connector)).resolves.toBe("access-someone-else")
    expect(connector.refreshTokens).not.toHaveBeenCalled()
    expect(releaseRefreshLease).toHaveBeenCalled()
  })

  it("gives up rather than looping forever when a lease never publishes a result", async () => {
    clock = STALE_CLOCK
    vi.mocked(acquireRefreshLease).mockResolvedValue(false)
    await expect(at(rotating(2))).rejects.toThrow(/Timed out waiting for a token refresh/)
  })
})

/** Criterion 10's other half — the refresh endpoint itself refusing. */
describe("a refresh the provider rejects", () => {
  // The real error class, so `credentialIsDead` is the real judgement and not a stub of
  // it — that branch is the one worth getting wrong in only one place.
  const dead = (status: number) =>
    connectorThat(async () => {
      throw new OAuthProviderError("acme", "token refresh", status)
    })

  it("marks NEEDS_REAUTH on a 400 — the refresh token is dead", async () => {
    clock = STALE_CLOCK
    await expect(at(dead(400))).rejects.toBeInstanceOf(SourceNeedsReauthError)
    expect(row.status).toBe("NEEDS_REAUTH")
  })

  it("stops every later call at the store, before any HTTP happens", async () => {
    clock = STALE_CLOCK
    await expect(at(dead(400))).rejects.toBeInstanceOf(SourceNeedsReauthError)

    const next = rotating(2)
    await expect(at(next)).rejects.toBeInstanceOf(SourceNeedsReauthError)
    // THE ANTI-STORM ASSERTION. Nothing reached the provider on the second call.
    expect(next.refreshTokens).not.toHaveBeenCalled()
  })

  it("does NOT mark NEEDS_REAUTH on a 500 — an outage is not a dead credential", async () => {
    /**
     * Getting this backwards sends the operator through a full OAuth flow on a phone to
     * repair a five-minute outage that fixed itself.
     */
    clock = STALE_CLOCK
    await expect(at(dead(503))).rejects.toThrow(/HTTP 503/)
    expect(row.status).toBe("ACTIVE")
    expect(markNeedsReauth).not.toHaveBeenCalled()
  })

  it("keeps the tokens when it marks NEEDS_REAUTH", async () => {
    clock = STALE_CLOCK
    await expect(at(dead(401))).rejects.toBeInstanceOf(SourceNeedsReauthError)
    expect(row.refreshToken).toBe("refresh-v1")
  })
})

/** Criterion 11, at the orchestration level. */
describe("the stored scopes are checked before anything is spent", () => {
  it("refuses a row short of a required scope, without calling the provider", async () => {
    installTable({ scopes: ["read"] })
    const connector = rotating(2)
    await expect(at(connector)).rejects.toBeInstanceOf(SourceNeedsReauthError)
    expect(connector.refreshTokens).not.toHaveBeenCalled()
    expect(row.status).toBe("NEEDS_REAUTH")
  })
})

describe("connections that are not there", () => {
  it("distinguishes never-connected from broken", async () => {
    installTable({ status: "DISCONNECTED" })
    await expect(at(rotating(2))).rejects.toBeInstanceOf(SourceNotConnectedError)
  })

  it("reports a row whose tokens were removed as not connected", async () => {
    installTable({ accessToken: undefined, refreshToken: undefined })
    await expect(at(rotating(2))).rejects.toBeInstanceOf(SourceNotConnectedError)
  })
})

/** The post-401 path, driven by value rather than by a boolean. */
describe("knownStale", () => {
  it("refreshes even though the clock says the token is fine", async () => {
    // The provider refused a token that has hours left. The clock is not the authority
    // here; the 401 is.
    clock = FRESH_CLOCK
    await expect(at(rotating(2), "access-v1")).resolves.toBe("access-v2")
  })

  it("does NOT refresh when someone else has already replaced the failed token", async () => {
    clock = FRESH_CLOCK
    const connector = rotating(2)
    await expect(at(connector, "access-v0")).resolves.toBe("access-v1")
    expect(connector.refreshTokens).not.toHaveBeenCalled()
  })
})
