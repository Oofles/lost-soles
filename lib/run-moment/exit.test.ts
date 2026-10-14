import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { initialMoment, momentReducer, type MomentState } from "@/app/run/[activityId]/run-moment"

import { BEAT1_MS, CAMERA_MS } from "./beat1"
import { BEAT4_START, BEAT5_START, SEQUENCE_END } from "./beat45"
import { SEQUENCE_CONTROL, SEQUENCE_MARKER, wireSequenceExit, type ExitCause, type ExitHost, type SequenceHistory } from "./exit"

/**
 * Ticket `0084`. Every way out of the sequence. The browser half — real clicks at real times over the
 * deployed page, `WEBGL_lose_context`, Back in Chromium — is the smoke recorded in the ticket; this is
 * the half that holds without one.
 */

type Fn = (e: Event) => void

/** `window`, as a listener registry: events are delivered by calling what was registered. */
function fakeHost() {
  const listeners: { type: string; fn: Fn; capture: boolean }[] = []
  const host: ExitHost = {
    addEventListener: (type, fn, options) => void listeners.push({ type, fn: fn as Fn, capture: options === true }),
    removeEventListener: (type, fn) => {
      const i = listeners.findIndex((l) => l.type === type && l.fn === fn)
      if (i >= 0) listeners.splice(i, 1)
    },
  }
  const fire = (type: string, event: Record<string, unknown> = {}) => {
    let prevented = false
    let stopped = false
    const e = { preventDefault: () => (prevented = true), stopPropagation: () => (stopped = true), ...event }
    for (const l of [...listeners]) if (l.type === type) l.fn(e as unknown as Event)
    return { prevented, stopped }
  }
  return { host, listeners, fire }
}

/** A history stack: `[ ...behind, current ]`. `back()` pops synchronously and fires `popstate`. */
function fakeHistory(onPop: () => void = () => {}) {
  const NEXT_STATE = { __NA: true, tree: "run" }
  const stack: unknown[] = [{ lostSolesSeed: true }, NEXT_STATE]
  let pushes = 0
  let backs = 0
  const history: SequenceHistory = {
    get state() {
      return stack[stack.length - 1]
    },
    pushState: (data) => {
      pushes++
      stack.push(data)
    },
    back: () => {
      backs++
      stack.pop()
      onPop()
    },
  }
  return { history, stack, NEXT_STATE, counts: () => ({ pushes, backs }) }
}

/** The moment, with the exit wired exactly as `RunMoment` wires it. */
function playing() {
  const { host, listeners, fire } = fakeHost()
  const h = fakeHistory()
  let state: MomentState = momentReducer(initialMoment(false), { type: "relive" })
  const exits: ExitCause[] = []
  const seen: string[] = []
  const exit = wireSequenceExit({
    host,
    history: h.history,
    onExit: (cause) => {
      exits.push(cause)
      state = momentReducer(state, { type: "done" })
      seen.push("a-9")
    },
  })
  return { exit, fire, listeners, h, exits, seen, state: () => state }
}

/** Which beat is on screen at `t` ms of sequence time — so each case below is a different beat. */
function beatAt(t: number): string {
  if (t < CAMERA_MS) return "beat 1: camera"
  if (t < BEAT1_MS) return "beat 1: lantern"
  const b2 = t - BEAT1_MS
  if (b2 < BEAT4_START) return "beat 2: tally"
  if (b2 < BEAT5_START) return "beat 4: chronicle"
  if (b2 < SEQUENCE_END) return "beat 5: frontier"
  return "after the end"
}

