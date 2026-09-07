/**
 * THE ONE FILE IN THE CODEBASE THAT NAMES A CONCRETE ADAPTER.
 *
 * Everything else — the endpoint, the worker, the reconcile sweep, the token refresh —
 * resolves an adapter through `getAdapter()`. That is what makes "swapping the primary
 * source touches one directory plus one line here" true rather than aspirational
 * (D-100, D-121.1). `registry.test.ts` asserts it instead of trusting it.
 *
 * It ships EMPTY, on purpose. The boundary has to exist before the first adapter does:
 * a seam introduced after the code that should have used it is a seam nobody uses.
 *
 * Ticket 0026.
 */

import type { SourceId } from "@/src/domain/activity"
import { stravaAdapter } from "./strava/adapter"
import { stravaOAuth } from "./strava/oauth"
import type { OAuthConnector, SourceAdapter } from "./types"

/**
 * Thrown rather than returning `undefined`, because every caller of `getAdapter` is on a
 * path where an unknown source is unrecoverable — there is no sensible fallback adapter,
 * and an `undefined` would surface later as a property access on nothing, far from the
 * id that caused it. Typed so a handler can map it to a 400 without matching on a string.
 */
export class UnknownAdapterError extends Error {
  readonly source: SourceId

  constructor(source: SourceId) {
    super(`No adapter is registered for source "${source}"`)
    this.name = "UnknownAdapterError"
    this.source = source
  }
}

/**
 * The lookup. Partial because `SourceId` enumerates every source the design anticipates,
 * most of which will never be built, and all of which are widened to `string` anyway —
 * a total record would be a lie in both directions.
 *
 * ADD AN ADAPTER HERE AND NOWHERE ELSE.
 *
 * ─── WHEN THE INGEST ADAPTER WAS REGISTERED, AND WHY THEN ───────────────────
 *
 * Ticket 0042, and the date matters because two earlier comments guessed at it and both
 * guessed wrong — this one said 0036/0037, `adapter.ts` said 0093, and neither happened
 * (ticket 0175 is the record of that). What actually forced it is `process-activity`:
 * the worker resolves its adapter through `getAdapter(job.source)` and there is no other
 * way for it to reach one, so an empty registry made the whole ingest path a function
 * that throws.
 *
 * `adapter.ts` argued for waiting on `accept` — *"`getAdapter("strava")` should never
 * hand back something that throws on phase 1"* — and that concern is real but smaller
 * than the one above. `accept` is phase 1, it is the WEBHOOK's entry point, and the
 * webhook does not exist until capability 14; the one caller that would reach for it
 * through the registry is the one caller that has not been built. Meanwhile phases 2, 3
 * and 4 are complete and are what the worker actually calls. Registering an object whose
 * unbuilt phase throws a named `NotYetImplemented` naming its ticket is a better failure
 * than a registry that cannot answer at all.
 */
export const ADAPTERS: Readonly<Partial<Record<SourceId, SourceAdapter>>> = {
  strava: stravaAdapter as SourceAdapter,
}

export function getAdapter(id: SourceId): SourceAdapter {
  const adapter = ADAPTERS[id]
  if (adapter === undefined) throw new UnknownAdapterError(id)
  return adapter
}

/** Every registered source. Used by the reconcile sweep, which must not hard-code a list. */
export function registeredSources(): SourceId[] {
  return Object.keys(ADAPTERS)
}

/**
 * ─── OAUTH CONNECTORS ────────────────────────────────────────────────────────
 *
 * Ticket 0032. A SECOND lookup in the same file, and the reason is worth stating
 * because "two registries" is normally a smell.
 *
 * Connecting a source and ingesting from one are different lifecycles with different
 * arrival dates. The OAuth handshake ships now, because nothing else in capability 05
 * can be built or tested until a real token exists. The four ingest phases arrive
 * across tickets 0034-0037.
 *
 * The alternative was to register a `SourceAdapter` today whose `normalize`,
 * `fetchRaw`, `accept` and `listSince` throw. That would make `getAdapter("strava")`
 * return an object that CLAIMS to implement the contract and does not — and it would
 * silently un-say `registry.test.ts`'s "ships empty" assertion, which is a real
 * statement about where the project is rather than a placeholder.
 *
 * So the connector was registered on its own until there was an adapter to hang it on.
 * That is now the case — 0042 registered the ingest adapter above — and the two lookups
 * still stay separate, because folding `oauth` onto `SourceAdapter` would put the
 * connect lifecycle back inside the ingest one for no gain: `connectableSources()` and
 * `registeredSources()` answer different questions and the settings screen asks the
 * first one.
 *
 * What has NOT changed: this file is still the only one outside an adapter's own
 * directory that names a concrete adapter, and `registry.test.ts` still asserts it.
 * ADD AN ADAPTER HERE AND NOWHERE ELSE.
 */
export const OAUTH_CONNECTORS: Readonly<Partial<Record<SourceId, OAuthConnector>>> = {
  strava: stravaOAuth,
}

/**
 * Throws `UnknownAdapterError` for both "no such source" and "this source does not
 * use OAuth", on purpose. Every caller is an HTTP route that answers a browser, and
 * both cases are the same answer there: there is nothing at this URL. Distinguishing
 * them would only tell an outsider which sources exist.
 */
export function getOAuthConnector(id: SourceId): OAuthConnector {
  const connector = OAUTH_CONNECTORS[id]
  if (connector === undefined) throw new UnknownAdapterError(id)
  return connector
}

/** Every source that can be connected. Used by the settings screen, which must not hard-code a list. */
export function connectableSources(): SourceId[] {
  return Object.keys(OAUTH_CONNECTORS)
}
