/**
 * THE ANIMATION DRIVER. Ticket `0056` criteria 6 and 7. `05-fog-of-war.md` §4.5.
 *
 * §4.5 asks for four behaviours and every one of them is a claim about *when a repaint does not
 * happen*, which is the hardest kind of claim to make about a rAF loop wired directly to `window`:
 *
 *   - repaints driven by `requestAnimationFrame` -> `map.triggerRepaint()`, **capped at 30 fps**
 *   - **paused entirely** when `document.hidden`
 *   - `prefers-reduced-motion: reduce` stops the loop and freezes `u_time` at 0
 *   - the same switch, exposed manually, is the battery saver
 *
 * ─── WHY THE HOST IS INJECTED ───────────────────────────────────────────────
 *
 * "A test asserts zero repaints while hidden" is criterion 6's own wording, and jsdom has no real
 * rAF clock, no real visibility, and a `matchMedia` that has to be stubbed anyway. Injecting the
 * four things this class touches makes the whole state machine drivable frame by frame at exact
 * timestamps, so "capped at 30" is measured as *29 repaints in a simulated second of 60 Hz rAF*
 * rather than asserted by reading the code. `browserAnimationHost` is the ten lines that are not
 * covered by that, and they contain no logic.
 *
 * NOTHING HERE TOUCHES GL. The animator's only outputs are `time()` — which the layer reads for
 * `u_time` — and calls to `repaint()`.
 */

import { FOG_FRAME_MS } from "./fog-uniforms"

/** `matchMedia`'s query, in one place so the test and the host cannot disagree about it. */
export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)"

/**
 * The frame cap's slack, in milliseconds.
 *
 * WITHOUT IT THE CAP SILENTLY BECOMES 20 fps. On a 60 Hz display rAF arrives every 16.67 ms, so two
 * frames is 33.33 ms and `FOG_FRAME_MS` is 33.33 ms — a comparison that lands on the wrong side of
 * exact for any timestamp jitter at all, and a miss costs a whole frame rather than a millisecond.
 * 1 ms is smaller than any real display interval and larger than any plausible jitter.
 */
const FRAME_SLACK_MS = 1

export interface AnimationHost {
  requestAnimationFrame(callback: (nowMs: number) => void): number
  cancelAnimationFrame(handle: number): void
  /** `document.hidden`. */
  isHidden(): boolean
  /** `matchMedia('(prefers-reduced-motion: reduce)').matches`. */
  prefersReducedMotion(): boolean
  /** Fires when either of the two above may have changed. Returns an unsubscribe. */
  subscribe(onChange: () => void): () => void
  /** `map.triggerRepaint()`. */
  repaint(): void
}

/**
 * Drives the fog's `u_time` and asks MapLibre to redraw, or does neither.
 *
 * `time()` is the number the composite pass reads. It is **seconds of animation actually shown** —
 * not wall clock since `start()` — so a tab left hidden for an hour comes back to the mist where it
 * left it rather than an hour downstream of it.
 */
export class FogAnimator {
  #host: AnimationHost
  #handle: number | null = null
  #unsubscribe: (() => void) | null = null
  #running = false
  /** rAF timestamp of the last repaint. 0 means "no baseline" — the next frame establishes one. */
  #last = 0
  #elapsed = 0
  #batterySaver = false
  #repaints = 0
  #framesSeen = 0

  constructor(host: AnimationHost) {
    this.#host = host
  }

  /** Criterion 6's instrument: how many times `repaint()` was actually called. */
  get repaints(): number {
    return this.#repaints
  }

  /** How many rAF callbacks were processed, repainted or not. Distinguishes "capped" from "off". */
  get framesSeen(): number {
    return this.#framesSeen
  }

  /**
   * `u_time`, in seconds. **Exactly 0 whenever the fog is static** (criterion 7) — not merely
   * frozen at whatever it had reached, because §4.5 says *"renders statically at `u_time = 0`"* and
   * a reader turning reduced motion on mid-session should get the same picture as one who had it on
   * from the start.
   */
  time(): number {
    return this.isStatic() ? 0 : this.#elapsed
  }

  /** Reduced motion (§4.5) or the manual battery saver — the same switch, as the ticket asks. */
  isStatic(): boolean {
    return this.#batterySaver || this.#host.prefersReducedMotion()
  }

