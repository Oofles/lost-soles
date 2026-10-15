/**
 * THE LAST RUN, CACHE FIRST. Ticket `0087`, `06-ui-ux.md` §2.4 ("cached totals immediately").
 *
 * `/api/runs/latest` is still the ONE source (D-316): the plinth's last-run line, the first camera
 * and `⌖` all read what `useLatestRun` hands up. What changes is that its last answer is kept in
 * IndexedDB (operator, 2026-10-15), so a cold start or an offline open paints the line with Total
 * Level and cells, and the network reconciles after. `loadStanding` (`load.ts`) is the pattern, over
 * the same `LogStore` key-value store, in the same order:
 *
 * 1. **Cache first.** Emitted as soon as IndexedDB answers — before any request is made.
 * 2. **Then the network**, written back before it is shown. The empty collection is written too:
 *    it is a real answer ("no traced run"), and a stale run would otherwise outlive a delete.
 * 3. **A failure is silent** to the screen (D-013). The cache stands; `onError` is for the log.
 *
 * The cache holds a precise record of where one person ran, in the same origin's IndexedDB that
 * already holds their whole explored set (`lost-soles-fog`). It is not a new kind of exposure.
 */

import type { LogStore } from "@/lib/log/queue"
import type { RunFeatureCollection } from "@/lib/runs/wire"

/** Beside `skills:<uid>` in the same store. Per account, so a second sign-in never reads the first's run. */
export const latestRunKey = (uid: string) => `latest-run:${uid}`

export interface LatestRunDeps {
  currentUid(): Promise<string | undefined>
  store: Pick<LogStore, "getKv" | "setKv"> | null
  fetchLatest(): Promise<RunFeatureCollection>
  onError?(error: unknown): void
}

/**
 * Starts loading. `emit` is called with the cached collection (when `fromCache` and there is one)
 * and again when the network answers. Returns `stop`.
 *
 * @param fromCache  `false` on a refetch (a generation change): what is on screen is already newer
 *                   than the cache, and re-emitting the cache would step the line backwards.
 */
export function loadLatestRun(
  deps: LatestRunDeps,
  emit: (runs: RunFeatureCollection) => void,
  fromCache = true,
): () => void {
  let live = true

  void (async () => {
    let uid: string | undefined
    try {
      uid = await deps.currentUid()
    } catch {
      uid = undefined
    }
    if (!live) return

    if (fromCache && uid && deps.store) {
      try {
        const cached = await deps.store.getKv<RunFeatureCollection>(latestRunKey(uid))
        if (live && cached && Array.isArray(cached.features)) emit(cached)
      } catch {
        // A cache that will not read is a cold start, nothing more.
      }
    }
    if (!live) return

    try {
      const fresh = await deps.fetchLatest()
      if (uid && deps.store) await deps.store.setKv(latestRunKey(uid), fresh).catch(() => {})
      if (live) emit(fresh)
    } catch (error) {
      deps.onError?.(error)
    }
  })()

  return () => {
    live = false
  }
}
