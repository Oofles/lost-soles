/**
 * HOW `/skills` GETS ITS STANDING. Ticket 0073.
 *
 * Out of the component so it can be tested without a DOM, against `memoryLogStore()` and fakes.
 *
 * 1. **Cache first.** The cached `SkillState` (the key `/log` also writes) and the cached recent
 *    sessions are emitted as soon as IndexedDB answers. Offline, that is the whole page: no
 *    spinner, no empty state (§9.5).
 * 2. **The replay gate** (`0066`, `02` §4.4 step 1). While `Profile.replayInProgress` is true the
 *    ledger is being rewritten underneath us, so NOTHING is refetched and no tile may move. The
 *    flag alone is polled; when it clears, the standing is refetched once.
 * 3. **Then the network**, written back to the cache before it is shown. Any failure leaves the
 *    cache standing, silently — a banner for a condition nobody can fix is noise.
 */

import { rulesForSkills, type CachedSkill } from "@/lib/log/optimistic"
import { skillsKey, type LogStore } from "@/lib/log/queue"

import { recentSessions, type SkillLedgerRow } from "./next"

/** How often the flag is re-read while a replay runs. Replays take seconds to minutes. */
export const REPLAY_POLL_MS = 5_000

export const sessionsKey = (uid: string) => `skill-sessions:${uid}`

export type Sessions = Record<string, number[]>

export interface PanelState {
  skills: CachedSkill[]
  sessions: Sessions
}

export interface PanelDeps {
  currentUid(): Promise<string | undefined>
  store: Pick<LogStore, "getKv" | "setKv">
  fetchSkills(): Promise<CachedSkill[]>
  fetchRecentLedger(uid: string): Promise<SkillLedgerRow[]>
  fetchReplayInProgress(uid: string): Promise<boolean>
  /** `setTimeout`, injectable. Returns a canceller. */
  later(fn: () => void, ms: number): () => void
}

/**
 * Starts loading. `emit` is called once with the cached state (empty for a signed-out or fresh
 * browser) and again each time fresh state lands. Returns `stop`, which silences every later emit.
 */
export function loadSkillsPanel(deps: PanelDeps, emit: (state: PanelState) => void): () => void {
  let live = true
  let cancel: (() => void) | undefined

  const refresh = async (uid: string) => {
    const skills = await deps.fetchSkills()
    const rules = rulesForSkills(skills)
    const ids = rules.skills.filter((s) => s.enabled && s.kind === "activity").map((s) => s.id)
    const ledger = await deps.fetchRecentLedger(uid)
    const sessions: Sessions = Object.fromEntries(ids.map((id) => [id, recentSessions(id, ledger, rules.version)]))
    await Promise.all([deps.store.setKv(skillsKey(uid), skills), deps.store.setKv(sessionsKey(uid), sessions)])
    if (live) emit({ skills, sessions })
  }

  const gateThenRefresh = async (uid: string) => {
    try {
      if (await deps.fetchReplayInProgress(uid)) {
        if (live) cancel = deps.later(() => void gateThenRefresh(uid), REPLAY_POLL_MS)
        return
      }
      if (live) await refresh(uid)
    } catch {
      // Offline or slow: the cache stands.
    }
  }

  void (async () => {
    const uid = await deps.currentUid()
    if (!live) return
    if (!uid) {
      emit({ skills: [], sessions: {} })
      return
    }
    const [skills, sessions] = await Promise.all([
      deps.store.getKv<CachedSkill[]>(skillsKey(uid)),
      deps.store.getKv<Sessions>(sessionsKey(uid)),
    ])
    if (!live) return
    emit({ skills: skills ?? [], sessions: sessions ?? {} })
    await gateThenRefresh(uid)
  })()

  return () => {
    live = false
    cancel?.()
  }
}
