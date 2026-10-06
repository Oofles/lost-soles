/**
 * HOLD TO REPEAT. Ticket 0071: *"Holding the button repeats at 4/s."*
 *
 * One step on press, then — after a pause long enough that an ordinary click never repeats —
 * one step every 250 ms until release. Timers are injected so the rate is a test, not a feeling.
 */

/** 4/s. */
export const REPEAT_INTERVAL_MS = 250
/** The pause before repeating starts. A click is well under this; a deliberate hold is over it. */
export const REPEAT_DELAY_MS = 400

export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(id: unknown): void
  setInterval(fn: () => void, ms: number): unknown
  clearInterval(id: unknown): void
}

const realTimers: Timers = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (id) => globalThis.clearTimeout(id as ReturnType<typeof setTimeout>),
  setInterval: (fn, ms) => globalThis.setInterval(fn, ms),
  clearInterval: (id) => globalThis.clearInterval(id as ReturnType<typeof setInterval>),
}

export interface Repeater {
  /** Press: steps once now, and starts repeating if still held after `REPEAT_DELAY_MS`. */
  start(): void
  /** Release, leave or cancel. Safe to call when not started. */
  stop(): void
}

export function holdToRepeat(onStep: () => void, timers: Timers = realTimers): Repeater {
  let delay: unknown
  let interval: unknown
  const stop = () => {
    if (delay !== undefined) timers.clearTimeout(delay)
    if (interval !== undefined) timers.clearInterval(interval)
    delay = interval = undefined
  }
  return {
    start() {
      stop()
      onStep()
      delay = timers.setTimeout(() => {
        delay = undefined
        interval = timers.setInterval(onStep, REPEAT_INTERVAL_MS)
      }, REPEAT_DELAY_MS)
    },
    stop,
  }
}
