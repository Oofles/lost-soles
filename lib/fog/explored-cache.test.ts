import "fake-indexeddb/auto"

import { IDBFactory } from "fake-indexeddb"
import { beforeEach, describe, expect, it } from "vitest"

import { indexedDbCache, KEEP_GENERATIONS, type ExploredCache } from "./explored-cache"

/**
 * Ticket `0054`, criteria 3 and 4. `05-fog-of-war.md` §7.3; `02-data-model.md` §6.4.
 *
 * RUN AGAINST A REAL INDEXEDDB IMPLEMENTATION, not a hand-written stub. The behaviour
 * this module depends on is IndexedDB's own — compound keys, key ordering across types
 * (the `[uid, []]` upper bound), cursor deletion inside a live transaction — and a fake
 * built to satisfy this module would agree with it by construction and prove nothing.
 * `fake-indexeddb` is the spec-conformant implementation; a fresh `IDBFactory` per test
 * is a fresh browser profile.
 */

const cells = (n: number, from = 1n): BigUint64Array =>
  BigUint64Array.from({ length: n }, (_, i) => from + BigInt(i))

let cache: ExploredCache
let factory: IDBFactory

beforeEach(() => {
  factory = new IDBFactory()
  const made = indexedDbCache(factory)
  expect(made).not.toBeNull()
  cache = made!
})

/**
 * The generations actually on disk for one user, newest first. Read through the raw store
 * rather than through `readLatest`, because "how many records exist" is exactly what the
 * public surface hides and exactly what criterion 4 is about.
 */
async function storedGenerations(uid: string): Promise<number[]> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open("lost-soles-fog")
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  try {
    const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
      const request = db.transaction("explored").objectStore("explored").getAllKeys()
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    return keys
      .filter((key) => (key as [string, number])[0] === uid)
      .map((key) => (key as [string, number])[1])
      .sort((a, b) => b - a)
  } finally {
    db.close()
  }
}

describe("the warm-start cache", () => {
  it("is null where IndexedDB does not exist, rather than throwing at import", () => {
    // A locked-down private window, or any server render. The caller's answer is a cold
    // boot, which is slower and never wrong.
    expect(indexedDbCache(null)).toBeNull()
  })

  it("reads back nothing on a cold start", async () => {
    expect(await cache.readLatest("user-a")).toBeUndefined()
  })

  /**
   * CRITERION 3, the storage half: the DECODED array, not the encoded bytes. `02` §6.3
   * prices a cold decode at ~50 ms on a mid-range Android (D-124), and a cache that
   * stored bytes would pay it on every single app open to save storage a phone has in
   * gigabytes.
   */
  it("stores the decoded array and returns it as a BigUint64Array", async () => {
    const written = cells(2_000, 600_000_000_000_000_000n)
    await cache.write("user-a", 41, written)

    const read = await cache.readLatest("user-a")
    expect(read?.generation).toBe(41)
    expect(read?.cells).toBeInstanceOf(BigUint64Array)
    expect(read?.cells.length).toBe(written.length)
    expect(read?.cells[0]).toBe(written[0])
    expect(read?.cells[written.length - 1]).toBe(written[written.length - 1])
  })

  it("returns the newest generation, not the most recently written", async () => {
    await cache.write("user-a", 43, cells(3))
    // A generation written out of order — a late idle callback from a tab that was
    // already behind. Ordering is by generation (I-11), never by write time.
    await cache.write("user-a", 42, cells(2))

    expect((await cache.readLatest("user-a"))?.generation).toBe(43)
  })

  /** CRITERION 4. *"Keep the current generation and one previous; evict the rest."* */
  it("keeps the current generation and one previous, and evicts the rest", async () => {
    for (const generation of [40, 41, 42, 43]) {
      await cache.write("user-a", generation, cells(generation))
    }

    expect(KEEP_GENERATIONS).toBe(2)
    expect((await cache.readLatest("user-a"))?.generation).toBe(43)
    // The survivors are the newest two. 40 and 41 are gone, not merely unreachable.
    expect(await storedGenerations("user-a")).toEqual([43, 42])
  })

  it("does not grow without bound — twenty writes leave two records", async () => {
    for (let generation = 1; generation <= 20; generation++) {
      await cache.write("user-a", generation, cells(10))
    }
    expect(await storedGenerations("user-a")).toEqual([20, 19])
  })

  it("keeps one user's generations out of another's eviction window", async () => {
    await cache.write("user-a", 10, cells(1))
    await cache.write("user-b", 20, cells(2))
    await cache.write("user-b", 21, cells(3))
    await cache.write("user-b", 22, cells(4))

    // user-b wrote three times; user-a's single record must survive it. The eviction
    // range is keyed on the uid, so this is what proves the bound is a fence and not a
    // count over the whole store.
    expect(await storedGenerations("user-a")).toEqual([10])
    expect(await storedGenerations("user-b")).toEqual([22, 21])
  })

  /** The version-skew remedy (`02` §6.4): discard the cache, refuse to render. */
  it("discards everything for one user and leaves the other alone", async () => {
    await cache.write("user-a", 41, cells(5))
    await cache.write("user-b", 41, cells(5))

    await cache.discard("user-a")

    expect(await storedGenerations("user-a")).toEqual([])
    expect(await cache.readLatest("user-a")).toBeUndefined()
    expect((await cache.readLatest("user-b"))?.generation).toBe(41)
  })
})
