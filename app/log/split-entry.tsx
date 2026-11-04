"use client"

import { useEffect, useMemo, useRef, useState } from "react"

import { Sigil } from "@/components/sigil"
import type { LogSplit, SplitLogLine, SplitPreviewRegion } from "@/lib/log/layout"
import type { Award } from "@/lib/log/optimistic"
import { clampValue, formatTime, parseValue, stepValue } from "@/lib/log/rows"
import { holdToRepeat } from "@/lib/log/repeat"

import { card, control, logButton } from "./log-row"

/**
 * THE SPLIT ENTRY. Ticket 0344, D-483, `06-ui-ux.md` §6.3–§6.4 as amended (D-485).
 *
 * One log of N minutes shared across a split's members: the Strength workout, today. Everything is
 * read from `split` (its label, members, step and share step), which is read from the ruleset, so
 * a second split in the YAML renders here with no code and no member id appears (D-031).
 *
 * Idle:       `STRENGTH WORKOUT  [−] [45 min] [+]  [LOG]`, then per member a ten-block share bar
 *             with its minutes and XP, then the sum line. Every share starts at 0% (operator,
 *             0344); the length starts at the last split log's. LOG waits for 100%.
 * Confirmed:  every skill the log paid, `Might +540 → L8`, and the in-row 8-second undo, exactly
 *             as a single row confirms (§6.4).
 *
 * THE SHARE BAR is a slider to assistive technology and the keyboard (arrows step by the share
 * step, Home is 0%, End is 100%) and ten clickable blocks to the mouse. Clicking a block sets the
 * share to it; clicking the top lit block again steps one block down, so 10% goes back to 0.
 */

/** What a split log produced. Owned by the page. */
export interface SplitLogged {
  key: string
  holdUntil: number
  award: Award
  minutes: number
  percents: number[]
  /** Every skill the log paid, in the order the confirmation lists them. */
  lines: SplitLogLine[]
  /** The length before this log, restored on undo. */
  previous: number | undefined
}

const minutesRow = (split: LogSplit) => ({ entry: split.entry, min: split.min, step: split.step, decimals: 0 })

/** `18 min`, or `13:30` when the share is not whole minutes. */
const regionTime = (s: number) => (s % 60 ? formatTime(s) : `${s / 60} min`)

