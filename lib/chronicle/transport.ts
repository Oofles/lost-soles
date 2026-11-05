/**
 * THE BROWSER HALF OF `/api/runs/chronicle` (ticket `0088`) and `/api/runs/workouts` (`0345`).
 *
 * Must never import `lib/runs/server.ts` (it builds AWS clients at module scope) — the shape is in
 * `wire.ts`, as `lib/runs/client.ts` explains.
 */

import { withApiTimeout } from "@/lib/http/timeout"
import { CHRONICLE_AFTER_PARAM, RUNS_CHRONICLE_PATH, RUNS_WORKOUTS_PATH, type ChroniclePage } from "@/lib/runs/wire"

type Fetch = typeof globalThis.fetch

/** The page after `after`. Throws on any non-2xx: a failed page is retried on the next scroll, never shown as an error. */
export function fetchChroniclePage(after: string, fetchImpl: Fetch = globalThis.fetch): Promise<ChroniclePage> {
  return withApiTimeout(`GET ${RUNS_CHRONICLE_PATH}`, (signal) => historyPage(RUNS_CHRONICLE_PATH, after, fetchImpl, signal))
}

/** `0345`. The workout history's page after `after`, on the same terms. */
export function fetchWorkoutsPage(after: string, fetchImpl: Fetch = globalThis.fetch): Promise<ChroniclePage> {
  return withApiTimeout(`GET ${RUNS_WORKOUTS_PATH}`, (signal) => historyPage(RUNS_WORKOUTS_PATH, after, fetchImpl, signal))
}

async function historyPage(path: string, after: string, fetchImpl: Fetch, signal: AbortSignal): Promise<ChroniclePage> {
  const url = `${path}?${CHRONICLE_AFTER_PARAM}=${encodeURIComponent(after)}`
  const response = await fetchImpl(url, { credentials: "same-origin", cache: "no-store", signal })
  if (!response.ok) throw new Error(`GET ${path} returned ${response.status}`)
  const body = (await response.json()) as Partial<ChroniclePage>
  return {
    items: Array.isArray(body.items) ? body.items : [],
    next: typeof body.next === "string" ? body.next : null,
  }
}
