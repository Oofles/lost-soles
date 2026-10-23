import { IDBFactory } from "fake-indexeddb"
import { afterEach, describe, expect, it, vi } from "vitest"

import { API_TIMEOUT_MS, withApiTimeout } from "@/lib/http/timeout"

import { addAwards } from "./optimistic"
import { flushDue, indexedDbLogStore, queuedLog, UNDO_WINDOW_MS, type SendLog } from "./queue"
import type { WorkoutEntry } from "./workout-entry"

/**
 * TICKET `0113`, criterion 7: *"A workout log made offline persists, shows as pending where its design
 * says it should, and flushes exactly once on reconnect."* `06` §9.5, §6.4; D-282.
 *
 * WHERE "PENDING" SHOWS. There is no sync UI anywhere (D-252 removed the only `n pending` badge), so
 * a queued log is pending in exactly one place: `/log`'s standing, which is the cached `SkillState`
 * plus `addAwards` over every queued entry's optimistic award (`app/log/log-page.tsx`). That is what
 * this test reads back.
 *
 * The operator steps this replaces — DevTools offline, log, go back online, check `/skills` — are
 * scenario construction (D-229). The server here is a fake keyed on the idempotency key exactly as
 * `logWorkout`'s receipt is (0069), so "exactly once" means one award, however many sends land.
 */

const T0 = 1_790_000_000_000
const UID = "user-under-test"

const pushups: WorkoutEntry = {
  exerciseId: "pushups",
  sets: [{ reps: 30 }],
  occurredAt: new Date(T0).toISOString(),
  idempotencyKey: "log-offline-1",
  timezone: "UTC",
}

/** The server's receipt: the first delivery awards, every later one returns the original award. */
function fakeServer() {
  const awarded = new Map<string, number>()
  let online = false
  let hang = false
  let reachedHung: () => void = () => {}
  /** Resolves when a hung request has reached the server, so a test can start the clock from there. */
  const hungReached = new Promise<void>((resolve) => {
    reachedHung = resolve
  })
  const deliver = (entry: WorkoutEntry) => {
    if (awarded.has(entry.idempotencyKey)) return { logged: false, xpAwarded: awarded.get(entry.idempotencyKey)! }
    awarded.set(entry.idempotencyKey, 30)
    return { logged: true, xpAwarded: 30 }
  }
  /** The real transport's shape: the mutation inside `withApiTimeout`. */
  const send: SendLog = (entry) =>
    withApiTimeout("logWorkout", async () => {
      if (hang) {
        // The request REACHES the server, and the answer never comes back.
        deliver(entry)
        reachedHung()
        return new Promise<never>(() => {})
      }
      if (!online) throw new TypeError("Failed to fetch")
      return deliver(entry)
    })
  return {
    send,
    awarded,
    hungReached,
    setOnline: (v: boolean) => {
      online = v
    },
    setHang: (v: boolean) => {
      hang = v
    },
  }
}

describe("0113 — a workout logged offline", () => {
  afterEach(() => vi.useRealTimers())

  it("persists, shows as pending, and lands exactly once when the network returns", async () => {
    const store = indexedDbLogStore(new IDBFactory())!
    const server = fakeServer()

    // Logged while offline: it is in IndexedDB before anything else happens, and nothing blocks.
    await store.put(queuedLog(UID, pushups, { fortitude: 30 }, T0))
    expect((await store.pending(UID)).map((q) => q.idempotencyKey)).toEqual(["log-offline-1"])

    // Pending, where the design shows it: stacked into /log's standing.
    expect(addAwards(...(await store.pending(UID)).map((q) => q.award))).toEqual({ fortitude: 30 })

    // The undo window closes; the flush fails offline; the entry stays, and nothing was awarded.
    const due = T0 + UNDO_WINDOW_MS
    expect(await flushDue(store, UID, server.send, due)).toEqual({ sent: 0, dropped: 0, retrying: 1 })
    expect(await store.pending(UID)).toHaveLength(1)
    expect(server.awarded.size).toBe(0)

    // Back online. The runner's `online` handler skips the backoff.
    server.setOnline(true)
    expect(await flushDue(store, UID, server.send, due + 50, { ignoreBackoff: true })).toEqual({
      sent: 1,
      dropped: 0,
      retrying: 0,
    })
    expect(await store.pending(UID)).toEqual([])
    expect([...server.awarded]).toEqual([["log-offline-1", 30]])

    // And a later tick has nothing left to send.
    expect(await flushDue(store, UID, server.send, due + 60_000, { ignoreBackoff: true })).toEqual({
      sent: 0,
      dropped: 0,
      retrying: 0,
    })
  })

  it("a send that hangs times out at 10 s and stays queued; the retry is one award, not two", async () => {
    // Only the timeout's clock: fake-indexeddb schedules on setImmediate and must keep running.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
    const store = indexedDbLogStore(new IDBFactory())!
    const server = fakeServer()
    await store.put(queuedLog(UID, pushups, { fortitude: 30 }, T0))
    const due = T0 + UNDO_WINDOW_MS

    server.setHang(true)
    const flushing = flushDue(store, UID, server.send, due)
    await server.hungReached
    await vi.advanceTimersByTimeAsync(API_TIMEOUT_MS)
    expect(await flushing).toEqual({ sent: 0, dropped: 0, retrying: 1 })
    expect(await store.pending(UID)).toHaveLength(1)

    // The hung request did reach the server. The retry is answered from the receipt.
    server.setHang(false)
    server.setOnline(true)
    expect(await flushDue(store, UID, server.send, due + 1, { ignoreBackoff: true })).toMatchObject({ sent: 1 })
    expect([...server.awarded]).toEqual([["log-offline-1", 30]])
    expect(await store.pending(UID)).toEqual([])
  })
})
