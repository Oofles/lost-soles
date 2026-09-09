import "fake-indexeddb/auto"

import { IDBFactory } from "fake-indexeddb"
import { gridDisk, latLngToCell } from "h3-js"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  BLOB_VERSION,
  bigToCell,
  cellToBig,
  encodeDeltaBlob,
  encodeExploredBlob,
} from "@/src/domain/explored-blob"
import { parentOf, RES } from "@/src/domain/fog"

import { startFogSession, type FogState } from "./boot"
import { decodeStats, resetDecodeStats } from "./decode"
import { indexedDbCache, type ExploredCache } from "./explored-cache"
import type { BucketInvalidator } from "./explored-set"
import type { FogTransport } from "./transport"
import type { FogUpdate, FogUpdateResponse } from "./wire"

/**
 * THE BOOT SEQUENCE. Ticket `0054`, criteria 3, 5, 6, 7 and 8.
 * `02-data-model.md` §6.4 states it as five numbered obligations and this file is those
 * five, one describe block each.
 *
 * SYNTHETIC GEOGRAPHY, POINT NEMO (08 §7.2, D-199).
 */
const ORIGIN = latLngToCell(-48.876, -123.393, RES)
const UID = "user-under-test"

const sortBig = (cells: readonly string[]): bigint[] =>
  cells.map(cellToBig).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))

const BASE = sortBig(gridDisk(ORIGIN, 3))
const HOME_PARENT = parentOf(ORIGIN)
/**
 * A cell in a DIFFERENT res-6 parent, chosen so its whole 2-ring is in that parent too.
 *
 * Criterion 9's premise is that a run touches 1-2 parents, and the first cell whose parent
 * differs sits exactly ON the boundary — a ring around it straddles two parents and the
 * test would then be asserting the opposite of what it means to. Picking an interior cell
 * makes "only the touched parents" a sharp claim rather than an accident of geometry.
 */
const FAR = gridDisk(ORIGIN, 60).find((c) => {
  const parent = parentOf(c)
  return parent !== HOME_PARENT && gridDisk(c, 2).every((n) => parentOf(n) === parent)
})!

const base64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64")

const update = (over: Partial<FogUpdate> = {}): FogUpdate => ({
  generation: 42,
  res: RES,
  cellCount: BASE.length,
  deltasFrom: 22,
  plan: "full",
  ...over,
})

/**
 * Records every call, so *"fetches no `.bin`"* is assertable rather than inferred.
 *
 * The recording WRAPS the override rather than being replaced by it. Spreading the
 * override over a recording object — the obvious shape — silently discards the recorder
 * in exactly the tests that override behaviour, which is most of them, and leaves the
 * "nothing was fetched" assertions passing because nothing was counted.
 */
function fakeTransport(over: Partial<FogTransport> = {}) {
  const updates: Array<number | null> = []
  const blobs: number[] = []
  const transport: FogTransport = {
    async update(since) {
      updates.push(since)
      return over.update ? over.update(since) : { status: 200, update: update() }
    },
    async blob(generation) {
      blobs.push(generation)
      return over.blob ? over.blob(generation) : encodeExploredBlob(BASE, generation)
    },
  }
  return { transport, updates, blobs }
}

let cache: ExploredCache
let states: FogState[]

beforeEach(() => {
  resetDecodeStats()
  cache = indexedDbCache(new IDBFactory())!
  states = []
})

afterEach(() => vi.useRealTimers())

/** Persist synchronously in tests: an idle callback is a race, not a behaviour. */
const start = (transport: FogTransport, over: Partial<Parameters<typeof startFogSession>[0]> = {}) =>
  startFogSession({
    uid: UID,
    transport,
    cache,
    onChange: (state) => states.push(state),
    schedulePersist: (task) => task(),
    revalidateOnFocus: false,
    ...over,
  })

