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
import { runDate, runDistance } from "@/lib/runs/format"
import { runHref, type RunFeatureCollection } from "@/lib/runs/wire"
import { skillsPanel } from "@/lib/skills/panel"
import type { Rung } from "@/src/scoring/levels"

const fmt = new Intl.NumberFormat("en-US")

export interface LastRunLine {
  href: string
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
  const parts = [runDate(run.startedAtLocal ?? run.startedAt, { year: false })]
  const distance = runDistance(run.distanceM ?? null)
  if (distance) parts.push(distance)
  const fresh = run.newCellCount ?? 0
  if (fresh > 0) parts.push(`${fmt.format(fresh)} new`)
  return { href: runHref(run.activityId), text: `Last: ${parts.join(" · ")}` }
}

export function plinthModel(input: {
  skills: readonly CachedSkill[] | undefined
  cells: number | null
  latest: RunFeatureCollection
}): PlinthModel {
  const panel = input.skills ? skillsPanel(rulesForSkills(input.skills), input.skills) : null
  return {
    totalLevel: panel?.totalLevel ?? null,
    rung: panel?.rung ?? null,
    target: panel ? milestoneTarget(panel.rung, panel.ceiling) : null,
    cells: input.cells === null ? null : fmt.format(input.cells),
    lastRun: lastRunLine(input.latest),
  }
}
