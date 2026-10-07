"use client"

import { useEffect, useRef, type CSSProperties } from "react"

import { Sigil } from "@/components/sigil"
import { reasonWords, type PlaceMilestone, type SkillDetail } from "@/lib/skills/detail"

/**
 * THE SKILL DETAIL SHEET. Ticket 0074, `06-ui-ux.md` §5.5.
 *
 * Pure presentation of `skillDetail()`'s model, and ONE component for every skill: nothing here
 * names one (I-25). Vigil's sheet differs from Wayfaring's only in what its row and ledger hand
 * over — a rules sentence without a ground clause, and no places, so no `ON THE MAP` heading.
 *
 * Dismissal has three paths and none is the only one: Esc, a click on the scrim, and the close
 * button — plus the browser's back, which works because the sheet is a route.
 *
 * NO CHART, GRAPH OR SPARKLINE (§5.5): a line going up over time is a stats page and invites
 * comparison with your past self (N4). The bar and the ladder are enough. And nothing is an
 * instruction: `AHEAD` is an estimate, never a target, at a precision no deadline can be read from.
 */

const fmt = new Intl.NumberFormat("en-US")
const tabular: CSSProperties = { fontVariantNumeric: "tabular-nums" }

const SHEET_CSS =
  ".skill-scrim { align-items: flex-end; }" +
  " .skill-sheet { width: 100%; max-height: 88dvh; border-radius: 8px 8px 0 0; }" +
  " @media (min-width: 1024px) {" +
  " .skill-scrim { align-items: center; }" +
  " .skill-sheet { width: 32rem; max-height: 80dvh; border-radius: 8px; } }"

const sectionLabel: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: ".5rem",
  fontSize: ".75rem",
  letterSpacing: ".08em",
  color: "var(--text-muted)",
  margin: "1.25rem 0 .5rem",
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section aria-label={label}>
      <h3 style={sectionLabel}>
        {label}
        <span style={{ flex: 1, height: 1, background: "var(--line)" }} />
      </h3>
      {children}
    </section>
  )
}

const row: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "7.5rem 1fr auto",
  gap: ".5rem",
  alignItems: "baseline",
  padding: ".25rem 0",
}

function dayLabel(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(d)
}

export function SkillSheet({
  skillId,
  detail,
  onDismiss,
  onFly,
}: {
  skillId: string
  detail: SkillDetail | null
  onDismiss(): void
  onFly(place: PlaceMilestone): void
}) {
  const dialog = useRef<HTMLDivElement | null>(null)
  // The caller's `onDismiss` is a new function each render; the listener below is installed once.
  const dismiss = useRef(onDismiss)
  dismiss.current = onDismiss

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss.current()
    }
    window.addEventListener("keydown", onKey)
    dialog.current?.focus()
    // The panel underneath must not scroll while the sheet is over it.
    const overflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      window.removeEventListener("keydown", onKey)
      document.body.style.overflow = overflow
    }
  }, [])

  return (
    <div
      className="skill-scrim"
      data-scrim=""
      onClick={(e) => {
        if (e.target === e.currentTarget) onDismiss()
      }}
      style={{ position: "fixed", inset: 0, zIndex: 10, display: "flex", justifyContent: "center", background: "var(--scrim)" }}
    >
      <style>{SHEET_CSS}</style>
      <div
        ref={dialog}
        className="skill-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="skill-sheet-title"
        tabIndex={-1}
        style={{
          position: "relative",
          overflowY: "auto",
          boxSizing: "border-box",
          background: "var(--surface-raised)",
          color: "var(--text-primary)",
          border: "1px solid var(--line)",
          padding: "1.25rem 1.25rem 1.75rem",
          outline: "none",
        }}
      >
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Close"
          style={{
            position: "absolute",
            top: ".5rem",
            right: ".5rem",
            background: "none",
            border: "none",
            color: "var(--text-secondary)",
            fontSize: "1.5rem",
            lineHeight: 1,
            padding: ".5rem",
            cursor: "pointer",
          }}
        >
          ×
        </button>
        {detail ? <Body detail={detail} onFly={onFly} /> : <NotFound skillId={skillId} />}
      </div>
    </div>
  )
}

function NotFound({ skillId }: { skillId: string }) {
  return (
    <div data-not-found="">
      <h2 id="skill-sheet-title" style={{ margin: "0 2rem .5rem 0", fontSize: "1.125rem", letterSpacing: ".08em" }}>
        NO SUCH SKILL
      </h2>
      <p style={{ margin: 0, color: "var(--text-secondary)" }}>
        There is no skill called “{skillId}”.
      </p>
    </div>
  )
}