  /**
   * The manual half of criterion 7's switch. **No UI here** — capability 13 owns chrome, and
   * `0056`'s criteria ask for the mechanism, not a control. This is the mechanism.
   */
  setBatterySaver(on: boolean): void {
    if (this.#batterySaver === on) return
    this.#batterySaver = on
    this.#sync()
  }

  start(): void {
    if (this.#running) return
    this.#running = true
    this.#unsubscribe = this.#host.subscribe(() => this.#sync())
    this.#sync()
  }

  stop(): void {
    this.#running = false
    this.#cancel()
    this.#unsubscribe?.()
    this.#unsubscribe = null
  }

  /**
   * Start or stop the loop to match the current state, and repaint once on any transition.
   *
   * THE REPAINT ON TRANSITION IS NOT COSMETIC. Turning reduced motion on stops the loop, and
   * MapLibre only draws when something asks it to — so without this the frozen frame the user is
   * left looking at is the last *animated* one, at whatever `u_time` it happened to hold, and not
   * the `u_time = 0` frame criterion 7 specifies. The same in reverse when it is turned off.
   */
  #sync(): void {
    if (!this.#running) return
    const shouldRun = !this.isStatic()
    const wasRunning = this.#handle !== null
    if (shouldRun && !wasRunning) {
      this.#last = 0
      this.#schedule()
      this.#paint()
    } else if (!shouldRun && wasRunning) {
      this.#cancel()
      this.#paint()
    }
  }

  #schedule(): void {
    this.#handle = this.#host.requestAnimationFrame(this.#tick)
  }

  #cancel(): void {
    if (this.#handle !== null) this.#host.cancelAnimationFrame(this.#handle)
    this.#handle = null
  }

  /**
   * The one place a repaint can happen, and therefore the one place the hidden guard has to be.
   *
   * CRITERION 6 SAYS **ZERO** REPAINTS WHILE HIDDEN, not "zero from the loop". `#sync` repaints on
   * every transition, and a reduced-motion change or a battery-saver toggle can land while the tab
   * is in the background — asking MapLibre to redraw a canvas nobody is looking at. The state it
   * would draw is recomputed from scratch on the next visible frame anyway.
   */
  #paint(): void {
    if (this.#host.isHidden()) return
    this.#repaints++
    this.#host.repaint()
  }

  #tick = (nowMs: number): void => {
    this.#handle = null
    if (!this.#running) return
    this.#framesSeen++

    // Reduced motion or the battery saver can be turned on between frames; `subscribe` covers the
    // media query, and this covers everything else. Returning without rescheduling ends the loop.
    if (this.isStatic()) return

    // CRITERION 6: paused ENTIRELY when hidden. The loop keeps being scheduled — a real browser
    // simply stops delivering rAF to a hidden tab, and the one that does not is the one this guard
    // is for — but nothing repaints and `#elapsed` does not advance, so the mist is exactly where
    // it was when the tab comes back.
    if (this.#host.isHidden()) {
      this.#last = 0
      this.#schedule()
      return
    }

    if (this.#last === 0) {
      this.#last = nowMs
      this.#schedule()
      return
    }

    const dt = nowMs - this.#last
    if (dt >= FOG_FRAME_MS - FRAME_SLACK_MS) {
      this.#last = nowMs
      this.#elapsed += dt / 1000
      this.#paint()
    }
    this.#schedule()
  }
}

/**
 * The real host. Ten lines, no logic, and deliberately the only part of this module that a unit
 * test does not reach — everything with a decision in it is above.
 */
export function browserAnimationHost(
  repaint: () => void,
  win: Window = window,
  doc: Document = document,
): AnimationHost {
  const media =
    typeof win.matchMedia === "function" ? win.matchMedia(REDUCED_MOTION_QUERY) : null
  return {
    requestAnimationFrame: (cb) => win.requestAnimationFrame(cb),
    cancelAnimationFrame: (handle) => win.cancelAnimationFrame(handle),
    isHidden: () => doc.hidden,
    prefersReducedMotion: () => media?.matches ?? false,
    subscribe: (onChange) => {
      doc.addEventListener("visibilitychange", onChange)
      media?.addEventListener("change", onChange)
      return () => {
        doc.removeEventListener("visibilitychange", onChange)
        media?.removeEventListener("change", onChange)
      }
    },
    repaint,
  }
}
