import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { holdToRepeat, REPEAT_DELAY_MS, REPEAT_INTERVAL_MS } from "./repeat"

/** Ticket 0071: "Holding the button repeats at 4/s." */
describe("holdToRepeat", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it("repeats at 4 per second", () => {
    expect(1000 / REPEAT_INTERVAL_MS).toBe(4)
  })

  it("a click steps exactly once", () => {
    const step = vi.fn()
    const r = holdToRepeat(step)
    r.start()
    vi.advanceTimersByTime(150)
    r.stop()
    vi.advanceTimersByTime(5_000)
    expect(step).toHaveBeenCalledTimes(1)
  })

  it("a hold steps once, pauses, then steps four times a second until released", () => {
    const step = vi.fn()
    const r = holdToRepeat(step)
    r.start()
    vi.advanceTimersByTime(REPEAT_DELAY_MS + 1_000)
    expect(step).toHaveBeenCalledTimes(1 + 4)
    r.stop()
    vi.advanceTimersByTime(5_000)
    expect(step).toHaveBeenCalledTimes(5)
  })

  it("a second press restarts rather than doubling the rate", () => {
    const step = vi.fn()
    const r = holdToRepeat(step)
    r.start()
    vi.advanceTimersByTime(REPEAT_DELAY_MS + 250)
    r.start()
    step.mockClear()
    vi.advanceTimersByTime(REPEAT_DELAY_MS + 1_000)
    expect(step).toHaveBeenCalledTimes(4)
    r.stop()
  })

  it("stop before start is harmless", () => {
    expect(() => holdToRepeat(() => {}).stop()).not.toThrow()
  })
})
