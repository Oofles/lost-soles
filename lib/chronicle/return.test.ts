import { describe, expect, it } from "vitest"

import { isColdLanding, seedHomeBehind, SEED_MARKER, type HistoryHost } from "@/lib/runs/history"
import type { RunListItem } from "@/lib/runs/wire"

import { backArrowClick, chronicleReturn, type ArrowClick, type ChronicleSnapshot } from "./return"

/**
 * TICKET 0088, CRITERIA 2 AND 3 — THE BACK STACK, WALKED.
 *
 * A small model of the browser's session history: a stack of entries, `pushState`, and a `back()`
 * that moves the index and fires `popstate`. The app's own pieces are driven against it unchanged
 * — `seedHomeBehind` (a cold deep link) and `chronicleReturn` (the scroll snapshot) — and every
 * navigation the app makes is a push (a `<Link>` without `replace`), which `chronicle-panel.test.tsx`
 * holds for the row links. What is asserted is the sequence of URLs the back button walks through.
 */

class FakeHistory {
  entries: { url: string; state: unknown; key: string }[]
  index = 0
  private keys = 0
  private listeners: (() => void)[] = []
  constructor(first: string) {
    this.entries = [{ url: first, state: null, key: "k0" }]
  }
  get here() {
    return this.entries[this.index]!
  }
  get location() {
    return { pathname: this.here.url, href: `https://x.test${this.here.url}`, search: "", hash: "" }
  }
  addEventListener(_type: "popstate", fn: () => void) {
    this.listeners.push(fn)
  }
  /** The Navigation API's view: a push is a new key, a replace keeps the entry's key. */
  get navigation() {
    return { currentEntry: { key: this.here.key, index: this.index }, entries: () => this.entries }
  }
  push(url: string, state: unknown = null) {
    this.entries = this.entries.slice(0, this.index + 1)
    this.entries.push({ url, state, key: `k${++this.keys}` })
    this.index++
  }
  replace(url: string, state: unknown) {
    this.entries[this.index] = { url, state, key: this.here.key }
  }
  back() {
    if (this.index === 0) return "LEFT THE APP"
    this.index--
    // In registration order — Next's router, registered at boot, always runs first (the wave 1
    // smoke showed capture-phase registration does not change that on `window`).
    for (const fn of this.listeners) fn()
    return this.here.url
  }
  host(navigation: { type: string; name: string } | undefined): HistoryHost {
    return {
      history: { get state() { return null }, length: this.entries.length } as unknown as History,
      location: this.location,
      replaceState: (data, url) => this.replace(url, data),
      pushState: (data, url) => this.push(url, data),
      navigation,
    }
  }
}

const snap = (scrollTop: number): ChronicleSnapshot => ({ items: [] as RunListItem[], next: "c", scrollTop })

