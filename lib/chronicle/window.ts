/**
 * THE CHRONICLE'S VIRTUAL WINDOW. Ticket `0088`: *"the list must survive a backfilled archive of
 * years. Virtualise or page it; do not render 2,000 rows."*
 *
 * Both. Pages of `CHRONICLE_PAGE_SIZE` arrive as the window nears the end of what is loaded, and
 * only the rows in view plus an overscan are ever in the DOM, at a fixed height each — so the node
 * count is a function of the WINDOW's height, never of the archive's length. Fixed height is what
 * makes it arithmetic rather than measurement: no row is laid out to find out where the next goes.
 *
 * Pure, so the bound is asserted in a test against a synthetic 2,000-row fixture.
 */

/** Two lines of text at 32px-minimum targets (D-313): the date line and the measure line. */
export const CHRONICLE_ROW_PX = 56

/** Rows drawn past each edge, so a fast wheel never shows a blank strip before React catches up. */
export const CHRONICLE_OVERSCAN = 8

/** Fetch the next page when the window's end is this close to the last loaded row. */
export const CHRONICLE_PREFETCH_ROWS = 20

/** Used before the panel has been measured (and in a test, where nothing is laid out). */
export const FALLBACK_VIEWPORT_PX = 1000

export interface RowWindow {
  /** First row index drawn, inclusive. */
  start: number
  /** Last row index drawn, exclusive. */
  end: number
}

export function rowWindow(
  scrollTop: number,
  viewportPx: number,
  count: number,
  rowPx: number = CHRONICLE_ROW_PX,
  overscan: number = CHRONICLE_OVERSCAN,
): RowWindow {
  if (count <= 0) return { start: 0, end: 0 }
  const top = Math.max(0, scrollTop)
  const height = viewportPx > 0 ? viewportPx : FALLBACK_VIEWPORT_PX
  const first = Math.min(count - 1, Math.floor(top / rowPx))
  const last = Math.ceil((top + height) / rowPx)
  return { start: Math.max(0, first - overscan), end: Math.min(count, last + overscan) }
}

/** The most rows `rowWindow` can ever return for a viewport — the DOM bound, stated once. */
export function maxWindowRows(viewportPx: number, rowPx: number = CHRONICLE_ROW_PX, overscan: number = CHRONICLE_OVERSCAN): number {
  return Math.ceil(viewportPx / rowPx) + 1 + 2 * overscan
}

export function shouldLoadMore(window: RowWindow, loaded: number, hasMore: boolean): boolean {
  return hasMore && window.end >= loaded - CHRONICLE_PREFETCH_ROWS
}
