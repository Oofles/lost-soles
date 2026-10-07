/**
 * THE SKILL DETAIL SHEET, AS DATA. Ticket 0074, `06-ui-ux.md` §5.5, `04-game-design.md` §4.1/§4.3.
 *
 * `skillDetail(rules, standing, ledger, places, now)` is everything `/skills/:skillId` draws. Like
 * `skillsPanel`, no skill id appears here (I-25): the sheet is a registry row and its ledger
 * rendered, so a new YAML row gets a sheet with no source change, and Vigil's differs from
 * Wayfaring's only because its row does (`groundMultipliers: null`, no place-bound milestones).
 *
 * - **Header** — `levelProgress` over the cached `SkillState`, exactly as the tile reads it, so the
 *   sheet and the tile under it cannot disagree.
 * - **`~N runs`** — the XP still needed over that skill's own TRAILING MEDIAN SESSION, the same
 *   `recentSessions`/`median` the panel's `NEXT` line uses. Omitted, never zeroed, with no session.
 * - **Rules sentence** — generated from `xpPerUnit`, `unit`, `softCapUnits`, the multipliers and the
 *   rows that feed this one. Change a number in YAML and the sentence changes.
 * - **`RECENT`** — one row per ACTIVITY, its reasons summed (operator, 2026-10-07): a run split
 *   across new and familiar ground is one run. The rows underneath stay attached as `parts`, so the
 *   sheet still answers "why do I have this XP". At most ten; the rest are only COUNTED.
 * - **`AHEAD`** — 04 §4.3's per-skill ladder with an estimate in months or years, never a date.
 * - **`ON THE MAP`** — place-bound milestones, passed in. Empty means the section is omitted.
 *
 * I-15: every one of the skill's ledger rows lands in exactly one of `recent`, the counted older
 * groups or `carried`, so `ledgerXp` is the sum of everything the sheet stands for. The session
 * estimate alone reads only the current ruleset's rows, as the panel's `NEXT` line does.
 */

import type { CachedSkill } from "@/lib/log/optimistic"
import type { Multipliers, RuleSet, RuleSkill } from "@/src/rules/schema"
import { SIX_MONTHS_MS } from "@/src/domain/discovery"
import { cumulativeXp, levelProgress, stepCoefficient } from "@/src/scoring/levels"

import { median, recentSessions, type SkillLedgerRow } from "./next"

/** How many activities `RECENT` shows. Ten rows, not a history (§5.5): the Chronicle owns that. */
export const RECENT_ROWS = 10

/**
 * The per-skill milestone ladder, `04-game-design.md` §4.3. One ladder for every skill (operator,
 * 2026-10-07, D-290): §5.5's mockup names (`Pathfinder`, `Roadwarden`) were illustrative, and no
 * registry field carries per-skill names. A rung above `curve.maxLevel` is unreachable on the
 * current curve and is not shown.
 */
export const SKILL_MILESTONES: readonly { level: number; name: string }[] = [
  { level: 10, name: "Initiate" },
  { level: 25, name: "Journeyman" },
  { level: 50, name: "Adept" },
  { level: 75, name: "Veteran" },
  { level: 90, name: "Elder" },
  { level: 99, name: "Mastery" },
  { level: 120, name: "Deep Mastery" },
]

/** A ledger row as the sheet reads it from `bySkill` (GSI3): the panel's row plus what it shows. */
export interface DetailLedgerRow extends SkillLedgerRow {
  reason: string
  units: number
}

/** A milestone that put something on the map (04 §4.3). Nothing records these yet. */
export interface PlaceMilestone {
  level: number
  label: string
  lng: number
  lat: number
}

export interface RecentPart {
  reason: string
  units: string | null
  xp: number
}

export interface RecentRow {
  activityId: string
  /** `startedAt`, from the row's `seq`. */
  startedAt: string
  units: string | null
  xp: number
  parts: RecentPart[]
}

