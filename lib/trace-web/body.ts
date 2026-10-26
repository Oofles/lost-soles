import type { WebRunInput } from "./web"

/**
 * `GET /api/runs/web`'s body, `{ runs: WebRunInput[] }`, from its text. Ticket `0259`.
 *
 * One reader for both halves: the main thread parses it for the run index and the region list, and
 * the worker (`web.worker.ts`) parses the same text for the build. Anything that is not an array of
 * runs is no runs, as `fetchTraceWebRuns` has always read it.
 */
export function webRunsFromBody(text: string): WebRunInput[] {
  const body = JSON.parse(text) as { runs?: unknown } | null
  return Array.isArray(body?.runs) ? (body.runs as WebRunInput[]) : []
}
