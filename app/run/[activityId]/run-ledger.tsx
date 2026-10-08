"use client"

import { useEffect, useMemo, useState } from "react"

import { rulesForSkills, type CachedSkill } from "@/lib/log/optimistic"
import { fetchSkills } from "@/lib/log/transport"
import { runDate, runDistance, xpNumber } from "@/lib/runs/format"
import { runLedger, type ActivityLedgerRow, type RunLedger } from "@/lib/runs/ledger"
import { fetchActivityLedger } from "@/lib/runs/ledger-transport"
import type { RunSummary } from "@/lib/runs/wire"

/**
 * THE LEDGER, UN-ANIMATED. Ticket `0078`. `06-ui-ux.md` §3.2 beat 2's content, laid out still.
 *
 * Plain DOM, and nothing in it reads the map: §3.4, *"the numbers must never depend on the
 * graphics"*. `0081` animates these rows and adds the bars, levels and reason breakdown.
 *
 * NO SPINNER (§3.2). While the ledger is being read the section renders its heading and nothing
 * else; a failure is one quiet line.
 */

const row: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: "1rem",
  padding: ".35rem 0",
  borderBottom: "1px solid var(--line)",
  fontVariantNumeric: "tabular-nums",
}

export function LedgerView({
  summary,
  ledger,
  skillName,
  error,
}: {
  summary: Pick<RunSummary, "startedAtLocal" | "distanceM" | "newCellCount" | "rearmedCellCount">
  /** `undefined` while it is being read. */
  ledger: RunLedger | undefined
  skillName: (id: string) => string
  error?: string
}) {
  const distance = runDistance(summary.distanceM)
  // Never a zero (§3.5): each half of the cells line appears only when it is non-zero.
  const cells = [
    summary.newCellCount > 0 ? `${xpNumber(summary.newCellCount)} cells claimed` : null,
    summary.rearmedCellCount > 0 ? `${xpNumber(summary.rearmedCellCount)} remembered` : null,
  ].filter(Boolean)

  return (
    <section aria-label="Ledger" data-slot="ledger">
      <header style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap", marginBottom: ".5rem" }}>
        <h2 style={{ margin: 0, fontSize: "1rem", letterSpacing: ".08em", color: "var(--text-primary)" }}>RETURN FROM THE FOG</h2>
        <span style={{ color: "var(--text-secondary)" }}>
          {runDate(summary.startedAtLocal, { year: false })}
          {distance ? ` · ${distance}` : null}
        </span>
      </header>

      {error ? <p style={{ color: "var(--text-muted)" }}>Ledger unavailable: {error}</p> : null}

      {ledger ? (
        <>
          {ledger.lines.map((l) => (
            <div key={l.skillId} style={row} data-skill={l.skillId}>
              <span style={{ color: "var(--text-primary)" }}>{skillName(l.skillId)}</span>
              <span style={{ color: "var(--text-primary)" }}>+{xpNumber(l.xp)}</span>
            </div>
          ))}
          {cells.length > 0 ? <p style={{ color: "var(--text-secondary)", margin: ".75rem 0 0" }}>{cells.join(" · ")}</p> : null}
          {ledger.totalXp > 0 ? (
            <p style={{ color: "var(--text-primary)", margin: ".5rem 0 0", fontVariantNumeric: "tabular-nums" }}>
              Total XP <strong>+{xpNumber(ledger.totalXp)}</strong>
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  )
}

/** Reads the run's ledger rows and the ruleset's skill names, then draws `LedgerView`. */
export function RunLedger({ summary }: { summary: RunSummary }) {
  const [rows, setRows] = useState<ActivityLedgerRow[]>()
  const [skills, setSkills] = useState<CachedSkill[]>([])
  const [error, setError] = useState("")

  useEffect(() => {
    let live = true
    fetchActivityLedger(summary.activityId).then(
      (r) => live && setRows(r),
      (e: unknown) => live && setError(e instanceof Error ? e.message : String(e)),
    )
    // Names only. A failure leaves the newest bundled ruleset, whose names are the same.
    fetchSkills().then(
      (s) => live && setSkills(s),
      () => undefined,
    )
    return () => {
      live = false
    }
  }, [summary.activityId])

  const rules = useMemo(() => rulesForSkills(skills), [skills])
  const ledger = useMemo(() => (rows ? runLedger(rows) : undefined), [rows])
  const skillName = (id: string) => rules.skills.find((s) => s.id === id)?.name ?? id

  return <LedgerView summary={summary} ledger={ledger} skillName={skillName} error={error || undefined} />
}
