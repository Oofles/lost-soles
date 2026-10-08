import Link from "next/link"

import { runDate, runDistance } from "@/lib/runs/format"
import { runHref, type RunListItem } from "@/lib/runs/wire"

/**
 * The Chronicle's links to past runs. Ticket `0078`: §3.1's *"Chronicle → any past run"* opens the
 * run's END STATE, so the link carries no autoplay intent. `0088` replaces this list with the sheet.
 */
export function ChronicleLinks({ runs }: { runs: readonly RunListItem[] }) {
  if (runs.length === 0) return null
  return (
    <nav aria-label="Runs" style={{ padding: "0 1.5rem 1.5rem", maxWidth: "40rem" }}>
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {runs.map((r) => {
          const distance = runDistance(r.distanceM)
          return (
            <li key={r.activityId} style={{ borderBottom: "1px solid var(--line)" }}>
              <Link href={runHref(r.activityId)} style={{ display: "block", padding: ".6rem 0", color: "var(--text-primary)" }}>
                {runDate(r.startedAtLocal)}
                {distance ? ` · ${distance}` : null}
                {r.name ? <span style={{ color: "var(--text-secondary)" }}> · {r.name}</span> : null}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
