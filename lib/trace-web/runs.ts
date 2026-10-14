import { fetchTraceWebRuns } from "@/lib/runs/client"

import type { WebRunInput } from "./web"

/**
 * ONE FETCH OF THE WEB PER GENERATION, shared. Ticket `0085`.
 *
 * Two readers want the same body at the same moment: the map's steady-state layer
 * (`use-trace-web`) and beat 1, which builds the web as it was before this run. One promise per
 * explored generation — the app's existing "the map changed" signal (`use-latest-run` explains
 * why it is the right one) — so neither waits on a second request.
 */
let cached: { generation: number | null; runs: Promise<WebRunInput[]> } | null = null

export function webRuns(generation: number | null, fetchImpl?: typeof globalThis.fetch): Promise<WebRunInput[]> {
  if (cached?.generation !== generation) {
    const runs = fetchTraceWebRuns(fetchImpl)
    cached = { generation, runs }
    // A failed fetch must not be cached: the next asker tries again.
    runs.catch(() => {
      if (cached?.runs === runs) cached = null
    })
  }
  return cached.runs
}

/** Tests only. */
export function resetWebRuns(): void {
  cached = null
}
