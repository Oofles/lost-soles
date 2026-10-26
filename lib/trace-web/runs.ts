import { fetchTraceWebBody } from "@/lib/runs/client"

import type { WebSource } from "./off-thread"
import type { WebRunInput } from "./web"

/**
 * ONE FETCH OF THE WEB PER GENERATION, shared. Ticket `0085`.
 *
 * Several readers want the same body at the same moment: the map's steady-state layer
 * (`use-trace-web`), beat 1, which builds the web as it was before this run, the run index and the
 * region list. One promise per explored generation — the app's existing "the map changed" signal
 * (`use-latest-run` explains why it is the right one) — so none waits on a second request.
 *
 * `0259`: `webSource` is the same fetch with the body's text and a key kept beside the runs, for
 * the builds that run in a worker (`off-thread.ts`); `webRuns` is its runs, the same array each time.
 */
let cached: { generation: number | null; source: Promise<WebSource>; runs: Promise<WebRunInput[]> } | null = null
let nextKey = 1

function entry(generation: number | null, fetchImpl?: typeof globalThis.fetch) {
  if (cached?.generation !== generation) {
    const key = nextKey++
    const source = fetchTraceWebBody(fetchImpl).then((body): WebSource => ({ key, ...body }))
    const runs = source.then((s) => s.runs)
    // Handled here so a reader of only one of the two is not an unhandled rejection on the other.
    runs.catch(() => {})
    cached = { generation, source, runs }
    // A failed fetch must not be cached: the next asker tries again.
    source.catch(() => {
      if (cached?.source === source) cached = null
    })
  }
  return cached
}

export function webRuns(generation: number | null, fetchImpl?: typeof globalThis.fetch): Promise<WebRunInput[]> {
  return entry(generation, fetchImpl).runs
}

export function webSource(generation: number | null, fetchImpl?: typeof globalThis.fetch): Promise<WebSource> {
  return entry(generation, fetchImpl).source
}

/** Tests only. */
export function resetWebRuns(): void {
  cached = null
}
