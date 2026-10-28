/**
 * THE PLINTH, AS DATA. Ticket `0086`, `06-ui-ux.md` §2.2–§2.3.
 *
 * Everything the plinth draws, computed from three inputs and nothing else: the cached `SkillState`
 * (the same key `/skills` and `/log` read), the size of the explored set, and the latest traced run
 * the map already fetched. No component decides a level, a target or a sentence.
 *
 * **Total Level is `skillsPanel`'s**, not a second sum: the plinth and the `/skills` header read the
 * same function over the same cache, so they cannot disagree (`lib/skills/panel.ts`). The derived
 * stats feed (`0090`) will replace the SOURCE of these numbers, never this shape.
 *
 * **NOTHING HERE IS TRANSIENT** (P5, D-013). There is no "this week", no "today", no "since", no
 * goal: every number is lifetime and cumulative, and the last-run line names a run, not a gap.
 */

import { rulesForSkills, type CachedSkill } from "@/lib/log/optimistic"
import type { SourceConnection } from "@/lib/plinth/connections"
import { runDate, runDistance } from "@/lib/runs/format"
import { runHref, type RunFeatureCollection } from "@/lib/runs/wire"
import { skillsPanel, type SkillsPanelModel, type SkillTile } from "@/lib/skills/panel"
import type { Rung } from "@/src/scoring/levels"

const fmt = new Intl.NumberFormat("en-US")

export interface LastRunLine {
  href: string
  text: string
  /**
   * `0087`. The run has not been seen on this device (`lib/run-moment/seen.ts`): the line is
   * `1 new run — open it`, with the gold treatment (a rule, never gold text — D-148), and its link
   * asks `/run/:id` to auto-play (§3.1).
   */
  fresh?: true
  /** `0087`. Pulse ONCE. Decided by the caller, once per run per page load, never per render. */
  pulse?: boolean
}

/** `0087`. A quiet one-line link to `/settings`: the connect invitation, or the reconnect line. */
export interface SettingsLine {
  href: "/settings"
  text: string
}

export interface PlinthModel {
  /** `null` until the cache (or the network) has answered — drawn as a dash, never as a guess. */
  totalLevel: number | null
  rung: Rung | null
  /** The milestone bar's named target: `next: 300`, or `of 2,277` at the ceiling. Never a percentage. */
  target: string | null
  /** Lifetime cells revealed, already formatted (`12,480`); `null` until the explored set loads. */
  cells: string | null
  lastRun: LastRunLine | null
  /**
   * `0087`. `Connect <source> to begin` — the only call to action in the app (§2.4) — when nothing
   * has ever been imported and no source is connected. Takes the last-run row's place; never both.
   */
  connect: SettingsLine | null
  /**
   * `0087`. `<source> needs reconnecting` — a genuinely broken token, the ONLY failure `/` ever
   * shows (§2.3). One ink line, never red, never a badge, never a modal.
   */
  reconnect: SettingsLine | null
  /**
   * `0270`. The skills quick-view under the rail: TRAINED skills only, as thin level bars, grouped
   * `ACTIVITY` then `META` in registry order. `null` until the cache (or the network) has answered.
   */
  quickView: QuickView | null
}

/** `0270`. One quick-view row: a link to the skill's sheet. Level and progress only — never XP. */
export interface QuickRow {
  skillId: string
  href: string
  name: string
  kind: SkillTile["kind"]
  level: number
  /** 0..1 toward `level + 1`, the same fraction the `/skills` tile draws. */
  fraction: number
  /** `Might, level 42, 37 percent to 43, activity skill` — the `/skills` tile's accessible name, word for word (`0324`). */
  label: string
}

export interface QuickView {
  activity: QuickRow[]
  meta: QuickRow[]
}

/** `0087`. §2.4's wording on the desktop (D-227: there is nothing to tap). */
export const FRESH_RUN_TEXT = "1 new run — open it"

/** `0087`. The unseen latest run's line: it opens `/run/:id` and asks the sequence to play (§3.1). */
export function freshRunLine(latest: RunFeatureCollection, pulse: boolean): LastRunLine | null {
  const run = latest.features[0]?.properties
  if (!run) return null
  return { href: runHref(run.activityId, { play: true }), text: FRESH_RUN_TEXT, fresh: true, pulse }
}

/**
 * `0087`. The source lines. `reconnectIds` are sources a Sync press just found broken — the server
 * has already marked them `NEEDS_REAUTH`, so the next load reads the same answer from `sources`.
 */
function sourceLines(
  sources: readonly SourceConnection[],
  reconnectIds: readonly string[],
  nothingImported: boolean,
): { connect: SettingsLine | null; reconnect: SettingsLine | null } {
  const broken = sources.find((s) => s.state === "reconnect" || reconnectIds.includes(s.sourceId))
  const connect =
    nothingImported && sources.length > 0 && sources.every((s) => s.state === "not-connected")
      ? { href: "/settings" as const, text: `Connect ${sources[0]!.name} to begin` }
      : null
  return {
    connect,
    reconnect: broken ? { href: "/settings", text: `${broken.name} needs reconnecting` } : null,
  }
}

