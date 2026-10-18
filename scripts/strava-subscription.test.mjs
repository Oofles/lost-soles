import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

import {
  API,
  APP_ID,
  PARAMETER_PREFIX,
  PERMANENCE_WARNING,
  parseCreatedId,
  parseSubscriptions,
  run,
} from "./strava-subscription.mjs"

/**
 * Ticket 0092 — the subscription script, criteria 6, 7 and 9, with Strava, SSM and the
 * deployed callback all faked. Nothing here reaches the network.
 */
const CALLBACK = "https://abc.lambda-url.us-east-1.on.aws/api/webhooks/strava"
const SECRETS = {
  STRAVA_CLIENT_ID: "12345",
  STRAVA_CLIENT_SECRET: "clientSecretMarkerZZZ",
  STRAVA_WEBHOOK_VERIFY_TOKEN: "verifyTokenMarkerYYY",
}

function response(status, body, headers = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (k) => headers[k.toLowerCase()] ?? null },
    text: async () => body,
  }
}

/**
 * `existing` is what Strava lists. `handshake` decides how the deployed callback answers our
 * self-check: "exact" echoes the challenge correctly, anything else is a broken serializer.
 */
function rig({ existing = "[]", answer = "", handshake = "exact", createStatus = 201 } = {}) {
  const calls = []
  const events = []
  const puts = []
  const out = []
  const io = {
    async fetch(url, init) {
      calls.push({ url, method: init.method, body: init.body })
      events.push(`fetch ${init.method} ${url.split("?")[0]}`)
      if (url.startsWith(CALLBACK)) {
        const challenge = new URL(url).searchParams.get("hub.challenge")
        const body =
          handshake === "exact" ? `{"hub.challenge":"${challenge}"}` : `{"hubChallenge":"${challenge}"}`
        return response(200, body, { "content-type": "application/json" })
      }
      if (init.method === "GET") return response(200, existing)
      if (init.method === "POST") return response(createStatus, '{"id":120475}')
      if (init.method === "DELETE") return response(204, "")
      throw new Error("unexpected")
    },
    async ssmGet(name) {
      return SECRETS[name.slice(PARAMETER_PREFIX.length)]
    },
    async ssmPut(name, value) {
      puts.push({ name, value })
    },
    async callbackUrl() {
      return CALLBACK
    },
    async prompt() {
      events.push("prompt")
      return answer
    },
    randomToken: () => "f".repeat(64),
    out: (l) => {
      out.push(l)
      events.push(`out ${l}`)
    },
    err: (l) => {
      out.push(l)
      events.push(`out ${l}`)
    },
  }
  const strava = () => calls.filter((c) => c.url.startsWith(API))
  return { io, calls, events, puts, out, strava }
}

const ONE = '[{"id":120475,"resource_state":2,"application_id":1,"callback_url":"' + CALLBACK + '","created_at":"2026-10-18T00:00:00Z","updated_at":"2026-10-18T00:00:00Z"}]'

describe("inspect (criterion 6)", () => {
  it("only reads, and reports the one subscription against the production callback", async () => {
    const r = rig({ existing: ONE })
    expect(await run(["inspect"], r.io)).toBe(0)
    expect(r.calls.map((c) => c.method)).toEqual(["GET"])
    expect(r.out.join("\n")).toMatch(/1 subscription\(s\)[^]*id 120475[^]*the production callback/)
  })
})

describe("create (criteria 6 and 7)", () => {
  it("self-checks, warns, waits for the typed word, then POSTs and prints the id + where to put it", async () => {
    const r = rig({ answer: "create" })
    expect(await run(["create"], r.io)).toBe(0)

    const post = r.strava().find((c) => c.method === "POST")
    const form = new URLSearchParams(post.body)
    expect(form.get("callback_url")).toBe(CALLBACK)
    expect(form.get("verify_token")).toBe(SECRETS.STRAVA_WEBHOOK_VERIFY_TOKEN)

    // ORDER: self-check GET → warning → prompt → the POST.
    const i = (pred) => r.events.findIndex(pred)
    const selfCheck = i((e) => e.startsWith(`fetch GET ${CALLBACK}`))
    const warning = i((e) => e === `out ${PERMANENCE_WARNING}`)
    const prompt = i((e) => e === "prompt")
    const create = i((e) => e === `fetch POST ${API}`)
    expect(selfCheck).toBeGreaterThan(-1)
    expect(selfCheck).toBeLessThan(warning)
    expect(warning).toBeLessThan(prompt)
    expect(prompt).toBeLessThan(create)

    const all = r.out.join("\n")
    expect(all).toContain("Subscription id: 120475")
    expect(all).toContain("STRAVA_SUBSCRIPTION_ID = 120475 in src/adapters/strava/subscription.ts")
  })

  it("sends nothing to Strava's create without the exact confirmation", async () => {
    for (const answer of ["", "y", "yes", "CREATE", "create please"]) {
      const r = rig({ answer })
      expect(await run(["create"], r.io)).toBe(1)
      expect(r.strava().filter((c) => c.method !== "GET")).toEqual([])
    }
  })

  it("refuses when a subscription already exists — Strava allows one", async () => {
    const r = rig({ existing: ONE, answer: "create" })
    expect(await run(["create"], r.io)).toBe(1)
    expect(r.strava().filter((c) => c.method === "POST")).toEqual([])
    expect(r.events).not.toContain("prompt")
  })

  it("refuses when the deployed callback answers anything but the exact bytes", async () => {
    const r = rig({ handshake: "camelCase", answer: "create" })
    expect(await run(["create"], r.io)).toBe(1)
    expect(r.strava().filter((c) => c.method === "POST")).toEqual([])
    expect(r.out.join("\n")).toMatch(/Self-check FAILED/)
  })
})

