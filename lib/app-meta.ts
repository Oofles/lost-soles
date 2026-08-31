/**
 * The one place the app's own identity is stated. Imported through the `@/…`
 * path alias so that alias is exercised by `next build`, `tsc --noEmit` and
 * `vitest` alike — 01-architecture.md §6 records three separate deploys broken
 * by an alias that resolved locally and nowhere else.
 */
export const APP_NAME = "Lost Soles"

export const APP_TAGLINE = "The map only ever grows."
