import { describe, expect, it } from "vitest"

import { FogAnimator, REDUCED_MOTION_QUERY, browserAnimationHost, type AnimationHost } from "./animation"
import { FOG_FPS, FOG_FRAME_MS } from "./fog-uniforms"

/**
 * A DRIVABLE BROWSER. Every one of §4.5's four behaviours is a claim about a repaint that does NOT
 * happen, and none of them can be measured against a real rAF clock in a unit test: you cannot ask
 * jsdom for sixty frames at exact 16.667 ms intervals, and you cannot hide its document.
 *
 * So the clock is the test's. `advance(ms)` delivers whatever frames are pending at that timestamp,
 * which makes "capped at 30 fps" a count rather than a reading of the source.
 */
function fakeHost() {
  let handle = 0
  let pending: { handle: number; callback: (nowMs: number) => void } | null = null
  const state = { hidden: false, reduced: false, repaints: 0, now: 0 }
  const listeners = new Set<() => void>()

  const host: AnimationHost = {
    requestAnimationFrame(callback) {
      handle += 1
      pending = { handle, callback }
      return handle
    },
    cancelAnimationFrame(h) {
      if (pending?.handle === h) pending = null
    },
    isHidden: () => state.hidden,
    prefersReducedMotion: () => state.reduced,
    subscribe(onChange) {
      listeners.add(onChange)
      return () => listeners.delete(onChange)
    },
    repaint() {
      state.repaints += 1
    },
  }

  return {
    host,
    state,
    get scheduled() {
      return pending !== null
    },
    get subscribers() {
      return listeners.size
    },
    /** Deliver `count` frames at a real display's interval. Returns how many were actually taken. */
    frames(count: number, intervalMs = 1000 / 60) {
      let delivered = 0
      for (let i = 0; i < count; i++) {
        state.now += intervalMs
        const next = pending
        if (!next) break
        pending = null
        next.callback(state.now)
        delivered += 1
      }
      return delivered
    },
    /** A `visibilitychange` or a `matchMedia` change, after flipping the flag. */
    notify() {
      for (const listener of [...listeners]) listener()
    },
  }
}

describe("FogAnimator — §4.5's repaint loop", () => {
  it("caps repaints at 30 fps while the display runs at 60 (criterion 6)", () => {
    const h = fakeHost()
    const animator = new FogAnimator(h.host)
    animator.start()

    expect(h.frames(60)).toBe(60) // a full simulated second of 60 Hz rAF
    expect(animator.framesSeen).toBe(60)

    // A frame is skipped whenever less than 1000/30 ms has passed, so half of them repaint. The
    // first two go to establishing a baseline, hence the tolerance rather than an exact 31.
    expect(animator.repaints).toBeGreaterThanOrEqual(FOG_FPS - 2)
    expect(animator.repaints).toBeLessThanOrEqual(FOG_FPS + 1)
    expect(animator.repaints).toBe(h.state.repaints)
  })

  /**
   * THE SABOTAGE CASE FOR THE CAP. Without `FRAME_SLACK_MS` the comparison `dt >= 33.333` lands
   * fractionally short on two 16.667 ms frames and the loop silently drops to 20 fps — still
   * "capped", still passing a test that only asserted `< 60`. This is what separates 30 from 20.
   */
  it("does not degrade to 20 fps on an exactly-60 Hz clock", () => {
    const h = fakeHost()
    const animator = new FogAnimator(h.host)
    animator.start()
    h.frames(60)
    expect(animator.repaints).toBeGreaterThan(24)
  })

  it("advances u_time by about a second per second of frames", () => {
    const h = fakeHost()
    const animator = new FogAnimator(h.host)
    animator.start()
    h.frames(60)
    expect(animator.time()).toBeGreaterThan(0.9)
    expect(animator.time()).toBeLessThan(1.05)
  })

  it("makes ZERO repaints while the tab is hidden (criterion 6)", () => {
    const h = fakeHost()
    h.state.hidden = true
    const animator = new FogAnimator(h.host)
    animator.start()
    h.frames(60)

    expect(animator.framesSeen).toBe(60)
    expect(animator.repaints).toBe(0)
    expect(h.state.repaints).toBe(0)
  })

  it("does not advance u_time while hidden, so the mist is where it was on return", () => {
    const h = fakeHost()
    const animator = new FogAnimator(h.host)
    animator.start()
    h.frames(30)
    const before = animator.time()
    expect(before).toBeGreaterThan(0)

    h.state.hidden = true
    h.notify()
    h.frames(600) // ten seconds in the background
    expect(animator.time()).toBeCloseTo(before, 6)

    h.state.hidden = false
    h.notify()
    h.frames(60)
    expect(animator.time()).toBeGreaterThan(before)
  })

  it("keeps the loop alive across a hidden period rather than stalling permanently", () => {
    const h = fakeHost()
    const animator = new FogAnimator(h.host)
    animator.start()
    h.state.hidden = true
    h.frames(10)
    expect(h.scheduled).toBe(true)
  })
})

