/**
 * `/log`'S TWO COLUMNS, AND ITS SPLIT ENTRIES. Ticket 0344, D-483, D-485, `06-ui-ux.md` §6.3–§6.5.
 *
 * The page is no longer one list. It is two columns, Full workouts and Quick workouts, whose
 * membership and order are DATA in `rules/log-layout.json`. That file is presentation, versioned
 * with nothing, like `rules/sigils.json`: moving a row is never a rescore. No skill, exercise or
 * split id appears here (I-25); every entry is read from the ruleset and placed by reading the
 * layout.
 *
 * - A split (`RuleSet.splits`, 0342) is ONE entry. Its member exercises never appear as rows of
 *   their own: the split is how they are logged.
 * - An entry the layout does not list lands at the bottom of the column `fallbackByEntry` names
 *   for its entry kind, in registry order. So a new YAML row still needs nothing else (§6.5).
 * - Nothing reorders by frequency, recency or level. The order is the file's, forever.
 */

import LAYOUT from "@/rules/log-layout.json"
import { awardFor, rowResult, type Award } from "@/lib/log/optimistic"
import { entryFor, logRows, SET_SCALE_BY_ENTRY, STEP_BY_ENTRY, type LogRow } from "@/lib/log/rows"
import { apportionSplit } from "@/lib/log/workout-entry"
import type { RuleExercise, RuleSet, RuleSplit } from "@/src/rules/schema"

export interface LogLayout {
  columns: readonly { id: string; title: string; entries: readonly string[] }[]
  fallbackByEntry: Readonly<Record<RuleExercise["entry"], string>>
}

export const LOG_LAYOUT: LogLayout = LAYOUT as LogLayout

/** One region of a split, as the split entry draws it. */
export interface LogSplitMember {
  exerciseId: string
  /** The member exercise's own label: `Upper body`. */
  label: string
  skillId: string
  skillName: string
}

/** A split, ready to draw. Everything here is read off `RuleSplit` and its members' rows. */
export interface LogSplit {
  splitId: string
  label: string
  entry: RuleSplit["entry"]
  members: readonly LogSplitMember[]
  /** Percent per block of the share bar. */
  shareStep: number
  /** The length stepper's step, in the entry's unit (minutes). */
  step: number
  /** The length's floor: one step. */
  min: number
  /** A fresh install's length: the split's first `quickValue`. */
  fallback: number
}

export type LogItem = { kind: "row"; id: string; row: LogRow } | { kind: "split"; id: string; split: LogSplit }

export interface LogColumn {
  id: string
  title: string
  items: LogItem[]
}

/** The splits `/log` can offer under `rules`: each member must be a row the page would draw. */
export function logSplits(rules: RuleSet): LogSplit[] {
  const rows = new Map(logRows(rules).map((r) => [r.exerciseId, r]))
  const exerciseLabel = new Map(rules.skills.flatMap((s) => (s.exercises ?? []).map((e) => [e.id, e.label] as const)))
  return (rules.splits ?? []).flatMap((split): LogSplit[] => {
    const members = split.members.map((id) => rows.get(id))
    if (members.some((m) => m === undefined)) return []
    const step = STEP_BY_ENTRY[split.entry]
    return [
      {
        splitId: split.id,
        label: split.label,
        entry: split.entry,
        // The exercise's own label, as written ("Upper body"): a region heads its line, where a
        // row's lowercased unit label ("pushups") only follows a skill name.
        members: members.map((m) => ({ exerciseId: m!.exerciseId, label: exerciseLabel.get(m!.exerciseId) ?? m!.label, skillId: m!.skillId, skillName: m!.skillName })),
        shareStep: split.shareStep,
        step,
        min: step,
        fallback: Math.max(step, split.quickValues[0] ?? step),
      },
    ]
  })
}

/**
 * The page, as columns. Rows a split covers are dropped; listed entries come in the file's order;
 * the rest follow in registry order, in the column their entry kind falls back to. An entry the
 * layout lists but this ruleset lacks is skipped. A column the fallbacks name but the layout
 * lacks is a broken file, and `log-layout.test.ts` refuses it before it ships.
 */
