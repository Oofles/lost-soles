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
  /** The Navigation API, where the browser has it: which session-history entry is current. */
  navigation?: { currentEntry: { key: string } | null }
}

export interface ChronicleReturn {
  /** The current session-history entry's key, or null where the Navigation API is absent. */
  here(): string | null
  /**
   * The Chronicle is going away (a row was opened, or it was dismissed): remember where it was,
   * and the history entry it was on (`here()` while it was mounted).
   */
  leave(snapshot: ChronicleSnapshot, entry: string | null): void
  /**
   * A Chronicle is mounting at `pathname`: the snapshot, if this arrival is a history traversal
   * BACK TO THE ENTRY it left. A push to `/chronicle` is a new entry with a new key, so it never
   * matches. Not consumed — React's development double-mount reads it twice, and the next `leave`
   * replaces it anyway.
   *
   * The entry key is the primary test. A `popstate` listener cannot be: Next's router registers its
   * own at boot and renders the restored route synchronously inside it, so the Chronicle mounts
   * before any listener of ours runs, in either phase (the wave 1 smoke, Amplify jobs 402 and 403).
   * The listener remains only as a fallback for a browser without the Navigation API.
   */
  take(pathname: string): ChronicleSnapshot | null
}

export function chronicleReturn(host: TraversalHost | null): ChronicleReturn {
  let snapshot: ChronicleSnapshot | null = null
  let leftFrom: string | null = null
  /** Where the last history traversal landed (fallback only). */
  let traversedTo: string | null = null
  host?.addEventListener("popstate", () => {
    traversedTo = host.location.pathname
  })
  const here = () => host?.navigation?.currentEntry?.key ?? null
  return {
    here,
    leave(s, entry) {
      snapshot = s
      leftFrom = entry
    },
    take(pathname) {
      if (!snapshot) return null
      if (leftFrom !== null && host?.navigation) return here() === leftFrom ? snapshot : null
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
