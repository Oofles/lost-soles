/**
 * BEAT 2'S CLOCK. Ticket `0081`. `06-ui-ux.md` §3.2, beat 2 — 2.9 s to 6.0 s:
 *
 *   0    – 300   the camera pulls back 1.5 zoom levels; the parchment rises (`easeOutQuint`)
 *   300  – …     one line every 240 ms, top to bottom: an 8 px slide-up under a 180 ms fade, and
 *                its number counting from 0 over 700 ms with `easeOutExpo`; the bar fills in the
 *                same 700 ms
 *   …    – 3100  the finished tally holds, and hands off
 *
 * Pure, like `beat1.ts`: milliseconds since beat 2 began in, everything a frame needs out. The time
 * spent with a row expanded is not in that number — `PausableClock` takes it out — so expansion
 * pauses the sequence rather than racing it on underneath (criterion 8).
 */

export const RISE_MS = 300
export const STAGGER_MS = 240
export const FADE_MS = 180
export const COUNT_MS = 700
export const SLIDE_PX = 8
/** 3.1 s: 2.9 → 6.0. Criterion 1. */
export const BEAT2_MS = 3100
/** §3.2: newly-lit territory in context, not filling the frame. */
export const PULL_BACK_ZOOM = 1.5

export function easeOutQuint(x: number): number {
  return 1 - (1 - clamp01(x)) ** 5
}

/**
 * `1 − 2^(−10x)`, PINNED TO 1 AT THE END. The textbook curve is `1 − 2^−10 ≈ 0.999` at `x = 1`, so
 * a count driven by it would land a digit short of the ledger — criterion 3's "no off-by-one from
 * easing". Rescaled so `f(1) = 1` exactly rather than special-cased, so the last frames still
 * decelerate into the final digit instead of jumping onto it.
 */
const EXPO_END = 1 - 2 ** -10
export function easeOutExpo(x: number): number {
  const t = clamp01(x)
  return t === 1 ? 1 : (1 - 2 ** (-10 * t)) / EXPO_END
}

/** A counted number at eased progress `p`. Integer, monotone, and exactly `value` at `p = 1`. */
export function countAt(value: number, p: number): number {
  return p >= 1 ? value : Math.floor(value * p)
}

export interface Beat2Line {
  /** `0..1`, the 180 ms fade. */
  opacity: number
  /** Pixels still to rise, `SLIDE_PX..0`. */
  dy: number
  /** `0..1`, `easeOutExpo` over 700 ms: drives the count and the bar together. */
  count: number
}

export interface Beat2Frame {
  phase: "rise" | "lines" | "hold" | "done"
  /** `0..1`, the parchment's rise, eased. */
  rise: number
  lines: Beat2Line[]
}

/**
 * The gap between lines. 240 ms (§3.2) unless that would run the last count past the beat, in which
 * case the lines close up so the whole tally still lands inside 3.1 s. At today's five skills and
 * four footer lines it never does; it is here so a sixth skill row is a data row, not a timing bug.
 */
export function staggerFor(count: number): number {
  if (count <= 1) return STAGGER_MS
  return Math.min(STAGGER_MS, (BEAT2_MS - RISE_MS - COUNT_MS) / (count - 1))
}

export function beat2At(t: number, count: number): Beat2Frame {
  const gap = staggerFor(count)
  const lines: Beat2Line[] = []
  for (let i = 0; i < count; i++) {
    const local = t - RISE_MS - i * gap
    const fade = clamp01(local / FADE_MS)
    lines.push({ opacity: fade, dy: SLIDE_PX * (1 - easeOutQuint(fade)), count: easeOutExpo(local / COUNT_MS) })
  }
  const lastDone = RISE_MS + Math.max(0, count - 1) * gap + COUNT_MS
  const phase = t >= BEAT2_MS ? "done" : t < RISE_MS ? "rise" : t < lastDone ? "lines" : "hold"
  return { phase, rise: easeOutQuint(t / RISE_MS), lines }
}

/** The settled frame: what the end state draws — every line in place, every number final. */
export function beat2End(count: number): Beat2Frame {
  return beat2At(BEAT2_MS, count)
}

/**
 * A clock that can stop. `elapsed(now)` is wall time since `start` minus every paused interval, so
 * the beat resumes exactly where it was left. `pause` and `resume` are idempotent.
 */
export class PausableClock {
  private paused = 0
  private since: number | null = null

  constructor(private readonly start: number) {}

  pause(now: number): void {
    if (this.since === null) this.since = now
  }

  resume(now: number): void {
    if (this.since === null) return
    this.paused += now - this.since
    this.since = null
  }

  get isPaused(): boolean {
    return this.since !== null
  }

  /** Total time spent paused so far, as of `now`. */
  pausedMs(now: number): number {
    return this.paused + (this.since === null ? 0 : now - this.since)
  }

  elapsed(now: number): number {
    return now - this.start - this.pausedMs(now)
  }
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x
}
