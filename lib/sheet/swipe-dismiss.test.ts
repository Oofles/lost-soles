import { describe, expect, it } from "vitest"

import { attachSwipeDismiss, isDismissSwipe, SWIPE_DISMISS_PX, type SwipeSheet } from "./swipe-dismiss"

/**
 * Ticket 0249 — the swipe-down gesture, driven with synthetic pointer and touch events against a
 * fake sheet (Node's EventTarget), the same events a browser would dispatch in the same order:
 * pointerdown, then each pointermove followed by its touchmove, then pointerup.
 */

class FakeSheet extends EventTarget implements SwipeSheet {
  scrollTop = 0
  style = { transform: "", transition: "" }
}

function setup({ wide = false, scrollTop = 0 } = {}) {
  const el = new FakeSheet()
  el.scrollTop = scrollTop
  let dismissed = 0
  const detach = attachSwipeDismiss(el, () => dismissed++, { isWide: () => wide })
  return { el, detach, dismissed: () => dismissed }
}

const pointer = (type: string, x: number, y: number, pointerType = "touch", pointerId = 1) =>
  Object.assign(new Event(type), { pointerType, pointerId, clientX: x, clientY: y })

/** Dispatches the drag and returns whether the browser's pan was cancelled on any touchmove. */
function drag(el: FakeSheet, path: [number, number][], { pointerType = "touch", end = "pointerup" } = {}) {
  const [x0, y0] = path[0]!
  el.dispatchEvent(pointer("pointerdown", x0, y0, pointerType))
  let prevented = false
  let last = path[0]!
  for (const [x, y] of path.slice(1)) {
    el.dispatchEvent(pointer("pointermove", x, y, pointerType))
    if (pointerType === "touch") {
      const t = Object.assign(new Event("touchmove", { cancelable: true }), { touches: [{ clientX: x, clientY: y }] })
      el.dispatchEvent(t)
      prevented ||= t.defaultPrevented
    }
    last = [x, y]
  }
  el.dispatchEvent(pointer(end, last[0], last[1], pointerType))
  return prevented
}

const down = (dy: number, dx = 0): [number, number][] => [
  [100, 50],
  [100 + dx / 4, 50 + dy / 4],
  [100 + dx / 2, 50 + dy / 2],
  [100 + dx, 50 + dy],
]

describe("isDismissSwipe (0249)", () => {
  it("one vertical threshold, mostly vertical", () => {
    expect(isDismissSwipe(0, SWIPE_DISMISS_PX)).toBe(true)
    expect(isDismissSwipe(0, SWIPE_DISMISS_PX - 1)).toBe(false)
    expect(isDismissSwipe(0, -200)).toBe(false)
    expect(isDismissSwipe(80, 150)).toBe(false)
    expect(isDismissSwipe(200, 120)).toBe(false)
  })
})

describe("swipe-down dismissal (0249)", () => {
  it("a long downward drag from the sheet's top dismisses, once, through onDismiss", () => {
    const { el, dismissed } = setup()
    const prevented = drag(el, down(160))
    expect(dismissed()).toBe(1)
    // The browser's pan was cancelled, so the gesture saw the whole drag rather than a pointercancel.
    expect(prevented).toBe(true)
  })

  it("the sheet follows the finger while held and springs back on a short release", () => {
    const { el, dismissed } = setup()
    el.dispatchEvent(pointer("pointerdown", 100, 50))
    el.dispatchEvent(pointer("pointermove", 100, 90))
    expect(el.style.transform).toBe("translateY(40px)")
    el.dispatchEvent(pointer("pointerup", 100, 90))
    expect(dismissed()).toBe(0)
    expect(el.style.transform).toBe("")
  })

  it("a drag while the content is scrolled is a scroll: no dismissal, the browser keeps the pan", () => {
    const { el, dismissed } = setup({ scrollTop: 240 })
    const prevented = drag(el, down(300))
    expect(dismissed()).toBe(0)
    expect(prevented).toBe(false)
    expect(el.style.transform).toBe("")
  })

  it("a short drag does not dismiss", () => {
    const { el, dismissed } = setup()
    drag(el, down(SWIPE_DISMISS_PX - 10))
    expect(dismissed()).toBe(0)
  })

  it("a mostly-horizontal drag does not dismiss and is left to the browser", () => {
    const { el, dismissed } = setup()
    const prevented = drag(el, down(120, 200))
    expect(dismissed()).toBe(0)
    expect(prevented).toBe(false)
  })

  it("a diagonal drag that is down-first but ends too sideways does not dismiss", () => {
    const { el, dismissed } = setup()
    drag(el, [[100, 50], [104, 60], [180, 150], [220, 170]])
    expect(dismissed()).toBe(0)
  })

  it("an upward first move scrolls the content, even if the finger then comes back down", () => {
    const { el, dismissed } = setup()
    const prevented = drag(el, [[100, 300], [100, 280], [100, 450]])
    expect(dismissed()).toBe(0)
    expect(prevented).toBe(false)
  })

  it("a browser-claimed gesture (pointercancel) never dismisses", () => {
    const { el, dismissed } = setup()
    drag(el, down(200), { end: "pointercancel" })
    expect(dismissed()).toBe(0)
    expect(el.style.transform).toBe("")
  })

  it("at ≥ 1024px, where the sheet is a centred dialog, nothing changes", () => {
    const { el, dismissed } = setup({ wide: true })
    const prevented = drag(el, down(300))
    expect(dismissed()).toBe(0)
    expect(prevented).toBe(false)
    expect(el.style.transform).toBe("")
  })

  it("a mouse drag is not the gesture", () => {
    const { el, dismissed } = setup()
    drag(el, down(300), { pointerType: "mouse" })
    expect(dismissed()).toBe(0)
  })

  it("detaching removes every listener", () => {
    const { el, detach, dismissed } = setup()
    detach()
    drag(el, down(300))
    expect(dismissed()).toBe(0)
  })
})
