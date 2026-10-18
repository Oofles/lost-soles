import { beforeEach, describe, expect, it, vi } from "vitest"

import { SourceNeedsReauthError, SourceNotConnectedError } from "@/src/adapters/errors"
import { disconnectMessage } from "@/src/pipeline/disconnect-message"

/**
 * Ticket 0093, D-NEW (operator Q1 = A′) — a deauthorization is confirmed with the provider before
 * it is believed. The forced refresh's own mechanics (lease, conditional rotation, `credentialIsDead`
 * → `NEEDS_REAUTH`) are `token-refresh.test.ts`; this file is the decision taken on its answer.
 */
const accessTokenFor = vi.fn<(...args: unknown[]) => Promise<string>>()
const markDisconnected = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {})
vi.mock("@/lib/sources/token-refresh", () => ({ accessTokenFor }))
vi.mock("@/lib/sources/source-account-store", () => ({ markDisconnected }))
vi.mock("@/src/adapters/registry", () => ({ getOAuthConnector: (id: string) => ({ id, requiredScopes: [] }) }))

const { handleDeauthorization } = await import("./deauthorization")

const MESSAGE = disconnectMessage({ source: "test-source" as never, userId: "u-1", now: new Date("2026-10-17T00:00:00Z") })

const logs: string[] = []
vi.spyOn(console, "log").mockImplementation((line: unknown) => {
  logs.push(String(line))
})

beforeEach(() => {
  accessTokenFor.mockReset()
  markDisconnected.mockClear()
  logs.length = 0
})

describe("handleDeauthorization", () => {
  it("forces a refresh through accessTokenFor — the lease path — with a window wider than any token's life", async () => {
    accessTokenFor.mockResolvedValue("fresh")
    await handleDeauthorization(MESSAGE)
    expect(accessTokenFor).toHaveBeenCalledTimes(1)
    const [request] = accessTokenFor.mock.calls[0] as [Record<string, unknown>]
    expect(request).toMatchObject({ userId: "u-1", sourceId: "test-source", connector: { id: "test-source" } })
    expect(request.refreshWithinSeconds).toBeGreaterThan(100 * 365 * 24 * 3600)
    expect(request).not.toHaveProperty("knownStale")
  })

  it("the provider REJECTS the credential: the revocation is real, the row is marked DISCONNECTED", async () => {
    accessTokenFor.mockRejectedValue(new SourceNeedsReauthError("test-source", "HTTP 401"))
    expect(await handleDeauthorization(MESSAGE)).toBe("disconnected")
    expect(markDisconnected).toHaveBeenCalledWith(expect.objectContaining({ userId: "u-1", sourceId: "test-source" }))
  })

  it("the provider ACCEPTS it: a forgery — nothing is disconnected, and the outcome is logged", async () => {
    accessTokenFor.mockResolvedValue("fresh")
    expect(await handleDeauthorization(MESSAGE)).toBe("forged-or-stale")
    expect(markDisconnected).not.toHaveBeenCalled()
    expect(logs.join("\n")).toContain("forged-or-stale")
  })

  it("already disconnected: a retry of an event already acted on is a no-op", async () => {
    accessTokenFor.mockRejectedValue(new SourceNotConnectedError("test-source"))
    expect(await handleDeauthorization(MESSAGE)).toBe("already-disconnected")
    expect(markDisconnected).not.toHaveBeenCalled()
  })

  it("a transient failure is neither answer: it throws, so SQS redelivers", async () => {
    accessTokenFor.mockRejectedValue(Object.assign(new Error("503"), { name: "OAuthProviderError" }))
    await expect(handleDeauthorization(MESSAGE)).rejects.toThrow("503")
    expect(markDisconnected).not.toHaveBeenCalled()
  })

  it("logs no token and no provider detail", async () => {
    accessTokenFor.mockResolvedValue("secret-access-token")
    await handleDeauthorization(MESSAGE)
    expect(logs.join("\n")).not.toContain("secret-access-token")
  })
})
