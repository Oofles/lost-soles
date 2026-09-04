import { afterEach, describe, expect, it, vi } from "vitest"

import { log, redact } from "./log"

/**
 * Ticket 0018, criterion 5. CloudWatch is a second, un-audited copy of whatever
 * reaches it — the O-005 class (`08-security-privacy.md` §7.4) — and log retention
 * outlives incident response. A token in a log line has leaked whether or not anyone
 * reads it.
 *
 * This is the LAST line of defence, not the first. Nothing should be logging a
 * credential. These tests exist because "should" is not a control.
 */

// Assembled at runtime: gitleaks and GitHub push protection scan committed source and
// are right to fire on a realistic credential sitting in a file. Same reasoning as
// scripts/check-bundle-leak.mjs's fixtures.
const fx = (...parts: string[]) => parts.join("")
const PAT = fx("github_pat", "_11ABCDEFG0abcdefghijKLMNOPQRSTUVWXYZ0123456789abcdef")
const CLASSIC = fx("ghp", "_0123456789abcdefghijABCDEFGHIJ0123")
const AKIA = fx("AKIA", "3NPRZQ7XWFTKLMVD")
const SLACK = fx("xoxb", "-1234567890-abcdefghij")

describe("redact", () => {
  it.each([
    ["a fine-grained PAT", PAT],
    ["a classic PAT", CLASSIC],
    ["an AWS access key id", AKIA],
    ["a Slack token", SLACK],
  ])("removes %s", (_what, secret) => {
    const out = redact(`request failed with token ${secret} attached`)
    expect(out).not.toContain(secret)
    expect(out).toContain("redacted")
  })

  it("removes a bearer token whatever its shape", () => {
    const out = redact(`Authorization: Bearer abcdef0123456789ABCDEF~+/`)
    expect(out).not.toContain("abcdef0123456789")
    expect(out).toContain("Bearer <redacted>")
  })

  it("leaves ordinary text alone", () => {
    // A redactor that mangles normal logs gets turned off. The prefix must survive
    // so a reader can still tell WHICH kind of credential was caught.
    const text = "capture failed for tickets/inbox/2026-08-31T1904-fog-edge.md status=422"
    expect(redact(text)).toBe(text)
  })

  it("removes every occurrence, not just the first", () => {
    const out = redact(`${PAT} and again ${PAT}`)
    expect(out).not.toContain(PAT)
    expect(out.match(/redacted/g)).toHaveLength(2)
  })
})

describe("the log functions redact before writing", () => {
  afterEach(() => vi.restoreAllMocks())

  it("masks a token passed as a bare string", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    log.error("boom", PAT)
    expect(spy.mock.calls[0][0]).not.toContain(PAT)
  })

  it("masks a token nested inside an object", () => {
    // The case a string-only scrub misses, and the one that actually happens: a
    // request config or a header bag logged wholesale.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    log.error("request", { headers: { Authorization: `Bearer ${PAT}` }, url: "https://x" })
    expect(spy.mock.calls[0][0]).not.toContain(PAT)
  })

  it("masks a token carried inside an Error message", () => {
    // How a credential most plausibly escapes: a thrown fetch error quoting the
    // request it was building.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    log.error("failed", new Error(`bad credentials for ${PAT}`))
    expect(spy.mock.calls[0][0]).not.toContain(PAT)
  })

  it("still says something useful after redacting", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    log.error("capture failed", { path: "tickets/inbox/x.md" }, new Error(`token ${PAT} bad`))
    const line = spy.mock.calls[0][0] as string
    expect(line).toContain("capture failed")
    expect(line).toContain("tickets/inbox/x.md")
    expect(line).toContain("github_pat_<redacted>")
  })

  it("does not throw on a value that cannot be serialised", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(() => log.warn("odd", circular)).not.toThrow()
    expect(spy).toHaveBeenCalled()
  })
})