describe("FogAnimator — reduced motion and the battery saver (criterion 7)", () => {
  it("runs NO rAF loop at all and freezes u_time at 0 under prefers-reduced-motion", () => {
    const h = fakeHost()
    h.state.reduced = true
    const animator = new FogAnimator(h.host)
    animator.start()

    expect(h.scheduled).toBe(false)
    expect(h.frames(60)).toBe(0)
    expect(animator.time()).toBe(0)
    expect(animator.repaints).toBe(0)
  })

  it("drops to u_time = 0 when reduced motion is turned on MID-SESSION, not to wherever it was", () => {
    const h = fakeHost()
    const animator = new FogAnimator(h.host)
    animator.start()
    h.frames(60)
    expect(animator.time()).toBeGreaterThan(0.5)

    h.state.reduced = true
    h.notify()

    expect(animator.time()).toBe(0)
    expect(animator.isStatic()).toBe(true)
    // And the frame the reader is left looking at is redrawn, or it would still show the last
    // animated one — MapLibre draws only when asked.
    const repaintsAtSwitch = animator.repaints
    expect(h.frames(60)).toBe(0)
    expect(animator.repaints).toBe(repaintsAtSwitch)
  })

  it("resumes when reduced motion is turned back off", () => {
    const h = fakeHost()
    h.state.reduced = true
    const animator = new FogAnimator(h.host)
    animator.start()
    expect(h.scheduled).toBe(false)

    h.state.reduced = false
    h.notify()
    expect(h.scheduled).toBe(true)
    h.frames(60)
    expect(animator.time()).toBeGreaterThan(0)
  })

  it("the battery saver is the same switch, and it is a mechanism with no UI", () => {
    const h = fakeHost()
    const animator = new FogAnimator(h.host)
    animator.start()
    h.frames(30)

    animator.setBatterySaver(true)
    expect(animator.isStatic()).toBe(true)
    expect(animator.time()).toBe(0)
    expect(h.frames(60)).toBe(0)

    animator.setBatterySaver(false)
    expect(h.scheduled).toBe(true)
  })

  it("stop() cancels the frame and releases both listeners", () => {
    const h = fakeHost()
    const animator = new FogAnimator(h.host)
    animator.start()
    expect(h.subscribers).toBe(1)

    animator.stop()
    expect(h.scheduled).toBe(false)
    expect(h.subscribers).toBe(0)
    expect(h.frames(10)).toBe(0)
  })

  it("start() is idempotent — a double mount does not run two loops", () => {
    const h = fakeHost()
    const animator = new FogAnimator(h.host)
    animator.start()
    animator.start()
    expect(h.subscribers).toBe(1)
  })
})

describe("browserAnimationHost", () => {
  it("asks matchMedia for the query §4.5 names, and survives not having it", () => {
    const queries: string[] = []
    const win = {
      matchMedia: (q: string) => {
        queries.push(q)
        return { matches: true, addEventListener() {}, removeEventListener() {} }
      },
      requestAnimationFrame: () => 1,
      cancelAnimationFrame: () => {},
    } as unknown as Window
    const doc = { hidden: true, addEventListener() {}, removeEventListener() {} } as unknown as Document

    const host = browserAnimationHost(() => {}, win, doc)
    expect(queries).toEqual([REDUCED_MOTION_QUERY])
    expect(host.prefersReducedMotion()).toBe(true)
    expect(host.isHidden()).toBe(true)

    const noMedia = browserAnimationHost(() => {}, {} as unknown as Window, doc)
    expect(noMedia.prefersReducedMotion()).toBe(false)
  })
})

describe("the frame budget constants", () => {
  it("derives the frame interval rather than restating it", () => {
    expect(FOG_FRAME_MS).toBeCloseTo(1000 / FOG_FPS, 10)
  })
})
