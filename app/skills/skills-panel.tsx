import Link from "next/link"
import type { CSSProperties } from "react"

import { CREST, Mark, Sigil } from "@/components/sigil"
import type { SkillsPanelModel, SkillTile } from "@/lib/skills/panel"

/**
 * THE SKILLS PANEL. Ticket 0073, `06-ui-ux.md` §5.2–5.3.
 *
 * Pure presentation of `skillsPanel()`'s model: one tile component for every skill, and no skill
 * named anywhere (I-25). The layout is §5.2's wireframe — a pinned header carrying the two numbers
 * P5 promises in two seconds, then `ACTIVITY`, `META` ending in the crest, the one-line `NEXT`
 * card, and the collapsed `Untrained` group.
 *
 * Three columns at every width, so a tile's position never depends on the window: "tile 3 is
 * Fortitude forever" (§5.1) is muscle memory, and a reflowing grid would break it.
 *
 * NOTHING HERE IS AN INSTRUCTION (§5.3 rule 6, D-013): no target, no goal, no "train this", no
 * neglected-skill warning, no decay. The `NEXT` line is an estimate, not a prompt.
 */

const fmt = new Intl.NumberFormat("en-US")
const tabular: CSSProperties = { fontVariantNumeric: "tabular-nums" }

function Bar({ fraction, tint }: { fraction: number; tint: "activity" | "meta" }) {
  return (
    <span style={{ display: "block", height: 3, background: "var(--line)", width: "100%" }}>
      <span
        style={{
          display: "block",
          height: "100%",
          width: `${Math.round(Math.min(Math.max(fraction, 0), 1) * 1000) / 10}%`,
          background: tint === "meta" ? "var(--progress-meta)" : "var(--progress-activity)",
        }}
      />
    </span>
  )
}

const tileStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: ".25rem",
  padding: ".75rem .5rem .625rem",
  minHeight: "6.5rem",
  background: "var(--surface)",
  border: "1px solid var(--line)",
  borderRadius: 4,
  color: "var(--text-primary)",
  textDecoration: "none",
  boxSizing: "border-box",
}

function Tile({ tile }: { tile: SkillTile }) {
  return (
    <Link href={`/skills/${tile.skillId}`} aria-label={`${tile.name}, level ${tile.level}`} style={tileStyle} data-skill={tile.skillId}>
      <span style={{ color: "var(--text-secondary)" }}>
        <Sigil skillId={tile.skillId} />
      </span>
      <span style={{ fontSize: ".75rem", color: "var(--text-secondary)" }}>{tile.name}</span>
      <span style={{ ...tabular, fontSize: "1.5rem", lineHeight: 1.1, color: "var(--text-primary)" }}>{tile.level}</span>
      <span style={{ display: "block", marginTop: "auto", width: "100%" }}>
        <Bar fraction={tile.fraction} tint={tile.kind} />
      </span>
    </Link>
  )
}

/** RS's corner (§5.2). Total Level again, as a seal: not a link, not a button, does nothing. */
function Crest({ model }: { model: SkillsPanelModel }) {
  return (
    <div aria-label={`Total Level ${model.totalLevel}`} style={{ ...tileStyle, cursor: "default" }} data-crest="">
      <span style={{ color: "var(--accent-text)" }}>
        <Mark paths={CREST} />
      </span>
      <span style={{ fontSize: ".75rem", color: "var(--text-secondary)", letterSpacing: ".08em" }}>TOTAL</span>
      <span style={{ ...tabular, fontSize: "1.5rem", lineHeight: 1.1 }}>{model.totalLevel}</span>
      <span style={{ display: "block", marginTop: "auto", width: "100%" }}>
        <Bar fraction={model.rung.fraction} tint="activity" />
      </span>
    </div>
  )
}

const grid: CSSProperties = {
  listStyle: "none",
  margin: 0,
  padding: 0,
  display: "grid",
  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
  gap: ".5rem",
}