/**
 * `0270`. The quick-view rows, from `skillsPanel`'s TRAINED groups — so membership (any lifetime XP),
 * grouping (`kind`) and order (`displayOrder`) are the panel's rules, not a second copy of them, and
 * a new registry row is a new row here with no code change (D-031). Untrained skills have no row:
 * the rail never shows a column of empty bars, and never nudges (D-013).
 */
export function quickView(panel: Pick<SkillsPanelModel, "activity" | "meta">): QuickView {
  const row = (t: SkillTile): QuickRow => ({
    skillId: t.skillId,
    href: `/skills/${t.skillId}`,
    name: t.name,
    kind: t.kind,
    level: t.level,
    fraction: t.fraction,
    label: t.label,
  })
  return { activity: panel.activity.map(row), meta: panel.meta.map(row) }
}

/** `next: 300`, or `of <ceiling>` once the ceiling is reached — the `/skills` header's wording. */
export function milestoneTarget(rung: Rung, ceiling: number): string {
  return rung.to === rung.from ? `of ${fmt.format(ceiling)}` : `next: ${fmt.format(rung.to)}`
}

/**
 * `Last: Fri 28 Aug · 8.40 km · 21 new` — §2.2's wording, short enough for one line of the rail.
 * The run's own date, from its naive wall clock (I-13), never a relative age — "3 weeks ago" is a "days since" by another name (H2). A part the run does
 * not have is left out; a run that revealed nothing new says nothing about it here (§3.5 is where
 * that run is honoured).
 */
export function lastRunLine(latest: RunFeatureCollection): LastRunLine | null {
  const run = latest.features[0]?.properties
  if (!run) return null
  const p = lastRunParts(latest)!
  const parts = [p.date, ...(p.distance ? [p.distance] : []), ...(p.fresh > 0 ? [`${fmt.format(p.fresh)} new`] : [])]
  return { href: runHref(run.activityId), text: `Last: ${parts.join(" · ")}` }
}

/** The latest run's three facts, shared by the visible line and the map's text summary. */
function lastRunParts(latest: RunFeatureCollection): { date: string; distance: string | null; fresh: number } | null {
  const run = latest.features[0]?.properties
  if (!run) return null
  return {
    date: runDate(run.startedAtLocal ?? run.startedAt, { year: false }),
    distance: runDistance(run.distanceM ?? null),
    fresh: run.newCellCount ?? 0,
  }
}

/**
 * `0112`. THE MAP, AS TEXT (06 §9.4): *"Map. 12,480 cells revealed. Last run Thursday, 8.4
 * kilometres, 21 new."* The canvas says nothing to a screen reader, so `/` carries this in a polite
 * live region beside it. Territory, then the last run, then its new cells — the plinth's own facts,
 * from the same inputs, so the summary and the rail can never disagree.
 *
 * `null` until the explored set is known: a summary of an unknown map would be a guess, and a live
 * region that announces a guess announces it again when it is corrected. Like the plinth, it names
 * the run by its date and never by an age (H2), and says nothing of what was missed (D-013).
 */
export function mapSummary(cells: number | null, latest: RunFeatureCollection): string | null {
  if (cells === null) return null
  const out = [`Map. ${fmt.format(cells)} ${cells === 1 ? "cell" : "cells"} revealed.`]
  const p = lastRunParts(latest)
  if (p) {
    const facts = [p.date, ...(p.distance ? [p.distance] : []), ...(p.fresh > 0 ? [`${fmt.format(p.fresh)} new ${p.fresh === 1 ? "cell" : "cells"}`] : [])]
    out.push(`Last run ${facts.join(", ")}.`)
  }
  return out.join(" ")
}

export function plinthModel(input: {
  skills: readonly CachedSkill[] | undefined
  cells: number | null
  latest: RunFeatureCollection
  /**
   * `0087`. Whether the latest run has been seen on this device. `null` while the flag is being
   * read — the row stays empty (it keeps its height) rather than showing one line and swapping to
   * the other. Omitted: treated as seen (`0086`'s callers).
   */
  seen?: boolean | null
  /** `0087`. Whether a fresh line pulses. See `LastRunLine.pulse`. */
  pulse?: boolean
  /** `0087`. From the server (`lib/plinth/connections.ts`); absent for a signed-out page. */
  sources?: readonly SourceConnection[]
  /** `0087`. Sources the last Sync press found broken. */
  reconnectIds?: readonly string[]
}): PlinthModel {
  const panel = input.skills ? skillsPanel(rulesForSkills(input.skills), input.skills) : null
  const seen = input.seen === undefined ? true : input.seen
  const lastRun =
    seen === null ? null : seen ? lastRunLine(input.latest) : freshRunLine(input.latest, input.pulse ?? false)
  const nothingImported = input.latest.features.length === 0 && input.cells === 0
  return {
    totalLevel: panel?.totalLevel ?? null,
    rung: panel?.rung ?? null,
    target: panel ? milestoneTarget(panel.rung, panel.ceiling) : null,
    cells: input.cells === null ? null : fmt.format(input.cells),
    lastRun,
    ...sourceLines(input.sources ?? [], input.reconnectIds ?? [], nothingImported),
    quickView: panel ? quickView(panel) : null,
  }
}