describe("the Chronicle's back stack (0088)", () => {
  it("/ → RUNS → a run → back → back: the Chronicle once, then /, with nothing blank between", () => {
    const h = new FakeHistory("/")
    const ret = chronicleReturn(h)
    h.push("/chronicle") // the plinth's RUNS
    expect(ret.take("/chronicle")).toBeNull() // a push starts at the top
    ret.leave(snap(4321), ret.here()) // a row is opened; the Chronicle unmounts
    h.push("/run/a-9") // the row's link PUSHES
    expect(h.back()).toBe("/chronicle")
    expect(ret.take("/chronicle")).toEqual(snap(4321)) // the same scroll position
    expect(h.back()).toBe("/")
    expect(h.entries.map((e) => e.url)).toEqual(["/", "/chronicle", "/run/a-9"]) // no duplicates
  })

  it("Relive then skip: the sequence's sentinel comes off, and the walk back is unchanged", () => {
    const h = new FakeHistory("/")
    const ret = chronicleReturn(h)
    h.push("/chronicle")
    ret.leave(snap(900), ret.here())
    h.push("/run/a-9")
    h.push("/run/a-9", { lostSolesSequence: true }) // ⟲ Relive pushes its sentinel (`0084`)
    expect(h.back()).toBe("/run/a-9") // a skip takes it back off
    expect(ret.take("/chronicle")).toBeNull() // that traversal landed on the run, not here
    expect(h.back()).toBe("/chronicle")
    expect(ret.take("/chronicle")?.scrollTop).toBe(900)
    expect(h.back()).toBe("/")
  })

  it("a cold deep link to /chronicle gets / underneath, so back does not leave the app", () => {
    const h = new FakeHistory("/chronicle")
    const nav = { type: "navigate", name: "https://x.test/chronicle" }
    expect(isColdLanding(h.host(nav))).toBe(true)
    expect(seedHomeBehind(h.host(nav))).toBe(true)
    expect(h.entries.map((e) => e.url)).toEqual(["/", "/chronicle"])
    expect((h.entries[0]!.state as Record<string, unknown>)[SEED_MARKER]).toBe(true)
    h.push("/run/a-9")
    expect(h.back()).toBe("/chronicle")
    expect(h.back()).toBe("/")
  })

  it("dismissing and reopening from the plinth starts at the top again", () => {
    const h = new FakeHistory("/")
    const ret = chronicleReturn(h)
    h.push("/chronicle")
    ret.leave(snap(700), ret.here()) // dismissed (Esc / close / back are all a back)
    expect(h.back()).toBe("/")
    h.push("/chronicle") // RUNS again
    expect(ret.take("/chronicle")).toBeNull()
  })

  it("take is stable across React's development double-mount", () => {
    const h = new FakeHistory("/")
    const ret = chronicleReturn(h)
    h.push("/chronicle")
    ret.leave(snap(10), ret.here())
    h.push("/run/a-9")
    h.back()
    expect(ret.take("/chronicle")).toEqual(snap(10))
    expect(ret.take("/chronicle")).toEqual(snap(10))
  })

  it("back restores the offset even when the router renders the Chronicle inside its own earlier popstate listener", () => {
    // The deployed bug (wave 1 smoke, job 402): Next registers its popstate listener at hydration,
    // long before the first Chronicle, and mounts the restored route synchronously within it.
    const h = new FakeHistory("/")
    let mountedWith: ChronicleSnapshot | null | undefined
    h.addEventListener("popstate", () => {
      if (h.location.pathname === "/chronicle") mountedWith = ret.take("/chronicle")
    })
    const ret = chronicleReturn(h)
    h.push("/chronicle")
    ret.leave(snap(265), ret.here())
    h.push("/run/a-1")
    expect(h.back()).toBe("/chronicle")
    expect(mountedWith).toEqual(snap(265))
  })

  it("a cold deep link, seeded, then a run and back: the offset comes back on the re-keyed entry", () => {
    const h = new FakeHistory("/chronicle")
    const ret = chronicleReturn(h)
    seedHomeBehind(h.host({ type: "navigate", name: "https://x.test/chronicle" }))
    ret.leave(snap(40), ret.here()) // `here()` read after the seed, as the panel does
    h.push("/run/a-9")
    expect(h.back()).toBe("/chronicle")
    expect(ret.take("/chronicle")).toEqual(snap(40))
  })

  it("without the Navigation API, the popstate fallback still restores a plain back", () => {
    const h = new FakeHistory("/")
    const bare = { addEventListener: h.addEventListener.bind(h), get location() { return h.location } }
    const ret = chronicleReturn(bare)
    h.push("/chronicle")
    expect(ret.here()).toBeNull()
    ret.leave(snap(77), ret.here())
    h.push("/run/a-9")
    h.back()
    expect(ret.take("/chronicle")).toEqual(snap(77))
    h.back()
    h.push("/chronicle")
    expect(ret.take("/chronicle")).toBeNull()
  })
})

/**
 * TICKET 0274 — THE RUN PAGE'S `←`, WALKED. The arrow is a `<Link href="/">` whose click handler is
 * `backArrowClick`; a click it does not prevent is the link's push of `/`, modelled here as `push`.
 */
