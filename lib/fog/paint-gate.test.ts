import { afterEach, describe, expect, it, vi } from "vitest"

import { API_TIMEOUT_MS } from "@/lib/http/timeout"

import { paintGate } from "./paint-gate"

/** Ticket `0113`. The gate between the map's first paint and the fog's revalidation request. */
describe("paintGate", () => {
  afterEach(() => vi.useRealTimers())

  const opened = async (p: Promise<void>): Promise<boolean> => {
    let done = false
    void p.then(() => {
      done = true
    })
    await vi.advanceTimersByTimeAsync(0)
    return done
  }

  it("stays shut until the map marks it, and mark is idempotent", async () => {
    vi.useFakeTimers()
    const gate = paintGate()
    expect(await opened(gate.painted)).toBe(false)
    gate.mark()
    gate.mark()
    expect(await opened(gate.painted)).toBe(true)
  })

  it("opens on its own at the API timeout, so a map that never paints cannot freeze the fog", async () => {
    vi.useFakeTimers()
    const gate = paintGate()
    await vi.advanceTimersByTimeAsync(API_TIMEOUT_MS - 1)
    expect(await opened(gate.painted)).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(await opened(gate.painted)).toBe(true)
  })

  it("dispose opens it, leaving nothing awaiting a map that is gone", async () => {
    vi.useFakeTimers()
    const gate = paintGate()
    gate.dispose()
    expect(await opened(gate.painted)).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })
})
