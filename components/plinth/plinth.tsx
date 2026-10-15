import Link from "next/link"
import type { CSSProperties } from "react"

import { AddWorkoutLink } from "@/components/add-workout-link"
import { SyncButton } from "@/components/sync-button"
import type { PlinthModel } from "@/lib/plinth/model"

/**
 * THE PLINTH. Ticket `0086`, `06-ui-ux.md` §2.1–§2.3, D-313.
 *
 * Pure presentation of `plinthModel()`. At ≥1024px it is a fixed, full-height, opaque rail down the
 * left edge, 24rem wide, with a 1px rule on its right; below that it stacks unchanged as an opaque
 * card over the bottom of the map (D-251: must not break, nothing optimised). Top-down, in exactly
 * this order (§2.2 rows 4, 5, 7, 9):
 *
 *   1. the two glance numbers — Total Level (the largest type on `/`) and lifetime cells;
 *   2. the milestone bar, with a NAMED target, never a bare percentage;
 *   3. the last run, one line, the whole line a link to `/run/:id`;
 *   4. SKILLS · + ADD WORKOUT · RUNS, `1fr 1.5fr 1fr`, 40px — Add workout centred and widest (D-061);
 *   5. the interim Sync caption line (D-313), until capability `14` deletes it.
 *
 * **D-013 IS THE SPECIFICATION.** Nothing here asks for anything: no streak, no today, no this-week,
 * no goal, no "days since", no badge, no dot, no "log a run". `plinth.test.tsx` holds that line, and
 * anything it forbids needs a decision record, not a commit (§2.3).
 *
 * **D-148.** Opaque throughout; gold is the bar's fill and Add workout's rule, never text.
 */

const tabular: CSSProperties = { fontVariantNumeric: "tabular-nums" }

/**
 * Layout, in a stylesheet because inline styles cannot hold a media query. 1024px is the breakpoint
 * `06` §2 uses everywhere. `home-pane` is the map's container (`MapShell`'s `paneClassName`): at
 * ≥1024px it starts where the rail ends, so the map is never under the plinth and the camera needs
 * no offset (§2.2, "The camera is not offset for the rail"). Below, the card sits 36px off the
 * bottom so MapLibre's attribution stays uncovered (§2.2 row 10, `0052`).
 */
export const PLINTH_CSS =
  ".home-pane { position: fixed; inset: 0; height: 100dvh; background: var(--bg); }" +
  " .plinth { position: fixed; z-index: 1; left: 16px; right: 16px; bottom: 36px; max-height: 55vh;" +
  " overflow-y: auto; box-sizing: border-box; padding: 16px; background: var(--surface-raised);" +
  " border: 1px solid var(--line); border-radius: 8px; color: var(--text-primary); font-family: var(--font-sans); }" +
  " .plinth-dests { display: grid; grid-template-columns: 1fr 1.5fr 1fr; gap: 8px; }" +
  " .plinth-dest { display: flex; align-items: center; justify-content: center; height: 40px; box-sizing: border-box;" +
  " padding: 0 8px; background: var(--surface); border: 1px solid var(--line); border-radius: 4px;" +
  " color: var(--text-primary); text-decoration: none; font: 500 13px/1.3 var(--font-sans);" +
  " letter-spacing: .08em; text-transform: uppercase; white-space: nowrap; }" +
  " .plinth-dest-primary { border-color: var(--accent); }" +
  " .plinth-dest:hover, .plinth-last:hover { background: var(--bg); }" +
  " .plinth a:focus-visible, .plinth button:focus-visible, .home-gear:focus-visible {" +
  " outline: 2px solid var(--text-primary); outline-offset: 2px; }" +
  " .home-gear { position: fixed; z-index: 1; top: 16px; right: 16px; width: 40px; height: 40px;" +
  " display: flex; align-items: center; justify-content: center; box-sizing: border-box;" +
  " background: var(--surface-raised); border: 1px solid var(--line); border-radius: 4px;" +
  " color: var(--text-primary); text-decoration: none; font-size: 20px; line-height: 1; }" +
  // `0087`. An unseen run: a gold RULE down the line's left edge (never gold text, D-148) and one
  // pulse of a gold ring that closes in and is gone — `1` iteration, and the class is set once per
  // run per page load (`home-screen.tsx`), so a re-render can never restart it. Reduced motion: none.
  " .plinth-fresh { box-shadow: inset 3px 0 0 var(--accent); }" +
  " .plinth-pulse { animation: plinth-pulse 1200ms ease-out 1; }" +
  " @keyframes plinth-pulse { from { box-shadow: inset 3px 0 0 var(--accent), 0 0 0 4px var(--accent); }" +
  " to { box-shadow: inset 3px 0 0 var(--accent), 0 0 0 0 var(--accent); } }" +
  " @media (prefers-reduced-motion: reduce) { .plinth-pulse { animation: none; } }" +
  // `0087`. The settings lines — connect, reconnect — are ink, quiet, and underlined in the rule
  // colour. Nothing about them is red, and nothing about them moves.
  " .plinth-quiet { color: var(--text-secondary); text-decoration-line: underline;" +
  " text-decoration-color: var(--line); text-underline-offset: 3px; }" +
  " @media (min-width: 1024px) {" +
  " .home-pane { left: 24rem; }" +
  " .plinth { top: 0; bottom: 0; left: 0; right: auto; width: 24rem; max-height: none;" +
  " border: 0; border-right: 1px solid var(--line); border-radius: 0; } }"

