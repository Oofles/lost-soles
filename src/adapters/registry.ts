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
import type { SourceAdapter } from "./types"

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
