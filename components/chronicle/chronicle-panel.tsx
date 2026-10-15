"use client"

import { usePathname, useRouter } from "next/navigation"
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"

import { rulesForSkills } from "@/lib/log/optimistic"
import { browserChronicleReturn } from "@/lib/chronicle/return"
import { chronicleRow, exerciseLabels, latestTraced, unseenIds } from "@/lib/chronicle/rows"
import { fetchChroniclePage } from "@/lib/chronicle/transport"
import { rowWindow, shouldLoadMore } from "@/lib/chronicle/window"
import { isSeen } from "@/lib/run-moment/seen"
import { browserHistoryHost, seedHomeBehind } from "@/lib/runs/history"
import type { ChroniclePage, RunListItem } from "@/lib/runs/wire"
import { useSwipeDismiss } from "@/lib/sheet/swipe-dismiss"

import { ChronicleRows } from "./chronicle-rows"

/**
 * `/chronicle`, IN THE BROWSER. Ticket `0088`. `06-ui-ux.md` §1.5, §2.5; D-313, D-314.
 *
 * A PANEL, NOT A PAGE AND NOT A MODAL. At ≥1024px it replaces the rail's contents — the same 24rem
 * column, full height, opaque — with no scrim, and the map to its right stays live. Below 1024px it
 * takes the bottom card's place, growing up to 16px below the map's top controls, and takes the
 * shared swipe-down (D-314) there. It is a ROUTE, held in no component state: the home layout keeps
 * the map mounted under both `/` and `/chronicle`, so opening and dismissing it never touch the
 * camera.
 *
 * Dismissal is Esc, the close control, and back — all three are `router.back()`, because there is
 * always a `/` behind it: a push from the plinth's `RUNS`, or the seed a cold deep link gets
 * (`seedHomeBehind`, `0078`).
 *
 * What it refuses (D-013, §2.3, `chronicle-panel.test.tsx`): no calendar, no week grid, no gaps,
 * no week or month totals, no filter, no search, no sort. A list, newest first.
 */

export const CHRONICLE_CSS =
  ".chronicle { position: fixed; z-index: 1; left: 16px; right: 16px; top: 72px; bottom: 36px;" +
  " overflow-y: auto; overscroll-behavior: contain; box-sizing: border-box; background: var(--surface-raised);" +
  " border: 1px solid var(--line); border-radius: 8px; color: var(--text-primary); font-family: var(--font-sans); }" +
  " .chronicle-head { position: sticky; top: 0; z-index: 1; display: flex; align-items: center;" +
  " justify-content: space-between; gap: 8px; padding: 12px 16px; background: var(--surface-raised);" +
  " border-bottom: 1px solid var(--line); }" +
  " .chronicle-close { width: 32px; height: 32px; display: flex; align-items: center; justify-content: center;" +
  " background: none; border: 1px solid transparent; border-radius: 4px; color: var(--text-primary);" +
  " font: 400 20px/1 var(--font-sans); cursor: pointer; }" +
  " .chronicle-close:hover, .chronicle-row:hover { background: var(--bg); }" +
  " .chronicle-row { display: flex; flex-direction: column; justify-content: center; height: 100%;" +
  " box-sizing: border-box; padding: 0 16px; text-decoration: none; color: inherit; }" +
  " .chronicle a:focus-visible, .chronicle button:focus-visible, .chronicle:focus-visible {" +
  " outline: 2px solid var(--text-primary); outline-offset: -2px; }" +
  " @media (min-width: 1024px) {" +
  " .chronicle { top: 0; bottom: 0; left: 0; right: auto; width: 24rem;" +
  " border: 0; border-right: 1px solid var(--line); border-radius: 0; } }"

const CHRONICLE_PATH = "/chronicle"

/** Merge a fetched page onto what is loaded, newest first, never duplicating a row. */
function append(have: readonly RunListItem[], page: readonly RunListItem[]): RunListItem[] {
  const ids = new Set(have.map((r) => r.activityId))
  return [...have, ...page.filter((r) => !ids.has(r.activityId))]
}

