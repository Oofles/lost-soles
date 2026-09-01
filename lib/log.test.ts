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
