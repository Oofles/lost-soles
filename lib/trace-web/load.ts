import { log } from "@/lib/log"

import { buildWebOffThread, type WebSource } from "./off-thread"
import { webSource } from "./runs"
import type { WebFeatureCollection } from "./web"

/**
 * The permanent web for one explored generation, fetched and built, or `null` when the fetch failed.
 * `useTraceWeb`'s whole data path, lifted out of the hook so it can be driven without a DOM (ticket
 * `0321`; the vitest environment is `node`, see `use-latest-run.test.ts`).
 *
 * ─── A FAILED FETCH IS A MAP WITHOUT THE WEB, NEVER A BROKEN PAGE ──────────────────────────
 *
 * A 413 from Amplify's response cap (D-460), a 5xx or a timeout all land here as a rejection from
 * `fetchTraceWebBody`. It is logged once and resolves `null`, so the hook draws nothing new and the
 * fog, the latest run and the controls carry on. It never rejects: an unhandled rejection in an
 * effect is the one way this path could take the page down with it.
 */
export function loadDrawnWeb(
  generation: number | null,
  deps: { fetch?: typeof globalThis.fetch; build?: (source: WebSource) => Promise<WebFeatureCollection> } = {},
): Promise<WebFeatureCollection | null> {
  const build = deps.build ?? ((source: WebSource) => buildWebOffThread(source))
  return webSource(generation, deps.fetch).then(build, (error: unknown) => {
    log.error("trace web: fetch failed", error)
    return null
  })
}
