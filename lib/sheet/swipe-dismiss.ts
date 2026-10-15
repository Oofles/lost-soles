import { useEffect, useRef, type RefObject } from "react"

/**
 * SWIPE-DOWN TO DISMISS A SHEET. Ticket 0249, `06-ui-ux.md` §1.5: sheets (`/chronicle`, skill
 * detail, ticket capture) dismiss "on back, on swipe-down, and on scrim tap". This is the ONE
 * gesture every sheet takes — the skill sheet first; `/chronicle` and ticket capture call the same
 * hook when they are built, rather than growing their own.
 *
 * Pointer events, not a gesture library: one vertical threshold, no inertia physics. The sheet
 * follows the finger while it is held and either dismisses on release or springs back.
 *
 * WHEN IT ARMS — all three, read at `pointerdown`:
 *   - the pointer is a finger (`pointerType === "touch"`): a mouse drag on the desktop is not a
 *     sheet gesture, and the desktop has Esc, the scrim and Close;
 *   - the viewport is narrow (< 1024px): at ≥ 1024px the sheet is a centred dialog, not a bottom
 *     sheet, and nothing changes there;
 *   - the sheet is scrolled to its top. A drag while the content is scrolled is a scroll.
 *
 * WHY THERE IS A `touchmove` LISTENER AT ALL. With `touch-action: auto` the browser claims any
 * vertical drag on a scrollable element as a pan and fires `pointercancel` a few pixels in — even
 * when there is nothing to scroll, as at scrollTop 0 dragging down. So the gesture never sees the
 * drag. The one non-passive `touchmove` listener cancels the browser's pan for exactly the drag
 * this gesture owns (armed, moving down) and for nothing else: an upward first move, or a
 * mostly-horizontal one, releases the gesture and the browser scrolls as normal.
 */

/** How far down, in CSS px, the finger must travel for a release to dismiss. */
export const SWIPE_DISMISS_PX = 96

/** The narrowest viewport at which a sheet is a centred dialog rather than a bottom sheet (§1.5). */
export const SHEET_DIALOG_MIN_WIDTH_PX = 1024

/**
 * Whether a drag from `(dx, dy)` — release point minus start point — dismisses: far enough down,
 * and mostly vertical (within ~27° of straight down). A short drag, an upward one, or a
 * mostly-horizontal one does not.
 */
export function isDismissSwipe(dx: number, dy: number): boolean {
  return dy >= SWIPE_DISMISS_PX && dy > 2 * Math.abs(dx)
}

/** The parts of a DOM element the gesture touches — narrowed so a test can hand it a fake. */
export interface SwipeSheet extends EventTarget {
  scrollTop: number
  style: { transform: string; transition: string }
}

export interface SwipeEnv {
  /** True when the viewport is wide enough that the sheet is a dialog, not a bottom sheet. */
  isWide(): boolean
}

const browserEnv: SwipeEnv = {
  isWide: () =>
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(`(min-width: ${SHEET_DIALOG_MIN_WIDTH_PX}px)`).matches,
}

type PointerLike = Event & { pointerType?: string; pointerId?: number; clientX?: number; clientY?: number }
type TouchLike = Event & { touches?: ArrayLike<{ clientX: number; clientY: number }> }

/**
 * Install the gesture on `el`; returns the uninstaller. `onDismiss` is the sheet's ordinary
 * dismissal — the same path as Esc, the scrim and Close, so the route decides where it goes.
 */
export function attachSwipeDismiss(el: SwipeSheet, onDismiss: () => void, env: SwipeEnv = browserEnv): () => void {
  // null: not tracking. "pending": armed, direction not yet seen. "owned": a downward drag this
  // gesture has claimed from the browser.
  let g: { id: number | undefined; x: number; y: number; dx: number; dy: number; state: "pending" | "owned" } | null = null

  const reset = (keepTransform = false) => {
    if (!keepTransform) {
      el.style.transition = "transform 160ms ease-out"
      el.style.transform = ""
    }
    g = null
  }

  // A direction is chosen on the first move past a couple of pixels: down claims it, anything
  // else (up, or mostly sideways) lets the browser have it.
  const decide = (dx: number, dy: number) => {
    if (!g || g.state !== "pending") return
    if (Math.abs(dx) < 3 && Math.abs(dy) < 3) return
    if (dy > 0 && dy >= Math.abs(dx)) {
      g.state = "owned"
      el.style.transition = ""
    } else {
      g = null
    }
  }

  const onDown = (e: PointerLike) => {
    if (e.pointerType !== "touch" || env.isWide() || el.scrollTop > 0) {
      g = null
      return
    }
    g = { id: e.pointerId, x: e.clientX ?? 0, y: e.clientY ?? 0, dx: 0, dy: 0, state: "pending" }
  }

  const onMove = (e: PointerLike) => {
    if (!g || e.pointerId !== g.id) return
    g.dx = (e.clientX ?? 0) - g.x
    g.dy = (e.clientY ?? 0) - g.y
    decide(g.dx, g.dy)
    if (g?.state === "owned") el.style.transform = `translateY(${Math.max(0, g.dy)}px)`
  }

  const onUp = (e: PointerLike) => {
    if (!g || e.pointerId !== g.id) return
    const dismiss = g.state === "owned" && isDismissSwipe(g.dx, g.dy)
    reset(dismiss)
    if (dismiss) onDismiss()
  }

  const onCancel = (e: PointerLike) => {
    if (g && e.pointerId === g.id) reset()
  }

  const onTouchMove = (e: TouchLike) => {
    if (!g) return
    const t = e.touches?.[0]
    if (g.state === "pending" && t) decide(t.clientX - g.x, t.clientY - g.y)
    if (g?.state === "owned" && e.cancelable) e.preventDefault()
  }

  el.addEventListener("pointerdown", onDown as EventListener)
  el.addEventListener("pointermove", onMove as EventListener)
  el.addEventListener("pointerup", onUp as EventListener)
  el.addEventListener("pointercancel", onCancel as EventListener)
  el.addEventListener("touchmove", onTouchMove as EventListener, { passive: false })
  return () => {
    el.removeEventListener("pointerdown", onDown as EventListener)
    el.removeEventListener("pointermove", onMove as EventListener)
    el.removeEventListener("pointerup", onUp as EventListener)
    el.removeEventListener("pointercancel", onCancel as EventListener)
    el.removeEventListener("touchmove", onTouchMove as EventListener)
  }
}

/**
 * The hook every sheet calls: `useSwipeDismiss(sheetRef, onDismiss)`. Installed once per mount;
 * `onDismiss` may be a new function each render.
 */
export function useSwipeDismiss(ref: RefObject<HTMLElement | null>, onDismiss: () => void): void {
  const dismiss = useRef(onDismiss)
  dismiss.current = onDismiss
  useEffect(() => {
    const el = ref.current
    if (!el) return
    return attachSwipeDismiss(el, () => dismiss.current())
  }, [ref])
}