export function ChroniclePanel({ initial }: { initial: ChroniclePage }) {
  const router = useRouter()
  const pathname = usePathname() ?? CHRONICLE_PATH

  // A back from a run this Chronicle opened gets its rows and offset back (the operator, 2026-10-15).
  const [restored] = useState(() => browserChronicleReturn().take(pathname))
  const [items, setItems] = useState<RunListItem[]>(() => restored?.items ?? initial.items)
  const [next, setNext] = useState<string | null>(() => (restored ? restored.next : initial.next))
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [scrollTop, setScrollTop] = useState(() => restored?.scrollTop ?? 0)
  const [viewport, setViewport] = useState(0)
  const [listTop, setListTop] = useState(0)
  const [seen, setSeen] = useState<ReadonlyMap<string, boolean>>(new Map())

  const panel = useRef<HTMLElement | null>(null)
  const list = useRef<HTMLDivElement | null>(null)
  const latest = useRef({ items, next, scrollTop: restored?.scrollTop ?? 0 })
  latest.current.items = items
  latest.current.next = next

  const dismiss = useCallback(() => router.back(), [router])
  useSwipeDismiss(panel, dismiss)

  // A cold deep link has nothing of the app behind it: slip `/` underneath, so back lands there.
  useEffect(() => {
    seedHomeBehind(browserHistoryHost())
  }, [])

  // Esc dismisses. Focus moves into the panel, so the keyboard is where the eye is.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) dismiss()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [dismiss])

  // Measure, restore the offset, and leave a snapshot behind on the way out.
  useLayoutEffect(() => {
    const el = panel.current
    if (!el) return
    const measure = () => {
      setViewport(el.clientHeight)
      setListTop(list.current?.offsetTop ?? 0)
    }
    measure()
    if (restored) el.scrollTop = restored.scrollTop
    el.focus({ preventScroll: true })
    window.addEventListener("resize", measure)
    const state = latest.current
    return () => {
      window.removeEventListener("resize", measure)
      browserChronicleReturn().leave({ items: state.items, next: state.next, scrollTop: state.scrollTop })
    }
  }, [restored])

  const frame = useRef(0)
  const onScroll = () => {
    const el = panel.current
    if (!el) return
    latest.current.scrollTop = el.scrollTop
    if (failed) setFailed(false)
    if (frame.current) return
    frame.current = requestAnimationFrame(() => {
      frame.current = 0
      setScrollTop(el.scrollTop)
    })
  }
  useEffect(() => () => cancelAnimationFrame(frame.current), [])

  const { start, end } = rowWindow(scrollTop - listTop, viewport, items.length)

  // The next page, as the window nears the end of what is loaded. A failure waits for the next scroll.
  useEffect(() => {
    if (loading || failed || !next || !shouldLoadMore({ start, end }, items.length, true)) return
    let live = true
    setLoading(true)
    fetchChroniclePage(next).then(
      (page) => {
        if (!live) return
        setItems((have) => append(have, page.items))
        setNext(page.next)
        setLoading(false)
      },
      () => {
        if (!live) return
        setFailed(true)
        setLoading(false)
      },
    )
    return () => {
      live = false
    }
  }, [start, end, items.length, next, loading, failed])

  // `0084`'s per-device flag, asked once per loaded traced row.
  useEffect(() => {
    const latest = latestTraced(items)
    const ask = latest && !seen.has(latest.activityId) ? [latest] : []
    if (ask.length === 0) return
    let live = true
    void Promise.all(ask.map(async (r) => [r.activityId, await isSeen(r.activityId)] as const)).then((answers) => {
      if (!live) return
      setSeen((had) => {
        const out = new Map(had)
        for (const [id, s] of answers) out.set(id, s)
        return out
      })
    })
    return () => {
      live = false
    }
  }, [items, seen])

  const label = useMemo(() => exerciseLabels(rulesForSkills([])), [])
  const rows = useMemo(() => items.slice(start, end).map((r) => chronicleRow(r, label)), [items, start, end, label])
  const unseen = useMemo(() => unseenIds(items, seen), [items, seen])

  return (
    <section
      ref={panel}
      className="chronicle"
      aria-labelledby="chronicle-title"
      data-chronicle=""
      tabIndex={-1}
      onScroll={onScroll}
    >
      <style>{CHRONICLE_CSS}</style>
      <header className="chronicle-head">
        <h2 id="chronicle-title" style={{ margin: 0, font: "600 12px/1.2 var(--font-sans)", letterSpacing: ".08em", color: "var(--text-secondary)" }}>
          CHRONICLE
        </h2>
        <button type="button" className="chronicle-close" aria-label="Close the Chronicle" onClick={dismiss}>
          <span aria-hidden="true">×</span>
        </button>
      </header>
      <div ref={list}>
        {items.length === 0 ? (
          <p style={{ margin: 0, padding: 16, font: "400 15px/1.45 var(--font-sans)", color: "var(--text-secondary)" }}>
            Nothing here yet.
          </p>
        ) : (
          <ChronicleRows rows={rows} start={start} total={items.length} unseen={unseen} />
        )}
      </div>
    </section>
  )
}