function Bar({ fraction }: { fraction: number }) {
  const pct = Math.round(Math.min(Math.max(fraction, 0), 1) * 1000) / 10
  return (
    <span aria-hidden="true" style={{ display: "block", height: 4, background: "var(--line)", width: "100%" }}>
      <span data-bar-fill="" style={{ display: "block", height: "100%", width: `${pct}%`, background: "var(--progress-activity)" }} />
    </span>
  )
}

const label: CSSProperties = {
  font: "600 12px/1.2 var(--font-sans)",
  letterSpacing: ".08em",
  color: "var(--text-secondary)",
}

export function Plinth({
  model,
  onReconnect,
}: {
  model: PlinthModel
  /** `0087`. A Sync press that found a broken token; `HomeScreen` turns it into `model.reconnect`. */
  onReconnect?: (sourceIds: string[]) => void
}) {
  return (
    <aside className="plinth" aria-label="Plinth" data-plinth="">
      {/* Row 4 — the two glance numbers, on one baseline. Not links. */}
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
        <p style={{ margin: 0, display: "flex", alignItems: "baseline", gap: 12 }} data-total-level="">
          <span style={label}>TOTAL LEVEL</span>
          <span style={{ ...tabular, font: "600 28px/1.2 var(--font-serif)", color: "var(--text-primary)" }}>
            {model.totalLevel ?? "—"}
          </span>
        </p>
        <p style={{ ...tabular, margin: 0, font: "600 17px/1.35 var(--font-sans)", color: "var(--text-primary)" }} data-cells="">
          {model.cells ?? "—"}
          <span style={{ font: "400 12px/1.35 var(--font-sans)", color: "var(--text-secondary)" }}> cells</span>
        </p>
      </div>

      {/* Row 5 — the milestone bar and its named target. */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8 }} data-milestone="">
        <div style={{ flex: 1 }}>
          <Bar fraction={model.rung?.fraction ?? 0} />
        </div>
        <span style={{ ...tabular, font: "400 12px/1.35 var(--font-sans)", color: "var(--text-secondary)", minWidth: "4.5rem", textAlign: "right" }}>
          {model.target ?? ""}
        </span>
      </div>

      {/*
        Row 7 — the last run. The whole line is the hit area. `0087`: an unseen run reads
        `1 new run — open it` with a gold rule and opens the sequence; with nothing ever imported
        and nothing connected the row is the one invitation to connect. The row keeps its height
        when it is empty so the buttons below never move.
      */}
      <div style={{ minHeight: 32, marginTop: 12 }}>
        {model.lastRun ? (
          <Link
            href={model.lastRun.href}
            className={
              "plinth-last" +
              (model.lastRun.fresh ? " plinth-fresh" : "") +
              (model.lastRun.fresh && model.lastRun.pulse ? " plinth-pulse" : "")
            }
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
              minHeight: 32,
              padding: "0 4px",
              borderRadius: 4,
              color: "var(--text-primary)",
              textDecoration: "none",
              font: "600 17px/1.35 var(--font-sans)",
            }}
            data-last-run={model.lastRun.fresh ? "fresh" : ""}
          >
            <span style={{ ...tabular, paddingLeft: model.lastRun.fresh ? 8 : 0 }}>{model.lastRun.text}</span>
            <span aria-hidden="true" style={{ color: "var(--text-secondary)" }}>
              ›
            </span>
          </Link>
        ) : model.connect ? (
          <Link
            href={model.connect.href}
            className="plinth-last"
            style={{
              display: "flex",
              alignItems: "center",
              minHeight: 32,
              padding: "0 4px",
              borderRadius: 4,
              color: "var(--text-primary)",
              textDecoration: "none",
              font: "500 15px/1.35 var(--font-sans)",
            }}
            data-connect=""
          >
            {model.connect.text}
          </Link>
        ) : null}
      </div>

      {/* Row 9 — the three destinations, below a rule. */}
      <nav aria-label="Destinations" style={{ borderTop: "1px solid var(--line)", marginTop: 12, paddingTop: 16 }}>
        <div className="plinth-dests">
          <Link href="/skills" className="plinth-dest">
            Skills
          </Link>
          <AddWorkoutLink />
          <Link href="/chronicle" className="plinth-dest">
            Runs
          </Link>
        </div>
      </nav>

      {/* Interim (D-313): manual ingest until capability 14. A caption line, never a fourth button. */}
      <SyncButton onReconnect={onReconnect} />

      {/*
        `0087`, §2.3: THE ONLY FAILURE `/` EVER SURFACES — a genuinely broken token. One ink caption
        line under the Sync line, linking to `/settings`. You should have to look for it.
      */}
      {model.reconnect ? (
        <p style={{ margin: "4px 0 0", font: "400 12px/1.35 var(--font-sans)" }}>
          <Link href={model.reconnect.href} className="plinth-quiet" data-reconnect="">
            {model.reconnect.text}
          </Link>
        </p>
      ) : null}
    </aside>
  )
}