describe("one click or key always ends it (§3.4, criterion 1)", () => {
  const TIMES = [200, 1500, 3000, 4500, 6500, 8000]

  it("the six times cover every beat the sequence has", () => {
    expect(new Set(TIMES.map(beatAt))).toEqual(
      new Set(["beat 1: camera", "beat 1: lantern", "beat 2: tally", "beat 4: chronicle", "beat 5: frontier"]),
    )
  })

  it.each(TIMES.flatMap((t) => [[t, "click"], [t, "escape"]] as const))(
    "t = %d ms, %s → the end state, never the next beat and never /",
    (t, how) => {
      const m = playing()
      expect(m.state().phase).toBe("sequence")
      const r = how === "click" ? m.fire("click", { target: null }) : m.fire("keydown", { key: "Escape" })
      expect(m.state().phase, beatAt(t)).toBe("end")
      expect(m.exits).toEqual([how])
      // Not `/`: the swallowed click cannot follow a link, and the stack is the run page's own.
      expect(r.prevented).toBe(true)
      expect(m.h.stack).toEqual([{ lostSolesSeed: true }, m.h.NEXT_STATE])
    },
  )

  it("a second click or key after the end does nothing — the listeners are gone", () => {
    const m = playing()
    m.fire("click")
    expect(m.listeners).toEqual([])
    m.fire("click")
    m.fire("keydown", { key: "Escape" })
    expect(m.exits).toEqual(["click"])
  })

  it("other keys do not skip", () => {
    const m = playing()
    for (const key of ["Enter", " ", "ArrowRight", "Tab"]) m.fire("keydown", { key })
    expect(m.state().phase).toBe("sequence")
  })

  it("the click is caught in the CAPTURE phase and stopped, so nothing beneath acts on it first", () => {
    const m = playing()
    expect(m.listeners.find((l) => l.type === "click")?.capture).toBe(true)
    expect(m.listeners.find((l) => l.type === "keydown")?.capture).toBe(true)
    expect(m.fire("click").stopped).toBe(true)
  })
})

describe("a level-up card does not hold the exit (criterion 2)", () => {
  /**
   * The card queue is a child of the sequence tree, and the exit is not a child of it: ending the
   * sequence unmounts the queue with everything else. So there is no card-specific path to test —
   * only that no card code listens for a skip of its own (below) and that a click on the card's
   * scrim is an ordinary click.
   */
  it("a click on the card's scrim ends the sequence, whole queue and all", () => {
    const m = playing()
    const scrim = { closest: () => null } // a card is not a sequence control
    m.fire("click", { target: scrim })
    expect(m.state().phase).toBe("end")
  })
})

describe("skip has no fade (criterion 3)", () => {
  it("the end state is dispatched synchronously inside the click — the next render IS the end state", () => {
    const m = playing()
    m.fire("click")
    // No timer, no promise, no transition state between: `phase` is already `end` on return.
    expect(m.state()).toEqual({ phase: "end", play: 1 })
  })

  it("the reducer has no intermediate 'fading' phase to pass through", () => {
    expect(momentReducer({ phase: "sequence", play: 3 }, { type: "done" })).toEqual({ phase: "end", play: 3 })
  })
})

describe("Back (criterion 4)", () => {
  it("the sequence pushes one sentinel entry, carrying the run entry's own router state", () => {
    const m = playing()
    expect(m.h.counts().pushes).toBe(1)
    expect(m.h.stack.at(-1)).toEqual({ ...m.h.NEXT_STATE, [SEQUENCE_MARKER]: true })
  })

  it("Back during the sequence → the end state, with the run page still current; a second Back → /", () => {
    const m = playing()
    m.h.stack.pop() // the browser pops the sentinel…
    m.fire("popstate") // …and tells us
    expect(m.state().phase).toBe("end")
    expect(m.exits).toEqual(["back"])
    expect(m.h.counts().backs).toBe(0) // the browser already took it off; we take nothing else
    expect(m.h.stack.at(-1)).toBe(m.h.NEXT_STATE) // still on /run/:id
    expect(m.h.stack.at(-2)).toEqual({ lostSolesSeed: true }) // so the next Back is `/`
  })

  it.each(["click", "escape", "complete"] as const)("after a %s exit the sentinel is taken back off: one Back from the end state is /", (how) => {
    const m = playing()
    if (how === "click") m.fire("click")
    else if (how === "escape") m.fire("keydown", { key: "Escape" })
    else m.exit.complete()
    expect(m.h.counts().backs).toBe(1)
    expect(m.h.stack).toEqual([{ lostSolesSeed: true }, m.h.NEXT_STATE])
  })

  it("teardown without an exit (the page went away) consumes the sentinel and calls nothing", () => {
    const m = playing()
    m.exit.teardown()
    expect(m.exits).toEqual([])
    expect(m.listeners).toEqual([])
    expect(m.h.stack.at(-1)).toBe(m.h.NEXT_STATE)
  })
})

