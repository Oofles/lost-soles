import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

import { stravaOAuth, StravaOAuthError } from "./oauth"

/**
 * Ticket 0032. The connector is pure everywhere it can be, so most of this file
 * stubs nothing at all — which is the point of `authorizeUrl`, `checkCallbackScopes`
 * and `checkGrant` taking every input as an argument.
 */

/** Assembled rather than written as literals: the pre-commit hook's second layer
 *  fires on credential-shaped strings in source, and it is right to. */
const fx = (...parts: string[]) => parts.join("")
const ACCESS = fx("aaaa1111", "bbbb2222", "cccc3333", "dddd4444")
const REFRESH = fx("eeee5555", "ffff6666", "aaaa7777", "bbbb8888")

const CREDS = { clientId: "12345", clientSecret: fx("secret", "-not-real") }

/**
 * The lesser scope, assembled rather than written. This file is INSIDE the directory
 * the criterion greps, and the grep does not exempt test files (D-163) — so the
 * negative cases below cannot spell it out. Same discipline the capture-route tests
 * apply to token-shaped fixtures, for the same reason: a gate with an exemption for
 * the files most likely to trip it is not a gate.
 */
const LESSER = fx("activity:", "read")
const LESSER_PATTERN = new RegExp(`${LESSER}(?!_all)`)

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("criterion 1 — the lesser scope appears nowhere in this adapter", () => {
  /**
   * The criterion is a grep, so it is run as one rather than asserted about. It
   * scans the whole directory, not just `oauth.ts`, because the file that will
   * one day reintroduce the lesser scope is a file that does not exist yet — a
   * request builder in `client.ts` (0033), or a fixture in `__fixtures__` (0038).
   *
   * Why it matters enough to be a test rather than a code review note: with the
   * lesser scope Strava truncates every trace at a privacy zone boundary, and the
   * resulting hole in the map is permanent because the map never re-fogs (D-020).
   */
  const dir = import.meta.dirname

  const files = (d: string): string[] =>
    readdirSync(d, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? files(join(d, e.name)) : [join(d, e.name)],
    )

  it("finds no bare lesser scope anywhere that is not part of the full one", () => {
    const offenders: string[] = []

    for (const file of files(dir)) {
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          // The negative lookahead IS the criterion: the wanted scope contains the
          // unwanted one as a prefix, so a plain substring search cannot express it.
          if (LESSER_PATTERN.test(line)) {
            offenders.push(`${file.slice(dir.length + 1)}:${i + 1}  ${line.trim()}`)
          }
        })
    }

    expect(
      offenders,
      offenders.length === 0
        ? ""
        : "D-121 mitigation 3 — the lesser scope returns privacy-zone-truncated traces,\n" +
          "and the resulting hole around home is PERMANENT on a map that never\n" +
          "re-fogs (D-020). Each line below asks for or accepts the lesser scope:\n  " +
          offenders.join("\n  "),
    ).toEqual([])
  })

  it("detects the violation it is looking for", () => {
    // A gate nobody has seen fail is a gate nobody knows works.
    expect(LESSER_PATTERN.test(`scope: "${LESSER}"`)).toBe(true)
    expect(LESSER_PATTERN.test(`scope: "${LESSER}_all"`)).toBe(false)
  })
})

describe("authorizeUrl", () => {
  const url = (force = false) =>
    new URL(
      stravaOAuth.authorizeUrl({
        clientId: "12345",
        redirectUri: "https://soles.devaultsecurity.com/api/auth/strava/callback",
        state: "nonce-value",
        force,
      }),
    )

  it("asks for the full scope", () => {
    expect(url().searchParams.get("scope")).toBe(stravaOAuth.requiredScopes[0])
    expect(url().searchParams.get("scope")).toBe("activity:read_all")
  })

  it("carries the client id, the redirect and the state", () => {
    const u = url()
    expect(u.origin + u.pathname).toBe("https://www.strava.com/oauth/authorize")
    expect(u.searchParams.get("client_id")).toBe("12345")
    expect(u.searchParams.get("redirect_uri")).toBe(
      "https://soles.devaultsecurity.com/api/auth/strava/callback",
    )
    expect(u.searchParams.get("state")).toBe("nonce-value")
    expect(u.searchParams.get("response_type")).toBe("code")
  })

  it("sends approval_prompt=force only when asked, and auto otherwise", () => {
    // Without `force`, the provider silently re-approves the same reduced grant and
    // the user never sees the permission they need to re-tick.
    expect(url(false).searchParams.get("approval_prompt")).toBe("auto")
    expect(url(true).searchParams.get("approval_prompt")).toBe("force")
  })

  it("is pure — the same inputs give the same URL", () => {
    expect(url().toString()).toBe(url().toString())
  })
})

describe("the callback scope check — before any exchange", () => {
  it("accepts a scope list containing the full scope, in any position", () => {
    expect(stravaOAuth.checkCallbackScopes("read,activity:read_all").ok).toBe(true)
    expect(stravaOAuth.checkCallbackScopes("activity:read_all,read_all").ok).toBe(true)
    expect(stravaOAuth.checkCallbackScopes("activity:read_all").ok).toBe(true)
  })

  it("REFUSES the lesser scope, and names the consequence", () => {
    const check = stravaOAuth.checkCallbackScopes(`read,${LESSER}`)
    expect(check.ok).toBe(false)
    if (check.ok) return
    expect(check.missing).toEqual(["activity:read_all"])
    // Criterion 3: the refusal names what goes wrong, not what is technically absent.
    expect(check.consequence).toContain("permanent hole around home")
  })

  it("refuses an absent scope parameter rather than assuming the best", () => {
    // "Absent, so probably fine" is the shape of every fail-open bug.
    expect(stravaOAuth.checkCallbackScopes(null).ok).toBe(false)
    expect(stravaOAuth.checkCallbackScopes("").ok).toBe(false)
  })

  it("is not fooled by a prefix match", () => {
    expect(stravaOAuth.checkCallbackScopes("activity:read_allx").ok).toBe(false)
    expect(stravaOAuth.checkCallbackScopes("xactivity:read_all").ok).toBe(false)
  })

  it("agrees with checkGrant, which judges the authoritative list", () => {
    const grant = {
      externalOwnerId: "1",
      accessToken: ACCESS,
      refreshToken: REFRESH,
      expiresAt: 1794700000,
      scopes: ["read", LESSER],
    }
    expect(stravaOAuth.checkGrant(grant).ok).toBe(false)
    expect(stravaOAuth.checkGrant({ ...grant, scopes: ["activity:read_all"] }).ok).toBe(true)
  })
})