export interface AheadRow {
  level: number
  name: string
  estimate: string | null
}

export interface SkillDetail {
  skillId: string
  name: string
  kind: RuleSkill["kind"]
  level: number
  atMax: boolean
  xp: number
  /** Cumulative XP to BE `level + 1` — the right-hand side of `xp / next`. */
  nextXp: number
  xpToNext: number
  fraction: number
  /** `~9 runs`, or null with no session history. */
  sessionsToNext: string | null
  rules: string
  recent: RecentRow[]
  /** Activities older than `recent`, counted and never listed. */
  more: number
  /** XP on D-135 floor rows (`retained_floor`), which belong to no activity. */
  carried: number
  /** Σ xpAwarded over every row of the skill — I-15's right-hand side. */
  ledgerXp: number
  ahead: AheadRow[]
  places: PlaceMilestone[]
}

/* ── Units ────────────────────────────────────────────────────────────────────────────── */

/** The registry's `unit` vocabulary, in words. An unknown unit falls back to itself. */
const UNIT_WORDS: Record<string, { one: string; many: string; short: string } | null> = {
  km: { one: "kilometre", many: "kilometres", short: "km" },
  rep: { one: "rep", many: "reps", short: "reps" },
  second: { one: "second", many: "seconds", short: "" },
  cell: { one: "cell", many: "cells", short: "cells" },
  // A share is fed XP, not a quantity anyone did: it is never shown as units.
  share: null,
}

const fmt = new Intl.NumberFormat("en-US")
const fmt1 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 })
const fmt2 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 })

function words(unit: string) {
  return unit in UNIT_WORDS ? UNIT_WORDS[unit] : { one: unit, many: unit, short: unit }
}

