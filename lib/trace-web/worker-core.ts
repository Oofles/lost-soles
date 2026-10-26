import { webRunsFromBody } from "./body"
import { packWeb, transferablesOf, type PackedWeb } from "./pack"
import { buildWeb, type WebRunInput } from "./web"

/**
 * THE WORKER'S WHOLE JOB, WITHOUT THE WORKER. Ticket `0259`.
 *
 * `web.worker.ts` is three lines around this, so a test can drive the real message handling in
 * node. One request is one `buildWeb` — with every run, or `exclude`-ing the one beat 1 plays —
 * over the body text the main thread already fetched (`lib/trace-web/runs.ts`). The text is parsed
 * here, once per `key`: beat 1 asks twice of the same body (with and without), and the second ask
 * must not pay the parse again.
 */
export interface BuildRequest {
  id: number
  /** One per fetched body. A new key is a new body. */
  key: number
  text: string
  exclude?: string
}

export type BuildResponse = { id: number; ok: true; web: PackedWeb } | { id: number; ok: false; error: string }

export function workerCore(): (req: BuildRequest) => { response: BuildResponse; transfer: ArrayBuffer[] } {
  let cached: { key: number; runs: WebRunInput[] } | null = null
  return (req) => {
    try {
      if (cached?.key !== req.key) cached = { key: req.key, runs: webRunsFromBody(req.text) }
      const web = packWeb(buildWeb(cached.runs, req.exclude === undefined ? {} : { exclude: req.exclude }))
      return { response: { id: req.id, ok: true, web }, transfer: transferablesOf(web) }
    } catch (error) {
      return { response: { id: req.id, ok: false, error: String(error) }, transfer: [] }
    }
  }
}
