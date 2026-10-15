/**
 * WHERE A SKILL SHEET WAS OPENED FROM, when it was not the `/skills` panel. Ticket `0270`.
 *
 * The sheet's dismiss (`app/skills/skill-sheet-route.tsx`) goes `router.back()` when there is an
 * in-app page behind it, and replaces itself with `/skills` for a deep link, which has none. The
 * panel knows when it was behind the sheet (`SkillsShell`'s `openedFromPanel`). The plinth's
 * quick-view (`0270`) is the other in-app door: a row click marks its own href here, so Esc, the
 * scrim and Close go back to `/` rather than to a panel the user never opened.
 *
 * Module state, not `history.state` (Next's router owns that) and not a query string (the sheet is
 * prerendered, D-282). A reload clears it, which is right: a reloaded sheet is a deep link.
 */

let fromHome: string | null = null

/** Called on a quick-view row's click, with the href it is about to open. */
export function markSheetOpenedFromHome(href: string): void {
  fromHome = href
}

/**
 * Whether the sheet at `pathname` was opened by a quick-view click. A mark for any other path is
 * stale (the user has moved on) and is dropped, so it can never leak onto a later deep link.
 */
export function sheetOpenedFromHome(pathname: string): boolean {
  if (fromHome !== null && fromHome !== pathname) fromHome = null
  return fromHome === pathname
}
