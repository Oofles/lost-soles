/**
 * THE WARM START. Ticket `0054`, criteria 3 and 4. `05-fog-of-war.md` §7.3;
 * `02-data-model.md` §6.4 step 1.
 *
 * *"Client cache: IndexedDB, keyed `{uid, generation}`, storing the decoded
 * `BigUint64Array` (not the encoded bytes — skip re-parsing on warm start). Keep the
 * current generation and one previous; evict the rest."*
 *
 * ─── WHY THE DECODED ARRAY AND NOT THE BYTES ────────────────────────────────
 *
 * The bytes are ~370 KB and the array is 1.2 MB, so this trades disk for time — and the
 * time is the thing that is actually scarce. `02` §6.3 prices a cold decode at ~50 ms on
 * a mid-range Android (D-124); a warm start that re-parsed would pay it on every single
 * app open, to save storage that a phone has in gigabytes.
 *
 * ─── WHY RENDERING FROM THIS BEFORE THE NETWORK IS SAFE ─────────────────────
 *
 * `02` §6.4: *"stale is always safe, and that is a structural property, not luck."* The
 * set is append-only (D-020), so a stale cache can only ever be MISSING THE NEWEST RUN —
 * never wrong about ground it already shows. That is what licenses step 1's
 * render-before-network, and a design where territory could be removed could not do it.
 *
 * ─── TWO GENERATIONS, NOT ONE ───────────────────────────────────────────────
 *
 * The previous generation is kept because a write is not atomic with the render that
 * depends on it: a tab that persists generation 43 and is killed mid-write leaves 42 as
 * the thing that still opens instantly. Three would buy nothing — anything older takes
 * the delta chain or the full blob anyway.
 */

/** `02` §6.4: *"keep the current generation and one previous; evict the rest."* */
export const KEEP_GENERATIONS = 2

const DB_NAME = "lost-soles-fog"
const DB_VERSION = 1
const STORE = "explored"

export interface CachedExplored {
  uid: string
  generation: number
  /** The DECODED set, ascending. See the header. */
  cells: BigUint64Array
  /** `Date.now()` at write. Diagnostics only — ordering is by generation (I-11). */
  savedAt: number
}

export interface ExploredCache {
  /** The newest generation held for this user, or `undefined` on a cold start. */
  readLatest(uid: string): Promise<CachedExplored | undefined>
  /** Writes and then evicts down to `KEEP_GENERATIONS`. */
  write(uid: string, generation: number, cells: BigUint64Array): Promise<void>
  /** Drops everything for this user. The version-skew remedy (`02` §6.4). */
  discard(uid: string): Promise<void>
}

const promised = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"))
  })

/**
 * Every record for one user, oldest first.
 *
 * The key is the compound `[uid, generation]`, so a bound range over `[uid]` to
 * `[uid, []]` is exactly this user's rows and nobody else's. The upper bound is an EMPTY
 * ARRAY rather than a large number because IndexedDB's key ordering puts every array
 * after every number — so it is an exact fence, where `Number.MAX_SAFE_INTEGER` would be
 * a guess that a large enough generation could one day walk past.
 */
const rangeFor = (uid: string): IDBKeyRange => IDBKeyRange.bound([uid], [uid, []])

/**
 * @param factory  injected so the tests can hand in `fake-indexeddb`, and so that a
 *                 context with no IndexedDB at all — SSR, a locked-down private window —
 *                 is answered with `null` rather than a throw at import time.
 *
 *                 `null` means *"there is none"* and `undefined` means *"find the ambient
 *                 one"*. They are distinct because a default parameter fires on an
 *                 explicit `undefined` too, so without the distinction a caller could not
 *                 say "no cache" at all — which is precisely what a test of the
 *                 no-IndexedDB path has to say.
 */
export function indexedDbCache(
  factory: IDBFactory | null | undefined = typeof indexedDB === "undefined" ? null : indexedDB,
): ExploredCache | null {
  if (!factory) return null

  let opening: Promise<IDBDatabase> | undefined

  function open(): Promise<IDBDatabase> {
    opening ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory!.open(DB_NAME, DB_VERSION)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: ["uid", "generation"] })
        }
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"))
      /**
       * A blocked upgrade means another tab holds the old version open. Resolving it is
       * not this module's business — the caller's answer to a cache that will not open is
       * the same as its answer to a cold start, which is to fetch the full blob.
       */
      request.onblocked = () => reject(new Error("IndexedDB upgrade blocked by another tab"))
    })
    return opening
  }

  async function tx(mode: IDBTransactionMode): Promise<IDBObjectStore> {
    const db = await open()
    return db.transaction(STORE, mode).objectStore(STORE)
  }

  return {
    async readLatest(uid) {
      const store = await tx("readonly")
      const cursor = await promised(store.openCursor(rangeFor(uid), "prev"))
      return (cursor?.value as CachedExplored | undefined) ?? undefined
    },

    async write(uid, generation, cells) {
      const store = await tx("readwrite")
      await promised(store.put({ uid, generation, cells, savedAt: Date.now() }))

      /**
       * EVICTION IN THE SAME TRANSACTION AS THE WRITE. Doing it in a second transaction
       * would leave a window in which the store holds three generations, and a tab killed
       * inside that window never comes back to finish the job — the store would grow by
       * 1.2 MB per run forever, which is the failure this criterion exists to prevent.
       */
      let seen = 0
      await new Promise<void>((resolve, reject) => {
        const request = store.openCursor(rangeFor(uid), "prev")
        request.onsuccess = () => {
          const cursor = request.result
          if (!cursor) return resolve()
          seen++
          if (seen > KEEP_GENERATIONS) cursor.delete()
          cursor.continue()
        }
        request.onerror = () => reject(request.error ?? new Error("IndexedDB evict failed"))
      })
    },

    async discard(uid) {
      const store = await tx("readwrite")
      await promised(store.delete(rangeFor(uid)))
    },
  }
}
