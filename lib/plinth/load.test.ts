import { describe, expect, it, vi } from "vitest"

import type { CachedSkill } from "@/lib/log/optimistic"
import { memoryLogStore, skillsKey } from "@/lib/log/queue"
import { REPLAY_POLL_MS } from "@/lib/skills/load"

import { loadStanding, type StandingDeps } from "./load"

const flush = () => new Promise((r) => setTimeout(r, 0))

function rig(over: Partial<StandingDeps> = {}) {
  const timers: { fn: () => void; ms: number }[] = []
  const deps: StandingDeps = {
    currentUid: async () => "u-1",
    store: memoryLogStore(),
    fetchSkills: vi.fn(async (): Promise<CachedSkill[]> => [{ skillId: "x", xp: 500 }]),
    fetchReplayInProgress: vi.fn(async () => false),
    later: (fn, ms) => {
      timers.push({ fn, ms })
      return () => undefined
    },
    ...over,
  }
  return { deps, timers }
}

describe("loadStanding (0086)", () => {
  it("emits the cache first, then the network, and writes the network back", async () => {
    const { deps } = rig()
    await deps.store.setKv(skillsKey("u-1"), [{ skillId: "x", xp: 100 }])
    const emit = vi.fn()
    loadStanding(deps, emit)
    await flush()
    expect(emit.mock.calls.map((c) => c[0])).toEqual([[{ skillId: "x", xp: 100 }], [{ skillId: "x", xp: 500 }]])
    expect(await deps.store.getKv(skillsKey("u-1"))).toEqual([{ skillId: "x", xp: 500 }])
  })

  it("with no cache, waits for the network rather than drawing every skill at level 1", async () => {
    const { deps } = rig({ fetchSkills: async () => Promise.reject(new Error("offline")) })
    const emit = vi.fn()
    loadStanding(deps, emit)
    await flush()
    expect(emit).not.toHaveBeenCalled()
  })

  it("a failed fetch leaves the cache standing, silently", async () => {
    const { deps } = rig({ fetchSkills: async () => Promise.reject(new Error("offline")) })
    await deps.store.setKv(skillsKey("u-1"), [{ skillId: "x", xp: 100 }])
    const emit = vi.fn()
    loadStanding(deps, emit)
    await flush()
    expect(emit).toHaveBeenCalledTimes(1)
  })

  it("does not refetch while a replay is rewriting the ledger, and polls only the flag", async () => {
    const replay = vi.fn(async () => true)
    const { deps, timers } = rig({ fetchReplayInProgress: replay })
    loadStanding(deps, vi.fn())
    await flush()
    expect(deps.fetchSkills).not.toHaveBeenCalled()
    expect(timers).toEqual([{ fn: expect.any(Function), ms: REPLAY_POLL_MS }])
  })

  /**
   * Criterion 9's mechanical half: left alone, the home screen asks for nothing more. One fetch,
   * no timer scheduled, so ten minutes (or three weeks) later nothing has changed.
   */
  it("schedules nothing once it has answered — no polling", async () => {
    vi.useFakeTimers()
    try {
      const { deps, timers } = rig()
      const emit = vi.fn()
      loadStanding(deps, emit)
      await vi.runAllTimersAsync()
      const calls = emit.mock.calls.length
      await vi.advanceTimersByTimeAsync(10 * 60_000)
      expect(timers).toHaveLength(0)
      expect(deps.fetchSkills).toHaveBeenCalledTimes(1)
      expect(emit).toHaveBeenCalledTimes(calls)
    } finally {
      vi.useRealTimers()
    }
  })

  it("emits nothing for a signed-out visitor", async () => {
    const { deps } = rig({ currentUid: async () => undefined })
    const emit = vi.fn()
    loadStanding(deps, emit)
    await flush()
    expect(emit).not.toHaveBeenCalled()
    expect(deps.fetchSkills).not.toHaveBeenCalled()
  })

  it("stop silences every later emit", async () => {
    const { deps } = rig()
    const emit = vi.fn()
    loadStanding(deps, emit)()
    await flush()
    expect(emit).not.toHaveBeenCalled()
  })
})
