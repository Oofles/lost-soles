import { describe, expect, it, vi } from "vitest"

import type { CachedSkill } from "@/lib/log/optimistic"
import { memoryLogStore, skillsKey } from "@/lib/log/queue"

import { loadSkillLedger, loadSkillsPanel, REPLAY_POLL_MS, sessionsKey, skillLedgerKey, type LedgerDeps, type PanelDeps, type PanelState } from "./load"

/**
 * Ticket 0073 — cache first, the replay gate, and silence on failure. Against the in-memory store
 * and fakes: the network paths are `fetchSkills` (already 0068's) and two AppSync reads.
 */

const UID = "user-1"
const CACHED: CachedSkill[] = [{ skillId: "s-cached", xp: 100 }]
const FRESH: CachedSkill[] = [{ skillId: "s-fresh", xp: 200 }]

function harness(over: Partial<PanelDeps> = {}) {
  const store = memoryLogStore()
  const timers: (() => void)[] = []
  const deps: PanelDeps = {
    currentUid: async () => UID,
    store,
    fetchSkills: vi.fn(async () => FRESH),
    fetchRecentLedger: vi.fn(async () => []),
    fetchReplayInProgress: vi.fn(async () => false),
    later: (fn) => {
      timers.push(fn)
      return () => {}
    },
    ...over,
  }
  const states: PanelState[] = []
  return { store, deps, states, timers, emit: (s: PanelState) => states.push(s) }
}

const settle = () => new Promise((r) => setTimeout(r, 0))

describe("loadSkillsPanel", () => {
  it("emits the cache first, then fresh state, and writes the fresh state back to the cache", async () => {
    const h = harness()
    await h.store.setKv(skillsKey(UID), CACHED)
    loadSkillsPanel(h.deps, h.emit)
    await settle()
    expect(h.states.map((s) => s.skills)).toEqual([CACHED, FRESH])
    expect(await h.store.getKv(skillsKey(UID))).toEqual(FRESH)
    expect(await h.store.getKv(sessionsKey(UID))).toBeDefined()
  })

  it("offline: emits the cache and stops there, with no error and no empty state", async () => {
    const h = harness({
      fetchReplayInProgress: vi.fn(async () => {
        throw new Error("offline")
      }),
    })
    await h.store.setKv(skillsKey(UID), CACHED)
    await h.store.setKv(sessionsKey(UID), { "s-cached": [40] })
    loadSkillsPanel(h.deps, h.emit)
    await settle()
    expect(h.states).toEqual([{ skills: CACHED, sessions: { "s-cached": [40] } }])
  })

  it("while a replay runs, refetches nothing and polls only the flag; refetches once when it clears", async () => {
    let replaying = true
    const h = harness({ fetchReplayInProgress: vi.fn(async () => replaying) })
    await h.store.setKv(skillsKey(UID), CACHED)
    loadSkillsPanel(h.deps, h.emit)
    await settle()
    expect(h.deps.fetchSkills).not.toHaveBeenCalled()
    expect(h.states).toHaveLength(1)
    expect(h.timers).toHaveLength(1)

    h.timers.shift()!() // still replaying
    await settle()
    expect(h.deps.fetchSkills).not.toHaveBeenCalled()
    expect(h.timers).toHaveLength(1)

    replaying = false
    h.timers.shift()!()
    await settle()
    expect(h.deps.fetchSkills).toHaveBeenCalledTimes(1)
    expect(h.states.map((s) => s.skills)).toEqual([CACHED, FRESH])
    expect(h.timers).toHaveLength(0)
  })

  it("polls at REPLAY_POLL_MS", async () => {
    const later = vi.fn(() => () => {})
    const h = harness({ fetchReplayInProgress: vi.fn(async () => true), later })
    loadSkillsPanel(h.deps, h.emit)
    await settle()
    expect(later).toHaveBeenCalledWith(expect.any(Function), REPLAY_POLL_MS)
  })

  it("signed out: emits an empty standing once and calls nothing", async () => {
    const h = harness({ currentUid: async () => undefined })
    loadSkillsPanel(h.deps, h.emit)
    await settle()
    expect(h.states).toEqual([{ skills: [], sessions: {} }])
    expect(h.deps.fetchReplayInProgress).not.toHaveBeenCalled()
  })

  it("emits nothing after stop", async () => {
    const h = harness()
    const stop = loadSkillsPanel(h.deps, h.emit)
    stop()
    await settle()
    expect(h.states).toEqual([])
  })
})

describe("loadSkillLedger (0074)", () => {
  const ROWS = [
    { skillId: "s", activityId: "a", reason: "distance", units: 5, xpAwarded: 500, xpRulesVersion: 3, isFloor: false, seq: "2026-10-01T00:00:00Z#a#00" },
  ]
  const deps = (over: Partial<LedgerDeps> = {}) => {
    const store = memoryLogStore()
    const d: LedgerDeps = {
      currentUid: async () => UID,
      store,
      fetchSkillLedger: vi.fn(async () => ROWS),
      fetchReplayInProgress: vi.fn(async () => false),
      ...over,
    }
    return { store, d }
  }

  it("emits the cache first, then the fresh ledger, written back to the cache", async () => {
    const { store, d } = deps()
    await store.setKv(skillLedgerKey(UID, "s"), [])
    const seen: unknown[] = []
    loadSkillLedger(d, "s", (r) => seen.push(r))
    await settle()
    expect(seen).toEqual([[], ROWS])
    expect(await store.getKv(skillLedgerKey(UID, "s"))).toEqual(ROWS)
  })

  it("offline: the cached ledger is the sheet, with no error", async () => {
    const { store, d } = deps({ fetchSkillLedger: vi.fn(async () => Promise.reject(new Error("offline"))) })
    await store.setKv(skillLedgerKey(UID, "s"), ROWS)
    const seen: unknown[] = []
    loadSkillLedger(d, "s", (r) => seen.push(r))
    await settle()
    expect(seen).toEqual([ROWS])
  })

  it("does not read the ledger while a replay is rewriting it", async () => {
    const { d } = deps({ fetchReplayInProgress: vi.fn(async () => true) })
    const seen: unknown[] = []
    loadSkillLedger(d, "s", (r) => seen.push(r))
    await settle()
    expect(d.fetchSkillLedger).not.toHaveBeenCalled()
    expect(seen).toEqual([[]])
  })
})