describe("step 5 — a cold start takes the full blob", () => {
  it("fetches the blob, renders it, and caches the decoded array", async () => {
    const { transport, updates, blobs } = fakeTransport()
    const session = start(transport)
    await session.ready

    expect(updates).toEqual([null])
    expect(blobs).toEqual([42])
    expect(session.state.phase).toBe("ready")
    expect(session.state.source).toBe("full")
    expect(session.state.set?.size).toBe(BASE.length)
    expect(session.state.generation).toBe(42)

    const cached = await cache.readLatest(UID)
    expect(cached?.generation).toBe(42)
    expect(cached?.cells.length).toBe(BASE.length)
  })

  it("refuses a blob whose header disagrees with the generation it was asked for", async () => {
    // The manifest names the blob, and `02` §6.4's ordering rule (blobs before manifest)
    // is what makes them agree. A disagreement is a broken invariant, not a stale read.
    const { transport } = fakeTransport({
      blob: async () => encodeExploredBlob(BASE, 41),
    })
    const session = start(transport)
    await session.ready

    expect(session.state.phase).toBe("refused")
    expect(session.state.set).toBeNull()
    expect(session.state.message).toMatch(/inconsistent/)
  })

  it("renders an empty set for a user who has ingested nothing", async () => {
    const { transport, blobs } = fakeTransport({
      update: async () => ({ status: 200, update: update({ plan: "empty", generation: 0 }) }),
    })
    const session = start(transport)
    await session.ready

    expect(session.state.phase).toBe("ready")
    expect(session.state.set?.size).toBe(0)
    // Nothing to fetch and nothing to cache — a blob for generation 0 does not exist.
    expect(blobs).toEqual([])
    expect(await cache.readLatest(UID)).toBeUndefined()
  })
})

describe("steps 1 and 3 — a warm start", () => {
  beforeEach(async () => {
    await cache.write(UID, 42, BigUint64Array.from(BASE))
    resetDecodeStats()
  })

  /**
   * CRITERIA 3 AND 6, together, because they are the same event: the common case is a
   * warm start whose manifest comes back 304, and it must parse nothing and fetch nothing.
   */
  it("parses no LEB128 and fetches no .bin when the manifest answers 304", async () => {
    const { transport, updates, blobs } = fakeTransport({
      update: async () => ({ status: 304 }),
    })
    const session = start(transport)
    await session.ready

    expect(session.state.source).toBe("cache")
    expect(session.state.set?.size).toBe(BASE.length)
    expect(session.state.generation).toBe(42)

    // The two assertions this criterion is actually about.
    expect(decodeStats.blobDecodes).toBe(0)
    expect(blobs).toEqual([])

    // And the cached generation is what was offered to the server as `since`.
    expect(updates).toEqual([42])
  })

  it("parses nothing when the server answers up-to-date without a conditional request", async () => {
    const { transport, blobs } = fakeTransport({
      update: async () => ({ status: 200, update: update({ plan: "up-to-date" }) }),
    })
    const session = start(transport)
    await session.ready

    expect(decodeStats.blobDecodes).toBe(0)
    expect(blobs).toEqual([])
    expect(session.state.phase).toBe("ready")
  })

  /**
   * CRITERION 5. *"Boot renders from cache before the manifest response arrives; a test
   * with the network delayed 2 s asserts a first paint of real territory well before
   * then."*
   *
   * Fake timers rather than a two-second wall clock: the claim is about ORDER, and a test
   * that proved it by sleeping would be both slow and weaker — it could pass on a fast
   * machine while the ordering was wrong.
   */
  it("paints real territory before a network that takes two seconds", async () => {
    vi.useFakeTimers()
    let resolveUpdate: ((response: FogUpdateResponse) => void) | undefined
    const { transport, blobs } = fakeTransport({
      update: () =>
        new Promise<FogUpdateResponse>((resolve) => {
          resolveUpdate = resolve
          setTimeout(() => resolve({ status: 304 }), 2_000)
        }),
    })

    const session = start(transport)

    // Let the cache read settle, WITHOUT advancing the clock: not one of the two seconds
    // has passed.
    await vi.advanceTimersByTimeAsync(0)

    expect(session.state.phase).toBe("ready")
    expect(session.state.source).toBe("cache")
    expect(session.state.set?.size).toBe(BASE.length)
    // Real territory, not a placeholder: a cell from the middle of the disc is present.
    expect(session.state.set?.has(bigToCell(BASE[BASE.length >> 1]!))).toBe(true)
    expect(resolveUpdate).toBeDefined()
    expect(blobs).toEqual([])

    await vi.advanceTimersByTimeAsync(2_000)
    await session.ready
    expect(session.state.source).toBe("cache")
  })

  /** Offline is not a refusal — this ticket's first operator check, in a unit test. */
  it("keeps the cached map on screen when the server cannot be reached", async () => {
    const { transport, blobs } = fakeTransport({
      update: async () => {
        throw new Error("network down")
      },
    })
    const session = start(transport)
    await session.ready

    expect(session.state.phase).toBe("ready")
    expect(session.state.set?.size).toBe(BASE.length)
    expect(session.state.message).toMatch(/offline/i)
    expect(blobs).toEqual([])
  })
})

