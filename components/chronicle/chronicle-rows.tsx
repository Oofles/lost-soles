import Link from "next/link"
import type { CSSProperties } from "react"

import type { ChronicleRowView } from "@/lib/chronicle/rows"
import { CHRONICLE_ROW_PX } from "@/lib/chronicle/window"

/**
 * THE CHRONICLE'S ROWS, ONE WINDOW OF THEM. Ticket `0088`. Pure presentation.
 *
 * The list is as tall as every row loaded, and only `rows` — the window `rowWindow` chose — are in
 * it, each placed absolutely at its own index. So the scrollbar is honest about the length of the
 * history while the DOM holds a screenful.
 *
 * A row is a link to `/run/:id` in its END STATE (§3.1): no autoplay intent. It PUSHES (the
 * operator, 2026-10-15): back from the run is the Chronicle again, and a second back is `/`.
 *
 * The unseen mark is a gold RULE on the row's leading edge — D-148: gold is a fill or a rule, never
 * text — and a visually hidden phrase for assistive technology. It is never a number, a badge or a
 * dot: `chronicle-panel.test.tsx` holds that.
 */

const tabular: CSSProperties = { fontVariantNumeric: "tabular-nums" }

export const visuallyHidden: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
}

export function ChronicleRows({
  rows,
  start,
  total,
  unseen,
}: {
  rows: readonly ChronicleRowView[]
  /** The index of `rows[0]` in the whole list. */
  start: number
  /** Rows loaded in all — the list's height. */
  total: number
  unseen: ReadonlySet<string>
}) {
  return (
    <ol
      aria-label="Runs and workouts, newest first"
      data-chronicle-list=""
      style={{ position: "relative", listStyle: "none", margin: 0, padding: 0, height: total * CHRONICLE_ROW_PX }}
    >
      {rows.map((row, i) => {
        const isUnseen = unseen.has(row.activityId)
        return (
          <li
            key={row.activityId}
            data-row={start + i}
            {...(isUnseen ? { "data-unseen": "" } : {})}
            style={{
              position: "absolute",
              top: (start + i) * CHRONICLE_ROW_PX,
              left: 0,
              right: 0,
              height: CHRONICLE_ROW_PX,
              boxSizing: "border-box",
              borderBottom: "1px solid var(--line)",
              boxShadow: isUnseen ? "inset 3px 0 0 var(--accent)" : undefined,
            }}
          >
            <Link href={row.href} className="chronicle-row">
              <span style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <span style={{ ...tabular, font: "600 15px/1.35 var(--font-sans)", color: "var(--text-primary)" }}>
                  {row.date}
                </span>
                {row.newCells ? (
                  <span style={{ ...tabular, font: "400 13px/1.35 var(--font-sans)", color: "var(--text-secondary)" }}>
                    {row.newCells}
                  </span>
                ) : null}
              </span>
              <span
                style={{
                  ...tabular,
                  display: "block",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  font: "400 13px/1.35 var(--font-sans)",
                  color: "var(--text-secondary)",
                }}
              >
                {row.kind}
                {row.measure ? ` · ${row.measure}` : null}
              </span>
              {isUnseen ? <span style={visuallyHidden}> — not yet seen</span> : null}
            </Link>
          </li>
        )
      })}
    </ol>
  )
}
