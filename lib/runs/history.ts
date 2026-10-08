/**
 * BACK FROM A COLD DEEP LINK LANDS ON `/`. Ticket `0078`, criterion 5. `06-ui-ux.md` §3.3, §1.5.
 *
 * A `/run/:id` opened in a new tab has nothing behind it: back would leave the app, or land on the
 * browser's blank new-tab entry. So on a COLD landing — the document itself was loaded at this
 * URL — a `/` entry is slipped in underneath before anything else happens:
 *
 *     [ /run/x ]   →   [ / (seed), /run/x ]
 *
 * ─── WHY THE UNPATCHED `History.prototype` METHODS ──────────────────────────
 *
 * Next 15's app router patches `window.history.pushState`/`replaceState` so that a call copies the
 * router's internal state — the CURRENT page's tree — into the entry. A seed written through the
 * patched method would therefore carry the run page's tree under the URL `/`, and back would
 * "restore" the run page at `/`. Written through the prototype, the seed carries a plain marker and
 * no `__NA`, which is exactly the case Next's `popstate` handler answers with a full reload of the
 * entry's URL: back renders `/` from the server, cleanly. The run entry on top is re-pushed with
 * the state Next already wrote for it, so forward and in-page navigation are untouched.
 *
 * A soft navigation from inside the app (the Chronicle, the plinth) is not cold — `/` or the
 * Chronicle is already behind it — and a reload is not either: it was seeded on the first load.
 */

export const SEED_MARKER = "lostSolesSeed"

export interface HistoryHost {
  history: Pick<History, "state" | "length">
  location: Pick<Location, "href" | "pathname" | "search" | "hash">
  /** The unpatched methods, bound to the real `history`. */
  replaceState(data: unknown, url: string): void
  pushState(data: unknown, url: string): void
  /** The document's own navigation — `performance.getEntriesByType("navigation")[0]`. */
  navigation: { type: string; name: string } | undefined
}

/** True when this page was the document's landing URL and not a reload of one. */
export function isColdLanding(host: Pick<HistoryHost, "location" | "navigation">): boolean {
  const nav = host.navigation
  if (!nav || nav.type !== "navigate") return false
  try {
    return new URL(nav.name).pathname === host.location.pathname
  } catch {
    return false
  }
}

/** Slip `/` under the current entry on a cold landing. Returns whether it did. */
export function seedHomeBehind(host: HistoryHost): boolean {
  if (!isColdLanding(host)) return false
  const state = host.history.state as Record<string, unknown> | null
  if (state && state[SEED_MARKER]) return false
  const here = host.location.pathname + host.location.search + host.location.hash
  host.replaceState({ [SEED_MARKER]: true }, "/")
  host.pushState(state, here)
  return true
}

/** The browser's host. Only ever called from an effect. */
export function browserHistoryHost(): HistoryHost {
  const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined
  return {
    history: window.history,
    location: window.location,
    replaceState: (data, url) => History.prototype.replaceState.call(window.history, data, "", url),
    pushState: (data, url) => History.prototype.pushState.call(window.history, data, "", url),
    navigation: nav ? { type: nav.type, name: nav.name } : undefined,
  }
}
