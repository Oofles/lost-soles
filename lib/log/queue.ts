/**
 * THE `/log` WRITE QUEUE. Ticket 0068 criterion 6, 0071's undo, D-281, D-282.
 *
 * `06-ui-ux.md` §6.4: *"The write lands in IndexedDB before the animation starts, is rendered
 * optimistically, and flushes to the API on a background-sync queue with an idempotency key. A
 * failed flush retries silently and is never surfaced as an error on this page."*
 *
 * ─── HELD, THEN FLUSHED ─────────────────────────────────────────────────────
 *
 * Every entry is written with `holdUntil`, the end of its 8-second undo window, and the flusher
 * will not touch it before then. That is the whole of how undo works, and it is the only way it
 * CAN work: once `logWorkout` runs the XP is in the ledger, and the ledger only adds (D-135). So
 * undo never compensates — it deletes an entry that has not left the browser (D-282). A tab
 * closed inside the window leaves the entry here, and it flushes on the next app open.
 *
 * ─── RETRIES ────────────────────────────────────────────────────────────────
 *
 * Re-sending is safe by construction: the server keys the receipt on `idempotencyKey`, and a
 * re-delivery returns the original award with `logged: false` (0069). So anything that is not a
 * refusal retries, with backoff, forever, and silently. A REFUSAL (`REFUSED:<code>:` — the client
 * sent something the server will never accept, like an exercise a newer ruleset dropped) is
 * removed instead: retrying it would retry forever and change nothing.
 *
 * There is no Service Worker, so no Background Sync API (D-282). "Background" here means the
 * `LogQueueRunner` mounted in the root layout, which runs on every route, not only `/log`.
 */

import type { Award } from "@/lib/log/optimistic"
import type { WorkoutEntry } from "@/lib/log/workout-entry"

/** `06` §6.4: undo, 8 seconds, in-row. */
export const UNDO_WINDOW_MS = 8_000

/** Retry backoff: 1 s doubling, capped at five minutes. */
const BACKOFF_BASE_MS = 1_000
const BACKOFF_CAP_MS = 5 * 60_000

export interface QueuedLog {
  idempotencyKey: string
  uid: string
  entry: WorkoutEntry
  /** The optimistic award, so a second log before this one flushes stacks on top of it. */
  award: Award
  /** `Date.now()` at which the undo window closes. Nothing flushes before it. */
  holdUntil: number
  attempts: number
  /** `Date.now()` before which a failed entry is not retried. */
  nextAttemptAt: number
}

export interface LogStore {
  put(log: QueuedLog): Promise<void>
  get(idempotencyKey: string): Promise<QueuedLog | undefined>
  /** True if there was an entry to delete. */
  remove(idempotencyKey: string): Promise<boolean>
  /** This user's entries, oldest click first. */
  pending(uid: string): Promise<QueuedLog[]>
  getKv<T>(key: string): Promise<T | undefined>
  setKv(key: string, value: unknown): Promise<void>
}

/** The server refused the entry. Not retried. */
export class LogRefusedError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = "LogRefusedError"
  }
}

export type SendLog = (entry: WorkoutEntry) => Promise<{ logged: boolean; xpAwarded: number }>

/** A new entry, held for its undo window. */
export function queuedLog(uid: string, entry: WorkoutEntry, award: Award, now: number): QueuedLog {
  return {
    idempotencyKey: entry.idempotencyKey,
    uid,
    entry,
    award,
    holdUntil: now + UNDO_WINDOW_MS,
    attempts: 0,
    nextAttemptAt: now + UNDO_WINDOW_MS,
  }
}

/**
 * Undo. Deletes the entry if its window is still open. Returns false if it has closed — the entry
 * may already be in flight, and from then on it is a log (D-135).
 */
export async function undoLog(store: LogStore, idempotencyKey: string, now: number): Promise<boolean> {
  const log = await store.get(idempotencyKey)
  if (!log || now >= log.holdUntil) return false
  return store.remove(idempotencyKey)
}

export interface FlushReport {
  sent: number
  dropped: number
  retrying: number
}

/**
 * Send every entry whose window has closed and whose backoff has elapsed. One at a time, oldest
 * first: there are seldom more than one or two, and serial sends keep the ledger's order the
 * click order.
 */