export function logColumns(rules: RuleSet, layout: LogLayout = LOG_LAYOUT): LogColumn[] {
  const splits = logSplits(rules)
  const covered = new Set(splits.flatMap((s) => s.members.map((m) => m.exerciseId)))
  const rows = logRows(rules).filter((r) => !covered.has(r.exerciseId))

  // Registry order across rows and splits: a split stands where its first member's row stood.
  const all = logRows(rules)
  const position = (id: string) => all.findIndex((r) => r.exerciseId === id)
  const items: { item: LogItem; entry: RuleExercise["entry"]; at: number }[] = [
    ...rows.map((row) => ({ item: { kind: "row", id: row.exerciseId, row } as LogItem, entry: row.entry, at: position(row.exerciseId) })),
    ...splits.map((split) => ({ item: { kind: "split", id: split.splitId, split } as LogItem, entry: split.entry, at: position(split.members[0]!.exerciseId) })),
  ].sort((a, b) => a.at - b.at)

  const placed = new Set<string>()
  const columns: LogColumn[] = layout.columns.map((c) => ({
    id: c.id,
    title: c.title,
    items: c.entries.flatMap((id) => {
      const hit = items.find((i) => i.item.id === id)
      if (!hit || placed.has(id)) return []
      placed.add(id)
      return [hit.item]
    }),
  }))
  for (const { item, entry } of items) {
    if (placed.has(item.id)) continue
    const column = columns.find((c) => c.id === layout.fallbackByEntry[entry]) ?? columns[columns.length - 1]
    column?.items.push(item)
    placed.add(item.id)
  }
  return columns
}

/** One region's preview line: its whole seconds, and the XP its skill would take for them. */
export interface SplitPreviewRegion {
  exerciseId: string
  percent: number
  seconds: number
  xp: number
}

/**
 * What the split entry shows beside each share, live. At 100% the seconds are apportioned exactly
 * as the server will (0342's `apportionSplit`). Below or above it, each share is floored, and LOG
 * is disabled anyway. Each region's XP is scored as a one-exercise log through the same
 * `awardFor` the confirmation uses, so its soft cap applies and no rate is restated here.
 */
export function splitPreview(
  split: LogSplit,
  minutes: number,
  percents: readonly number[],
  rules: RuleSet,
): { total: number; regions: SplitPreviewRegion[] } {
  const durationS = Math.round(minutes * SET_SCALE_BY_ENTRY[split.entry])
  const total = percents.reduce((a, b) => a + b, 0)
  const shares = split.members.map((m, i) => ({ exerciseId: m.exerciseId, percent: percents[i] ?? 0 }))
  const ruleSplit = { id: split.splitId, label: split.label, entry: split.entry, members: split.members.map((m) => m.exerciseId), shareStep: split.shareStep, quickValues: [] }
  const exact = total === 100 ? apportionSplit(ruleSplit, { durationS, shares }) : null
  const regions = split.members.map((m, i): SplitPreviewRegion => {
    const percent = percents[i] ?? 0
    const seconds = exact ? (exact.find((s) => s.exercise === m.exerciseId)?.durationS ?? 0) : Math.floor((durationS * percent) / 100)
    if (seconds <= 0) return { exerciseId: m.exerciseId, percent, seconds: 0, xp: 0 }
    const entry = entryFor({ exerciseId: m.exerciseId, entry: "seconds" }, seconds, rules, {
      now: new Date(0),
      idempotencyKey: "preview",
      timezone: undefined,
    })
    return { exerciseId: m.exerciseId, percent, seconds, xp: awardFor(entry, rules)[m.skillId] ?? 0 }
  })
  return { total, regions }
}

/** One line of a split log's confirmation: `Might +540 → L8`. */
export interface SplitLogLine {
  skillId: string
  name: string
  xpGained: number
  level: number
}

/**
 * Every skill a split log paid, in the order the confirmation lists them: the members' skills in the
 * split's order, then whatever they feed in registry order (Constitution, then Iron, under v5). `standing`
 * is each skill's XP before the log. Also the order the level-up cards play in.
 */
export function splitLogLines(split: LogSplit, award: Award, rules: RuleSet, standing: (skillId: string) => number): SplitLogLine[] {
  const members = [...new Set(split.members.map((m) => m.skillId))].filter((id) => id in award)
  const fed = [...rules.skills]
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .map((s) => s.id)
    .filter((id) => id in award && !members.includes(id))
  return [...members, ...fed].map((skillId) => ({
    skillId,
    name: rules.skills.find((s) => s.id === skillId)?.name ?? skillId,
    xpGained: award[skillId] ?? 0,
    level: rowResult(skillId, award, { xp: standing(skillId) }, rules).level,
  }))
}
