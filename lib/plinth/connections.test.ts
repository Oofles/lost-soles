import { describe, expect, it, vi } from "vitest"

import type { SourceAccountSummary } from "@/lib/sources/source-account-store"

/** Ticket `0087`: the plinth's view of each connectable source. The store is DynamoDB; stubbed. */
vi.mock("@/lib/sources/source-account-store", () => ({ getSourceAccountSummary: vi.fn() }))
vi.mock("@/src/adapters/registry", () => ({
  connectableSources: () => ["src"],
  getOAuthConnector: () => ({ displayName: "Example" }),
}))

const { sourceConnections, sourceState } = await import("./connections")

const summary = (status: SourceAccountSummary["status"]): SourceAccountSummary => ({
  sourceId: "src",
  externalOwnerId: "1",
  scopes: [],
  expiresAt: 0,
  status,
  connectedAt: "",
})

describe("sourceState (0087)", () => {
  it("never connected and disconnected are both 'not-connected'", () => {
    expect(sourceState(null)).toBe("not-connected")
    expect(sourceState(summary("DISCONNECTED"))).toBe("not-connected")
  })

  it("ACTIVE is connected; NEEDS_REAUTH — a genuinely broken token — is the only 'reconnect'", () => {
    expect(sourceState(summary("ACTIVE"))).toBe("connected")
    expect(sourceState(summary("NEEDS_REAUTH"))).toBe("reconnect")
  })
})

describe("sourceConnections (0087)", () => {
  it("names each source by the connector's displayName", async () => {
    expect(await sourceConnections("u-1", async () => summary("NEEDS_REAUTH"))).toEqual([
      { sourceId: "src", name: "Example", state: "reconnect" },
    ])
  })

  it("a failed read omits the source rather than failing the page or guessing a state", async () => {
    expect(await sourceConnections("u-1", async () => Promise.reject(new Error("ddb down")))).toEqual([])
  })
})
