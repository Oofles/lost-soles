import { readFileSync } from "node:fs"
import { join } from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Ticket 0092 — the `hub.challenge` handshake, at the adapter. Criteria 1–5.
 *
 * `node:crypto` is wrapped, not replaced: `timingSafeEqual` still runs for real, and the spy is
 * how criterion 4 proves the comparison goes through it.
 */
const timingSafeEqual = vi.hoisted(() => ({ calls: 0 }))
vi.mock("node:crypto", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:crypto")>()
  return {
    ...real,
    timingSafeEqual: (a: NodeJS.ArrayBufferView, b: NodeJS.ArrayBufferView) => {
      timingSafeEqual.calls++
      return real.timingSafeEqual(a, b)
    },
  }
})

const { acceptHandshake, challengeBody, tokensMatch, CHALLENGE_PATTERN } = await import("./handshake")
const { getAdapter } = await import("../registry")
import type { InboundRequest } from "../types"

const TOKEN = "tok3nUnderTestQ7v2xLm9pR4sW8yZ1aB5c"
const CHALLENGE = "15f7d1a91c1f40f8a748fd134752feb3"

function get(query: Record<string, string>): InboundRequest {
  return { source: "strava", method: "GET", headers: {}, query, rawBody: Buffer.alloc(0) }
}
const subscribe = (over: Record<string, string> = {}) =>
  get({ "hub.mode": "subscribe", "hub.challenge": CHALLENGE, "hub.verify_token": TOKEN, ...over })

const logged: string[] = []
const LEVELS = ["log", "info", "warn", "error", "debug", "trace"] as const
beforeEach(() => {
  timingSafeEqual.calls = 0
  for (const level of LEVELS) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(" "))
    })
  }
})
afterEach(() => {
  logged.length = 0
  vi.restoreAllMocks()
})