export async function flushDue(
  store: LogStore,
  uid: string,
  send: SendLog,
  now: number,
  /** The browser just came back online: the backoff was waiting for exactly this. */
  opts: { ignoreBackoff?: boolean } = {},
): Promise<FlushReport> {
  const report: FlushReport = { sent: 0, dropped: 0, retrying: 0 }
  for (const log of await store.pending(uid)) {
    if (now < log.holdUntil) continue
    if (now < log.nextAttemptAt && !opts.ignoreBackoff) continue
    // Re-read: an undo may have landed between `pending` and here.
    if (!(await store.get(log.idempotencyKey))) continue
    try {
      await send(log.entry)
      await store.remove(log.idempotencyKey)
      report.sent++
    } catch (e) {
      if (e instanceof LogRefusedError) {
        await store.remove(log.idempotencyKey)
        report.dropped++
        console.warn(`/log: the server refused ${log.idempotencyKey} (${e.code}); dropped`, e.message)
        continue
      }
      const attempts = log.attempts + 1
      await store.put({
        ...log,
        attempts,
        nextAttemptAt: now + Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** (attempts - 1)),
      })
      report.retrying++
    }
  }
  return report
}

// ─── IndexedDB ────────────────────────────────────────────────────────────────

const DB_NAME = "lost-soles-log"
const DB_VERSION = 1
const QUEUE = "queue"
const KV = "kv"

const promised = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"))
  })

/**
 * @param factory  injected so tests can hand in `fake-indexeddb`. `null` means there is none
 *                 (SSR, a locked-down private window) and returns `null`; `undefined` finds the
 *                 ambient one — the same convention as `lib/fog/explored-cache.ts`.
 */
export function indexedDbLogStore(
  factory: IDBFactory | null | undefined = typeof indexedDB === "undefined" ? null : indexedDB,
): LogStore | null {
  if (!factory) return null

  let opening: Promise<IDBDatabase> | undefined
  function open(): Promise<IDBDatabase> {
    opening ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory!.open(DB_NAME, DB_VERSION)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(QUEUE)) db.createObjectStore(QUEUE, { keyPath: "idempotencyKey" })
        if (!db.objectStoreNames.contains(KV)) db.createObjectStore(KV)
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"))
      request.onblocked = () => reject(new Error("IndexedDB upgrade blocked by another tab"))
    })
    return opening
  }

  async function store(name: string, mode: IDBTransactionMode): Promise<IDBObjectStore> {
    return (await open()).transaction(name, mode).objectStore(name)
  }

  return {
    async put(log) {
      await promised((await store(QUEUE, "readwrite")).put(log))
    },
    async get(key) {
      return (await promised((await store(QUEUE, "readonly")).get(key))) as QueuedLog | undefined
    },
    async remove(key) {
      const s = await store(QUEUE, "readwrite")
      const existing = await promised(s.getKey(key))
      if (existing === undefined) return false
      await promised(s.delete(key))
      return true
    },
    async pending(uid) {
      const all = (await promised((await store(QUEUE, "readonly")).getAll())) as QueuedLog[]
      return all.filter((l) => l.uid === uid).sort((a, b) => a.holdUntil - b.holdUntil)
    },
    async getKv<T>(key: string) {
      return (await promised((await store(KV, "readonly")).get(key))) as T | undefined
    },
    async setKv(key, value) {
      await promised((await store(KV, "readwrite")).put(value, key))
    },
  }
}

/**
 * The same interface in memory: for a context with no IndexedDB (a locked-down private window).
 * Logs still work and still undo; they just do not survive the tab.
 */
export function memoryLogStore(): LogStore {
  const queue = new Map<string, QueuedLog>()
  const kv = new Map<string, unknown>()
  return {
    async put(log) {
      queue.set(log.idempotencyKey, structuredClone(log))
    },
    async get(key) {
      const log = queue.get(key)
      return log && structuredClone(log)
    },
    async remove(key) {
      return queue.delete(key)
    },
    async pending(uid) {
      return [...queue.values()].filter((l) => l.uid === uid).sort((a, b) => a.holdUntil - b.holdUntil)
    },
    async getKv<T>(key: string) {
      return kv.get(key) as T | undefined
    },
    async setKv(key, value) {
      kv.set(key, value)
    },
  }
}

let shared: LogStore | undefined

/**
 * THE store, one per tab: the page writes to it and `LogQueueRunner` flushes from it, so the two
 * must be the same object when the fallback is in memory.
 */
export function logStore(): LogStore {
  shared ??= indexedDbLogStore() ?? memoryLogStore()
  return shared
}

/** The kv key for a row's last logged value (0071: per type, persisted locally). */
export const lastValueKey = (uid: string, exerciseId: string) => `last:${uid}:${exerciseId}`
/** The kv key for the cached `SkillState` rows the optimistic result reads. */
export const skillsKey = (uid: string) => `skills:${uid}`
