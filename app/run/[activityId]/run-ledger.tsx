"use client"

import { useEffect, useMemo, useState, useSyncExternalStore } from "react"

import { rulesForSkills, type CachedSkill } from "@/lib/log/optimistic"
import { fetchSkills } from "@/lib/log/transport"
import { beat2End, countAt, type Beat2Frame } from "@/lib/run-moment/beat2"
import { breakdownText, kmText, tallyFor, type Tally } from "@/lib/run-moment/tally"
import { runDate, runDistance, xpNumber } from "@/lib/runs/format"
import type { ActivityLedgerRow } from "@/lib/runs/ledger"
import { fetchActivityLedger } from "@/lib/runs/ledger-transport"
import type { RunSummary } from "@/lib/runs/wire"

/**
 * THE TALLY. Ticket `0078` laid the ledger out still; `0081` makes it beat 2. `06-ui-ux.md` §3.2.
 *
 * ONE COMPONENT, TWO SEATS. During the sequence it rides the parchment panel and `frame` comes from
 * `beat2At`; in the end state it sits in the column with the settled frame. The numbers are
 * `tallyFor`'s either way, so the two cannot show different things.
 *
 * Plain DOM, and nothing in it reads the map: §3.4, *"the numbers must never depend on the
 * graphics"*.
 *
 * NEVER A ZERO (§3.5). A skill that earned nothing has no line, the cells line drops whichever half
 * is zero, and the new-road line is absent rather than `0.00 km`. The click-breakdown is where the
 * whole truth lives.
 *
 * NO SPINNER (§3.2). While the ledger is being read the section renders its heading and nothing
 * else; a failure is one quiet line.
 */

const rowGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(6.5rem, max-content) 6ch minmax(3rem, 1fr) 6ch max-content",
  alignItems: "center",
  columnGap: ".75rem",
  width: "100%",
  padding: ".4rem 0",
  border: 0,
  borderBottom: "1px solid var(--line)",
  background: "transparent",
  color: "var(--text-primary)",
  font: "inherit",
  textAlign: "left",
  cursor: "pointer",
  fontVariantNumeric: "tabular-nums",
}

const num: React.CSSProperties = { textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }

/** The lines below the skill rows, in order. Each is present only when it has something to say. */
type Footer = "cells" | "record" | "km" | "total" | "level"

type FooterSummary = Pick<RunSummary, "newCellCount" | "rearmedCellCount"> & Partial<Pick<RunSummary, "distanceM">>

/**
 * `0085`. A RUN WITH NO NEW GROUND SAYS WHAT IT ADDED, IN DISTANCE (§3.5): *"5.1 km added to the
 * record"* stands where the cells line would, so the summary is never a cell count and never a zero.
 * Absent when there is no distance either — then Total XP carries the bottom alone (§3.5's *"there
 * is always something"*).
 */
export function tallyFooters(tally: Tally, summary: FooterSummary): Footer[] {
  const out: Footer[] = []
  if (summary.newCellCount > 0 || summary.rearmedCellCount > 0) out.push("cells")
  else if (runDistance(summary.distanceM ?? null)) out.push("record")
  if (tally.newKm !== null) out.push("km")
  // §3.5: Total XP is always on screen. Without a `before` (D-296's read failed) it is the run's
  // own gain alone — `Total XP +442` — never dropped (`0265`, D-310).
  if (tally.total || tally.runXp > 0) out.push("total")
  if (tally.totalLevel !== null) out.push("level")
  return out
}

/** How many lines beat 2 staggers: the skill rows, then the footers. */
export function tallyLineCount(tally: Tally, summary: FooterSummary): number {
  return tally.lines.length + tallyFooters(tally, summary).length
}

