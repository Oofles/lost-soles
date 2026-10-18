import { cellToLatLng } from "h3-js"

import { REDUCED_BAND } from "@/lib/run-moment/beat1"
import { mercatorX, mercatorY } from "@/lib/fog/instances"
import { REVEAL_RAMP, type BloomUniform } from "@/lib/fog/mask"
import type { RevealCell } from "@/lib/fog/reveal"
import { quantiseArc } from "@/lib/fog/reveal-tag"
import { CARD_MS } from "@/lib/level-up/beat3"
import type { LevelCard } from "@/lib/level-up/cards"
import { rulesForSkills, type CachedSkill } from "@/lib/log/optimistic"
import { skillsPanel } from "@/lib/skills/panel"
import { bigToCell } from "@/src/domain/explored-blob"

import type { BackfillMark } from "./batch"

/**
 * THE AGGREGATE REVEAL, AS DATA AND AS A CLOCK. Ticket `0257`. `06-ui-ux.md` §3.4 *Backfill*:
 *
 * > Backfill produces **one** aggregate reveal: the whole archive burns back at once over 4 s, with a
 * > ledger showing lifetime totals and starting levels, and a single card: `Total Level 214`.
 *
 * Pure. What burns back is the batch's ground — every cell in the `after` generation that the
 * `before` generation did not hold — and the timeline is one clock, like the run sequence's, so the
 * one-listener skip (`lib/run-moment/exit.ts`) ends all of it at once:
 *
 *   0.0 – 4.0   the burn: the archive clears outward from where the map is looking, gold as it goes
 *   4.0 – 4.3   the ledger rises over the map (fades, under reduced motion)
 *   5.0 – 6.4   the one Total Level card
 *   6.4 – 8.4   the ledger holds, settled, to be read; then the map is home again
 *
 * 8.4 s, the same as a run's sequence (§3.2), and ONE sequence however many activities came in.
 */

export const BURN_MS = 4000
/** §3.2's 600 ms gold bloom, on the burn's clock. There is no remembered ground in a first reveal. */
const GOLD_MS = 600
const FROST_MS = 900
/** The bloom fades out over this, after the burn, so a bloom cut off mid-flush never pops. */
const SETTLE_MS = 300
export const LEDGER_AT = BURN_MS
export const LEDGER_RISE_MS = 300
/** How far the ledger rises, px. Beat 2's panel rises; this is a smaller one. */
const LEDGER_RISE_PX = 24
export const CARD_AT = 5000
export const AGGREGATE_END = CARD_AT + CARD_MS + 2000
/** Reduced motion: the burn is a 400 ms cross-fade (§3.4), then holds — order and timing unchanged. */
export const REDUCED_FADE_MS = 400

export interface AggregateFrame {
  phase: "burn" | "ledger" | "card" | "hold" | "done"
  /** The mask's `revealProgress`, `0..1`. */
  progress: number
  bloom: BloomUniform
  /** The ledger's opacity and its rise still to go, px. */
  ledger: number
  rise: number
  /** Whether the Total Level card is up (it runs its own 1.4 s clock, `LevelUpQueue`). */
  card: boolean
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)

function phaseAt(t: number): AggregateFrame["phase"] {
  if (t >= AGGREGATE_END) return "done"
  if (t >= CARD_AT + CARD_MS) return "hold"
  if (t >= CARD_AT) return "card"
  if (t >= LEDGER_AT) return "ledger"
  return "burn"
}

const OFF: BloomUniform = { clock: -1, fade: 0, goldSpan: GOLD_MS / BURN_MS, frostSpan: FROST_MS / BURN_MS }

export function aggregateAt(t: number): AggregateFrame {
  const phase = phaseAt(t)
  // Linear in the cells' order: the eye reads a steady front, never a pace.
  const progress = clamp01(t / BURN_MS)
  const settle = clamp01((t - BURN_MS) / SETTLE_MS)
  const bloom: BloomUniform =
    t < 0 || settle >= 1 ? OFF : { ...OFF, clock: t / BURN_MS, fade: 1 - settle * settle }
  const up = clamp01((t - LEDGER_AT) / LEDGER_RISE_MS)
  const eased = 1 - (1 - up) ** 3
  return {
    phase,
    progress,
    bloom,
    ledger: t >= LEDGER_AT ? eased : 0,
    rise: t >= LEDGER_AT ? LEDGER_RISE_PX * (1 - eased) : LEDGER_RISE_PX,
    card: phase === "card",
  }
}

/**
 * `prefers-reduced-motion` (§3.4, `05` §4.5): no travelling front, no bloom, no rise. The burn is one
 * 400 ms cross-fade across the composite's visible band (`beat1ReducedAt`'s reasoning — a weight
 * ramped 0 → 1 reads as a snap), then the map holds lit until the ledger, which fades in complete.
 * The same boundaries, the same content: only the motion is removed.
 */
export function aggregateReducedAt(t: number): AggregateFrame {
  const phase = phaseAt(t)
  const fade = clamp01(t / REDUCED_FADE_MS)
  const [lo, hi] = REDUCED_BAND
  const weight = t <= 0 ? 0 : lo + (hi - lo) * fade
  const up = clamp01((t - LEDGER_AT) / LEDGER_RISE_MS)
  return {
    phase,
    progress: fade >= 1 ? 1 : REVEAL_RAMP * weight,
    bloom: OFF,
    ledger: t >= LEDGER_AT ? up : 0,
    rise: 0,
    card: phase === "card",
  }
}

