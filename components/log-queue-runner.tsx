"use client"

import { useEffect } from "react"

import { flushDue, logStore, skillsKey } from "@/lib/log/queue"
import { currentUid, fetchSkills, sendLog } from "@/lib/log/transport"

/**
 * THE `/log` QUEUE'S BACKGROUND HALF. Ticket 0068 criterion 6, D-282.
 *
 * Mounted once, in the root layout inside the auth gate, so it runs on EVERY route: a log held
 * for its undo window on `/log` still flushes after the user has gone back to the map, and an
 * entry left by a closed tab flushes on the next app open. There is no Service Worker (D-282),
 * so this is what "background sync" means here.
 *
 * Renders nothing and reports nothing. §6.4: *"A failed flush retries silently and is never
 * surfaced as an error."* The only trace of a failure is the entry still sitting in IndexedDB.
 */

/** How often the queue is checked. One IndexedDB read when nothing is due; no network. */
export const FLUSH_POLL_MS = 1_000

/** Fired on `window` after a flush sent something, so `/log` can refresh its standing. */
export const LOG_FLUSHED_EVENT = "lost-soles:log-flushed"

export function LogQueueRunner() {
  useEffect(() => {
    const store = logStore()
    let running = false
    let stopped = false

    const tick = async (ignoreBackoff = false) => {
      if (running || stopped) return
      running = true
      try {
        const uid = await currentUid()
        if (!uid) return
        const report = await flushDue(store, uid, sendLog, Date.now(), { ignoreBackoff })
        if (report.sent > 0) {
          // The server now holds XP the cached standing does not. Refresh it, quietly.
          try {
            await store.setKv(skillsKey(uid), await fetchSkills())
          } catch {
            // Offline again, or a slow AppSync: the next flush or the next /log visit retries.
          }
          window.dispatchEvent(new Event(LOG_FLUSHED_EVENT))
        }
      } catch (e) {
        // IndexedDB itself failing. Nothing the user can act on, so nothing is shown.
        console.warn("/log queue: flush failed", e)
      } finally {
        running = false
      }
    }

    const onOnline = () => void tick(true)
    const id = setInterval(() => void tick(), FLUSH_POLL_MS)
    window.addEventListener("online", onOnline)
    void tick()
    return () => {
      stopped = true
      clearInterval(id)
      window.removeEventListener("online", onOnline)
    }
  }, [])

  return null
}