/** `8.4 km`, `40 reps`, `2:30`, or null for a unit that is not a quantity. */
export function formatUnits(n: number, unit: string): string | null {
  const w = words(unit)
  if (!w) return null
  if (unit === "second") {
    const s = Math.round(n)
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const ss = String(s % 60).padStart(2, "0")
    return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`
  }
  return `${unit === "km" ? fmt1.format(n) : fmt.format(Math.round(n))} ${w.short}`
}

/* ── The rules sentence ───────────────────────────────────────────────────────────────── */

/** `1 → full`, `0.5 → half`, `0.3333 → a third`, else a percentage. */
function fraction(rate: number): string {
  const named: [number, string][] = [
    [1, "full"],
    [0.5, "half"],
    [1 / 3, "a third"],
    [0.25, "a quarter"],
    [0, "nothing"],
  ]
  const hit = named.find(([v]) => Math.abs(v - rate) < 0.001)
  return hit ? hit[1] : `${Math.round(rate * 100)}%`
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

function list(items: string[]): string {
  return items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`
}

const MONTHS_TO_REARM = Math.round(SIX_MONTHS_MS / (30.44 * 24 * 60 * 60 * 1000))
const MONTHS_WORD: Record<number, string> = { 6: "six" }

/** The re-arm clause for one multipliers object. `null` when everything is paid in full. */
function multiplierClause(m: Multipliers, things: string): string | null {
  const parts: string[] = []
  if (m.new !== 1) parts.push(`${fraction(m.new)} on new ${things}`)
  if (m.rearmed === m.recent) {
    if (m.rearmed !== 1) parts.push(`${fraction(m.rearmed)} on ${things} you have run before`)
  } else {
    const months = MONTHS_WORD[MONTHS_TO_REARM] ?? String(MONTHS_TO_REARM)
    if (m.rearmed !== 1) parts.push(`${fraction(m.rearmed)} on ${things} last run over ${months} months ago`)
    if (m.recent !== 1) parts.push(`${fraction(m.recent)} on ${things} run more recently`)
  }
  return parts.length ? parts.join(", ") : null
}

/** One sentence of plain rules, generated from the row (§5.5). */
export function rulesSentence(rules: RuleSet, skill: RuleSkill): string {
  const clauses: string[] = []
  const w = words(skill.unit)

  if (w) {
    const multiplied = skill.groundMultipliers ? "" : skill.unitMultipliers ? "new " : ""
    clauses.push(`${fmt2.format(skill.xpPerUnit)} XP per ${multiplied}${w.one}`)
  }

  const ground = skill.groundMultipliers ? multiplierClause(skill.groundMultipliers, "ground") : null
  if (ground) clauses.push(ground)
  const cells = skill.unitMultipliers ? multiplierClause(skill.unitMultipliers, "ground") : null
  if (cells) clauses.push(cells)

  if (skill.softCapUnits !== null && w) {
    clauses.push(`full rate up to ${fmt.format(skill.softCapUnits)} ${w.many} in one session, tapering after`)
  }

  // Meta skills are fed: list the rows that feed this one, grouped by rate, in registry order.
  const feeders = rules.skills
    .filter((s) => s.enabled)
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .flatMap((s) => s.feeds.filter((f) => f.skill === skill.id).map((f) => ({ name: s.name, rate: f.rate })))
  if (feeders.length > 0) {
    const byRate = new Map<number, string[]>()
    for (const f of feeders) byRate.set(f.rate, [...(byRate.get(f.rate) ?? []), f.name])
    const fed = [...byRate].map(([rate, names]) => `${fraction(rate)} of the XP earned in ${list(names)}`)
    clauses.push(list(fed))
  }

  if (clauses.length === 0) return ""
  return `${capitalise(clauses[0]!)}${clauses.length > 1 ? "; " + clauses.slice(1).join("; ") : ""}.`
}

/* ── Estimates ────────────────────────────────────────────────────────────────────────── */

const DAY_MS = 24 * 60 * 60 * 1000
/** A cadence read off a fortnight or less is noise; the span is never taken as shorter. */
const MIN_CADENCE_SPAN_DAYS = 14

/** Low precision on purpose (§5.5): a precise date is a deadline, and a deadline is N2. */
export function lowPrecision(days: number): string {
  const months = days / 30.44
  if (months < 1) return "under a month"
  if (months < 18) {
    const n = Math.round(months)
    return `~${n} month${n === 1 ? "" : "s"}`
  }
  const years = Math.round(months / 12)
  return `~${years} year${years === 1 ? "" : "s"}`
}

/** `startedAt` from `<startedAt>#<activityId>#<nn>`. */
const startedAtOf = (seq: string) => seq.split("#")[0]!

/* ── The model ────────────────────────────────────────────────────────────────────────── */

export function skillDetail(
  rules: RuleSet,
  skillId: string,
  standing: readonly CachedSkill[],
  ledger: readonly DetailLedgerRow[],
  places: readonly PlaceMilestone[],
  now: number,
): SkillDetail | null {
  // Disabled rows are not part of the game (they are not on the panel or in Total Level), so a
  // link to one is as unknown as a typo.
  const skill = rules.skills.find((s) => s.id === skillId && s.enabled)
  if (!skill) return null

  const held = standing.find((s) => s.skillId === skillId)
  const xp = held?.xp ?? 0
  const p = levelProgress(xp, rules.curve, held?.levelHighWater ?? 1)
  const k = stepCoefficient(rules.curve)
  const atMax = p.level >= rules.curve.maxLevel

  // EVERY row of this skill, whatever its version — I-15 has no exceptions. A replay deletes the
  // non-floor rows it re-derives (02 §4.4 step 2), so what survives under an older version is
  // exactly what still counts: `retained_floor` rows, stamped with the version that wrote them, and
  // a tombstoned activity's kept rows. Filtering by version here dropped a live 13,342 XP floor.
  const rows = ledger.filter((r) => r.skillId === skillId)
  const ledgerXp = rows.reduce((sum, r) => sum + r.xpAwarded, 0)

  const groups = new Map<string, { seq: string; rows: DetailLedgerRow[] }>()
  let carried = 0
  for (const r of rows) {
    if (r.isFloor || r.activityId.startsWith("__")) {
      carried += r.xpAwarded
      continue
    }
    const g = groups.get(r.activityId) ?? { seq: r.seq, rows: [] }
    g.rows.push(r)
    if (r.seq > g.seq) g.seq = r.seq
    groups.set(r.activityId, g)
  }
  const ordered = [...groups].sort(([, a], [, b]) => (a.seq < b.seq ? 1 : a.seq > b.seq ? -1 : 0))
  const recent: RecentRow[] = ordered.slice(0, RECENT_ROWS).map(([activityId, g]) => ({
    activityId,
    startedAt: startedAtOf(g.seq),
    units: formatUnits(
      g.rows.reduce((s, r) => s + r.units, 0),
      skill.unit,
    ),
    xp: g.rows.reduce((s, r) => s + r.xpAwarded, 0),
    parts: g.rows.map((r) => ({ reason: r.reason, units: formatUnits(r.units, skill.unit), xp: r.xpAwarded })),
  }))

  // Sessions and cadence: the trailing sessions the panel's NEXT line reads, from this ledger.
  const sessions = recentSessions(skillId, rows, rules.version)
  const perSession = sessions.length > 0 ? median(sessions) : 0
  const noun = skill.logMode === "trace" ? "run" : "session"
  let sessionsToNext: string | null = null
  if (perSession > 0 && !atMax) {
    const n = Math.max(1, Math.ceil(p.xpToNext / perSession))
    sessionsToNext = `~${n} ${noun}${n === 1 ? "" : "s"}`
  }

  // Sessions per day over the span the trailing sessions cover, up to now.
  const trailing = ordered
    .filter(([, g]) => g.rows.some((r) => r.xpRulesVersion === rules.version) && g.rows.reduce((s, r) => s + r.xpAwarded, 0) > 0)
    .slice(0, sessions.length)
  const oldest = trailing.length ? Date.parse(startedAtOf(trailing[trailing.length - 1]![1].seq)) : NaN
  const spanDays = Number.isFinite(oldest) ? Math.max((now - oldest) / DAY_MS, MIN_CADENCE_SPAN_DAYS) : NaN
  const perDay = sessions.length > 0 && Number.isFinite(spanDays) ? sessions.length / spanDays : 0

  const ahead: AheadRow[] = SKILL_MILESTONES.filter((m) => m.level > p.level && m.level <= rules.curve.maxLevel).map((m) => {
    const needed = cumulativeXp(m.level, k) - xp
    const estimate = perSession > 0 && perDay > 0 ? lowPrecision(needed / perSession / perDay) : null
    return { level: m.level, name: m.name, estimate }
  })

  return {
    skillId,
    name: skill.name,
    kind: skill.kind,
    level: p.level,
    atMax,
    xp,
    nextXp: atMax ? cumulativeXp(p.level, k) : cumulativeXp(p.level + 1, k),
    xpToNext: p.xpToNext,
    fraction: p.fraction,
    sessionsToNext,
    rules: rulesSentence(rules, skill),
    recent,
    more: Math.max(0, ordered.length - RECENT_ROWS),
    carried,
    ledgerXp,
    ahead,
    places: [...places].sort((a, b) => a.level - b.level),
  }
}

/** Ledger reasons in words, for a `RECENT` row's breakdown. The closed vocabulary of `02` §4.2. */
const REASON_WORDS: Record<string, string> = {
  new_ground: "new ground",
  rearmed_ground: "re-armed ground",
  recent_ground: "familiar ground",
  cells_new: "new cells",
  cells_rearmed: "re-armed cells",
  constitution_share: "share",
}

export const reasonWords = (reason: string) => REASON_WORDS[reason] ?? reason.replace(/_/g, " ")