describe("step 4 — the delta chain", () => {
  const firstAdd = sortBig([FAR])
  const secondAdd = sortBig(gridDisk(FAR, 1).filter((c) => cellToBig(c) !== cellToBig(FAR)))

  beforeEach(async () => {
    await cache.write(UID, 42, BigUint64Array.from(BASE))
    resetDecodeStats()
  })

  /** CRITERION 7, and criterion 9's wiring: only the touched parents are invalidated. */
  it("applies the chain in order and invalidates only the touched res-6 parents", async () => {
    const invalidator: BucketInvalidator = { invalidateParents: vi.fn() }
    const { transport, blobs } = fakeTransport({
      update: async () => ({
        status: 200,
        update: update({
          generation: 44,
          plan: "delta",
          deltas: [
            base64(encodeDeltaBlob(firstAdd, 42, 43)),
            base64(encodeDeltaBlob(secondAdd, 43, 44)),
          ],
        }),
      }),
    })

    const session = start(transport, { invalidators: [invalidator] })
    await session.ready

    expect(session.state.source).toBe("delta")
    expect(session.state.generation).toBe(44)
    expect(session.state.set?.size).toBe(BASE.length + firstAdd.length + secondAdd.length)
    expect(session.state.set?.has(FAR)).toBe(true)
    // No full fetch, and no LEB128 parse of a full blob — two hops and nothing else.
    expect(blobs).toEqual([])
    expect(decodeStats.blobDecodes).toBe(0)
    expect(decodeStats.deltaDecodes).toBe(2)

    // One call per hop, each naming only the parent that hop touched.
    expect(invalidator.invalidateParents).toHaveBeenCalledTimes(2)
    expect(invalidator.invalidateParents).toHaveBeenCalledWith([parentOf(FAR)])
    expect(invalidator.invalidateParents).not.toHaveBeenCalledWith(
      expect.arrayContaining([HOME_PARENT]),
    )

    // The advanced generation is what gets persisted, so the next boot asks from there.
    expect((await cache.readLatest(UID))?.generation).toBe(44)
  })

  /**
   * CRITERION 7's second half. `02` §6.5: *"assert `delta.fromGen === state.generation`
   * before applying; on mismatch, fall back to a full fetch."*
   */
  it("falls back to a full fetch when a hop's fromGen does not match", async () => {
    const { transport, blobs } = fakeTransport({
      update: async () => ({
        status: 200,
        update: update({
          generation: 43,
          plan: "delta",
          // fromGen 40, against a set at 42. The bytes are fine; they do not apply here.
          deltas: [base64(encodeDeltaBlob(firstAdd, 40, 43))],
        }),
      }),
      blob: async (generation) => encodeExploredBlob(sortBig(gridDisk(ORIGIN, 4)), generation),
    })

    const session = start(transport)
    await session.ready

    expect(blobs).toEqual([43])
    expect(session.state.source).toBe("full")
    expect(session.state.generation).toBe(43)
  })

  it("treats a delta plan with an empty chain as up to date", async () => {
    const { transport, blobs } = fakeTransport({
      update: async () => ({ status: 200, update: update({ plan: "delta", deltas: [] }) }),
    })
    const session = start(transport)
    await session.ready

    expect(session.state.phase).toBe("ready")
    expect(session.state.generation).toBe(42)
    expect(blobs).toEqual([])
  })

  it("takes the full blob when a delta plan arrives with nothing cached to apply it to", async () => {
    await cache.discard(UID)
    const { transport, blobs } = fakeTransport({
      update: async () => ({
        status: 200,
        update: update({ generation: 43, plan: "delta", deltas: [base64(encodeDeltaBlob(firstAdd, 42, 43))] }),
      }),
    })
    const session = start(transport)
    await session.ready

    expect(blobs).toEqual([43])
    expect(session.state.source).toBe("full")
  })
})