export function TallyView({
  summary,
  tally,
  skillName,
  error,
  frame,
  expanded = new Set(),
  onToggle,
}: {
  summary: Pick<RunSummary, "startedAtLocal" | "distanceM" | "newCellCount" | "rearmedCellCount">
  /** `undefined` while it is being read. */
  tally: Tally | undefined
  skillName: (id: string) => string
  error?: string
  /** Beat 2's frame. Omitted: the settled tally. */
  frame?: Beat2Frame
  expanded?: ReadonlySet<string>
  onToggle?: (skillId: string) => void
}) {
  const distance = runDistance(summary.distanceM)
  const footers = tally ? tallyFooters(tally, summary) : []
  const f = frame ?? beat2End(tally ? tally.lines.length + footers.length : 0)
  const line = (i: number): React.CSSProperties => {
    const l = f.lines[i]
    return l ? { opacity: l.opacity, transform: l.dy ? `translateY(${l.dy}px)` : undefined } : {}
  }
  const progress = (i: number) => f.lines[i]?.count ?? 1

  const cells = [
    summary.newCellCount > 0 ? `${xpNumber(summary.newCellCount)} cells claimed` : null,
    summary.rearmedCellCount > 0 ? `${xpNumber(summary.rearmedCellCount)} remembered` : null,
  ].filter(Boolean)

  const footer = (kind: Footer, i: number) => {
    const style = { ...line(i), margin: ".5rem 0 0", fontVariantNumeric: "tabular-nums" as const }
    switch (kind) {
      case "cells":
        return <p key={kind} data-line="cells" style={{ ...style, color: "var(--text-secondary)" }}>{cells.join(" · ")}</p>
      case "record":
        return <p key={kind} data-line="record" style={{ ...style, color: "var(--text-secondary)" }}>{distance} added to the record</p>
      case "km":
        return <p key={kind} data-line="km" style={{ ...style, margin: ".25rem 0 0", color: "var(--text-secondary)" }}>{kmText(tally!.newKm!)} never run before</p>
      case "total": {
        if (!tally!.total) {
          return (
            <p key={kind} data-line="total" style={{ ...style, margin: "1rem 0 0", color: "var(--text-primary)" }}>
              Total XP <strong style={num}>+{xpNumber(countAt(tally!.runXp, progress(i)))}</strong>
            </p>
          )
        }
        const { before, after } = tally!.total!
        const shown = before + countAt(after - before, progress(i))
        return (
          <p key={kind} data-line="total" style={{ ...style, margin: "1rem 0 0", color: "var(--text-primary)" }}>
            Total XP <span style={num}>{xpNumber(before)}</span> → <strong style={num}>{xpNumber(shown)}</strong>{" "}
            <span style={{ ...num, color: "var(--text-secondary)" }}>(+{xpNumber(after - before)})</span>
          </p>
        )
      }
      case "level":
        return <p key={kind} data-line="level" style={{ ...style, margin: ".25rem 0 0", color: "var(--text-primary)" }}>Total Level <strong>{tally!.totalLevel}</strong></p>
    }
  }

  return (
    <section aria-label="Ledger" data-slot="ledger">
      <header style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap", marginBottom: ".5rem" }}>
        <h2 style={{ margin: 0, fontFamily: "var(--font-serif)", fontWeight: 600, fontSize: "1rem", letterSpacing: ".08em", color: "var(--text-primary)" }}>RETURN FROM THE FOG</h2>
        <span style={{ color: "var(--text-secondary)" }}>
          {runDate(summary.startedAtLocal, { year: false })}
          {distance ? ` · ${distance}` : null}
        </span>
      </header>

      {error ? <p style={{ color: "var(--text-muted)" }}>Ledger unavailable: {error}</p> : null}

      {tally ? (
        <>
          {tally.lines.map((l, i) => {
            const p = progress(i)
            const open = expanded.has(l.skillId)
            const s = l.standing
            const fill = s ? s.barFrom + (s.barTo - s.barFrom) * p : 0
            return (
              <div key={l.skillId} data-skill={l.skillId} style={line(i)}>
                <button
                  type="button"
                  data-sequence-control=""
                  style={rowGrid}
                  aria-expanded={open}
                  aria-label={`${skillName(l.skillId)}, +${xpNumber(l.xp)} XP${s ? `, level ${s.levelAfter}${s.levelUp ? ", level gained" : ""}` : ""}. Show the reasons.`}
                  onClick={() => onToggle?.(l.skillId)}
                >
                  <span>{skillName(l.skillId)}</span>
                  <span style={num} data-count>+{xpNumber(countAt(l.xp, p))}</span>
                  {s ? (
                    <>
                      <span aria-hidden="true" style={{ height: 6, background: "var(--line)", borderRadius: 3, overflow: "hidden" }}>
                        <span data-bar style={{ display: "block", height: "100%", width: `${(fill * 100).toFixed(2)}%`, background: "var(--text-secondary)" }} />
                      </span>
                      <span style={num}>
                        L{s.levelAfter}
                        {/* D-148 / D-296: a meaning-bearing mark on parchment needs 3:1 — the activity
                            fill's token, not `--gold-500` (2.24:1). Shown once the bar is full. OPACITY,
                            not `visibility`: an explicit `visible` overrides the veiled column's
                            inherited `hidden` and shows through it (0081's smoke caught exactly that). */}
                        <span aria-hidden="true" style={{ color: "var(--progress-activity)", opacity: s.levelUp && p >= 1 ? 1 : 0 }}>↑</span>
                      </span>
                      <span style={{ ...num, color: "var(--text-secondary)" }}>
                        {s.xpToNext > 0 ? `${xpNumber(s.xpToNext)} →${s.levelAfter + 1}` : ""}
                      </span>
                    </>
                  ) : null}
                </button>
                {open ? (
                  <p data-breakdown style={{ margin: ".25rem 0 .5rem", color: "var(--text-secondary)", fontVariantNumeric: "tabular-nums" }}>
                    {breakdownText(l.parts)}
                  </p>
                ) : null}
              </div>
            )
          })}
          {footers.map((k, j) => footer(k, tally.lines.length + j))}
          {tally.lines.some((l) => l.parts.length > 0) ? <ExpandHint /> : null}
        </>
      ) : null}
    </section>
  )
}

