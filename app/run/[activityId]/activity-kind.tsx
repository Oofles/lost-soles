"use client"

import { useEffect, useMemo, useState } from "react"

import { rulesForSkills, type CachedSkill } from "@/lib/log/optimistic"
import { fetchSkills } from "@/lib/log/transport"
import { kindChangeLine, kindChoices, kindLabel, wasKind, type ActivityKindRow } from "@/lib/run-kind/kind"
import { fetchActivityKind, setActivityKind } from "@/lib/run-kind/transport"

/**
 * THE ACTIVITY'S KIND, AND THE CORRECTION OF IT. Ticket `0244`, D-284.
 *
 * A self-contained block so capability 12's run page (`0078`) can place it in the end state
 * without rewriting it; until then it sits under the route's stub.
 *
 * SECONDARY ON PURPOSE (D-051). Changing a kind is a rare correction, so the control is a quiet
 * "Change" that opens a select, never a primary button on the page.
 *
 * The choices are the kinds the user's ruleset knows (`kindChoices`), and the XP line is composed
 * by `kindChangeLine` — nothing here branches on what a kind is (D-031).
 */

const quiet: React.CSSProperties = {
  background: "transparent",
  border: "none",
  padding: 0,
  color: "var(--accent-text)",
  font: "inherit",
  textDecoration: "underline",
  cursor: "pointer",
}

const button: React.CSSProperties = {
  padding: ".35rem .75rem",
  borderRadius: ".375rem",
  border: "1px solid var(--accent)",
  background: "transparent",
  color: "var(--accent-text)",
  font: "inherit",
  cursor: "pointer",
}

export function ActivityKind({ activityId }: { activityId: string }) {
  const [row, setRow] = useState<ActivityKindRow | null>()
  const [skills, setSkills] = useState<CachedSkill[]>([])
  const [editing, setEditing] = useState(false)
  const [choice, setChoice] = useState("")
  const [pending, setPending] = useState(false)
  const [line, setLine] = useState("")
  const [error, setError] = useState("")

  const rules = useMemo(() => rulesForSkills(skills), [skills])
  const choices = useMemo(() => kindChoices(rules), [rules])
  const skillName = (id: string) => rules.skills.find((s) => s.id === id)?.name ?? id

  useEffect(() => {
    let live = true
    fetchActivityKind(activityId).then(
      (r) => live && setRow(r),
      (e: unknown) => live && (setRow(null), setError(e instanceof Error ? e.message : String(e))),
    )
    // The ruleset the user's ledger is on, for the choices and the skill names. A failure leaves
    // the newest bundled, which the server would refuse a kind from only if it had dropped one.
    fetchSkills().then(
      (s) => live && setSkills(s),
      () => undefined,
    )
    return () => {
      live = false
    }
  }, [activityId])

  if (row === undefined) return null
  if (row === null) return error ? <p style={{ color: "var(--text-muted)" }}>Kind unavailable: {error}</p> : null

  const was = wasKind(row)

  async function save() {
    if (!choice || choice === row!.kind) return setEditing(false)
    setPending(true)
    setError("")
    try {
      const result = await setActivityKind(activityId, choice)
      setLine(kindChangeLine(result, skillName))
      setEditing(false)
      setRow(await fetchActivityKind(activityId))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setPending(false)
    }
  }

  return (
    <section aria-label="Activity kind">
      <p style={{ color: "var(--text-primary)", margin: 0 }}>
        {kindLabel(row.kind)}
        {was ? <span style={{ color: "var(--text-muted)" }}> (was {kindLabel(was)})</span> : null}
        {!editing ? (
          <>
            {" · "}
            <button type="button" style={{ ...quiet, fontSize: ".875rem" }} onClick={() => (setChoice(row.kind), setEditing(true), setLine(""))}>
              Change
            </button>
          </>
        ) : null}
      </p>

      {editing ? (
        <div style={{ display: "flex", gap: ".5rem", alignItems: "center", marginTop: ".5rem", flexWrap: "wrap" }}>
          <label style={{ color: "var(--text-secondary)" }}>
            Kind{" "}
            <select value={choice} onChange={(e) => setChoice(e.target.value)} disabled={pending} style={{ font: "inherit" }}>
              {choices.map((k) => (
                <option key={k} value={k}>
                  {kindLabel(k)}
                </option>
              ))}
            </select>
          </label>
          <button type="button" style={{ ...button, opacity: pending ? 0.6 : 1 }} disabled={pending} onClick={() => void save()}>
            {pending ? "Saving…" : "Save"}
          </button>
          <button type="button" style={quiet} disabled={pending} onClick={() => setEditing(false)}>
            Cancel
          </button>
        </div>
      ) : null}

      <p aria-live="polite" style={{ color: "var(--text-secondary)", marginTop: ".5rem", minHeight: "1.25rem" }}>
        {error ? <span style={{ color: "var(--text-muted)" }}>Not changed: {error}</span> : line}
      </p>
    </section>
  )
}
