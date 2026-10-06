"use client"

import { useEffect, useMemo, useRef, useState } from "react"

import type { Award, RowResult } from "@/lib/log/optimistic"
import { clampValue, formatValue, parseValue, stepValue, type LogRow } from "@/lib/log/rows"
import { holdToRepeat } from "@/lib/log/repeat"

/**
 * ONE `/log` ROW. Ticket 0071, `06-ui-ux.md` §6.3–6.4.
 *
 * Everything on it is read from `row`, which is read from the registry — the label, the step,
 * the floor, the starting value. The component knows two shapes, idle and confirmed, and no
 * workout type.
 *
 * Idle:       `MIGHT  pushups   [−] [ 30 ] [+]  [LOG]`
 * Confirmed:  `MIGHT 30 pushups · Might +120 → L31 · ⟲ Undo 7s`, gold, with a bar wipe.
 *
 * NO CONFIRMATION DIALOG, ANYWHERE (0071's notes). The 8-second undo is why: it handles the
 * mis-click afterwards instead of taxing every log in advance. No gesture is the only path to
 * anything, and there is no swipe, no drag and no long-press action on this row.
 */

/** What a click produced. Owned by the page; the row only displays it and hands it back to undo. */
export interface Logged {
  key: string
  value: number
  result: RowResult
  /** `Date.now()` at which undo stops being possible. */
  holdUntil: number
  award: Award
  /** The last value before this log, restored on undo. */
  previous: number | undefined
}

const control: React.CSSProperties = {
  minWidth: "2.75rem",
  height: "2.75rem",
  borderRadius: ".375rem",
  border: "1px solid var(--line)",
  background: "var(--surface-raised)",
  color: "var(--text-primary)",
  font: "inherit",
  fontSize: "1.25rem",
  cursor: "pointer",
  touchAction: "manipulation",
  userSelect: "none",
}

const logButton: React.CSSProperties = {
  ...control,
  minWidth: "5.5rem",
  marginLeft: "auto",
  border: "1px solid var(--accent)",
  color: "var(--accent-text)",
  fontSize: "1rem",
  fontWeight: 700,
  letterSpacing: ".08em",
}

const card: React.CSSProperties = {
  border: "1px solid var(--line)",
  borderRadius: ".5rem",
  background: "var(--surface)",
  padding: ".75rem",
  minHeight: "6.5rem",
  boxSizing: "border-box",
}

/** §8.7: reduced motion removes the wipe's motion, never the confirmation. */
const REDUCED_MOTION_CSS =
  "@media (prefers-reduced-motion: reduce) { .log-bar-fill { transition: none !important; } }"

