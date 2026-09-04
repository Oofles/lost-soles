import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { connectableSources, getOAuthConnector } from "@/src/adapters/registry"

/**
 * Ticket 0032. The three OAuth routes, end to end, with only the IO stubbed: SSM,
 * DynamoDB, the Cognito session and the provider's HTTP endpoints.
 *
 * WHAT IS NOT STUBBED is the connector. The authorize URL, the scope judgement and
 * the token-response parsing all run for real, so a route that calls them in the
 * wrong order — or skips one — fails here. That ordering IS the ticket: the scope
 * check has to happen before the exchange, and the row write has to happen after
 * both.
 *
 * NO VENDOR NAME APPEARS IN THIS FILE either. `check-boundaries.mjs` scans `app/`,
 * test files included (D-163), and the source id and the expected authorize URL both
 * come from the registry — which makes the assertions stronger, not weaker: they
 * compare the route's output against the connector's own, rather than against a
 * literal copied from it.
 */

const SOURCE = connectableSources()[0] as string
const CONNECTOR = getOAuthConnector(SOURCE)

const fx = (...parts: string[]) => parts.join("")
const ACCESS = fx("aaaa1111", "bbbb2222", "cccc3333", "dddd4444")
const REFRESH = fx("eeee5555", "ffff6666", "aaaa7777", "bbbb8888")

const OWNER = "b3f1c2d4-0000-4000-8000-000000000001"
const OTHER = "b3f1c2d4-0000-4000-8000-000000000002"
const APP_ORIGIN = "https://soles.devaultsecurity.com"
const CREDS = { clientId: "12345", clientSecret: fx("secret", "-not-real") }

let signedInAs: string | undefined
let owners: string[] = []

vi.mock("@/lib/auth/owner", () => ({
  currentUserId: async () => signedInAs,
  isOwner: (id: string | undefined) => id !== undefined && owners.includes(id),
}))

vi.mock("@/lib/sources/oauth-credentials", () => ({
  getOAuthClientCredentials: async () => CREDS,
}))

const issueState = vi.fn()
const consumeState = vi.fn()

vi.mock("@/lib/sources/oauth-state-store", () => ({
  issueState: (...a: unknown[]) => issueState(...a),
  consumeState: (...a: unknown[]) => consumeState(...a),
}))

const putConnectedAccount = vi.fn()
const markDisconnected = vi.fn()
const readAccessTokenForRevocation = vi.fn()

vi.mock("@/lib/sources/source-account-store", () => ({
  putConnectedAccount: (...a: unknown[]) => putConnectedAccount(...a),
  markDisconnected: (...a: unknown[]) => markDisconnected(...a),
  readAccessTokenForRevocation: (...a: unknown[]) => readAccessTokenForRevocation(...a),
}))

const { NextRequest } = await import("next/server")
const { GET: START } = await import("./start/route")
const { GET: CALLBACK } = await import("./callback/route")
const { POST: DISCONNECT } = await import("./disconnect/route")

const params = (source = SOURCE) => ({ params: Promise.resolve({ source }) })

const start = (query = "", source = SOURCE) =>
  START(new NextRequest(new URL(`${APP_ORIGIN}/api/auth/${source}/start${query}`)), params(source))

const callback = (query: string, source = SOURCE) =>
  CALLBACK(
    new NextRequest(new URL(`${APP_ORIGIN}/api/auth/${source}/callback${query}`)),
    params(source),
  )

const disconnect = (headers: Record<string, string> = { origin: APP_ORIGIN }, source = SOURCE) =>
  DISCONNECT(
    new NextRequest(new URL(`${APP_ORIGIN}/api/auth/${source}/disconnect`), {
      method: "POST",
      headers,
    }),
    params(source),
  )

/** The token response, in the documented shape (03-integrations.md §2.2 step 3). */
const tokenResponse = (scope: string) => ({
  token_type: "Bearer",
  expires_at: 1794700000,
  expires_in: 21600,
  refresh_token: REFRESH,
  access_token: ACCESS,
  athlete: { id: 134815 },
  scope,
})

const FULL_SCOPE = CONNECTOR.requiredScopes.join(",")
/** The lesser scope, derived rather than spelled — see the note at the top. */
const LESSER_SCOPE = `read,${CONNECTOR.requiredScopes[0].replace("_all", "")}`

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  signedInAs = OWNER
  owners = [OWNER]
  issueState.mockResolvedValue({ state: "the-nonce" })
  consumeState.mockResolvedValue({ userId: OWNER, sourceId: SOURCE })
  putConnectedAccount.mockResolvedValue(undefined)
  markDisconnected.mockResolvedValue(undefined)
  readAccessTokenForRevocation.mockResolvedValue(ACCESS)

  fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => tokenResponse(FULL_SCOPE) }))
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

