/**
 * BACK FROM A RUN LANDS IN THE CHRONICLE WHERE YOU LEFT IT. Ticket `0088`; the operator's call of
 * 2026-10-15 (`06` §3.3, as amended): *"back from a run opened out of the Chronicle returns to the
 * Chronicle, at the same scroll position."*
 *
 * The run page is not under the home layout, so opening a run unmounts the Chronicle. What it had —
 * the rows loaded so far, the cursor for the next page, and the scroll offset — is put aside here
 * as it unmounts, and taken back by the next Chronicle that mounts AS A HISTORY TRAVERSAL to
 * `/chronicle`. Any other arrival (the plinth's `RUNS`, a typed URL) starts at the top: the
 * snapshot belongs to the back button, not to the route.
 *
 * Module state, not `sessionStorage`: a back is a soft navigation inside the same document, and a
 * reload is a fresh visit that should start at the top anyway. Next's router owns `history.state`,
 * which is why the entry itself does not carry the offset.
 */

import type { RunListItem } from "@/lib/runs/wire"

export interface ChronicleSnapshot {
  items: RunListItem[]
  next: string | null
  scrollTop: number
}

/** `window`, narrowed to what this reads — so a test hands in a plain object. */
export interface TraversalHost {
  addEventListener(type: "popstate", listener: () => void): void
  location: { pathname: string }
}

export interface ChronicleReturn {
  /** The Chronicle is going away (a row was opened, or it was dismissed): remember where it was. */
  leave(snapshot: ChronicleSnapshot): void
  /**
   * A Chronicle is mounting at `pathname`: the snapshot, if this arrival is a history traversal to
   * it. Not consumed — React's development double-mount reads it twice, and the next `leave`
   * replaces it anyway. A push to `/chronicle` fires no `popstate`, so it can never match: the last
   * traversal before one is always somewhere else (the dismissal back to `/`, at the latest).
   */
  take(pathname: string): ChronicleSnapshot | null
}

export function chronicleReturn(host: TraversalHost | null): ChronicleReturn {
  let snapshot: ChronicleSnapshot | null = null
  /** Where the last history traversal landed. */
  let traversedTo: string | null = null
  host?.addEventListener("popstate", () => {
    traversedTo = host.location.pathname
  })
  return {
    leave(s) {
      snapshot = s
    },
    take(pathname) {
      return traversedTo === pathname ? snapshot : null
    },
  }
}

let ambient: ChronicleReturn | undefined

/**
 * The browser's instance, created on the first Chronicle mount — so its `popstate` listener is in
 * place before any back from a run the Chronicle opened.
 */
export function browserChronicleReturn(): ChronicleReturn {
  return (ambient ??= chronicleReturn(typeof window === "undefined" ? null : window))
}
