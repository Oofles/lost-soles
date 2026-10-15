/**
 * THE BROWSER HALF OF `/api/runs/chronicle`. Ticket `0088`.
 *
 * Must never import `lib/runs/server.ts` (it builds AWS clients at module scope) — the shape is in
 * `wire.ts`, as `lib/runs/client.ts` explains.
 */

import { CHRONICLE_AFTER_PARAM, RUNS_CHRONICLE_PATH, type ChroniclePage } from "@/lib/runs/wire"

type Fetch = typeof globalThis.fetch

/** The page after `after`. Throws on any non-2xx: a failed page is retried on the next scroll, never shown as an error. */
export async function fetchChroniclePage(after: string, fetchImpl: Fetch = globalThis.fetch): Promise<ChroniclePage> {
  const url = `${RUNS_CHRONICLE_PATH}?${CHRONICLE_AFTER_PARAM}=${encodeURIComponent(after)}`
  const response = await fetchImpl(url, { credentials: "same-origin", cache: "no-store" })
  if (!response.ok) throw new Error(`GET ${RUNS_CHRONICLE_PATH} returned ${response.status}`)
  const body = (await response.json()) as Partial<ChroniclePage>
  return {
    items: Array.isArray(body.items) ? body.items : [],
    next: typeof body.next === "string" ? body.next : null,
  }
}
