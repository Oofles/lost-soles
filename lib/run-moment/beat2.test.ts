import { describe, expect, it } from "vitest"

import { BEAT1_MS } from "./beat1"
import { pullBack, type Box } from "./camera"
import {
  BEAT2_MS,
  beat2At,
  COUNT_MS,
  countAt,
  easeOutExpo,
  FADE_MS,
  PausableClock,
  RISE_MS,
  SLIDE_PX,
  STAGGER_MS,
  staggerFor,
} from "./beat2"

/** Ticket `0081` — beat 2's timing, to the millisecond. The wall-clock half is in the smoke. */

describe("the beat spans 2.9 → 6.0 s (criterion 1)", () => {
  it("is 3.1 s long, and starts where beat 1 ends", () => {
    expect(BEAT1_MS).toBe(2900)
    expect(BEAT1_MS + BEAT2_MS).toBe(6000)
    expect(beat2At(BEAT2_MS - 1, 3).phase).not.toBe("done")
    expect(beat2At(BEAT2_MS, 3).phase).toBe("done")
  })

  it("the parchment rises over 300 ms, then the lines run, then it holds", () => {
    expect(beat2At(0, 3).rise).toBe(0)
    expect(beat2At(RISE_MS, 3).rise).toBe(1)
    expect(beat2At(150, 3).phase).toBe("rise")
    expect(beat2At(RISE_MS, 3).phase).toBe("lines")
    expect(beat2At(RISE_MS + 2 * STAGGER_MS + COUNT_MS, 3).phase).toBe("hold")
  })
})

describe("lines stagger at 240 ms and count over 700 ms (criterion 3)", () => {
  it("line i begins at 300 + 240·i", () => {
    for (const i of [0, 1, 2]) {
      const start = RISE_MS + i * STAGGER_MS
      expect(beat2At(start, 3).lines[i]!.opacity).toBe(0)
      expect(beat2At(start + 1, 3).lines[i]!.opacity).toBeGreaterThan(0)
      expect(beat2At(start + FADE_MS, 3).lines[i]!.opacity).toBe(1)
    }
  })

  it("each line slides up 8 px under its fade", () => {
    expect(beat2At(RISE_MS, 1).lines[0]!.dy).toBe(SLIDE_PX)
    expect(beat2At(RISE_MS + FADE_MS, 1).lines[0]!.dy).toBe(0)
  })

  it("the count is easeOutExpo: fast early, decelerating into the final digit", () => {
    expect(easeOutExpo(0)).toBe(0)
    expect(easeOutExpo(0.1)).toBeGreaterThan(0.45)
    expect(easeOutExpo(0.5) - easeOutExpo(0.4)).toBeGreaterThan(easeOutExpo(0.9) - easeOutExpo(0.8))
    expect(easeOutExpo(0.999)).toBeLessThan(1)
  })

  it.each([1, 7, 576, 1143, 99_999, 1_885_263])("ends on the exact value %i — no off-by-one from easing", (v) => {
    expect(countAt(v, beat2At(RISE_MS + COUNT_MS, 1).lines[0]!.count)).toBe(v)
    // And never overshoots on the way, nor goes backwards.
    let last = 0
    for (let t = RISE_MS; t <= RISE_MS + COUNT_MS; t += 7) {
      const n = countAt(v, beat2At(t, 1).lines[0]!.count)
      expect(n).toBeGreaterThanOrEqual(last)
      expect(n).toBeLessThanOrEqual(v)
      last = n
    }
  })

  it("closes the stagger up only when a long tally would overrun 6.0 s", () => {
    expect(staggerFor(9)).toBe(STAGGER_MS)
    expect(staggerFor(12)).toBeLessThan(STAGGER_MS)
    expect(RISE_MS + 11 * staggerFor(12) + COUNT_MS).toBeLessThanOrEqual(BEAT2_MS)
  })
})

describe("expansion pauses the clock (criterion 8)", () => {
  it("time spent paused is not beat time, and it resumes where it stopped", () => {
    const c = new PausableClock(1000)
    expect(c.elapsed(1500)).toBe(500)
    c.pause(1500)
    expect(c.elapsed(4000)).toBe(500)
    c.pause(4500) // idempotent
    c.resume(5000)
    expect(c.elapsed(5100)).toBe(600)
    expect(c.pausedMs(5100)).toBe(3500)
    c.resume(6000) // idempotent
    expect(c.elapsed(6000)).toBe(1500)
  })
})

describe("the pull-back is from the run's own framing (Relive must not compound it)", () => {
  it("targets fit − 1.5 whatever the current zoom, offset up by half the covered map", () => {
    const run: Box = [[-123.4, -48.9], [-123.35, -48.87]]
    const moves: Record<string, unknown>[] = []
    const map = {
      getContainer: () => ({ getBoundingClientRect: () => ({ width: 1280, height: 500 }) }),
      cameraForBounds: () => ({ center: { lng: -123.375, lat: -48.885 }, zoom: 14 }),
      easeTo: (o: Record<string, unknown>) => void moves.push(o),
    }
    for (let i = 0; i < 3; i++) pullBack(map, run, { zoomOut: 1.5, covered: 100, duration: 300, easing: (t) => t })
    expect(moves.map((m) => m.zoom)).toEqual([12.5, 12.5, 12.5])
    expect(moves[0]).toMatchObject({ center: { lng: -123.375, lat: -48.885 }, offset: [0, -50], duration: 300 })
    expect(moves[0]).not.toHaveProperty("padding")
  })
})

describe("a hand-off rewinds the clock to the trigger's instant (0082)", () => {
  it("whatever ran past the trigger since the last frame is folded into paused time", () => {
    const c = new PausableClock(0)
    c.pause(1016) // the frame that noticed a trigger due at 1,000
    c.rewindTo(1000, 1016)
    expect(c.elapsed(1016)).toBe(1000)
    c.resume(2416) // one card later
    expect(c.elapsed(2416)).toBe(1000)
    expect(c.elapsed(2516)).toBe(1100)
  })
})