/**
 * THE BATCH'S GROUND: cells in `after` and not in `before`, each placed on the burn's clock.
 *
 * Both inputs are ascending (the blob's order), so the difference is one merge (`addedCells`; home
 * holds exactly these back until the reveal plays). Each cell's arc is
 * its RANK by distance from `origin` — where the map is looking as the reveal starts — so the
 * territory clears outward from the middle of the screen at a steady count of cells per frame. Rank,
 * not raw distance: one run abroad would otherwise stretch the scale until the whole home region
 * cleared in the first tenth of a second. `origin` null: the cells' own centroid.
 *
 * Every cell is `new` ground — it was fog before the import — so it blooms gold as it clears.
 */
export function addedCells(after: ArrayLike<bigint>, before: ArrayLike<bigint>): bigint[] {
  const added: bigint[] = []
  let j = 0
  for (let i = 0; i < after.length; i++) {
    const c = after[i]!
    while (j < before.length && before[j]! < c) j++
    if (j < before.length && before[j] === c) continue
    added.push(c)
  }
  return added
}

/** `addedCells`' output, placed on the burn's clock. See above. */
export function aggregateRevealCells(
  added: readonly bigint[],
  origin: { lat: number; lng: number } | null,
): RevealCell[] {
  if (added.length === 0) return []

  const cells = added.map((big) => {
    const cell = bigToCell(big)
    const [lat, lng] = cellToLatLng(cell)
    return { cell, lat, lng, x: mercatorX(lng), y: mercatorY(lat) }
  })
  const o =
    origin ??
    cells.reduce((m, c) => ({ lat: m.lat + c.lat / cells.length, lng: m.lng + c.lng / cells.length }), { lat: 0, lng: 0 })
  const ox = mercatorX(o.lng)
  const oy = mercatorY(o.lat)
  const ranked = cells
    .map((c) => ({ ...c, d: Math.hypot(c.x - ox, c.y - oy) }))
    .sort((a, b) => a.d - b.d || (a.cell < b.cell ? -1 : a.cell > b.cell ? 1 : 0))
  const last = Math.max(1, ranked.length - 1)
  return ranked.map((c, i) => ({ cell: c.cell, x: c.x, y: c.y, arc: quantiseArc(i / last), ground: "new" as const }))
}

/** One skill's line on the ledger: where it starts now, and where it stood before the import. */
export interface LedgerSkill {
  skillId: string
  name: string
  level: number
  /** The level before the import; equal to `level` for a skill the import did not move. */
  from: number
}

export interface AggregateLedger {
  /** `97 activities · Feb 2020 – Aug 2026` */
  imported: string
  /** Lifetime totals, label and value, already formatted. */
  totals: { label: string; value: string; detail: string | null }[]
  /** Every trained skill, in the panel's order (`skillsPanel`, D-031: no skill named here). */
  skills: LedgerSkill[]
  totalLevel: { from: number; to: number }
  /** The single card (§3.4): Total Level, at its new value. */
  card: LevelCard
}

const fmt = new Intl.NumberFormat("en-US")
const month = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" })

/**
 * THE LEDGER: lifetime totals and starting levels (§3.4). Every number is LIFETIME (D-013) — the
 * import's own count and span are the only figures about the batch, and they describe what came in,
 * not a period. Levels are `skillsPanel`'s over each standing, so the ledger, the plinth and
 * `/skills` read one rule.
 */
export function aggregateLedger(mark: BackfillMark): AggregateLedger {
  const panel = (skills: CachedSkill[]) => skillsPanel(rulesForSkills(skills), skills)
  const after = panel(mark.after.skills)
  const before = panel(mark.before.skills)
  const was = new Map([...before.activity, ...before.meta, ...before.untrained].map((t) => [t.skillId, t.level]))

  const span = [mark.imported.firstStartedAt, mark.imported.lastStartedAt]
    .filter((s): s is string => s !== null)
    .map((s) => month.format(new Date(s)))
  const range = span.length === 0 ? "" : span[0] === span[1] ? ` · ${span[0]}` : ` · ${span[0]} – ${span[1]}`
  const n = mark.imported.count
  const gained = mark.after.cells - mark.before.cells

  return {
    imported: `${fmt.format(n)} ${n === 1 ? "activity" : "activities"}${range}`,
    totals: [
      { label: "Activities", value: fmt.format(mark.after.activities), detail: null },
      { label: "Cells revealed", value: fmt.format(mark.after.cells), detail: gained > 0 ? `+${fmt.format(gained)}` : null },
      { label: "Lifetime XP", value: fmt.format(after.totalXp), detail: null },
    ],
    skills: [...after.activity, ...after.meta].map((t) => ({
      skillId: t.skillId,
      name: t.name,
      level: t.level,
      from: was.get(t.skillId) ?? 1,
    })),
    totalLevel: { from: before.totalLevel, to: after.totalLevel },
    card: { kind: "total", milestone: after.totalLevel },
  }
}