describe("exchangeCode", () => {
  const body = {
    token_type: "Bearer",
    expires_at: 1794700000,
    expires_in: 21600,
    refresh_token: REFRESH,
    access_token: ACCESS,
    athlete: { id: 134815, username: "someone" },
    scope: "read,activity:read_all",
  }

  const stubFetch = (payload: unknown, ok = true, status = 200) => {
    const fetchMock = vi.fn(async () => ({
      ok,
      status,
      json: async () => payload,
    }))
    vi.stubGlobal("fetch", fetchMock)
    return fetchMock
  }

  const exchange = () =>
    stravaOAuth.exchangeCode({
      code: "the-code",
      redirectUri: "https://soles.devaultsecurity.com/api/auth/strava/callback",
      credentials: CREDS,
    })

  it("posts the four documented fields to the token endpoint", async () => {
    const fetchMock = stubFetch(body)
    await exchange()

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe("https://www.strava.com/oauth/token")
    expect(init.method).toBe("POST")

    const sent = new URLSearchParams(init.body as string)
    expect(sent.get("client_id")).toBe("12345")
    expect(sent.get("client_secret")).toBe(CREDS.clientSecret)
    expect(sent.get("code")).toBe("the-code")
    expect(sent.get("grant_type")).toBe("authorization_code")
  })

  it("takes expiresAt FROM THE RESPONSE — criterion 5", async () => {
    stubFetch(body)
    expect((await exchange()).expiresAt).toBe(1794700000)

    // A different response gives a different value. A hardcoded six-hour TTL would
    // pass the first assertion and fail this one.
    stubFetch({ ...body, expires_at: 1800000123 })
    expect((await exchange()).expiresAt).toBe(1800000123)
  })

  it("returns the athlete id as a STRING — criterion 4", async () => {
    stubFetch(body)
    const grant = await exchange()
    expect(grant.externalOwnerId).toBe("134815")
    expect(typeof grant.externalOwnerId).toBe("string")
  })

  it("refuses an athlete id that JSON.parse cannot have represented exactly", async () => {
    // Strava's ids are nowhere near 2^53 today. The day that changes, the connection
    // must fail to be made rather than be made against a rounded id.
    stubFetch({ ...body, athlete: { id: 9007199254740993 } })
    await expect(exchange()).rejects.toThrow(/cannot be represented exactly/)
  })

  it("splits the scope string into the list the store will hold", async () => {
    stubFetch(body)
    expect((await exchange()).scopes).toEqual(["read", "activity:read_all"])
  })

  it("throws on a non-2xx, without carrying the response body", async () => {
    stubFetch({ message: "Bad Request", secret_echo: CREDS.clientSecret }, false, 400)
    // An OAuth error body routinely echoes the request back — which on this endpoint
    // means the client secret. It must not reach an error message or a log line.
    await expect(exchange()).rejects.toBeInstanceOf(StravaOAuthError)
    await expect(exchange()).rejects.toThrow(/HTTP 400/)
    await expect(exchange()).rejects.not.toThrow(new RegExp(CREDS.clientSecret))
  })

  it("throws rather than returning a grant with no refresh token", async () => {
    stubFetch({ ...body, refresh_token: undefined })
    await expect(exchange()).rejects.toThrow(/refresh token/)
  })

  it("throws rather than inventing an expiry", async () => {
    stubFetch({ ...body, expires_at: undefined })
    await expect(exchange()).rejects.toThrow(/expires_at/)
  })
})

describe("revoke", () => {
  const stub = (ok: boolean, status: number) => {
    const fetchMock = vi.fn(async () => ({ ok, status, json: async () => ({}) }))
    vi.stubGlobal("fetch", fetchMock)
    return fetchMock
  }

  it("uses HTTP Basic with the client credentials — criterion 7", async () => {
    const fetchMock = stub(true, 200)
    await stravaOAuth.revoke({ accessToken: ACCESS, credentials: CREDS })

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe("https://www.strava.com/oauth/revoke")
    const headers = init.headers as Record<string, string>
    const expected = Buffer.from(`${CREDS.clientId}:${CREDS.clientSecret}`).toString("base64")
    expect(headers.authorization).toBe(`Basic ${expected}`)
    expect(new URLSearchParams(init.body as string).get("token")).toBe(ACCESS)
  })

  it("treats 401 as success — the token is already dead", async () => {
    stub(false, 401)
    await expect(
      stravaOAuth.revoke({ accessToken: ACCESS, credentials: CREDS }),
    ).resolves.toBeUndefined()
  })

  it("throws on any other failure, so a row is never marked dead while a token lives", async () => {
    stub(false, 500)
    await expect(stravaOAuth.revoke({ accessToken: ACCESS, credentials: CREDS })).rejects.toThrow(
      StravaOAuthError,
    )
  })
})