function Body({ detail, onFly }: { detail: SkillDetail; onFly(place: PlaceMilestone): void }) {
  return (
    <>
      <header style={{ display: "flex", gap: "1rem", alignItems: "flex-start", marginRight: "2rem" }}>
        <span style={{ color: "var(--text-secondary)", paddingTop: ".25rem" }}>
          <Sigil skillId={detail.skillId} size={36} />
        </span>
        <div style={{ flex: 1 }}>
          <h2 id="skill-sheet-title" style={{ margin: 0, fontSize: "1.125rem", letterSpacing: ".08em" }}>
            {detail.name.toUpperCase()}
          </h2>
          <p style={{ margin: ".125rem 0 .5rem", color: "var(--text-secondary)" }}>
            Level <span style={{ ...tabular, color: "var(--text-primary)" }}>{detail.level}</span>
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: ".75rem" }}>
            <span data-bar="" style={{ flex: 1, display: "block", height: 4, background: "var(--line)" }}>
              <span
                style={{
                  display: "block",
                  height: "100%",
                  width: `${Math.round(Math.min(Math.max(detail.fraction, 0), 1) * 1000) / 10}%`,
                  background: detail.kind === "meta" ? "var(--progress-meta)" : "var(--progress-activity)",
                }}
              />
            </span>
            <span data-xp="" style={{ ...tabular, fontSize: ".8125rem", color: "var(--text-secondary)" }}>
              {fmt.format(detail.xp)}
              {detail.atMax ? "" : ` / ${fmt.format(detail.nextXp)}`}
            </span>
          </div>
          {detail.atMax ? null : (
            <p data-to-next="" style={{ ...tabular, margin: ".375rem 0 0", fontSize: ".875rem", color: "var(--text-secondary)" }}>
              {fmt.format(detail.xpToNext)} XP to {detail.level + 1}
              {detail.sessionsToNext ? <span>{`   ·   ${detail.sessionsToNext}`}</span> : null}
            </p>
          )}
        </div>
      </header>

      {detail.rules ? (
        <p data-rules="" style={{ margin: "1.25rem 0 0", color: "var(--text-primary)", lineHeight: 1.45 }}>
          {detail.rules}
        </p>
      ) : null}

      {detail.recent.length > 0 || detail.carried > 0 ? (
        <Section label="RECENT">
          {detail.recent.map((r) => (
            <details key={r.activityId} data-recent="">
              <summary style={{ ...row, cursor: "pointer", listStyle: "none" }}>
                <span style={{ color: "var(--text-secondary)" }}>{dayLabel(r.startedAt)}</span>
                <span style={tabular}>{r.units ?? ""}</span>
                <span style={{ ...tabular, color: "var(--text-primary)" }}>+{fmt.format(r.xp)}</span>
              </summary>
              <ul style={{ listStyle: "none", margin: "0 0 .25rem", padding: "0 0 0 7.5rem", fontSize: ".8125rem", color: "var(--text-muted)" }}>
                {r.parts.map((p) => (
                  <li key={p.reason} style={{ display: "flex", gap: ".5rem", justifyContent: "space-between" }}>
                    <span>
                      {reasonWords(p.reason)}
                      {p.units ? ` · ${p.units}` : ""}
                    </span>
                    <span style={tabular}>+{fmt.format(p.xp)}</span>
                  </li>
                ))}
              </ul>
            </details>
          ))}
          {/* Counted, never listed: RECENT is ten rows, not a history. The Chronicle owns that. */}
          {detail.more > 0 ? (
            <p data-more="" style={{ margin: ".25rem 0 0", color: "var(--text-muted)", fontSize: ".875rem" }}>
              … {fmt.format(detail.more)} more
            </p>
          ) : null}
          {detail.carried > 0 ? (
            <p data-carried="" style={{ ...tabular, margin: ".25rem 0 0", color: "var(--text-muted)", fontSize: ".875rem" }}>
              +{fmt.format(detail.carried)} carried from an earlier ruleset
            </p>
          ) : null}
        </Section>
      ) : null}

      {detail.ahead.length > 0 ? (
        <Section label="AHEAD">
          {detail.ahead.map((a) => (
            <div key={a.level} data-ahead="" style={{ ...row, gridTemplateColumns: "2.5rem 1fr auto" }}>
              <span style={{ ...tabular, color: "var(--text-primary)" }}>{a.level}</span>
              <span>{a.name}</span>
              <span style={{ color: "var(--text-secondary)" }}>{a.estimate ?? ""}</span>
            </div>
          ))}
        </Section>
      ) : null}

      {/* Omitted, not empty, when nothing this skill earned is on the map (§5.5). */}
      {detail.places.length > 0 ? (
        <Section label="ON THE MAP">
          {detail.places.map((p) => (
            <div key={`${p.level}:${p.label}`} data-place="" style={{ display: "flex", gap: ".5rem", alignItems: "baseline", padding: ".25rem 0" }}>
              <span style={{ color: "var(--accent-text)" }}>◈</span>
              <span style={{ flex: 1 }}>{p.label}</span>
              <button
                type="button"
                onClick={() => onFly(p)}
                style={{ background: "none", border: "none", color: "var(--accent-text)", cursor: "pointer", padding: ".25rem", font: "inherit" }}
              >
                → fly to
              </button>
            </div>
          ))}
        </Section>
      ) : null}
    </>
  )
}
