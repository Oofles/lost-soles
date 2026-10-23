import { afterEach, describe, expect, it, vi } from "vitest"

import { API_TIMEOUT_MS, ApiTimeoutError, withApiTimeout } from "./timeout"

/** Ticket `0113`, `06` §9.5: *"API timeout 10 s, then queue. No request is allowed to hold a screen."* */
describe("withApiTimeout", () => {
  afterEach(() => vi.useRealTimers())

  it("is 10 s, the number the design states", () => {
    expect(API_TIMEOUT_MS).toBe(10_000)
  })

  it("passes a value through and leaves no timer behind", async () => {
    vi.useFakeTimers()
    await expect(withApiTimeout("x", async () => 7)).resolves.toBe(7)
    expect(vi.getTimerCount()).toBe(0)
  })

  it("passes an error through unchanged", async () => {
    const boom = new Error("boom")
    await expect(withApiTimeout("x", async () => Promise.reject(boom))).rejects.toBe(boom)
    await expect(
      withApiTimeout("x", () => {
        throw boom
      }),
    ).rejects.toBe(boom)
  })

  it("rejects at 10 s even when the call ignores its signal, and aborts the signal", async () => {
    vi.useFakeTimers()
    let seen: AbortSignal | undefined
    const result = withApiTimeout("GET /api/hung", (signal) => {
      seen = signal
      return new Promise<never>(() => {})
    })
    const caught = result.catch((e: unknown) => e)

    await vi.advanceTimersByTimeAsync(API_TIMEOUT_MS - 1)
    expect(seen?.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)

    const error = await caught
    expect(error).toBeInstanceOf(ApiTimeoutError)
    expect((error as Error).message).toBe("GET /api/hung timed out after 10000 ms")
    expect(seen?.aborted).toBe(true)
  })
})
