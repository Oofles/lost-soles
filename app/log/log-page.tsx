"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useState } from "react"

import { LevelUpQueue } from "@/components/level-up-card"
import { LOG_FLUSHED_EVENT } from "@/components/log-queue-runner"
import { REDUCED_MOTION_QUERY } from "@/lib/fog/animation"
import { levelUpQueue, type LevelCard } from "@/lib/level-up/cards"
import { addAwards, awardFor, rowResult, rulesForSkills, type Award, type CachedSkill } from "@/lib/log/optimistic"
import { lastValueKey, logStore, queuedLog, skillsKey, undoLog } from "@/lib/log/queue"
import { logColumns, logSplits, splitLogLines, splitPreview, type LogSplit } from "@/lib/log/layout"
import { entryFor, logRows, splitEntryFor, type LogRow } from "@/lib/log/rows"
import { currentUid, fetchSkills } from "@/lib/log/transport"

import { LogRowView, type Logged } from "./log-row"
import { SplitEntryView, type SplitLogged } from "./split-entry"

/**
 * `/log` — ADD WORKOUT. Tickets 0068 and 0071, `06-ui-ux.md` §6.
 *
 * Rows and split entries generated from the skill registry, in two columns that
 * `rules/log-layout.json` lays out (0344, D-485): Full workouts and Quick workouts. No skill,
 * exercise or split id appears in this directory (I-25): every entry is `logColumns(rules)`, so a
 * new YAML row is a new row here with an empty `.tsx` diff (0072 proves it).
 *
 * NOTHING HERE WAITS ON THE NETWORK (§6.2). The rows render from the bundled registry on the
 * first frame. The standing (cached `SkillState`) and each row's last value come from
 * IndexedDB a few milliseconds later. `SkillState` is then revalidated in the background, and
 * a failure is ignored — the cache is what the page was already showing.
 */

/**
 * The page's only stylesheet: what inline styles cannot say. Two columns side by side on a desktop
 * (the first wider, for the split entry), one column below 760px (D-251: narrow must not break).
 * A split region is its name and share bar on one line, its readout under the name.
 */
const LAYOUT_CSS = `
.log-columns { display: grid; grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); gap: 1.25rem; align-items: start; }
@media (max-width: 760px) { .log-columns { grid-template-columns: minmax(0, 1fr); } }
.split-region { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: .2rem .75rem; align-items: center; }
.split-region > .split-read { grid-column: 1 / -1; padding-left: 1.625rem; }
@media (max-width: 420px) { .split-region { grid-template-columns: minmax(0, 1fr); } .split-region > div:nth-child(2) { padding-left: 1.625rem; } }
`