describe("delete (criteria 6 and 7)", () => {
  it("warns, waits for the id to be typed, then DELETEs", async () => {
    const r = rig({ existing: ONE, answer: "120475" })
    expect(await run(["delete", "120475"], r.io)).toBe(0)
    const del = r.strava().find((c) => c.method === "DELETE")
    expect(del.url.split("?")[0]).toBe(`${API}/120475`)
    expect(r.events.indexOf(`out ${PERMANENCE_WARNING}`)).toBeLessThan(r.events.indexOf("prompt"))
    expect(r.events.indexOf("prompt")).toBeLessThan(r.events.indexOf(`fetch DELETE ${API}/120475`))
  })

  it("sends no DELETE without the confirmation, or for an id that is not ours", async () => {
    const wrong = rig({ existing: ONE, answer: "yes" })
    expect(await run(["delete", "120475"], wrong.io)).toBe(1)
    const unknown = rig({ existing: ONE, answer: "999" })
    expect(await run(["delete", "999"], unknown.io)).toBe(1)
    for (const r of [wrong, unknown]) expect(r.strava().filter((c) => c.method === "DELETE")).toEqual([])
  })
})

describe("rotate-token (criterion 9)", () => {
  it("writes a SecureString-bound value from the CSPRNG and never prints it", async () => {
    const r = rig({ answer: "rotate" })
    expect(await run(["rotate-token"], r.io)).toBe(0)
    expect(r.puts).toEqual([{ name: `${PARAMETER_PREFIX}STRAVA_WEBHOOK_VERIFY_TOKEN`, value: "f".repeat(64) }])
    expect(r.out.join("\n")).not.toContain("f".repeat(64))
  })

  it("the real wiring is crypto.randomBytes and Type SecureString", () => {
    const src = readFileSync(new URL("./strava-subscription.mjs", import.meta.url), "utf8")
    expect(src).toContain('randomToken: () => randomBytes(32).toString("hex")')
    expect(src).toMatch(/Type: "SecureString"/)
    expect(src).not.toMatch(/Math\.random/)
  })
})

describe("no secret is ever printed", () => {
  it("across every command", async () => {
    const runs = [
      [["inspect"], rig({ existing: ONE })],
      [["create"], rig({ answer: "create" })],
      [["create"], rig({ handshake: "camelCase" })],
      [["delete", "120475"], rig({ existing: ONE, answer: "120475" })],
    ]
    for (const [argv, r] of runs) {
      await run(argv, r.io)
      const all = r.out.join("\n")
      expect(all).not.toContain(SECRETS.STRAVA_CLIENT_SECRET)
      expect(all).not.toContain(SECRETS.STRAVA_WEBHOOK_VERIFY_TOKEN)
    }
  })
})

describe("parsing", () => {
  it("keeps ids as exact digits", () => {
    expect(parseCreatedId('{"id": 9007199254740993}')).toBe("9007199254740993")
    expect(parseSubscriptions('[{"id":9007199254740993,"callback_url":"x","created_at":"t"}]')[0].id).toBe(
      "9007199254740993",
    )
  })
})

describe("the SSM prefix agrees with the app's", () => {
  it("is the one lib/sources/oauth-credentials.ts reads", () => {
    const src = readFileSync(new URL("../lib/sources/oauth-credentials.ts", import.meta.url), "utf8")
    expect(src).toContain(`"/amplify/shared/${APP_ID}/"`)
  })
})