/**
 * Ticket 0033, criterion 4 — redaction by KEY NAME.
 *
 * The pattern list above cannot help here and no pattern could. A Strava access token
 * is forty hexadecimal characters, which is also what a git commit id looks like; any
 * regex loose enough to catch one catches every opaque identifier this app logs on
 * purpose. What IS reliable is the name of the field it arrives in, because a credential
 * reaches a log line inside an object that came from a token response, a DynamoDB item
 * or a header bag — and all three name their fields.
 */
describe("credentials are redacted by the name of the field carrying them", () => {
  // Built by concatenation so the literal never appears whole in this file, and so a
  // secret scanner has nothing to find. Shaped like the real thing: 40 hex characters.
  const hex = (a: string) => a.repeat(5)
  const ACCESS = hex("a1b2c3d4")
  const REFRESH = hex("9f8e7d6c")

  afterEach(() => vi.restoreAllMocks())

  it("blanks accessToken and refreshToken, the criterion exactly", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {})
    log.info("token state", { accessToken: ACCESS, refreshToken: REFRESH, expiresAt: 1794700000 })

    const line = spy.mock.calls[0][0] as string
    expect(line).not.toContain(ACCESS)
    expect(line).not.toContain(REFRESH)
    // And it still says something. A redaction that eats the whole line is a redaction
    // that gets removed the first time someone needs to debug this path.
    expect(line).toContain("token state")
    expect(line).toContain("1794700000")
  })

  it("finds them nested, which is how a DynamoDB item actually arrives", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    log.error("write failed", {
      command: { input: { Item: { pk: "U#owner", accessToken: ACCESS } } },
    })

    const line = spy.mock.calls[0][0] as string
    expect(line).not.toContain(ACCESS)
    expect(line).toContain("U#owner")
  })

  it("covers the snake_case spelling a provider's JSON uses", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {})
    log.info("token response", { access_token: ACCESS, refresh_token: REFRESH, expires_in: 21600 })

    const line = spy.mock.calls[0][0] as string
    expect(line).not.toContain(ACCESS)
    expect(line).not.toContain(REFRESH)
    expect(line).toContain("21600")
  })

  it("covers a client secret and an authorization header", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {})
    log.warn("request", {
      clientSecret: ACCESS,
      headers: { authorization: `Bearer ${REFRESH}` },
    })

    const line = spy.mock.calls[0][0] as string
    expect(line).not.toContain(ACCESS)
    expect(line).not.toContain(REFRESH)
  })

  it("leaves the diagnostics that made 0165 and 0166 debuggable alone", () => {
    // Ticket 0166's whole finding was that logging too little cost a second failed
    // connect. Over-redacting into uselessness would undo it, so the fields that
    // matter are asserted to survive: scope names are not credentials.
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {})
    log.warn("grant refused", {
      granted: ["read", "activity:read_all"],
      scopeSource: "response",
      tokenType: "Bearer",
    })

    const line = spy.mock.calls[0][0] as string
    expect(line).toContain("activity:read_all")
    expect(line).toContain("response")
    expect(line).toContain("Bearer")
  })

  it("renders a DynamoDB string set rather than dropping it to {}", () => {
    // `JSON.stringify(new Set([...]))` is `{}`, so before the scrub walked Sets, a
    // logged row's scopes vanished — the exact field 0166 needed to see.
    const spy = vi.spyOn(console, "log").mockImplementation(() => {})
    log.info("row", { scopes: new Set(["activity:read_all"]) })
    expect(spy.mock.calls[0][0] as string).toContain("activity:read_all")
  })

  it("does not mutate the object it was handed", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {})
    const creds = { accessToken: ACCESS }
    log.info("x", creds)
    expect(spy.mock.calls[0][0] as string).not.toContain(ACCESS)
    // A logger that edits its argument changes program behaviour, which is a far worse
    // bug than the one it was preventing.
    expect(creds.accessToken).toBe(ACCESS)
  })

  it("survives a cycle inside a credential-bearing object", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const circular: Record<string, unknown> = { refreshToken: REFRESH }
    circular.self = circular
    expect(() => log.warn("odd", circular)).not.toThrow()
    expect(spy.mock.calls[0][0] as string).not.toContain(REFRESH)
  })
})
