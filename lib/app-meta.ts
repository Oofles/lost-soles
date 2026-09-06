/**
 * The one place the app's own identity is stated. Imported through the `@/…`
 * path alias so that alias is exercised by `next build`, `tsc --noEmit` and
 * `vitest` alike — 01-architecture.md §6 records three separate deploys broken
 * by an alias that resolved locally and nowhere else.
 */
export const APP_NAME = "Lost Soles"

export const APP_TAGLINE = "The map only ever grows."

/**
 * The version stamped onto every archived raw object's metadata (ticket 0039,
 * `01-architecture.md` §3 "self-describing").
 *
 * A LITERAL, mirroring `package.json`, asserted equal by `app-meta.test.ts`. The same
 * trade `LostSolesCaptureGuard`'s table name records: importing `package.json` here
 * would need `resolveJsonModule` and would pull the whole manifest — every dependency
 * name and version — into a Lambda bundle and into any client chunk that touches this
 * module. A literal plus a test costs one line and leaks nothing.
 *
 * WHAT IT IS FOR, and it is worth being precise because "app version" invites a shrug:
 * an archived object is replayed through a normalizer written years later, and the
 * question that replay asks is "what wrote this?". A release version answers it well
 * enough to bisect. It is deliberately NOT the git SHA — Amplify's `AWS_COMMIT_ID` is
 * absent in a sandbox and in every test, so the field would be blank in exactly the
 * environments where someone is debugging.
 */
export const APP_VERSION = "0.1.0"
