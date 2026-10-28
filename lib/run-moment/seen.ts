/**
 * THE `seen` FLAG. Ticket `0084`. `06-ui-ux.md` §3.4.
 *
 * A run is `seen` the first time its sequence completes OR IS SKIPPED. The flag is LOCAL AND
 * PER-DEVICE, and it never affects scoring — D-135's spirit: display state is not truth. Clearing app
 * data loses it, and that is acceptable, because losing it costs an offer to replay, not data.
 *
 * Nothing here is read by `src/`, the pipeline or the server, and `seen.test.ts` holds that by grep.
 * Its reader is the plinth's new-run line (capability 13); WHETHER `/run/:id` plays is the entry
 * point's intent alone (`0078`), never this flag.
 *
 * ─── ITS OWN DATABASE, BESIDE THE FOG CACHE ─────────────────────────────────
 *
 * The flag lives in IndexedDB alongside the cached explored blob (`explored-r11.<gen>.bin`, D-237;
 * this comment once said `explored-r10.bin`). Alongside, not inside: `lost-soles-fog` is
 * versioned by `lib/fog/explored-cache.ts`, and adding a store there means a version bump that a tab
 * holding the old version open BLOCKS — the fog cache would fall back to a cold start to make room for
 * a display flag. A second database on the same origin is cleared by the same "clear site data".
 */

const DB_NAME = "lost-soles-seen"
const DB_VERSION = 1
const STORE = "seen"

export interface SeenStore {
  isSeen(activityId: string): Promise<boolean>
  /** Idempotent: a Relive marks an already-seen run again, harmlessly. */
  markSeen(activityId: string): Promise<void>
}

const promised = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"))
  })

/**
 * @param factory  injected for `fake-indexeddb`; `null` (SSR, a locked-down private window) means
 *                 there is no store, and the caller carries on without one — `explored-cache.ts`'s
 *                 convention, and its reason for distinguishing `null` from `undefined`.
 */
export function indexedDbSeen(
  factory: IDBFactory | null | undefined = typeof indexedDB === "undefined" ? null : indexedDB,
): SeenStore | null {
  if (!factory) return null

  let opening: Promise<IDBDatabase> | undefined
  const open = () =>
    (opening ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(DB_NAME, DB_VERSION)
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) {
          request.result.createObjectStore(STORE, { keyPath: "activityId" })
        }
      }
      request.onsuccess = () => {
        const db = request.result
        // Let a delete (clearing site data, another tab's upgrade) through rather than block it; the
        // next call reopens.
        db.onversionchange = () => {
          db.close()
          opening = undefined
        }
        resolve(db)
      }
      request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"))
      request.onblocked = () => reject(new Error("IndexedDB upgrade blocked by another tab"))
    }))
  const store = async (mode: IDBTransactionMode) => (await open()).transaction(STORE, mode).objectStore(STORE)

  return {
    async isSeen(activityId) {
      return (await promised((await store("readonly")).get(activityId))) !== undefined
    },
    async markSeen(activityId) {
      await promised((await store("readwrite")).put({ activityId, seenAt: Date.now() }))
    },
  }
}

let ambient: SeenStore | null | undefined

/** The browser's store, opened once. A failure to write is swallowed: it costs a replay offer. */
export function markSeen(activityId: string): void {
  ambient ??= indexedDbSeen()
  void ambient?.markSeen(activityId).catch(() => {})
}

/** For the plinth (capability 13). `false` when there is no store: an unseen run offers a replay. */
export async function isSeen(activityId: string): Promise<boolean> {
  ambient ??= indexedDbSeen()
  try {
    return (await ambient?.isSeen(activityId)) ?? false
  } catch {
    return false
  }
}