const COARSE = "(pointer: coarse)"
const subscribeCoarse = (cb: () => void) => {
  const mq = window.matchMedia?.(COARSE)
  mq?.addEventListener("change", cb)
  return () => mq?.removeEventListener("change", cb)
}

/**
 * `0267`. §3.2's mockup ends the tally with `[ tap a row for ⌄ ]`: without it the reason breakdown —
 * what makes the numbers accountable — is undiscoverable (D-051). "click" on the desktop, the
 * viewing surface (D-227); "tap" only on a coarse pointer. Static, so nothing reflows while the
 * counts run, and `aria-hidden`: the row buttons already say they expand.
 */
function ExpandHint() {
  const coarse = useSyncExternalStore(subscribeCoarse, () => window.matchMedia?.(COARSE).matches ?? false, () => false)
  return (
    <p aria-hidden="true" data-hint="expand" style={{ margin: ".75rem 0 0", textAlign: "right", fontSize: ".75rem", color: "var(--text-muted)" }}>
      {coarse ? "tap" : "click"} a row for ⌄
    </p>
  )
}

/** What the page reads for the tally: this run's ledger rows and the ruleset's names and curve. */
export function useRunTally(summary: RunSummary, xpBefore: Record<string, number> | null) {
  const [rows, setRows] = useState<ActivityLedgerRow[]>()
  const [skills, setSkills] = useState<CachedSkill[]>([])
  const [error, setError] = useState("")

  useEffect(() => {
    let live = true
    fetchActivityLedger(summary.activityId).then(
      (r) => live && setRows(r),
      (e: unknown) => live && setError(e instanceof Error ? e.message : String(e)),
    )
    // Names and the version only. A failure leaves the newest bundled ruleset, whose names are the same.
    fetchSkills().then(
      (s) => live && setSkills(s),
      () => undefined,
    )
    return () => {
      live = false
    }
  }, [summary.activityId])

  const rules = useMemo(() => rulesForSkills(skills), [skills])
  const tally = useMemo(() => (rows ? tallyFor(rows, xpBefore, rules) : undefined), [rows, xpBefore, rules])
  const skillName = useMemo(() => (id: string) => rules.skills.find((s) => s.id === id)?.name ?? id, [rules])
  return { tally, skillName, rules, xpBefore, error: error || undefined }
}

/** The end state's seat: the settled tally, with its own expand state. */
export function RunLedger({
  summary,
  data,
}: {
  summary: RunSummary
  data: ReturnType<typeof useRunTally>
}) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const onToggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (!next.delete(id)) next.add(id)
      return next
    })
  return <TallyView summary={summary} tally={data.tally} skillName={data.skillName} error={data.error} expanded={expanded} onToggle={onToggle} />
}