const sectionLabel: CSSProperties = {
  fontSize: ".75rem",
  letterSpacing: ".08em",
  color: "var(--text-muted)",
  margin: "1.25rem 0 .5rem",
}

function Section({ label, tiles, crest }: { label: string; tiles: SkillTile[]; crest?: SkillsPanelModel }) {
  if (tiles.length === 0 && !crest) return null
  return (
    <section aria-label={label}>
      <h2 style={sectionLabel}>{label}</h2>
      <ul style={grid}>
        {tiles.map((t) => (
          <li key={t.skillId}>
            <Tile tile={t} />
          </li>
        ))}
        {crest ? (
          <li>
            <Crest model={crest} />
          </li>
        ) : null}
      </ul>
    </section>
  )
}

export function SkillsPanel({ model, next }: { model: SkillsPanelModel; next: string | null }) {
  const atCeiling = model.rung.to === model.rung.from
  return (
    <main style={{ maxWidth: "36rem", margin: "0 auto", padding: "0 1rem 2rem" }}>
      {/* App bar and header pinned together: they never scroll away, at any skill count (rule 4). */}
      <div style={{ position: "sticky", top: 0, zIndex: 1, background: "var(--bg)", paddingTop: "1rem" }}>
        <header style={{ display: "flex", alignItems: "center", gap: ".75rem", marginBottom: ".75rem" }}>
          <Link
            href="/"
            aria-label="Back to the map"
            style={{ color: "var(--text-primary)", textDecoration: "none", fontSize: "1.5rem", padding: ".25rem .5rem" }}
          >
            ←
          </Link>
          <h1 style={{ color: "var(--text-primary)", margin: 0, fontSize: "1.125rem", letterSpacing: ".08em" }}>SKILLS</h1>
        </header>
        <div
          data-total=""
          style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 4, padding: ".875rem 1rem" }}
        >
          <p style={{ margin: 0, display: "flex", alignItems: "center", gap: ".5rem", letterSpacing: ".08em" }}>
            <span style={{ color: "var(--accent-text)", display: "inline-flex" }}>
              <Mark paths={CREST} size={20} />
            </span>
            <span style={{ fontSize: ".875rem", color: "var(--text-secondary)" }}>TOTAL LEVEL</span>
            <span style={{ ...tabular, fontSize: "1.75rem", fontWeight: 600, color: "var(--text-primary)" }}>{model.totalLevel}</span>
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: ".75rem", margin: ".5rem 0" }}>
            <div style={{ flex: 1 }}>
              <Bar fraction={model.rung.fraction} tint="activity" />
            </div>
            <span style={{ ...tabular, fontSize: ".75rem", color: "var(--text-muted)" }}>
              {atCeiling ? `of ${model.ceiling}` : `next: ${model.rung.to}`}
            </span>
          </div>
          <p style={{ margin: 0, fontSize: ".875rem", color: "var(--text-secondary)" }}>
            Total XP <span style={{ ...tabular, color: "var(--text-primary)" }}>{fmt.format(model.totalXp)}</span>
          </p>
        </div>
      </div>

      <Section label="ACTIVITY" tiles={model.activity} />
      <Section label="META" tiles={model.meta} crest={model} />

      {next ? (
        <section
          aria-label="Next"
          style={{ marginTop: "1.25rem", background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 4, padding: ".75rem 1rem" }}
        >
          <h2 style={{ ...sectionLabel, margin: "0 0 .25rem" }}>NEXT</h2>
          <p style={{ margin: 0, color: "var(--text-primary)" }}>{next}</p>
        </section>
      ) : null}

      {model.untrained.length > 0 ? (
        <details style={{ marginTop: "1.25rem" }} data-untrained="">
          <summary style={{ cursor: "pointer", color: "var(--text-secondary)", fontSize: ".875rem" }}>
            Untrained ({model.untrained.length})
          </summary>
          <ul style={{ ...grid, marginTop: ".5rem" }}>
            {model.untrained.map((t) => (
              <li key={t.skillId}>
                <Tile tile={t} />
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </main>
  )
}