describe("version skew is a refusal, not a guess", () => {
  beforeEach(async () => {
    await cache.write(UID, 42, BigUint64Array.from(BASE))
  })

  /**
   * CRITERION 8. `02` §6.4: *"if `manifest.res !== 10` (D-115) or the blob's `version`
   * byte is unknown, the client discards its cache and refuses to render rather than
   * guessing. A silent mis-parse of cell IDs looks like territory teleporting, which is
   * indistinguishable from data loss to the user."*
   */
  it("refuses a manifest at another resolution, before fetching any payload", async () => {
    const { transport, blobs } = fakeTransport({
      update: async () => ({ status: 200, update: update({ res: 9 }) }),
    })
    const session = start(transport)
    await session.ready

    expect(session.state.phase).toBe("refused")
    expect(session.state.set).toBeNull()
    expect(session.state.message).toMatch(/resolution 9/)
    // Refused BEFORE the payload — the point of `res` being in the manifest at all.
    expect(blobs).toEqual([])
    // The cache is discarded, so a reload cannot quietly show the old map either.
    expect(await cache.readLatest(UID)).toBeUndefined()
  })

  it("refuses a blob whose version byte it does not know, and clears the cache", async () => {
    const { transport } = fakeTransport({
      blob: async (generation) => {
        const bytes = encodeExploredBlob(BASE, generation)
        bytes[4] = BLOB_VERSION + 1
        return bytes
      },
    })
    const session = start(transport)
    await session.ready

    expect(session.state.phase).toBe("refused")
    expect(session.state.set).toBeNull()
    expect(session.state.message).toMatch(/does not understand/)
    expect(await cache.readLatest(UID)).toBeUndefined()
  })
})

describe("revalidation triggers (05 §7.4)", () => {
  /**
   * Trigger 2 — *"revalidate `manifest.json` on `visibilitychange` → visible and on
   * `window.focus`"*. Trigger 1 is the AppSync subscription (capability `14`), trigger 3
   * is the Sync button. **Never a timer**: that is the upkeep D-013 rejects, and the test
   * for it is that no timer is created.
   */
  it("revalidates on visibilitychange and focus, and never on a timer", async () => {
    vi.useFakeTimers()
    const listeners: Record<string, Array<() => void>> = {}
    const target = {
      addEventListener: (type: string, fn: () => void) => (listeners[type] ??= []).push(fn),
      removeEventListener: (type: string, fn: () => void) => {
        listeners[type] = (listeners[type] ?? []).filter((l) => l !== fn)
      },
      visibilityState: "visible",
    }
    vi.stubGlobal("document", target)
    vi.stubGlobal("window", target)

    try {
      const { transport, updates } = fakeTransport({
        update: async () => ({ status: 304 }),
      })
      /**
       * `cache: null`, because `fake-indexeddb` completes its transactions on
       * `setImmediate` — which fake timers replace. A cache under fake timers would never
       * settle, and this test is about listeners, not about the warm start.
       */
      const session = start(transport, { revalidateOnFocus: true, cache: null })
      await session.ready
      expect(updates).toHaveLength(1)

      listeners.visibilitychange!.forEach((fn) => fn())
      await vi.advanceTimersByTimeAsync(0)
      expect(updates).toHaveLength(2)

      listeners.focus!.forEach((fn) => fn())
      await vi.advanceTimersByTimeAsync(0)
      expect(updates).toHaveLength(3)

      // Nothing is scheduled. A polling loop would show up here as a pending timer.
      expect(vi.getTimerCount()).toBe(0)

      session.dispose()
      listeners.focus!.forEach((fn) => fn())
      await vi.advanceTimersByTimeAsync(0)
      expect(updates).toHaveLength(3)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  /**
   * `visibilitychange` and `focus` both fire when a phone returns to the app. Without
   * collapsing, every return would issue two requests and could apply one delta chain
   * twice against a set that had already moved.
   */
  it("collapses overlapping revalidations onto one request", async () => {
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => (release = resolve))
    const { transport, updates } = fakeTransport({
      update: async () => {
        await gate
        return { status: 304 }
      },
    })

    const session = start(transport, { cache: null })
    const first = session.refresh()
    const second = session.refresh()
    release!()
    await Promise.all([first, second, session.ready])

    // Boot's own revalidation and both manual ones are the same request.
    expect(updates).toHaveLength(1)
  })
})