describe("the run page's back arrow (0274)", () => {
  const click = (over: Partial<ArrowClick> = {}): ArrowClick => {
    const e: ArrowClick = {
      defaultPrevented: false,
      button: 0,
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      preventDefault() {
        e.defaultPrevented = true
      },
      ...over,
    }
    return e
  }
  /** Click the arrow: either the handler backs, or the link pushes `/`. Returns where it landed. */
  const arrow = (h: FakeHistory, ret: ReturnType<typeof chronicleReturn>) => {
    const e = click()
    backArrowClick(ret, () => h.back())(e)
    if (!e.defaultPrevented) h.push("/")
    return h.here.url
  }

  it("opened from the Chronicle: ← is browser back — the Chronicle at its offset, no new entry, then /", () => {
    const h = new FakeHistory("/")
    const ret = chronicleReturn(h)
    h.push("/chronicle")
    ret.leave(snap(4321), ret.here())
    h.push("/run/a-9")
    expect(ret.behind()).toBe(true)
    expect(arrow(h, ret)).toBe("/chronicle")
    expect(ret.take("/chronicle")).toEqual(snap(4321))
    expect(h.entries.map((e) => e.url)).toEqual(["/", "/chronicle", "/run/a-9"]) // nothing pushed
    expect(h.back()).toBe("/") // browser back from the Chronicle: home, not the run again
    expect(h.back()).toBe("LEFT THE APP")
  })

  it("opened from a cold-linked, seeded Chronicle: ← still backs to it", () => {
    const h = new FakeHistory("/chronicle")
    const ret = chronicleReturn(h)
    seedHomeBehind(h.host({ type: "navigate", name: "https://x.test/chronicle" }))
    ret.leave(snap(40), ret.here())
    h.push("/run/a-9")
    expect(arrow(h, ret)).toBe("/chronicle")
    expect(h.back()).toBe("/")
  })

  it("after a Relive whose sentinel came off, ← still backs to the Chronicle", () => {
    const h = new FakeHistory("/")
    const ret = chronicleReturn(h)
    h.push("/chronicle")
    ret.leave(snap(900), ret.here())
    h.push("/run/a-9")
    h.push("/run/a-9", { lostSolesSequence: true })
    h.back() // the sequence's exit takes its sentinel back off
    expect(arrow(h, ret)).toBe("/chronicle")
  })

  it("opened from the plinth: ← pushes /", () => {
    const h = new FakeHistory("/")
    const ret = chronicleReturn(h)
    h.push("/run/a-9") // the plinth's last-run line
    expect(ret.behind()).toBe(false)
    expect(arrow(h, ret)).toBe("/")
    expect(h.entries.map((e) => e.url)).toEqual(["/", "/run/a-9", "/"])
  })

  it("a cold deep link to a run: ← pushes /", () => {
    const h = new FakeHistory("/run/a-9")
    const ret = chronicleReturn(h)
    seedHomeBehind(h.host({ type: "navigate", name: "https://x.test/run/a-9" }))
    expect(arrow(h, ret)).toBe("/")
  })

  it("the Chronicle dismissed, then a run opened from the plinth: ← pushes /", () => {
    const h = new FakeHistory("/")
    const ret = chronicleReturn(h)
    h.push("/chronicle")
    ret.leave(snap(700), ret.here()) // dismissed — a back
    h.back()
    h.push("/run/a-9") // prunes the Chronicle's entry
    expect(ret.behind()).toBe(false)
    expect(arrow(h, ret)).toBe("/")
  })

  it("the Chronicle more than one entry back is not behind: ← pushes /", () => {
    const h = new FakeHistory("/")
    const ret = chronicleReturn(h)
    h.push("/chronicle")
    ret.leave(snap(1), ret.here())
    h.push("/run/a-9")
    h.push("/skills")
    h.push("/run/b-2")
    expect(arrow(h, ret)).toBe("/")
  })

  it("a modified, middle or already-swallowed click is always the link's", () => {
    const overs: Partial<ArrowClick>[] = [
      { metaKey: true },
      { ctrlKey: true },
      { shiftKey: true },
      { altKey: true },
      { button: 1 },
      { defaultPrevented: true },
    ]
    for (const over of overs) {
      const h = new FakeHistory("/")
      const ret = chronicleReturn(h)
      h.push("/chronicle")
      ret.leave(snap(1), ret.here())
      h.push("/run/a-9")
      let backed = false
      backArrowClick(ret, () => (backed = true))(click(over))
      expect(backed).toBe(false)
    }
  })

  it("without the Navigation API, ← pushes / as it always did", () => {
    const h = new FakeHistory("/")
    const bare = { addEventListener: h.addEventListener.bind(h), get location() { return h.location } }
    const ret = chronicleReturn(bare)
    h.push("/chronicle")
    ret.leave(snap(77), ret.here())
    h.push("/run/a-9")
    expect(ret.behind()).toBe(false)
    expect(arrow(h, ret)).toBe("/")
  })
})