export function LogPage() {
  const store = useMemo(() => logStore(), [])
  const [uid, setUid] = useState<string>()
  const [skills, setSkills] = useState<CachedSkill[]>([])
  /** Awards of logs still in the queue — on top of `skills`, until a flush refreshes it. */
  const [pending, setPending] = useState<Award>({})
  /** Each row's last logged value, by exercise. `undefined` until IndexedDB has answered. */
  const [lastValues, setLastValues] = useState<Record<string, number>>()

  /** `0082`: a log that crossed a level plays beat 3's cards over the page (§6.4, D-288). */
  const [cards, setCards] = useState<LevelCard[] | null>(null)
  /** `0258`. `prefers-reduced-motion`, read as each queue starts — as the run sequence does (§3.4). */
  const [reduced, setReduced] = useState(false)

  const rules = useMemo(() => rulesForSkills(skills), [skills])
  const columns = useMemo(() => logColumns(rules), [rules])

  // Cache first, then the network behind it.
  useEffect(() => {
    let live = true
    void (async () => {
      const id = await currentUid()
      if (!live || !id) return
      setUid(id)
      // Every entry that remembers a value: each row's, and each split's length.
      const entryIds = [...logRows(rulesForSkills([])).map((r) => r.exerciseId), ...logSplits(rulesForSkills([])).map((s) => s.splitId)]
      const [cached, queued, ...lasts] = await Promise.all([
        store.getKv<CachedSkill[]>(skillsKey(id)),
        store.pending(id),
        ...entryIds.map((e) => store.getKv<number>(lastValueKey(id, e))),
      ])
      if (!live) return
      if (cached) setSkills(cached)
      setPending(addAwards(...queued.map((q) => q.award)))
      const values: Record<string, number> = {}
      entryIds.forEach((e, i) => {
        if (typeof lasts[i] === "number") values[e] = lasts[i]
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
      // Every skill's standing before this log — the Total Level milestone reads them all. The row's
      // own skill first, then whatever it feeds, as the award lists them.
      const before = Object.fromEntries(rules.skills.map((s) => [s.id, standing(s.id)]))
      const order = [row.skillId, ...Object.keys(award).filter((id) => id !== row.skillId)]
      const queue = levelUpQueue(before, award, rules, order)
      const log = queuedLog(uid, entry, award, now)
      // IndexedDB FIRST, then the animation (§6.4). A tab killed after this line still logs.
      await store.put(log)
      const previous = lastValues?.[row.exerciseId]
      await store.setKv(lastValueKey(uid, row.exerciseId), value)
      setLastValues((v) => ({ ...v, [row.exerciseId]: value }))
      setPending((p) => addAwards(p, award))
      if (queue.length) {
        setReduced(window.matchMedia?.(REDUCED_MOTION_QUERY).matches === true)
        setCards(queue)
      }
      return { key: log.idempotencyKey, value, result, holdUntil: log.holdUntil, award, previous }
    },
    [uid, rules, standing, store, lastValues],
  )

  /**
   * A split log (0344): one entry, one activity, one undo. The same path as a row: IndexedDB first,
   * then the cards. Its "last value" is the length; the shares start at 0% every time (operator).
   */
  const onLogSplit = useCallback(
    async (split: LogSplit, minutes: number, percents: readonly number[]): Promise<SplitLogged | undefined> => {
      if (!uid) return undefined
      const now = Date.now()
      const shares = split.members.map((m, i) => ({ exerciseId: m.exerciseId, percent: percents[i] ?? 0 }))
      const ruleSplit = rules.splits?.find((s) => s.id === split.splitId)
      if (!ruleSplit) return undefined
      const entry = splitEntryFor(ruleSplit, minutes, shares, {
        now: new Date(now),
        idempotencyKey: crypto.randomUUID(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      })
      const award = awardFor(entry, rules)
      const before = Object.fromEntries(rules.skills.map((s) => [s.id, standing(s.id)]))
      const lines = splitLogLines(split, award, rules, standing)
      const order = lines.map((l) => l.skillId)
      const queue = levelUpQueue(before, award, rules, order)
      const log = queuedLog(uid, entry, award, now)
      await store.put(log)
      const previous = lastValues?.[split.splitId]
      await store.setKv(lastValueKey(uid, split.splitId), minutes)
      setLastValues((v) => ({ ...v, [split.splitId]: minutes }))
      setPending((p) => addAwards(p, award))
      if (queue.length) {
        setReduced(window.matchMedia?.(REDUCED_MOTION_QUERY).matches === true)
        setCards(queue)
      }
      return { key: log.idempotencyKey, holdUntil: log.holdUntil, award, minutes, percents: [...percents], lines, previous }
    },
    [uid, rules, standing, store, lastValues],
  )

  const onUndo = useCallback(
    async (entryId: string, logged: Pick<Logged, "key" | "award" | "previous">): Promise<boolean> => {
      if (!uid) return false
      const undone = await undoLog(store, logged.key, Date.now())
      if (!undone) return false
      const negated = Object.fromEntries(Object.entries(logged.award).map(([k, v]) => [k, -v]))
      setPending((p) => addAwards(p, negated))
      // An undone log was never logged, so it is not "your last logged value" either (0071).
      if (logged.previous !== undefined) {
        await store.setKv(lastValueKey(uid, entryId), logged.previous)
      }
      setLastValues((v) => {
        const next = { ...v }
        if (logged.previous === undefined) delete next[entryId]
        else next[entryId] = logged.previous
        return next
      })
      return true
    },
    [uid, store],
  )

  return (
    <main style={{ padding: "1rem .75rem", maxWidth: "64rem", margin: "0 auto" }}>
      <style>{LAYOUT_CSS}</style>
      <header style={{ display: "flex", alignItems: "center", gap: ".75rem", marginBottom: "1rem" }}>
        <Link
          href="/"
          aria-label="Back to the map"
          style={{ color: "var(--text-primary)", textDecoration: "none", fontSize: "1.5rem", padding: ".25rem .5rem" }}
        >
          ←
        </Link>
        <h1 style={{ color: "var(--text-primary)", margin: 0, fontFamily: "var(--font-serif)", fontWeight: 600, fontSize: "1.125rem", letterSpacing: ".08em" }}>
          ADD WORKOUT
        </h1>
      </header>

      {/*
        Two columns, laid out by `rules/log-layout.json` (D-485). Each keeps its order forever and
        scrolls when it outgrows the screen (§6.5). At a narrow width they stack, first column first.
      */}
      <div className="log-columns">
        {columns.map((column) => (
          <section key={column.id} aria-labelledby={`log-col-${column.id}`}>
            <h2
              id={`log-col-${column.id}`}
              style={{ margin: "0 0 .6rem", fontFamily: "var(--font-serif)", fontWeight: 600, fontSize: ".9375rem", letterSpacing: ".08em", color: "var(--text-secondary)" }}
            >
              {column.title.toUpperCase()}
            </h2>
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: ".75rem" }}>
              {column.items.map((item) => (
                <li key={item.id}>
                  {item.kind === "row" ? (
                    <LogRowView
                      row={item.row}
                      initialValue={lastValues === undefined ? undefined : (lastValues[item.row.exerciseId] ?? item.row.fallback)}
                      disabled={!uid}
                      onLog={(value, durationS) => onLog(item.row, value, durationS)}
                      onUndo={(logged) => onUndo(item.row.exerciseId, logged)}
                    />
                  ) : (
                    <SplitEntryView
                      split={item.split}
                      initialMinutes={lastValues === undefined ? undefined : (lastValues[item.split.splitId] ?? item.split.fallback)}
                      disabled={!uid}
                      preview={(minutes, percents) => splitPreview(item.split, minutes, percents, rules)}
                      onLog={(minutes, percents) => onLogSplit(item.split, minutes, percents)}
                      onUndo={(logged) => onUndo(item.split.splitId, logged)}
                    />
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      {cards ? (
        <LevelUpQueue
          cards={cards}
          skillName={(id) => rules.skills.find((s) => s.id === id)?.name ?? id}
          onDone={() => setCards(null)}
          reduced={reduced}
        />
      ) : null}
    </main>
  )
}
