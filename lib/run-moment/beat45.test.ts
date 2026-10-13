import { describe, expect, it } from "vitest"

import { BEAT1_MS } from "./beat1"
import { BEAT2_MS, beat2At } from "./beat2"
import { BEAT4_START, BEAT5_START, beat45At, LINE_FADE_MS, SEQUENCE_END } from "./beat45"

/** Ticket `0083` — beats 4 and 5's timing. The wall-clock half is in the smoke. */

describe("the beats span 6.0 → 7.2 → 8.4 s (criterion 1)", () => {
  it("on the sequence's clock", () => {
    expect(BEAT1_MS + BEAT4_START).toBe(6000)
    expect(BEAT1_MS + BEAT5_START).toBe(7200)
    expect(BEAT1_MS + SEQUENCE_END).toBe(8400)
  })

  it("phases change exactly at the boundaries", () => {
    expect(beat45At(BEAT4_START - 1).phase).toBe("before")
    expect(beat45At(BEAT4_START).phase).toBe("chronicle")
    expect(beat45At(BEAT5_START).phase).toBe("frontier")
    expect(beat45At(SEQUENCE_END - 1).phase).toBe("frontier")
    expect(beat45At(SEQUENCE_END).phase).toBe("done")
  })
})

describe("the chronicle line (criterion 2)", () => {
  it("fades in over 500 ms and stays in the end state", () => {
    expect(LINE_FADE_MS).toBe(500)
    expect(beat45At(BEAT4_START).chronicle).toBe(0)
    expect(beat45At(BEAT4_START + 250).chronicle).toBeCloseTo(0.5)
    expect(beat45At(BEAT4_START + 500).chronicle).toBe(1)
    expect(beat45At(SEQUENCE_END + 60_000).chronicle).toBe(1)
  })

  it("nothing else animates while it is there: the tally is settled and the frontier has not begun", () => {
    const settled = beat2At(BEAT2_MS, 5)
    for (let t = BEAT4_START; t < BEAT5_START; t += 50) {
      expect(beat2At(t, 5)).toEqual(settled)
      expect(beat45At(t).frontier).toBe(0)
    }
  })

  it("the frontier fades in only after, and stays", () => {
    expect(beat45At(BEAT5_START + LINE_FADE_MS).frontier).toBe(1)
    expect(beat45At(SEQUENCE_END).frontier).toBe(1)
  })
})
