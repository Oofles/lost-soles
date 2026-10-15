/**
 * HOW THE PLINTH GETS TOTAL LEVEL. Ticket `0086`.
 *
 * `/skills`' loader (`lib/skills/load.ts`) in miniature, over the same cache key, without the ledger
 * read the `NEXT` line needs and the plinth does not:
 *
 * 1. **Cache first.** The cached `SkillState` is emitted as soon as IndexedDB answers — offline,
 *    that is the whole number (§2.4 "cached totals immediately").
 * 2. **The replay gate** (`0066`, `02` §4.4 step 1). While `Profile.replayInProgress` is true no
 *    number may move, so nothing is refetched; the flag alone is re-read until it clears.
 * 3. **Then the network**, written back to the cache before it is shown. A failure leaves the cache
 *    standing, silently: the plinth never reports a fetch it could not make (D-013).
 *
 * **It asks once per call, and never on a timer** beyond the replay gate's. The home screen left
 * alone for ten minutes, or three weeks, issues nothing and changes nothing (`0086` criterion 9).
 */

import type { CachedSkill } from "@/lib/log/optimistic"
import { skillsKey, type LogStore } from "@/lib/log/queue"
import { REPLAY_POLL_MS } from "@/lib/skills/load"

export interface StandingDeps {
  currentUid(): Promise<string | undefined>
  store: Pick<LogStore, "getKv" | "setKv">
  fetchSkills(): Promise<CachedSkill[]>
  fetchReplayInProgress(uid: string): Promise<boolean>
  /** `setTimeout`, injectable. Returns a canceller. */
  later(fn: () => void, ms: number): () => void
}

/**
 * Starts loading. `emit` is called with the cached standing (if there is one) and again
 * when fresh standing lands. Nothing is emitted for a signed-out visitor. Returns `stop`.
 */
export function loadStanding(deps: StandingDeps, emit: (skills: CachedSkill[]) => void): () => void {
  let live = true
  let cancel: (() => void) | undefined

  const gateThenRefresh = async (uid: string) => {
    try {
      if (await deps.fetchReplayInProgress(uid)) {
        if (live) cancel = deps.later(() => void gateThenRefresh(uid), REPLAY_POLL_MS)
        return
      }
      if (!live) return
      const skills = await deps.fetchSkills()
      await deps.store.setKv(skillsKey(uid), skills)
      if (live) emit(skills)
    } catch {
      // Offline or slow: the cache stands, and nothing says so.
    }
  }

  void (async () => {
    const uid = await deps.currentUid()
    if (!live || !uid) return
    let cached: CachedSkill[] | undefined
    try {
      cached = await deps.store.getKv<CachedSkill[]>(skillsKey(uid))
    } catch {
      cached = undefined
    }
    if (!live) return
    // No cache is NOT "every skill at level 1": a fresh browser waits for the network rather than
    // drawing a number that then jumps (§9.5 — no placeholder that lies).
    if (cached) emit(cached)
    await gateThenRefresh(uid)
  })()

  return () => {
    live = false
    cancel?.()
  }
}
