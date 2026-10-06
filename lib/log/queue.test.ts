import { IDBFactory } from "fake-indexeddb"
import { describe, expect, it, vi } from "vitest"

import {
  flushDue,
  indexedDbLogStore,
  LogRefusedError,
  memoryLogStore,
  queuedLog,
  UNDO_WINDOW_MS,
  undoLog,
  type LogStore,
} from "./queue"
import type { WorkoutEntry } from "./workout-entry"

/**
 * Ticket 0068 criterion 6 and 0071's undo, D-282. Run against BOTH stores — the IndexedDB one
 * through `fake-indexeddb`, and the in-memory fallback — because the page and the runner treat
 * them as one interface and a difference between them is a bug only a private window would find.
 */

const T0 = 1_790_000_000_000

const entry = (key: string): WorkoutEntry => ({
  exerciseId: "ex",
  sets: [{ reps: 30 }],
  occurredAt: new Date(T0).toISOString(),
  idempotencyKey: key,
  timezone: "UTC",
})

const stores: [string, () => LogStore][] = [
  ["IndexedDB", () => indexedDbLogStore(new IDBFactory())!],
  ["memory", () => memoryLogStore()],
]

describe.each(stores)("the %s log store", (_name, make) => {
  it("holds an entry for exactly the undo window", async () => {
    const store = make()
    await store.put(queuedLog("u", entry("a"), { s: 120 }, T0))
    const send = vi.fn().mockResolvedValue({ logged: true, xpAwarded: 120 })

    expect(await flushDue(store, "u", send, T0 + UNDO_WINDOW_MS - 1)).toEqual({ sent: 0, dropped: 0, retrying: 0 })
    expect(send).not.toHaveBeenCalled()

    expect(await flushDue(store, "u", send, T0 + UNDO_WINDOW_MS)).toMatchObject({ sent: 1 })
    expect(send).toHaveBeenCalledWith(entry("a"))
    expect(await store.pending("u")).toEqual([])
  })

  it("undo inside the window deletes it, and it is never sent (D-135: cancel, never compensate)", async () => {
    const store = make()
    await store.put(queuedLog("u", entry("a"), {}, T0))
    expect(await undoLog(store, "a", T0 + 7_999)).toBe(true)
    const send = vi.fn()
    await flushDue(store, "u", send, T0 + 60_000)
    expect(send).not.toHaveBeenCalled()
    expect(await store.pending("u")).toEqual([])
  })

  it("undo after the window refuses: from then on it is a log", async () => {
    const store = make()
    await store.put(queuedLog("u", entry("a"), {}, T0))
    expect(await undoLog(store, "a", T0 + UNDO_WINDOW_MS)).toBe(false)
    expect(await store.pending("u")).toHaveLength(1)
  })

  it("undo of an unknown key is false, not a throw", async () => {
    expect(await undoLog(make(), "nope", T0)).toBe(false)
  })

  it("a failed flush stays queued, retries with backoff, and re-sends the SAME entry", async () => {
    const store = make()
    await store.put(queuedLog("u", entry("a"), {}, T0))
    const send = vi.fn().mockRejectedValueOnce(new Error("Network error")).mockResolvedValue({ logged: true, xpAwarded: 1 })
    const due = T0 + UNDO_WINDOW_MS

    expect(await flushDue(store, "u", send, due)).toMatchObject({ retrying: 1 })
    const [held] = await store.pending("u")
    expect(held).toMatchObject({ attempts: 1, nextAttemptAt: due + 1_000 })

    // Inside the backoff: not retried.
    expect(await flushDue(store, "u", send, due + 999)).toMatchObject({ sent: 0 })
    expect(send).toHaveBeenCalledTimes(1)

    expect(await flushDue(store, "u", send, due + 1_000)).toMatchObject({ sent: 1 })
    expect(send).toHaveBeenNthCalledWith(2, entry("a"))
    expect(send.mock.calls[0][0].idempotencyKey).toBe(send.mock.calls[1][0].idempotencyKey)
  })

  it("backoff doubles and caps at five minutes", async () => {
    const store = make()
    await store.put(queuedLog("u", entry("a"), {}, T0))
    const send = vi.fn().mockRejectedValue(new Error("down"))
    let now = T0 + UNDO_WINDOW_MS
    const gaps: number[] = []
    for (let i = 0; i < 12; i++) {
      await flushDue(store, "u", send, now)
      const [held] = await store.pending("u")
      gaps.push(held.nextAttemptAt - now)
      now = held.nextAttemptAt
    }
    expect(gaps.slice(0, 4)).toEqual([1_000, 2_000, 4_000, 8_000])
    expect(Math.max(...gaps)).toBe(5 * 60_000)
  })

  it("coming back online skips the backoff", async () => {
    const store = make()
    await store.put(queuedLog("u", entry("a"), {}, T0))
    const send = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue({ logged: true, xpAwarded: 1 })
    const due = T0 + UNDO_WINDOW_MS
    await flushDue(store, "u", send, due)
    expect(await flushDue(store, "u", send, due + 10, { ignoreBackoff: true })).toMatchObject({ sent: 1 })
  })

  it("but never skips the undo window, even online", async () => {
    const store = make()
    await store.put(queuedLog("u", entry("a"), {}, T0))
    const send = vi.fn()
    await flushDue(store, "u", send, T0 + 1, { ignoreBackoff: true })
    expect(send).not.toHaveBeenCalled()
  })

  it("a refusal is dropped, not retried forever", async () => {
    const store = make()
    await store.put(queuedLog("u", entry("a"), {}, T0))
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const send = vi.fn().mockRejectedValue(new LogRefusedError("UNKNOWN_EXERCISE", "gone"))
    expect(await flushDue(store, "u", send, T0 + UNDO_WINDOW_MS)).toMatchObject({ dropped: 1 })
    expect(await store.pending("u")).toEqual([])
    warn.mockRestore()
  })

  it("flushes oldest click first, and only this user's", async () => {
    const store = make()
    await store.put(queuedLog("u", entry("second"), {}, T0 + 10))
    await store.put(queuedLog("u", entry("first"), {}, T0))
    await store.put(queuedLog("other", entry("theirs"), {}, T0))
    const sent: string[] = []
    await flushDue(store, "u", async (e) => (sent.push(e.idempotencyKey), { logged: true, xpAwarded: 1 }), T0 + 60_000)
    expect(sent).toEqual(["first", "second"])
    expect(await store.pending("other")).toHaveLength(1)
  })

  it("keeps the optimistic award with the entry, so a reload still stacks it", async () => {
    const store = make()
    await store.put(queuedLog("u", entry("a"), { s: 120, m: 40 }, T0))
    expect((await store.pending("u"))[0].award).toEqual({ s: 120, m: 40 })
  })

  it("stores per-type last values and the skill cache", async () => {
    const store = make()
    expect(await store.getKv("last:u:ex")).toBeUndefined()
    await store.setKv("last:u:ex", 40)
    await store.setKv("skills:u", [{ skillId: "s", xp: 9 }])
    expect(await store.getKv("last:u:ex")).toBe(40)
    expect(await store.getKv("skills:u")).toEqual([{ skillId: "s", xp: 9 }])
  })
})

describe("the IndexedDB store specifically", () => {
  it("survives a new connection — a closed tab's held log is still there to flush", async () => {
    const factory = new IDBFactory()
    await indexedDbLogStore(factory)!.put(queuedLog("u", entry("a"), {}, T0))
    const reopened = indexedDbLogStore(factory)!
    expect((await reopened.pending("u")).map((l) => l.idempotencyKey)).toEqual(["a"])
  })

  it("is null where there is no IndexedDB, so the page falls back to memory", () => {
    expect(indexedDbLogStore(null)).toBeNull()
  })
})
