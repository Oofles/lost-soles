"use client"

import { useRouter } from "next/navigation"
import { useCallback, useEffect, useRef, type CSSProperties } from "react"

import { CHRONICLE_CSS } from "@/components/chronicle/chronicle-panel"
import { browserHistoryHost, seedHomeBehind } from "@/lib/runs/history"
import { useSwipeDismiss } from "@/lib/sheet/swipe-dismiss"
import type { WorkoutRecordView } from "@/lib/workouts/record"

/**
 * `/workouts/:id`, IN THE BROWSER. Ticket `0345`. `06-ui-ux.md` §2.6, D-486.
 *
 * A PLAIN RECORD in the workout list's column: the date, what was logged, the XP each skill earned.
 * It is the Chronicle's panel (`CHRONICLE_CSS`) holding a record instead of a list, under the same
 * `(home)` layout, so the map beside it stays live and the camera never moves. It has NO ⟲ Relive,
 * no "Return from the Fog" and no motion of any kind: there is no territory to show (§6.4).
 *
 * It reads nothing and writes nothing. Everything on it was read on the server and arrives as
 * props; `workout-record.test.tsx` holds that opening it touches no store.
 *
 * Esc, the close control and back are all `router.back()`: from the list, that is the list again.
 * A cold deep link gets `/` slipped in behind it, as the Chronicle does (`seedHomeBehind`).
 */

const tabular: CSSProperties = { fontVariantNumeric: "tabular-nums" }
const heading: CSSProperties = {
  margin: 0,
  font: "600 12px/1.2 var(--font-sans)",
  letterSpacing: ".08em",
  color: "var(--text-secondary)",
}
const line: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "baseline",
  gap: 8,
  padding: "8px 0",
  borderBottom: "1px solid var(--line)",
  font: "400 15px/1.45 var(--font-sans)",
}
const secondary: CSSProperties = { color: "var(--text-secondary)" }

export function WorkoutRecord({ view }: { view: WorkoutRecordView }) {
  const router = useRouter()
  const panel = useRef<HTMLElement | null>(null)
  const dismiss = useCallback(() => router.back(), [router])
  useSwipeDismiss(panel, dismiss)

  useEffect(() => {
    seedHomeBehind(browserHistoryHost())
    panel.current?.focus({ preventScroll: true })
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) dismiss()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [dismiss])

  return (
    <section ref={panel} className="chronicle" aria-labelledby="workout-title" data-workout-record="" tabIndex={-1}>
      <style>{CHRONICLE_CSS}</style>
      <header className="chronicle-head">
        <h2 style={heading}>WORKOUT</h2>
        <button type="button" className="chronicle-close" aria-label="Close the workout" onClick={dismiss}>
          <span aria-hidden="true">×</span>
        </button>
      </header>

      <div style={{ padding: 16 }}>
        <h3 id="workout-title" style={{ ...tabular, margin: 0, font: "600 17px/1.35 var(--font-sans)" }}>
          {view.date}
        </h3>
        <p style={{ margin: "4px 0 0", font: "400 13px/1.35 var(--font-sans)", ...secondary }}>
          {view.name && view.name !== view.kind ? `${view.kind} · ${view.name}` : view.kind}
        </p>

        <h4 style={{ ...heading, marginTop: 24 }}>LOGGED</h4>
        <ul aria-label="What was logged" data-logged="" style={{ listStyle: "none", margin: "4px 0 0", padding: 0 }}>
          {view.logged.map((l, i) => (
            <li key={i} style={line}>
              <span>{l.what}</span>
              <span style={tabular}>
                {l.measure ?? ""}
                {l.share ? <span style={secondary}>{l.measure ? " · " : ""}{l.share}</span> : null}
              </span>
            </li>
          ))}
        </ul>

        <h4 style={{ ...heading, marginTop: 24 }}>EARNED</h4>
        {view.xp === null ? (
          <p style={{ margin: "8px 0 0", font: "400 13px/1.45 var(--font-sans)", ...secondary }} data-xp-unavailable="">
            The XP for this workout could not be read just now.
          </p>
        ) : view.xp.length === 0 ? (
          <p style={{ margin: "8px 0 0", font: "400 13px/1.45 var(--font-sans)", ...secondary }}>No XP recorded.</p>
        ) : (
          <ul aria-label="XP earned" data-earned="" style={{ listStyle: "none", margin: "4px 0 0", padding: 0 }}>
            {view.xp.map((x) => (
              <li key={x.skillId} style={line} data-skill={x.skillId}>
                <span>{x.name}</span>
                <span style={tabular}>{x.xp}</span>
              </li>
            ))}
            {view.xp.length > 1 && view.totalXp ? (
              <li style={{ ...line, borderBottom: 0, fontWeight: 600 }}>
                <span>Total</span>
                <span style={tabular}>{view.totalXp}</span>
              </li>
            ) : null}
          </ul>
        )}
      </div>
    </section>
  )
}
