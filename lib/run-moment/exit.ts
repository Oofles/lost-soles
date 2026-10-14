/**
 * EVERY WAY OUT OF THE SEQUENCE, IN ONE PLACE. Ticket `0084`. `06-ui-ux.md` §3.4, D-298.
 *
 * *"One tap ends it."* An eight-second animation is acceptable to ship only because the user is
 * never trapped in it, so the way out is ONE set of listeners installed for the sequence's whole
 * lifetime and torn down with it — never per-beat skip handling. Per-beat handling is how "click
 * goes to the next beat" bugs are born: a beat that owns its own skip can only skip itself.
 *
 * The exits, all landing on the end state that is already mounted underneath (`0078`):
 *
 *   - a click anywhere (capture phase, so nothing under it acts first) — except on a SEQUENCE
 *     CONTROL, an element inside `[data-sequence-control]`: a tally row's expander and the frontier
 *     line keep their own meaning (D-298, the operator's call: §3.2's "tap a row" and §3.4's "tap
 *     anywhere" cannot both hold, and Esc always still works). The click is swallowed, so the header's
 *     `←` link skips rather than leaving for `/`;
 *   - Escape;
 *   - Back. A SENTINEL history entry is pushed when the sequence starts, so the first Back pops it
 *     (→ end state) instead of leaving; the entry behind is the run's own, so a second Back → `/`.
 *     Any OTHER exit takes the sentinel back off the stack, or the end state would need two Backs;
 *   - the sequence finishing, or aborting (no WebGL, WebGL lost, nothing to tally) — `complete()`.
 *
 * Every exit calls `onExit` exactly once, which is where the `seen` flag is written: a skip marks
 * a run seen exactly as a finish does (§3.4).
 */

/** The attribute that marks a control whose click must NOT skip (D-298). */
export const SEQUENCE_CONTROL = "data-sequence-control"

/** The sentinel entry's marker, in its history state. */
export const SEQUENCE_MARKER = "lostSolesSequence"

export type ExitCause = "click" | "escape" | "back" | "complete"

type Listener = (event: Event) => void

/** `window`, narrowed to what this needs, so the tests hand in a plain object. */
export interface ExitHost {
  addEventListener(type: string, listener: Listener, options?: boolean | AddEventListenerOptions): void
  removeEventListener(type: string, listener: Listener, options?: boolean | EventListenerOptions): void
}

export interface SequenceHistory {
  readonly state: unknown
  /** The UNPATCHED `pushState` — see `lib/runs/history.ts` on Next's patched one. */
  pushState(data: unknown): void
  back(): void
}

export interface SequenceExit {
  /** The sequence ended on its own: finished, or aborted to the end state. */
  complete(): void
  /** Unmount without an exit (e.g. the page went away). Listeners off, sentinel consumed. */
  teardown(): void
}

interface ClickLike {
  target?: unknown
  preventDefault?: () => void
  stopPropagation?: () => void
}

interface KeyLike {
  key?: string
  preventDefault?: () => void
}

function isControl(target: unknown): boolean {
  const t = target as { closest?: (selector: string) => unknown } | null | undefined
  return typeof t?.closest === "function" && t.closest(`[${SEQUENCE_CONTROL}]`) != null
}

function isSentinel(state: unknown): boolean {
  return typeof state === "object" && state !== null && (state as Record<string, unknown>)[SEQUENCE_MARKER] === true
}

export function wireSequenceExit({
  host,
  history,
  onExit,
}: {
  host: ExitHost
  history: SequenceHistory
  onExit: (cause: ExitCause) => void
}): SequenceExit {
  let done = false

  // The run's own state is copied in (Next's router state included), so popping back onto the entry
  // behind is a no-op for the router: it is the same page.
  const behind = history.state
  history.pushState({ ...(typeof behind === "object" && behind !== null ? behind : {}), [SEQUENCE_MARKER]: true })

  const off = () => {
    host.removeEventListener("click", onClick, true)
    host.removeEventListener("keydown", onKey, true)
    host.removeEventListener("popstate", onPop)
  }

  const exit = (cause: ExitCause) => {
    if (done) return
    done = true
    off()
    // Back already popped the sentinel; every other exit takes it off, so one Back from the end
    // state is one Back.
    if (cause !== "back" && isSentinel(history.state)) history.back()
    onExit(cause)
  }

  function onClick(event: Event) {
    const e = event as ClickLike
    if (isControl(e.target)) return
    e.preventDefault?.()
    e.stopPropagation?.()
    exit("click")
  }

  function onKey(event: Event) {
    const e = event as KeyLike
    if (e.key !== "Escape") return
    e.preventDefault?.()
    exit("escape")
  }

  function onPop() {
    exit("back")
  }

  host.addEventListener("click", onClick, true)
  host.addEventListener("keydown", onKey, true)
  host.addEventListener("popstate", onPop)

  return {
    complete: () => exit("complete"),
    teardown() {
      if (done) return
      done = true
      off()
      if (isSentinel(history.state)) history.back()
    },
  }
}

/** The browser's history, with the unpatched `pushState`. Only ever called from an effect. */
export function browserSequenceHistory(): SequenceHistory {
  const here = () => window.location.pathname + window.location.search + window.location.hash
  return {
    get state() {
      return window.history.state as unknown
    },
    pushState: (data) => History.prototype.pushState.call(window.history, data, "", here()),
    back: () => window.history.back(),
  }
}