const location = (res: Response) => res.headers.get("location") ?? ""
const outcome = (res: Response) => new URL(location(res)).searchParams.get("connect")

describe("who is allowed in", () => {
  it("404s a signed-out request on every route", async () => {
    signedInAs = undefined
    expect((await start()).status).toBe(404)
    expect((await callback("?code=c&state=s")).status).toBe(404)
    expect((await disconnect()).status).toBe(404)
  })

  it("404s a signed-in NON-OWNER — the same status, so neither can tell them apart", async () => {
    // 08-security-privacy.md §6.5: anyone who can distinguish a 403 from a 404 has
    // learned the route exists.
    signedInAs = OTHER
    expect((await start()).status).toBe(404)
    expect((await callback("?code=c&state=s")).status).toBe(404)
  })

  it("404s an unknown source rather than saying which ones exist", async () => {
    expect((await start("", "not-a-source")).status).toBe(404)
    expect((await callback("?code=c&state=s", "not-a-source")).status).toBe(404)
  })
})

describe("start", () => {
  it("redirects to the connector's own authorize URL, with the issued nonce", async () => {
    const res = await start()
    expect(res.status).toBe(302)

    // Compared against the connector's output rather than a copied literal, so the
    // route is asserted to DELEGATE rather than to have reimplemented the URL.
    expect(location(res)).toBe(
      CONNECTOR.authorizeUrl({
        clientId: CREDS.clientId,
        redirectUri: `${APP_ORIGIN}/api/auth/${SOURCE}/callback`,
        state: "the-nonce",
        force: false,
      }),
    )
    expect(new URL(location(res)).searchParams.get("scope")).toBe(CONNECTOR.requiredScopes[0])
  })

  it("binds the nonce to the signed-in user and this source", async () => {
    await start()
    expect(issueState).toHaveBeenCalledWith({ userId: OWNER, sourceId: SOURCE })
  })

  it("passes force=1 through, so a refusal can be retried against a real consent screen", async () => {
    const res = await start("?force=1")
    expect(new URL(location(res)).searchParams.get("approval_prompt")).toBe("force")
  })

  it("builds the redirect URI from the app's own origin, never from the request host", async () => {
    // Deriving it from `Host` would let anyone who can set that header choose where
    // the authorization code is delivered.
    const res = await START(
      new NextRequest(new URL("https://attacker.example/api/auth/x/start"), {
        headers: { host: "attacker.example" },
      }),
      params(),
    )
    expect(new URL(location(res)).searchParams.get("redirect_uri")).toBe(
      `${APP_ORIGIN}/api/auth/${SOURCE}/callback`,
    )
  })

  it("fails closed to settings when the nonce cannot be stored", async () => {
    issueState.mockRejectedValue(new Error("dynamo is down"))
    const res = await start()
    expect(outcome(res)).toBe("failed")
  })
})

describe("the callback — state, before anything else costs something", () => {
  const assertNothingHappened = () => {
    expect(fetchMock).not.toHaveBeenCalled()
    expect(putConnectedAccount).not.toHaveBeenCalled()
  }

  it("rejects a missing, unknown, expired or consumed state WITHOUT exchanging", async () => {
    // The store collapses all four into null, and this is the assertion that the
    // route treats that as fatal before it spends a code.
    consumeState.mockResolvedValue(null)
    const res = await callback("?code=the-code&state=whatever")

    expect(outcome(res)).toBe("failed")
    assertNothingHappened()
  })

  it("rejects a nonce issued for a DIFFERENT user", async () => {
    consumeState.mockResolvedValue({ userId: OTHER, sourceId: SOURCE })
    const res = await callback("?code=the-code&state=s")

    expect(outcome(res)).toBe("failed")
    assertNothingHappened()
  })

  it("rejects a nonce issued for a DIFFERENT source", async () => {
    consumeState.mockResolvedValue({ userId: OWNER, sourceId: "somewhere-else" })
    const res = await callback("?code=the-code&state=s")

    expect(outcome(res)).toBe("failed")
    assertNothingHappened()
  })

  it("consumes the nonce exactly once per callback", async () => {
    await callback(`?code=the-code&state=s&scope=${FULL_SCOPE}`)
    expect(consumeState).toHaveBeenCalledTimes(1)
  })
})

