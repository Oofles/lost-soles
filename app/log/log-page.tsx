"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useState } from "react"

import { LOG_FLUSHED_EVENT } from "@/components/log-queue-runner"
import { addAwards, awardFor, rowResult, rulesForSkills, type Award, type CachedSkill } from "@/lib/log/optimistic"
import { lastValueKey, logStore, queuedLog, skillsKey, undoLog } from "@/lib/log/queue"
import { entryFor, logRows, type LogRow } from "@/lib/log/rows"
import { currentUid, fetchSkills } from "@/lib/log/transport"

import { LogRowView, type Logged } from "./log-row"

/**
 * `/log` — ADD WORKOUT. Tickets 0068 and 0071, `06-ui-ux.md` §6.
 *
 * A list of rows generated from the skill registry, and nothing else. No skill or exercise id
 * appears in this directory (I-25): every row is `logRows(rules)`, so a new YAML row is a new
 * row here with an empty `.tsx` diff (0072 proves it).
 *
 * NOTHING HERE WAITS ON THE NETWORK (§6.2). The rows render from the bundled registry on the
 * first frame. The standing (cached `SkillState`) and each row's last value come from
 * IndexedDB a few milliseconds later. `SkillState` is then revalidated in the background, and
 * a failure is ignored — the cache is what the page was already showing.
 */

export function LogPage() {
  const store = useMemo(() => logStore(), [])
  const [uid, setUid] = useState<string>()
  const [skills, setSkills] = useState<CachedSkill[]>([])
  /** Awards of logs still in the queue — on top of `skills`, until a flush refreshes it. */
  const [pending, setPending] = useState<Award>({})
  /** Each row's last logged value, by exercise. `undefined` until IndexedDB has answered. */
  const [lastValues, setLastValues] = useState<Record<string, number>>()

  const rules = useMemo(() => rulesForSkills(skills), [skills])
  const rows = useMemo(() => logRows(rules), [rules])

  // Cache first, then the network behind it.
  useEffect(() => {
    let live = true
    void (async () => {
      const id = await currentUid()
      if (!live || !id) return
      setUid(id)
      const [cached, queued, ...lasts] = await Promise.all([
        store.getKv<CachedSkill[]>(skillsKey(id)),
        store.pending(id),
        ...logRows(rulesForSkills([])).map((r) => store.getKv<number>(lastValueKey(id, r.exerciseId))),
      ])
      if (!live) return
      if (cached) setSkills(cached)
      setPending(addAwards(...queued.map((q) => q.award)))
      const values: Record<string, number> = {}
      logRows(rulesForSkills([])).forEach((r, i) => {
        if (typeof lasts[i] === "number") values[r.exerciseId] = lasts[i]
      })
      setLastValues(values)
      try {
        const fresh = await fetchSkills()
        await store.setKv(skillsKey(id), fresh)
        if (live) setSkills(fresh)
      } catch {
        // Offline or slow: the cache stands. §9.5 — no banner for a condition nobody can fix.
      }
    })()
    return () => {
      live = false
    }
  }, [store])

  // A flush means the server has the XP: re-read the refreshed cache and drop sent awards.
  useEffect(() => {
    if (!uid) return
    const onFlushed = async () => {
      const [cached, queued] = await Promise.all([store.getKv<CachedSkill[]>(skillsKey(uid)), store.pending(uid)])
      if (cached) setSkills(cached)
      setPending(addAwards(...queued.map((q) => q.award)))
    }
    window.addEventListener(LOG_FLUSHED_EVENT, onFlushed)
    return () => window.removeEventListener(LOG_FLUSHED_EVENT, onFlushed)
  }, [store, uid])

  const standing = useCallback(
    (skillId: string) => (skills.find((s) => s.skillId === skillId)?.xp ?? 0) + (pending[skillId] ?? 0),
    [skills, pending],
  )

  const onLog = useCallback(
    async (row: LogRow, value: number, durationS?: number): Promise<Logged | undefined> => {
      if (!uid) return undefined
      const now = Date.now()
      const entry = entryFor(row, value, rules, {
        now: new Date(now),
        idempotencyKey: crypto.randomUUID(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        durationS,
      })
      const award = awardFor(entry, rules)
      const result = rowResult(row.skillId, award, { xp: standing(row.skillId) }, rules)
      const log = queuedLog(uid, entry, award, now)
      // IndexedDB FIRST, then the animation (§6.4). A tab killed after this line still logs.
      await store.put(log)
      const previous = lastValues?.[row.exerciseId]
      await store.setKv(lastValueKey(uid, row.exerciseId), value)
      setLastValues((v) => ({ ...v, [row.exerciseId]: value }))
      setPending((p) => addAwards(p, award))
      return { key: log.idempotencyKey, value, result, holdUntil: log.holdUntil, award, previous }
    },
    [uid, rules, standing, store, lastValues],
  )

  const onUndo = useCallback(
    async (row: LogRow, logged: Logged): Promise<boolean> => {
      if (!uid) return false
      const undone = await undoLog(store, logged.key, Date.now())
      if (!undone) return false
      const negated = Object.fromEntries(Object.entries(logged.award).map(([k, v]) => [k, -v]))
      setPending((p) => addAwards(p, negated))
      // An undone log was never logged, so it is not "your last logged value" either (0071).
      if (logged.previous !== undefined) {
        await store.setKv(lastValueKey(uid, row.exerciseId), logged.previous)
      }
      setLastValues((v) => {
        const next = { ...v }
        if (logged.previous === undefined) delete next[row.exerciseId]
        else next[row.exerciseId] = logged.previous
        return next
      })
      return true
    },
    [uid, store],
  )

  return (
    <main style={{ padding: "1rem", maxWidth: "40rem", margin: "0 auto" }}>
      <header style={{ display: "flex", alignItems: "center", gap: ".75rem", marginBottom: "1rem" }}>
        <Link
          href="/"
          aria-label="Back to the map"
          style={{ color: "var(--text-primary)", textDecoration: "none", fontSize: "1.5rem", padding: ".25rem .5rem" }}
        >
          ←
        </Link>
        <h1 style={{ color: "var(--text-primary)", margin: 0, fontSize: "1.125rem", letterSpacing: ".08em" }}>
          ADD WORKOUT
        </h1>
      </header>

      {/* Registry order, forever (§6.5). When it outgrows the screen it scrolls — nothing else. */}
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: ".75rem" }}>
        {rows.map((row) => (
          <li key={row.exerciseId}>
            <LogRowView
              row={row}
              initialValue={lastValues === undefined ? undefined : (lastValues[row.exerciseId] ?? row.fallback)}
              disabled={!uid}
              onLog={(value, durationS) => onLog(row, value, durationS)}
              onUndo={(logged) => onUndo(row, logged)}
            />
          </li>
        ))}
      </ul>
    </main>
  )
}