describe("a correct handshake (criteria 1 and 2)", () => {
  it("answers 200 with the EXACT bytes {\"hub.challenge\":\"<X>\"}", () => {
    const ack = acceptHandshake(subscribe(), TOKEN)
    expect(ack.status).toBe(200)
    expect(ack.commands).toEqual([])
    // The raw string, never a parsed object: a parse would forgive the very bug this guards.
    expect(ack.body).toBe('{"hub.challenge":"15f7d1a91c1f40f8a748fd134752feb3"}')
  })

  it("contains the dotted key and neither of the serializer-shaped impostors", () => {
    const body = acceptHandshake(subscribe(), TOKEN).body as string
    expect(body).toContain('"hub.challenge"')
    expect(body).not.toContain("hub_challenge")
    expect(body).not.toContain("hubChallenge")
  })

  it("is what the registered adapter's accept() returns for a GET", async () => {
    vi.stubEnv("STRAVA_WEBHOOK_VERIFY_TOKEN", TOKEN)
    try {
      const ack = await getAdapter("strava").accept(subscribe())
      expect(ack.status).toBe(200)
      expect(ack.body).toBe(`{"hub.challenge":"${CHALLENGE}"}`)
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it("is built by hand, not by a serializer (source check)", () => {
    const src = readFileSync(join(import.meta.dirname, "handshake.ts"), "utf8")
    expect(src).toContain(`'{"hub.challenge":"' + challenge + '"}'`)
    const fn = src.slice(src.indexOf("export function challengeBody"), src.indexOf("const REJECT"))
    expect(fn).not.toContain("JSON.stringify")
  })
})

describe("a wrong token (criterion 3)", () => {
  it.each([
    ["a different token", { "hub.verify_token": "wrongWrongWrong123" }],
    ["a prefix of the token", { "hub.verify_token": TOKEN.slice(0, 10) }],
    ["the token plus one character", { "hub.verify_token": TOKEN + "x" }],
    ["an empty token", { "hub.verify_token": "" }],
  ])("%s → bare 400", (_name, over) => {
    const ack = acceptHandshake(subscribe(over), TOKEN)
    expect(ack).toEqual({ status: 400, commands: [] })
    expect(ack.body).toBeUndefined()
  })

  it("a missing token → bare 400", () => {
    const q = { "hub.mode": "subscribe", "hub.challenge": CHALLENGE }
    expect(acceptHandshake(get(q), TOKEN)).toEqual({ status: 400, commands: [] })
  })

  it("never writes the supplied token, at any console level", () => {
    const supplied = "SUPPLIEDtokenMarker4242"
    acceptHandshake(subscribe({ "hub.verify_token": supplied }), TOKEN)
    acceptHandshake(subscribe(), TOKEN) // and the correct one, on success, either
    expect(logged.length).toBeGreaterThan(0)
    const all = logged.join("\n")
    expect(all).not.toContain(supplied)
    expect(all).not.toContain(TOKEN)
    expect(all).not.toContain(CHALLENGE)
  })

  it("fails closed when the secret is not configured", () => {
    expect(acceptHandshake(subscribe(), undefined)).toEqual({ status: 400, commands: [] })
    expect(acceptHandshake(subscribe({ "hub.verify_token": "" }), "")).toEqual({ status: 400, commands: [] })
  })

  it("rejects any GET that is not hub.mode=subscribe — a scanner", () => {
    expect(acceptHandshake(get({}), TOKEN).status).toBe(400)
    expect(acceptHandshake(subscribe({ "hub.mode": "unsubscribe" }), TOKEN).status).toBe(400)
  })
})

describe("the comparison is constant-time (criterion 4)", () => {
  it("goes through crypto.timingSafeEqual on both a match and a mismatch", () => {
    expect(tokensMatch(TOKEN, TOKEN)).toBe(true)
    expect(timingSafeEqual.calls).toBe(1)
    expect(tokensMatch("short", TOKEN)).toBe(false) // unequal lengths do not throw
    expect(timingSafeEqual.calls).toBe(2)
    acceptHandshake(subscribe(), TOKEN)
    expect(timingSafeEqual.calls).toBe(3)
  })

  it("has no === or !== against the token in the source", () => {
    const src = readFileSync(join(import.meta.dirname, "handshake.ts"), "utf8")
    expect(src).not.toMatch(/(supplied|expected\w*)\s*[!=]==\s*(supplied|expected\w*)/)
    expect(src).toMatch(/timingSafeEqual\(sha256\(supplied\), sha256\(expected\)\)/)
  })
})

describe("the challenge is reflected, so it is validated (criterion 5)", () => {
  it.each([
    ["an HTML break-out", '"><script>'],
    ["a quote", 'abc"def'],
    ["a backslash", "abc\\u0022"],
    ["a space", "abc def"],
    ["a dash", "abc-def"],
    ["non-ASCII", "abcé"],
    ["empty", ""],
    ["257 characters", "a".repeat(257)],
  ])("%s is rejected with a bare 400 and never reaches the body", (_name, challenge) => {
    const ack = acceptHandshake(subscribe({ "hub.challenge": challenge }), TOKEN)
    expect(ack).toEqual({ status: 400, commands: [] })
    if (challenge) expect(JSON.stringify(ack)).not.toContain(challenge)
  })

  it("accepts exactly 256 alphanumerics", () => {
    const max = "Z9".repeat(128)
    expect(acceptHandshake(subscribe({ "hub.challenge": max }), TOKEN).body).toBe(`{"hub.challenge":"${max}"}`)
  })

  it("a missing challenge is rejected", () => {
    const q = { "hub.mode": "subscribe", "hub.verify_token": TOKEN }
    expect(acceptHandshake(get(q), TOKEN).status).toBe(400)
  })

  it("challengeBody refuses to emit anything that failed the pattern", () => {
    expect(() => challengeBody('"><script>')).toThrow()
    expect(CHALLENGE_PATTERN.test('"><script>')).toBe(false)
  })
})
