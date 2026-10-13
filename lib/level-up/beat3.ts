/**
 * BEAT 3'S CLOCK — ONE LEVEL-UP CARD. Ticket `0082`. `06-ui-ux.md` §3.2, beat 3; D-297.
 *
 *   0    – 220    scale 0.94 → 1.0, `easeOutBack`, peaking at 1.02
 *   0    – 400    the gold border wipes in, clockwise
 *   300  – 800    the number: the old level fades OUT over the first half, the new one rises IN over
 *                 the second — never both legible at once (the ticket's operator check)
 *   400  – 1200   hold
 *   1200 – 1400   exit: fade and a 4 px rise — or, at a place-bound milestone, a flight into the map
 *
 * §3.2's parts (entry 400 + hold 600 + exit 200) sum to 1.2 s; its total, and the ticket's
 * criterion, is 1.4 s. The total wins and the hold is 800 ms (D-297).
 *
 * Pure: milliseconds since the card began in, the frame out. The queue is a plain sequence of these.
 */

export const CARD_MS = 1400
export const SCALE_MS = 220
export const BORDER_MS = 400
export const NUMBER_FROM = 300
export const NUMBER_MS = 500
export const EXIT_FROM = 1200
export const EXIT_MS = 200
export const EXIT_RISE_PX = 4
export const NUMBER_RISE_PX = 8

/** The scale `easeOutBack` peaks at (§3.2's "overshoot 1.02"). */
export const SCALE_PEAK = 1.02
const SCALE_FROM = 0.94

/**
 * `easeOutBack`'s overshoot constant, solved so `0.94 + 0.06·f` peaks at exactly 1.02. The curve's
 * peak is `1 + 4c³ / 27(c+1)²`, which must equal `1 + 0.08/0.06`; bisection, once, at load.
 */
const BACK_C1 = (() => {
  const want = (SCALE_PEAK - SCALE_FROM) / (1 - SCALE_FROM) - 1
  let lo = 0
  let hi = 10
  for (let i = 0; i < 60; i++) {
    const c = (lo + hi) / 2
    if ((4 * c ** 3) / (27 * (c + 1) ** 2) < want) lo = c
    else hi = c
  }
  return (lo + hi) / 2
})()

export function easeOutBack(x: number): number {
  const t = clamp01(x) - 1
  return 1 + (BACK_C1 + 1) * t ** 3 + BACK_C1 * t ** 2
}

export interface CardFrame {
  phase: "enter" | "hold" | "exit" | "done"
  scale: number
  /** `0..1` of the border drawn, clockwise from the top-left corner. */
  border: number
  /** The old level's opacity; and the new one's, with its remaining rise in px. */
  oldOpacity: number
  newOpacity: number
  newDy: number
  /** `0..1` of the exit: the card's opacity is `1 − exit`. */
  exit: number
}

export function cardAt(t: number): CardFrame {
  const n = clamp01((t - NUMBER_FROM) / NUMBER_MS)
  const exit = clamp01((t - EXIT_FROM) / EXIT_MS)
  return {
    phase: t >= CARD_MS ? "done" : t >= EXIT_FROM ? "exit" : t >= BORDER_MS ? "hold" : "enter",
    scale: SCALE_FROM + (1 - SCALE_FROM) * easeOutBack(t / SCALE_MS),
    border: clamp01(t / BORDER_MS),
    oldOpacity: 1 - clamp01(n * 2),
    newOpacity: clamp01(n * 2 - 1),
    newDy: NUMBER_RISE_PX * (1 - clamp01(n * 2 - 1)),
    exit,
  }
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x
}
