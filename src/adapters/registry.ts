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
 */
export const ADAPTERS: Readonly<Partial<Record<SourceId, SourceAdapter>>> = {}

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
 * So the connector is registered on its own until there is an adapter to hang it on.
 * When 0036/0037 register the real one, folding `oauth` onto `SourceAdapter` is a
 * refactor with these tests already green.
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
