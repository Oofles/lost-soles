import { describe, expect, it } from "vitest"

import { isColdLanding, seedHomeBehind, SEED_MARKER, type HistoryHost } from "@/lib/runs/history"
import type { RunListItem } from "@/lib/runs/wire"

import { chronicleReturn, type ChronicleSnapshot } from "./return"

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
  entries: { url: string; state: unknown }[]
  index = 0
  private listeners: { fn: () => void; capture: boolean }[] = []
  constructor(first: string) {
    this.entries = [{ url: first, state: null }]
  }
  get here() {
    return this.entries[this.index]!
  }
  get location() {
    return { pathname: this.here.url, href: `https://x.test${this.here.url}`, search: "", hash: "" }
  }
  addEventListener(_type: "popstate", fn: () => void, capture = false) {
    this.listeners.push({ fn, capture })
  }
  push(url: string, state: unknown = null) {
    this.entries = this.entries.slice(0, this.index + 1)
    this.entries.push({ url, state })
    this.index++
  }
  replace(url: string, state: unknown) {
    this.entries[this.index] = { url, state }
  }
  back() {
    if (this.index === 0) return "LEFT THE APP"
    this.index--
    // As at a real event target: capture listeners first, then bubble, each in registration order.
    for (const l of this.listeners) if (l.capture) l.fn()
    for (const l of this.listeners) if (!l.capture) l.fn()
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
    ret.leave(snap(4321)) // a row is opened; the Chronicle unmounts
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
    ret.leave(snap(900))
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
    ret.leave(snap(700)) // dismissed (Esc / close / back are all a back)
    expect(h.back()).toBe("/")
    h.push("/chronicle") // RUNS again
    expect(ret.take("/chronicle")).toBeNull()
  })

  it("take is stable across React's development double-mount", () => {
    const h = new FakeHistory("/")
    const ret = chronicleReturn(h)
    h.push("/chronicle")
    ret.leave(snap(10))
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
    ret.leave(snap(265))
    h.push("/run/a-1")
    expect(h.back()).toBe("/chronicle")
    expect(mountedWith).toEqual(snap(265))
  })
})
