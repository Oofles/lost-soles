import { BEAT2_MS } from "./beat2"

/**
 * BEATS 4 AND 5'S CLOCK. Ticket `0083`. `06-ui-ux.md` §3.2:
 *
 *   beat 4   6.0 → 7.2 s   the chronicle line fades in over 500 ms, and stays
 *   beat 5   7.2 → 8.4 s   the frontier line fades in, quietly, and stays
 *
 * Read off BEAT 2'S clock, continued: the two beats are the tail of the same panel, so the pause a
 * row expansion or a level-up card takes out of beat 2 is taken out of these too, and the boundaries
 * cannot drift apart. `t` is ms since beat 2 began. Pure.
 */

export const BEAT4_MS = 1200
export const BEAT5_MS = 1200
/** §3.2 beat 4: *"It fades in over 500 ms."* Beat 5 takes the same fade — quiet, not a reveal. */
export const LINE_FADE_MS = 500

export const BEAT4_START = BEAT2_MS
export const BEAT5_START = BEAT2_MS + BEAT4_MS
/** Where the sequence ends, on beat 2's clock: 8.4 s on the sequence's. */
export const SEQUENCE_END = BEAT5_START + BEAT5_MS

export interface Beat45Frame {
  phase: "before" | "chronicle" | "frontier" | "done"
  chronicle: number
  frontier: number
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)

export function beat45At(t: number): Beat45Frame {
  const phase = t < BEAT4_START ? "before" : t < BEAT5_START ? "chronicle" : t < SEQUENCE_END ? "frontier" : "done"
  return {
    phase,
    chronicle: clamp01((t - BEAT4_START) / LINE_FADE_MS),
    frontier: clamp01((t - BEAT5_START) / LINE_FADE_MS),
  }
}
