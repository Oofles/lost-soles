import { afterEach, describe, expect, it, vi } from "vitest"

import type { InboundRequest } from "../types"
import { acceptStravaEvent } from "./accept"
import { STRAVA_SUBSCRIPTION_ID } from "./subscription"

/**
 * Ticket 0093 — the adapter half of the webhook's filter chain (`08-security-privacy.md` §4.1,
 * §4.4). The Lambda half (method allowlist, 8 KB cap, flood counter, receipt gate) is
 * `amplify/functions/ingest-webhook/handler.test.ts`.
 */
const KNOWN_OWNER = "51449053"
const OWNER_SUB = "5488e4b8-d081-7014-748e-edd1937f8083"
const OURS = 120475

function req(body: unknown, headers: Record<string, string> = { "content-type": "application/json" }): InboundRequest {
  return {
    source: "strava",
    method: "POST",
    headers,
    query: {},
    rawBody: Buffer.from(typeof body === "string" ? body : JSON.stringify(body)),
  }
}

const create = (over: Record<string, unknown> = {}) => ({
  object_type: "activity",
  object_id: 1360128428,
  aspect_type: "create",
  updates: {},
  owner_id: Number(KNOWN_OWNER),
  subscription_id: OURS,
  event_time: 1516126040,
  ...over,
})

const deauth = (over: Record<string, unknown> = {}) => ({
  object_type: "athlete",
  object_id: Number(KNOWN_OWNER),
  aspect_type: "update",
  updates: { authorized: "false" },
  owner_id: Number(KNOWN_OWNER),
  subscription_id: OURS,
  event_time: 1516126040,
  ...over,
})

const logs: string[] = []
vi.spyOn(console, "info").mockImplementation((line: unknown) => {
  logs.push(String(line))
})
afterEach(() => {
  logs.length = 0
})
const decision = () => JSON.parse(logs.at(-1) ?? "{}").decision as string

describe("subscription_id (§4.1 filter 1, criterion 1)", () => {
  it("is null in source until 0092 creates the subscription", () => {
    expect(STRAVA_SUBSCRIPTION_ID).toBeNull()
  })

  it("null drops EVERY event with a 200, under its own decision name", async () => {
    for (const body of [create(), deauth()]) {
      const ack = await acceptStravaEvent(req(body), { subscriptionId: null })
      expect(ack).toEqual({ status: 200, commands: [] })
      expect(decision()).toBe("no-subscription")
    }
  })

  it("the committed constant is what production uses — today, everything drops", async () => {
    expect(await acceptStravaEvent(req(create()))).toEqual({ status: 200, commands: [] })
    expect(decision()).toBe("no-subscription")
  })

  it("another subscription's id is dropped with a 200", async () => {
    const ack = await acceptStravaEvent(req(create({ subscription_id: OURS + 1 })), { subscriptionId: OURS })
    expect(ack).toEqual({ status: 200, commands: [] })
    expect(decision()).toBe("wrong-subscription")
  })

  it("a missing subscription_id is dropped", async () => {
    const without: Record<string, unknown> = create()
    delete without.subscription_id
    expect((await acceptStravaEvent(req(without), { subscriptionId: OURS })).commands).toEqual([])
    expect(decision()).toBe("wrong-subscription")
  })

  it("ours is accepted", async () => {
    const ack = await acceptStravaEvent(req(create()), { subscriptionId: OURS })
    expect(ack.commands).toHaveLength(1)
  })
})

describe("object_type (§4.1 filter 2, criterion 2)", () => {
  it.each(["club", "segment", "", "ACTIVITY"])("%j is dropped with a 200", async (objectType) => {
    const ack = await acceptStravaEvent(req(create({ object_type: objectType })), { subscriptionId: OURS })
    expect(ack).toEqual({ status: 200, commands: [] })
    expect(decision()).toBe("ignored-object-type")
  })
})

describe("deauthorization (criterion 14, the adapter half)", () => {
  it("a known athlete's deauthorization becomes ONE disconnect command naming the user, never the athlete", async () => {
    const ack = await acceptStravaEvent(req(deauth()), { subscriptionId: OURS })
    expect(ack).toEqual({ status: 200, commands: [{ kind: "disconnect", source: "strava", userId: OWNER_SUB }] })
    expect(decision()).toBe("deauthorize")
    expect(logs.join("\n")).not.toContain(KNOWN_OWNER)
  })

  it.each([
    ["authorized true", deauth({ updates: { authorized: "true" } })],
    ["authorized as a boolean", deauth({ updates: { authorized: false } })],
    ["an extra updates key", deauth({ updates: { authorized: "false", title: "x" } })],
    ["no updates", deauth({ updates: {} })],
    ["a create aspect", deauth({ aspect_type: "create" })],
  ])("%s is not a deauthorization", async (_name, body) => {
    const ack = await acceptStravaEvent(req(body), { subscriptionId: OURS })
    expect(ack).toEqual({ status: 200, commands: [] })
    expect(decision()).toBe("ignored-athlete-event")
  })

  it("object_id must be the athlete itself", async () => {
    const ack = await acceptStravaEvent(req(deauth({ object_id: 42 })), { subscriptionId: OURS })
    expect(ack.commands).toEqual([])
    expect(decision()).toBe("malformed-ids")
  })

  it("a stranger's deauthorization is dropped", async () => {
    const ack = await acceptStravaEvent(req(deauth({ owner_id: 999, object_id: 999 })), { subscriptionId: OURS })
    expect(ack.commands).toEqual([])
    expect(decision()).toBe("unknown-owner")
  })
})

describe("the shape check (§4.4 items 2 and 3, criterion 9)", () => {
  it.each([
    ["text/plain", req(create(), { "content-type": "text/plain" }), "not-json"],
    ["no content-type", req(create(), {}), "not-json"],
    ["application/jsonx", req(create(), { "content-type": "application/jsonx" }), "not-json"],
    ["unparseable", req("{"), "unparseable"],
    ["a number", req("42"), "unparseable"],
    ["an unknown top-level key", req(create({ start_latlng: [40.1, -74.2] })), "unknown-fields"],
    ["10,000 keys", req({ ...create(), ...Object.fromEntries(Array.from({ length: 10_000 }, (_, i) => [`k${i}`, 1])) }), "unknown-fields"],
    ["an unknown updates key", req(create({ updates: { distance: 5000 } })), "unknown-fields"],
    ["updates as an array", req(create({ updates: [] })), "unknown-fields"],
    ["event_time as a string", req(create({ event_time: "yesterday" })), "unknown-fields"],
    ["object_type as a number", req(create({ object_type: 1 })), "unknown-fields"],
  ])("%s → 200, no command, no detail", async (_name, request, expected) => {
    const ack = await acceptStravaEvent(request, { subscriptionId: OURS })
    expect(ack).toEqual({ status: 200, commands: [] })
    expect(decision()).toBe(expected)
  })

  it("every documented field, including an update's title/type/private, passes the shape check", async () => {
    await acceptStravaEvent(
      req(create({ aspect_type: "update", updates: { title: "t", type: "Run", private: "true" } })),
      { subscriptionId: OURS },
    )
    // Past the shape check; dropped later for its aspect, not its fields.
    expect(decision()).toBe("ignored-aspect")
  })
})