export function LogRowView({
  row,
  initialValue,
  disabled,
  onLog,
  onUndo,
}: {
  row: LogRow
  /** The last logged value, or the registry fallback. `undefined` while IndexedDB answers. */
  initialValue: number | undefined
  disabled: boolean
  onLog(value: number): Promise<Logged | undefined>
  onUndo(logged: Logged): Promise<boolean>
}) {
  const [value, setValue] = useState<number>()
  const [draft, setDraft] = useState<string>()
  const [logged, setLogged] = useState<Logged>()
  const [now, setNow] = useState(() => Date.now())
  const [wiped, setWiped] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)
  const undoRef = useRef<HTMLButtonElement>(null)
  const logRef = useRef<HTMLButtonElement>(null)
  const refocusLog = useRef(false)

  // The last logged value arrives from IndexedDB once; after that the row owns its number.
  useEffect(() => {
    if (value === undefined && initialValue !== undefined) setValue(clampValue(row, initialValue))
  }, [initialValue, value, row])

  const current = value ?? initialValue ?? row.fallback

  // `setValue` with an updater, because the repeater calls this closure four times a second.
  // Depends on `row` alone: rebuilding it per step would stop a hold after its first repeat.
  const minus = useMemo(() => holdToRepeat(() => setValue((v) => stepValue(row, v ?? row.fallback, -1))), [row])
  const plus = useMemo(() => holdToRepeat(() => setValue((v) => stepValue(row, v ?? row.fallback, 1))), [row])
  useEffect(() => () => (minus.stop(), plus.stop()), [minus, plus])

  // The countdown, and the row settling back once the window closes.
  useEffect(() => {
    if (!logged) return
    const id = setInterval(() => {
      const t = Date.now()
      setNow(t)
      if (t >= logged.holdUntil) {
        refocusLog.current = cardRef.current?.contains(document.activeElement) ?? false
        setLogged(undefined)
      }
    }, 250)
    return () => clearInterval(id)
  }, [logged])

  // Focus follows the control that replaced the one you used, so a keyboard never falls out.
  useEffect(() => {
    if (logged) {
      undoRef.current?.focus()
      setWiped(false)
      const raf = requestAnimationFrame(() => setWiped(true))
      return () => cancelAnimationFrame(raf)
    }
    if (refocusLog.current) {
      refocusLog.current = false
      logRef.current?.focus()
    }
  }, [logged])

  const label = `${row.skillName}: ${row.label}`
  const shown = formatValue(row, current)

  const commitDraft = () => {
    if (draft === undefined) return
    const parsed = parseValue(row, draft)
    if (parsed !== null) setValue(clampValue(row, parsed))
    setDraft(undefined)
  }

  const log = async () => {
    // A typed number not yet committed is the number being logged.
    let v = current
    if (draft !== undefined) {
      const parsed = parseValue(row, draft)
      if (parsed !== null) v = clampValue(row, parsed)
      setValue(v)
      setDraft(undefined)
    }
    const result = await onLog(v)
    if (result) {
      setNow(Date.now())
      setLogged(result)
    }
  }

  const undo = async () => {
    if (!logged) return
    const ok = await onUndo(logged)
    refocusLog.current = true
    if (ok) setValue(logged.value)
    setLogged(undefined)
  }

  // Pointer presses step through the repeater; a keyboard click (`detail === 0`) steps once.
  const stepper = (r: ReturnType<typeof holdToRepeat>, direction: 1 | -1, name: string) => ({
    type: "button" as const,
    "aria-label": `${name} ${row.label} by ${formatValue(row, row.step)}`,
    disabled: disabled || (direction === -1 && current <= row.min),
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0) return
      ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
      r.start()
    },
    onPointerUp: () => r.stop(),
    onPointerCancel: () => r.stop(),
    onLostPointerCapture: () => r.stop(),
    onClick: (e: React.MouseEvent) => {
      if (e.detail === 0) setValue((v) => stepValue(row, v ?? row.fallback, direction))
    },
    style: control,
  })

  if (logged) {
    const remaining = Math.max(0, Math.ceil((logged.holdUntil - now) / 1000))
    return (
      <div ref={cardRef} role="group" aria-label={label} style={{ ...card, color: "var(--accent-text)" }}>
        <style>{REDUCED_MOTION_CSS}</style>
        <p aria-live="polite" style={{ margin: 0, fontWeight: 700 }}>
          <span style={{ letterSpacing: ".08em" }}>{row.skillName.toUpperCase()}</span>{" "}
          {formatValue(row, logged.value)} {row.label}
        </p>
        <div style={{ display: "flex", alignItems: "center", gap: ".75rem", marginTop: ".5rem" }}>
          <span>
            {row.skillName} +{logged.result.xpGained} → L{logged.result.level}
          </span>
          <button
            ref={undoRef}
            type="button"
            onClick={() => void undo()}
            aria-label={`Undo ${formatValue(row, logged.value)} ${row.label}, ${remaining} seconds left`}
            style={{ ...logButton, minWidth: "7rem" }}
          >
            ⟲ Undo {remaining}s
          </button>
        </div>
        <div aria-hidden style={{ height: "6px", background: "var(--line)", borderRadius: "3px", marginTop: ".5rem", overflow: "hidden" }}>
          <div
            className="log-bar-fill"
            style={{
              height: "100%",
              width: `${Math.round((wiped ? logged.result.progress : 0) * 100)}%`,
              background: "var(--progress-activity)",
              transition: "width 600ms ease-out",
            }}
          />
        </div>
      </div>
    )
  }

  return (
    <div ref={cardRef} role="group" aria-label={label} style={card}>
      <p style={{ margin: "0 0 .5rem", display: "flex", gap: ".75rem", alignItems: "baseline" }}>
        <span style={{ color: "var(--text-primary)", fontWeight: 700, letterSpacing: ".08em" }}>
          {row.skillName.toUpperCase()}
        </span>
        <span style={{ color: "var(--text-secondary)" }}>{row.label}</span>
      </p>
      <div style={{ display: "flex", alignItems: "center", gap: ".5rem" }}>
        <button {...stepper(minus, -1, "Decrease")}>−</button>
        <input
          type="text"
          inputMode="numeric"
          aria-label={row.entry === "seconds" ? `${row.label}, minutes and seconds` : `${row.label}, count`}
          value={draft ?? shown}
          disabled={disabled}
          onFocus={(e) => {
            setDraft(shown)
            e.currentTarget.select()
          }}
          onChange={(e) => setDraft(e.currentTarget.value)}
          onBlur={commitDraft}
          onKeyDown={(e) => {
            // Enter COMMITS THE NUMBER and does not log (0071). Escape abandons the edit.
            if (e.key === "Enter") {
              e.preventDefault()
              commitDraft()
            } else if (e.key === "Escape") {
              setDraft(undefined)
              e.currentTarget.blur()
            }
          }}
          style={{
            ...control,
            width: "5rem",
            textAlign: "center",
            cursor: "text",
            border: "2px solid var(--text-secondary)",
            fontVariantNumeric: "tabular-nums",
          }}
        />
        <button {...stepper(plus, 1, "Increase")}>+</button>
        <button
          ref={logRef}
          type="button"
          disabled={disabled}
          onClick={() => void log()}
          aria-label={`Log ${shown} ${row.label}`}
          style={{ ...logButton, opacity: disabled ? 0.6 : 1 }}
        >
          LOG
        </button>
      </div>
    </div>
  )
}