describe("the sequence's controls keep their meaning (D-298)", () => {
  const control = { closest: (sel: string) => (sel === `[${SEQUENCE_CONTROL}]` ? {} : null) }

  it("a click on a tally row's expander or the frontier line does not skip", () => {
    const m = playing()
    const r = m.fire("click", { target: control })
    expect(m.state().phase).toBe("sequence")
    expect(r.prevented).toBe(false) // the control's own onClick still runs
  })

  it("…and Esc still ends it from there", () => {
    const m = playing()
    m.fire("click", { target: control })
    m.fire("keydown", { key: "Escape" })
    expect(m.state().phase).toBe("end")
  })

  const ROOT = join(import.meta.dirname, "..", "..")
  it("exactly the row expander and the frontier line carry the attribute", () => {
    const ledger = readFileSync(join(ROOT, "app/run/[activityId]/run-ledger.tsx"), "utf8")
    const lines = readFileSync(join(ROOT, "app/run/[activityId]/run-lines.tsx"), "utf8")
    expect(ledger.match(/data-sequence-control/g)).toHaveLength(1)
    expect(lines.match(/data-sequence-control/g)).toHaveLength(1)
    expect(ledger).toMatch(/data-sequence-control=""\s+style=\{rowGrid\}/)
  })
})

describe("skip is ONE listener, not per-beat handling (the ticket's note)", () => {
  const ROOT = join(import.meta.dirname, "..", "..")
  const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")

  it.each([
    "app/run/[activityId]/run-sequence.tsx",
    "app/run/[activityId]/run-ledger.tsx",
    "app/run/[activityId]/run-lines.tsx",
    "components/level-up-card.tsx",
    "lib/run-moment/beat1.ts",
    "lib/run-moment/beat2.ts",
    "lib/run-moment/beat45.ts",
    "lib/level-up/beat3.ts",
  ])("%s listens for no click, key or popstate of its own", (f) => {
    const src = strip(readFileSync(join(ROOT, f), "utf8"))
    expect(src).not.toMatch(/addEventListener\(\s*["'](click|keydown|keyup|pointerdown|popstate)/)
    expect(src).not.toMatch(/\bon(KeyDown|KeyUp|PointerDown)=/)
    expect(src).not.toMatch(/Escape/)
  })

  it("RunMoment wires the exit once, after the history seed", () => {
    const src = strip(readFileSync(join(ROOT, "app/run/[activityId]/run-moment.tsx"), "utf8"))
    expect(src.match(/wireSequenceExit\(/g)).toHaveLength(1)
    expect(src.indexOf("seedHomeBehind(")).toBeLessThan(src.indexOf("wireSequenceExit("))
  })
})

describe("seen is written on every exit, skip included (criterion 10, the in-memory half)", () => {
  it.each(["click", "escape", "back", "complete"] as const)("%s → onExit, once", (how) => {
    const m = playing()
    if (how === "click") m.fire("click")
    else if (how === "escape") m.fire("keydown", { key: "Escape" })
    else if (how === "back") m.fire("popstate")
    else m.exit.complete()
    m.exit.complete() // a late finish after a skip changes nothing
    expect(m.seen).toEqual(["a-9"])
  })
})