describe("the callback — the scope refusal, which is the point of the ticket", () => {
  it("REFUSES the lesser scope on the callback URL, storing nothing and exchanging nothing", async () => {
    const res = await callback(`?code=the-code&state=s&scope=${LESSER_SCOPE}`)

    expect(outcome(res)).toBe("scope-refused")
    // No token was ever minted, so there is nothing to store by mistake and nothing
    // to revoke on the way out.
    expect(fetchMock).not.toHaveBeenCalled()
    expect(putConnectedAccount).not.toHaveBeenCalled()
  })

  it("refuses a callback carrying no scope at all", async () => {
    const res = await callback("?code=the-code&state=s")
    expect(outcome(res)).toBe("scope-refused")
    expect(putConnectedAccount).not.toHaveBeenCalled()
  })

  it("refuses AND REVOKES when the token response disagrees with the callback", async () => {
    // The callback parameter is a hint; the token response is the authority. When
    // they differ a live credential exists, and it must not simply be dropped.
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => tokenResponse(LESSER_SCOPE),
    })

    const res = await callback(`?code=the-code&state=s&scope=${FULL_SCOPE}`)

    expect(outcome(res)).toBe("scope-refused")
    expect(putConnectedAccount).not.toHaveBeenCalled()

    const revoked = fetchMock.mock.calls.some(([url]) => String(url).endsWith("/oauth/revoke"))
    expect(revoked).toBe(true)
  })

  it("still refuses when the revocation itself fails", async () => {
    let call = 0
    fetchMock.mockImplementation(async () => {
      call += 1
      if (call === 1) return { ok: true, status: 200, json: async () => tokenResponse(LESSER_SCOPE) }
      throw new Error("revoke unreachable")
    })

    const res = await callback(`?code=the-code&state=s&scope=${FULL_SCOPE}`)
    expect(outcome(res)).toBe("scope-refused")
    expect(putConnectedAccount).not.toHaveBeenCalled()
  })

  it("reports a user who cancelled as declined, not as an error", async () => {
    const res = await callback("?error=access_denied&state=s")
    expect(outcome(res)).toBe("denied")
    expect(putConnectedAccount).not.toHaveBeenCalled()
  })
})

describe("the callback — a good grant", () => {
  it("stores the row criteria 4 and 5 describe, and only then", async () => {
    const res = await callback(`?code=the-code&state=s&scope=${FULL_SCOPE}`)

    expect(outcome(res)).toBe("connected")
    expect(putConnectedAccount).toHaveBeenCalledWith({
      userId: OWNER,
      sourceId: SOURCE,
      externalOwnerId: "134815",
      accessToken: ACCESS,
      refreshToken: REFRESH,
      expiresAt: 1794700000,
      scopes: CONNECTOR.requiredScopes.slice(),
    })
  })

  it("stores nothing when the exchange fails", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })
    const res = await callback(`?code=the-code&state=s&scope=${FULL_SCOPE}`)

    expect(outcome(res)).toBe("failed")
    expect(putConnectedAccount).not.toHaveBeenCalled()
  })

  it("stores nothing when there is no code", async () => {
    const res = await callback(`?state=s&scope=${FULL_SCOPE}`)
    expect(outcome(res)).toBe("failed")
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe("disconnect — criterion 7", () => {
  it("revokes at the provider BEFORE the row is torn down", async () => {
    const order: string[] = []
    fetchMock.mockImplementation(async () => {
      order.push("revoke")
      return { ok: true, status: 200, json: async () => ({}) }
    })
    markDisconnected.mockImplementation(async () => {
      order.push("mark")
    })

    const res = await disconnect()

    expect(res.status).toBe(303)
    // Marking first would leave a live token at the provider that nothing in this
    // system can still see, and therefore nothing will ever revoke.
    expect(order).toEqual(["revoke", "mark"])
  })

  it("does not tear the row down when revocation fails", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })
    const res = await disconnect()

    expect(outcome(res)).toBe("disconnect-failed")
    expect(markDisconnected).not.toHaveBeenCalled()
  })

  it("still marks the row when there was no token left to revoke", async () => {
    readAccessTokenForRevocation.mockResolvedValue(null)
    await disconnect()

    expect(fetchMock).not.toHaveBeenCalled()
    expect(markDisconnected).toHaveBeenCalledWith({ userId: OWNER, sourceId: SOURCE })
  })

  it("refuses a cross-site form post, and a post with no Origin at all", async () => {
    // CORS governs what a script may READ; a form post does not need to read the
    // answer to have revoked the credential.
    expect((await disconnect({ origin: "https://attacker.example" })).status).toBe(404)
    expect((await disconnect({})).status).toBe(404)
    expect(markDisconnected).not.toHaveBeenCalled()
  })
})