export function SplitEntryView({
  split,
  initialMinutes,
  disabled,
  preview,
  onLog,
  onUndo,
}: {
  split: LogSplit
  /** The last split log's length, or the split's fallback. `undefined` while IndexedDB answers. */
  initialMinutes: number | undefined
  disabled: boolean
  /** The live readout: whole seconds and XP per member, from `splitPreview`. */
  preview(minutes: number, percents: readonly number[]): { total: number; regions: SplitPreviewRegion[] }
  onLog(minutes: number, percents: readonly number[]): Promise<SplitLogged | undefined>
  onUndo(logged: SplitLogged): Promise<boolean>
}) {
  const row = useMemo(() => minutesRow(split), [split])
  const [minutes, setMinutes] = useState<number>()
  const [draft, setDraft] = useState<string>()
  const [percents, setPercents] = useState<number[]>(() => split.members.map(() => 0))
  const [logged, setLogged] = useState<SplitLogged>()
  const [now, setNow] = useState(() => Date.now())
  const undoRef = useRef<HTMLButtonElement>(null)
  const logRef = useRef<HTMLButtonElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const refocusLog = useRef(false)

  useEffect(() => {
    if (minutes === undefined && initialMinutes !== undefined) setMinutes(clampValue(row, initialMinutes))
  }, [initialMinutes, minutes, row])

  const current = minutes ?? initialMinutes ?? split.fallback
  const minus = useMemo(() => holdToRepeat(() => setMinutes((v) => stepValue(row, v ?? split.fallback, -1))), [row, split.fallback])
  const plus = useMemo(() => holdToRepeat(() => setMinutes((v) => stepValue(row, v ?? split.fallback, 1))), [row, split.fallback])
  useEffect(() => () => (minus.stop(), plus.stop()), [minus, plus])

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

  useEffect(() => {
    if (logged) undoRef.current?.focus()
    else if (refocusLog.current) {
      refocusLog.current = false
      logRef.current?.focus()
    }
  }, [logged])

  const blocks = Math.round(100 / split.shareStep)
  const setShare = (i: number, percent: number) =>
    setPercents((p) => p.map((v, j) => (j === i ? Math.min(100, Math.max(0, percent)) : v)))
  const commitDraft = () => {
    if (draft === undefined) return
    const parsed = parseValue(row, draft)
    if (parsed !== null) setMinutes(clampValue(row, parsed))
    setDraft(undefined)
  }

  const { total, regions } = preview(current, percents)
  const ready = total === 100
  const shown = `${current} min`
  const label = split.label

  const log = async () => {
    let m = current
    if (draft !== undefined) {
      const parsed = parseValue(row, draft)
      if (parsed !== null) m = clampValue(row, parsed)
      setMinutes(m)
      setDraft(undefined)
    }
    const result = await onLog(m, percents)
    if (result) {
      setNow(Date.now())
      setPercents(split.members.map(() => 0))
      setLogged(result)
    }
  }

  const undo = async () => {
    if (!logged) return
    const ok = await onUndo(logged)
    refocusLog.current = true
    // An undone log hands its numbers back, so a wrong share is fixed, not re-entered.
    if (ok) {
      setMinutes(logged.minutes)
      setPercents(logged.percents)
    }
    setLogged(undefined)
  }

  const stepper = (r: ReturnType<typeof holdToRepeat>, direction: 1 | -1, name: string) => ({
    type: "button" as const,
    "aria-label": `${name} workout length by ${split.step} min`,
    disabled: disabled || (direction === -1 && current <= split.min),
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0) return
      ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
      r.start()
    },
    onPointerUp: () => r.stop(),
    onPointerCancel: () => r.stop(),
    onLostPointerCapture: () => r.stop(),
    onClick: (e: React.MouseEvent) => {
      if (e.detail === 0) setMinutes((v) => stepValue(row, v ?? split.fallback, direction))
    },
    style: control,
  })

  if (logged) {
    const remaining = Math.max(0, Math.ceil((logged.holdUntil - now) / 1000))
    const what = `${logged.minutes} min ${label.toLowerCase()}`
    return (
      <div ref={cardRef} role="group" aria-label={label} style={{ ...card, borderColor: "var(--accent)", color: "var(--text-primary)" }}>
        <p aria-live="polite" style={{ margin: 0, fontWeight: 700, display: "flex", gap: ".5rem", alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ display: "inline-flex", gap: ".5rem", alignItems: "center", letterSpacing: ".08em" }}>
            <Sigil skillId={split.splitId} size={20} />
            {label.toUpperCase()}
          </span>
          <span style={{ fontWeight: 400, color: "var(--text-secondary)" }}>
            {logged.minutes} min · {logged.percents.filter((p) => p > 0).join(" / ")}%
          </span>
        </p>
        <ul style={{ listStyle: "none", margin: ".5rem 0 0", padding: 0, display: "grid", gap: ".15rem", fontVariantNumeric: "tabular-nums" }}>
          {logged.lines.map((l) => (
            <li key={l.skillId} style={{ display: "flex", gap: ".5rem", alignItems: "center" }}>
              <Sigil skillId={l.skillId} size={18} />
              <span>
                {l.name} <b style={{ fontWeight: 600 }}>+{Math.round(l.xpGained).toLocaleString()}</b> → L{l.level}
              </span>
            </li>
          ))}
        </ul>
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: ".5rem" }}>
          <button
            ref={undoRef}
            type="button"
            onClick={() => void undo()}
            aria-label={`Undo ${what}, ${remaining} seconds left`}
            style={{ ...logButton, minWidth: "7rem" }}
          >
            ⟲ Undo {remaining}s
          </button>
        </div>
      </div>
    )
  }

  return (
    <div ref={cardRef} role="group" aria-label={label} style={{ ...card, paddingInline: ".625rem" }}>
      <p style={{ margin: "0 0 .5rem", display: "flex", gap: ".75rem", alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ color: "var(--text-primary)", fontWeight: 700, display: "inline-flex", gap: ".5rem", alignItems: "center", letterSpacing: ".08em" }}>
          <Sigil skillId={split.splitId} size={20} />
          {label.toUpperCase()}
        </span>
        <span style={{ color: "var(--text-secondary)" }}>split by body region</span>
      </p>
      <div style={{ display: "flex", alignItems: "center", gap: ".5rem" }}>
        <button {...stepper(minus, -1, "Decrease")}>−</button>
        <input
          type="text"
          inputMode="numeric"
          aria-label="workout length, minutes"
          value={draft ?? shown}
          disabled={disabled}
          onFocus={(e) => {
            setDraft(shown)
            e.currentTarget.select()
          }}
          onChange={(e) => setDraft(e.currentTarget.value)}
          onBlur={commitDraft}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              commitDraft()
            } else if (e.key === "Escape") {
              setDraft(undefined)
              e.currentTarget.blur()
            }
          }}
          style={{ ...control, width: "5rem", textAlign: "center", cursor: "text", border: "2px solid var(--text-secondary)", fontVariantNumeric: "tabular-nums" }}
        />
        <button {...stepper(plus, 1, "Increase")}>+</button>
        <button
          ref={logRef}
          type="button"
          disabled={disabled || !ready}
          onClick={() => void log()}
          aria-label={`Log ${shown} ${label.toLowerCase()}`}
          style={{ ...logButton, opacity: disabled || !ready ? 0.45 : 1, cursor: ready ? "pointer" : "not-allowed" }}
        >
          LOG
        </button>
      </div>

      <div style={{ display: "grid", gap: ".5rem", margin: ".75rem 0 0", padding: ".6rem 0 0", borderTop: "1px solid var(--line)" }}>
        {split.members.map((m, i) => {
          const p = percents[i] ?? 0
          const r = regions[i]
          const lit = Math.round(p / split.shareStep)
          return (
            <div key={m.exerciseId} className="split-region">
              <div style={{ display: "flex", gap: ".5rem", alignItems: "center", minWidth: 0, whiteSpace: "nowrap" }}>
                <Sigil skillId={m.skillId} size={18} />
                <span style={{ fontWeight: 500 }}>{m.label}</span>
              </div>
              <div style={{ display: "flex", gap: ".5rem", alignItems: "center" }}>
                <div
                  role="slider"
                  tabIndex={disabled ? -1 : 0}
                  aria-label={`${m.label} share`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={p}
                  aria-valuetext={`${p}%`}
                  aria-disabled={disabled || undefined}
                  onKeyDown={(e) => {
                    if (disabled) return
                    const next =
                      e.key === "ArrowRight" || e.key === "ArrowUp" ? p + split.shareStep
                      : e.key === "ArrowLeft" || e.key === "ArrowDown" ? p - split.shareStep
                      : e.key === "Home" ? 0
                      : e.key === "End" ? 100
                      : null
                    if (next === null) return
                    e.preventDefault()
                    setShare(i, next)
                  }}
                  style={{ display: "flex", gap: "2px", padding: "2px", borderRadius: ".25rem" }}
                >
                  {Array.from({ length: blocks }, (_, k) => (
                    <span
                      key={k}
                      aria-hidden
                      onClick={() => {
                        if (disabled) return
                        const v = (k + 1) * split.shareStep
                        setShare(i, p === v ? v - split.shareStep : v)
                      }}
                      style={{
                        width: "1.05rem",
                        height: "1.75rem",
                        borderRadius: "2px",
                        border: `1px solid ${k < lit ? "var(--progress-activity)" : "var(--line)"}`,
                        background: k < lit ? "var(--progress-activity)" : "var(--surface-raised)",
                        cursor: disabled ? "not-allowed" : "pointer",
                        boxSizing: "border-box",
                      }}
                    />
                  ))}
                </div>
                <span style={{ minWidth: "3rem", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{p}%</span>
              </div>
              <div className="split-read" style={{ color: "var(--text-secondary)", fontSize: ".875rem", fontVariantNumeric: "tabular-nums", opacity: p ? 1 : 0.7 }}>
                {r && r.seconds > 0 ? (
                  <>
                    <b style={{ color: "var(--text-primary)", fontWeight: 500 }}>{regionTime(r.seconds)}</b> · {m.skillName} +
                    {Math.round(r.xp).toLocaleString()}
                  </>
                ) : (
                  m.skillName
                )}
              </div>
            </div>
          )
        })}
        <div>
          <div aria-hidden style={{ height: "6px", background: "var(--line)", borderRadius: "3px", overflow: "hidden", display: "flex", margin: ".25rem 0 .2rem" }}>
            {percents.map((p, i) =>
              p ? <span key={i} style={{ display: "block", width: `${p}%`, background: "var(--progress-activity)", borderLeft: i ? "2px solid var(--surface)" : undefined }} /> : null,
            )}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: ".5rem", flexWrap: "wrap", fontSize: ".875rem", color: "var(--text-secondary)", fontVariantNumeric: "tabular-nums" }}>
            <span role="status" style={{ fontWeight: 600, color: ready ? "var(--text-primary)" : "var(--text-secondary)" }}>
              {ready ? "100% — ready to log" : total < 100 ? `${total}% — ${100 - total}% left to place` : `${total}% — ${total - 100}% over`}
            </span>
            <span>
              {ready ? `+${Math.round(regions.reduce((a, r) => a + r.xp, 0)).toLocaleString()} XP` : "LOG waits for 100%"}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
