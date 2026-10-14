/**
 * THE CHRONICLE LINE. Ticket `0083`. `04-game-design.md` §4.2 step 4; `06-ui-ux.md` §3.2 beat 4,
 * §3.5 rule 4.
 *
 * *"One generated sentence, in the voice of the setting, drawn from the session's most distinctive
 * fact."* The sentences are DATA (`rules/chronicle.json`); this module is the selector and nothing
 * else. Adding a line is adding a row — there is no `switch` on a fact, a set or a row id anywhere
 * here, and `chronicle.test.ts` proves it by selecting a row the shipped table does not have.
 *
 * ─── HOW A ROW IS CHOSEN ────────────────────────────────────────────────────
 *
 *   1. The SET is fixed by the run: `newCells > 0` reads from `new-ground`, anything else from
 *      `no-new-ground` (§3.5 rule 4). Never both.
 *   2. A row is ELIGIBLE when every condition holds AND every placeholder in its text has a fact to
 *      fill it. A fact that was not computed fails its condition rather than reading as zero — so a
 *      row naming `{street}` waits, silently, until something supplies street names.
 *   3. Highest `rank` wins — rank is the table's own judgement of how distinctive a fact is.
 *   4. Ties break on a hash of the activity id and the row id. Deterministic, so `⟲ Relive` reads
 *      the same line it read the first time; spread, so two ordinary runs do not read the same one.
 *
 * ─── THE FALLBACK IS A PROPERTY OF THE TABLE ────────────────────────────────
 *
 * `assertChronicleTable` refuses a table in which either set lacks a row with no conditions and no
 * placeholders. Such a row is eligible for every run, so selection cannot come back empty — and the
 * guarantee lives where the lines live, not as a hard-coded string here that would drift from them.
 *
 * Pure: no clock, no I/O. The facts arrive computed (`chronicleFacts`), from history AS OF the run,
 * so the same activity yields the same facts tomorrow.
 */

export const CHRONICLE_SETS = ["new-ground", "no-new-ground"] as const
export type ChronicleSet = (typeof CHRONICLE_SETS)[number]

export const CONDITION_OPS = ["eq", "gt", "gte", "lt", "lte", "in"] as const
export type ConditionOp = (typeof CONDITION_OPS)[number]
export type Condition = Partial<Record<Exclude<ConditionOp, "in">, number>> & { in?: number[] }

export interface ChronicleRow {
  id: string
  /** One set or both. A row that suits either kind of run says so, rather than being written twice. */
  set: ChronicleSet | ChronicleSet[]
  rank: number
  /** Every fact named must be present and satisfy every op given. */
  when?: Record<string, Condition>
  /** `{fact}`, `{fact:words}`, `{fact:Words}`, `{fact:ordinal}`, `{fact:Ordinal}`. */
  text: string
  /** Free text for whoever edits the table. Ignored. */
  note?: string
}

export interface ChronicleTable {
  version: number
  rows: ChronicleRow[]
}

export type ChronicleFacts = Readonly<Record<string, number | string>>

/** The three forbidden shapes (§3.5 rule 4): a stated lack, a quantified lack, an instruction. */
export const FORBIDDEN_SHAPES: readonly RegExp[] = [/\bno new\b/i, /\b0 cells\b/i, /\btry\b/i]

const PLACEHOLDER = /\{([A-Za-z][A-Za-z0-9]*)(?::(words|Words|ordinal|Ordinal))?\}/g

export class ChronicleTableError extends Error {
  constructor(detail: string) {
    super(`rules/chronicle.json: ${detail}`)
    this.name = "ChronicleTableError"
  }
}

const setsOf = (row: ChronicleRow): ChronicleSet[] => (Array.isArray(row.set) ? row.set : [row.set])

/** Validates a parsed table. Every failure is a table bug, so every one throws. */
export function assertChronicleTable(raw: unknown): ChronicleTable {
  const t = raw as Partial<ChronicleTable> | null
  if (!t || typeof t.version !== "number" || !Array.isArray(t.rows)) {
    throw new ChronicleTableError("expected { version: number, rows: [...] }")
  }
  const ids = new Set<string>()
  for (const row of t.rows) {
    if (!row || typeof row.id !== "string" || !row.id) throw new ChronicleTableError("a row has no id")
    const at = `row "${row.id}"`
    if (ids.has(row.id)) throw new ChronicleTableError(`${at} is duplicated`)
    ids.add(row.id)
    if (typeof row.text !== "string" || !row.text.trim()) throw new ChronicleTableError(`${at} has no text`)
    if (typeof row.rank !== "number" || !Number.isFinite(row.rank)) throw new ChronicleTableError(`${at} has no rank`)
    const sets = setsOf(row)
    if (sets.length === 0 || sets.some((s) => !CHRONICLE_SETS.includes(s))) {
      throw new ChronicleTableError(`${at} has set ${JSON.stringify(row.set)}; expected ${CHRONICLE_SETS.join(" | ")}`)
    }
    for (const [fact, cond] of Object.entries(row.when ?? {})) {
      for (const [op, v] of Object.entries(cond)) {
        if (!(CONDITION_OPS as readonly string[]).includes(op)) {
          throw new ChronicleTableError(`${at}: unknown op "${op}" on ${fact}`)
        }
        const ok = op === "in" ? Array.isArray(v) && v.every((n) => typeof n === "number") : typeof v === "number"
        if (!ok) throw new ChronicleTableError(`${at}: ${fact}.${op} must be ${op === "in" ? "a number array" : "a number"}`)
      }
    }
    const stripped = row.text.replace(PLACEHOLDER, "")
    if (/[{}]/.test(stripped)) throw new ChronicleTableError(`${at} has a malformed placeholder: ${row.text}`)
    for (const shape of FORBIDDEN_SHAPES) {
      if (shape.test(row.text)) throw new ChronicleTableError(`${at} has a forbidden shape ${shape}: ${row.text}`)
    }
  }
  for (const set of CHRONICLE_SETS) {
    const fallback = t.rows.some(
      (r) => setsOf(r).includes(set) && Object.keys(r.when ?? {}).length === 0 && !hasPlaceholder(r.text),
    )
    if (!fallback) {
      throw new ChronicleTableError(`set "${set}" has no fallback row (no conditions, no placeholders)`)
    }
  }
  return t as ChronicleTable
}

const hasPlaceholder = (text: string): boolean => new RegExp(PLACEHOLDER.source).test(text)

function holds(value: number | string | undefined, cond: Condition): boolean {
  if (typeof value !== "number") return false
  if (cond.eq !== undefined && !(value === cond.eq)) return false
  if (cond.gt !== undefined && !(value > cond.gt)) return false
  if (cond.gte !== undefined && !(value >= cond.gte)) return false
  if (cond.lt !== undefined && !(value < cond.lt)) return false
  if (cond.lte !== undefined && !(value <= cond.lte)) return false
  if (cond.in !== undefined && !cond.in.includes(value)) return false
  return true
}

/** The row's text with every placeholder filled, or `null` if a fact it names is missing. */
export function renderRow(text: string, facts: ChronicleFacts): string | null {
  let missing = false
  const out = text.replace(PLACEHOLDER, (_, fact: string, format?: string) => {
    const v = facts[fact]
    if (v === undefined) {
      missing = true
      return ""
    }
    if (format === undefined) return String(v)
    if (typeof v !== "number") {
      missing = true
      return ""
    }
    const s = format.toLowerCase() === "ordinal" ? ordinalWords(v) : numberWords(v)
    return format[0] === format[0].toUpperCase() ? s[0].toUpperCase() + s.slice(1) : s
  })
  return missing ? null : out
}

export function setFor(facts: ChronicleFacts): ChronicleSet {
  return typeof facts.newCells === "number" && facts.newCells > 0 ? "new-ground" : "no-new-ground"
}

export interface ChronicleChoice {
  rowId: string
  set: ChronicleSet
  text: string
}

/**
 * THE LINE FOR A RUN. `seed` is the activity id. The table must have passed `assertChronicleTable`,
 * which is what makes the result non-null; a table that did not is a thrown error, not a blank line.
 */
export function chronicleLine(facts: ChronicleFacts, table: ChronicleTable, seed: string): ChronicleChoice {
  const set = setFor(facts)
  let best: { row: ChronicleRow; text: string; tie: number } | null = null
  for (const row of table.rows) {
    if (!setsOf(row).includes(set)) continue
    if (!Object.entries(row.when ?? {}).every(([fact, cond]) => holds(facts[fact], cond))) continue
    const text = renderRow(row.text, facts)
    if (text === null) continue
    const tie = fnv1a(`${seed}\u0000${row.id}`)
    if (!best || row.rank > best.row.rank || (row.rank === best.row.rank && tie < best.tie)) {
      best = { row, text, tie }
    }
  }
  if (!best) throw new ChronicleTableError(`no row eligible in set "${set}" — the table was not validated`)
  return { rowId: best.row.id, set, text: best.text }
}

function fnv1a(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

// ─── THE FACTS ────────────────────────────────────────────────────────────────

/** A league: three miles, the setting's unit of road. */
export const LEAGUE_M = 4828.032

/** A year back, for "the longest road you have walked in a year". 365 days, UTC — no calendar. */
const YEAR_MS = 365 * 24 * 60 * 60 * 1000

/**
 * How many earlier roads a record needs before "the longest" means anything. Without a floor the
 * second run anyone logs is "the longest road you have walked in a year" — true, and hollow.
 */
export const LONGEST_IN_YEAR_MIN_PRIOR = 8
export const LONGEST_EVER_MIN_PRIOR = 20

export interface ChronicleRun {
  activityId: string
  startedAt: string
  distanceM: number | null
  newCellCount: number
  rearmedCellCount: number
  /** Cells the run touched, all classes. `null` where the row predates the column. */
  cellCount: number | null
  traced: boolean
  /** The street this run came back to, and after how long (`returnedTo`). Absent: no such fact. */
  returned?: ReturnedTo | null
  /** Each re-armed cell's gap in days, named or not — what `returnedTo` falls back to. */
  rearmGapsDays?: readonly number[]
  /** The town or neighbourhood the run started in (`0256`). */
  place?: string | null
}

/** One earlier activity, as the history read returns it. */
export interface PriorRun {
  activityId: string
  startedAt: string
  distanceM: number | null
  newCellCount: number
}

/** True when `a` comes before `b` in replay order: `startedAt`, then id (the ledger's own order). */
export const isBefore = (a: Pick<PriorRun, "startedAt" | "activityId">, b: Pick<PriorRun, "startedAt" | "activityId">) =>
  a.startedAt < b.startedAt || (a.startedAt === b.startedAt && a.activityId < b.activityId)

/**
 * EVERY FACT A TEMPLATE MAY NAME, computed from the run and the activities strictly before it.
 * `history` may include the run itself and anything after it; both are filtered out here, so the
 * answer does not move when a later run lands. A fact that cannot be known is ABSENT, never zero —
 * and `history: null` (the read failed) knows nothing lifetime-shaped, rather than mistaking the run
 * for a first one and announcing milestones it did not reach.
 */
export function chronicleFacts(run: ChronicleRun, history: readonly PriorRun[] | null): Record<string, number | string> {
  const facts: Record<string, number | string> = {
    newCells: run.newCellCount,
    rearmedCells: run.rearmedCellCount,
    traced: run.traced ? 1 : 0,
  }
  // Names are facts like any other (`0256`): a row naming `{street}` or `{place}` is eligible the
  // moment one is known, with no change here or in the selector.
  if (run.place) facts.place = run.place
  if (run.returned) {
    facts.street = run.returned.street
    facts.rearmGapDays = run.returned.gapDays
  } else if (run.rearmGapsDays?.length) {
    facts.rearmGapDays = Math.min(...run.rearmGapsDays)
  }
  if (run.cellCount !== null && run.cellCount > 0) {
    facts.cellCount = run.cellCount
    facts.newPerHundred = Math.floor((run.newCellCount * 100) / run.cellCount)
  }
  const d = run.distanceM
  if (d !== null && d > 0) facts.distanceKm = Math.round(d / 100) / 10
  if (!history) return facts

  const prior = history.filter((h) => h.activityId !== run.activityId && isBefore(h, run))
  const cellsBefore = prior.reduce((s, h) => s + h.newCellCount, 0)
  facts.lifetimeCellsBefore = cellsBefore
  facts.lifetimeCells = cellsBefore + run.newCellCount

  if (d !== null && d > 0) {
    const roads = prior.filter((h) => h.distanceM !== null && h.distanceM > 0)
    facts.roadCount = roads.length + 1
    const metresBefore = roads.reduce((s, h) => s + (h.distanceM ?? 0), 0)
    facts.lifetimeLeaguesBefore = metresBefore / LEAGUE_M
    facts.lifetimeLeagues = (metresBefore + d) / LEAGUE_M

    const at = Date.parse(run.startedAt)
    const year = roads.filter((h) => at - Date.parse(h.startedAt) <= YEAR_MS)
    facts.longestInYear =
      year.length >= LONGEST_IN_YEAR_MIN_PRIOR && year.every((h) => (h.distanceM ?? 0) < d) ? 1 : 0
    facts.longestEver =
      roads.length >= LONGEST_EVER_MIN_PRIOR && roads.every((h) => (h.distanceM ?? 0) < d) ? 1 : 0
  }
  return facts
}

// ─── THE STREET A RUN CAME BACK TO ────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000

/** Whole days from `since` to `at`, both ISO. Floored: "211 days" is never more than happened. */
export const daysBetween = (since: string, at: string): number => Math.floor((Date.parse(at) - Date.parse(since)) / DAY_MS)

export interface ReturnedTo {
  street: string
  gapDays: number
}

/** One re-armed cell: its previous `lastRunAt` and the street it lies on, if any. */
export interface RearmedCell {
  since: string
  street: string | null
}

/**
 * *"You returned to Ashgrove Lane after two hundred and eleven days."* The street the most re-armed
 * cells lie on — the one the run actually spent its returning on, not a corner it clipped — ties
 * broken by name. The gap is that street's SHORTEST: the time since you were last anywhere on it,
 * which is the only gap the sentence can claim truthfully. `null` when no re-armed cell is named.
 */
export function returnedTo(cells: readonly RearmedCell[], startedAt: string): ReturnedTo | null {
  const by = new Map<string, { n: number; gap: number }>()
  for (const c of cells) {
    if (!c.street) continue
    const gap = daysBetween(c.since, startedAt)
    const hit = by.get(c.street)
    if (hit) {
      hit.n++
      hit.gap = Math.min(hit.gap, gap)
    } else by.set(c.street, { n: 1, gap })
  }
  let best: (ReturnedTo & { n: number }) | null = null
  for (const [street, { n, gap }] of by) {
    if (!best || n > best.n || (n === best.n && street < best.street)) best = { street, gapDays: gap, n }
  }
  return best && { street: best.street, gapDays: best.gapDays }
}

// ─── NUMBERS IN WORDS ─────────────────────────────────────────────────────────

const SMALL = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen",
]
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"]
const SCALES: [number, string][] = [[1_000_000_000, "billion"], [1_000_000, "million"], [1_000, "thousand"]]

function under1000(n: number): string {
  const h = Math.floor(n / 100)
  const r = n % 100
  const rest = r < 20 ? SMALL[r] : TENS[Math.floor(r / 10)] + (r % 10 ? `-${SMALL[r % 10]}` : "")
  if (h === 0) return rest
  return `${SMALL[h]} hundred` + (r ? ` and ${rest}` : "")
}

/** `211` → `"two hundred and eleven"`. The setting's voice, so the British "and". Integers only. */
export function numberWords(value: number): string {
  let n = Math.floor(Math.abs(value))
  if (n === 0) return "zero"
  const parts: string[] = []
  for (const [size, name] of SCALES) {
    if (n >= size) {
      parts.push(`${under1000(Math.floor(n / size))} ${name}`)
      n %= size
    }
  }
  if (n > 0) parts.push((parts.length && n < 100 ? "and " : "") + under1000(n))
  return (value < 0 ? "minus " : "") + parts.join(" ")
}

const ORDINAL_IRREGULAR: Record<string, string> = {
  one: "first", two: "second", three: "third", five: "fifth", eight: "eighth", nine: "ninth", twelve: "twelfth",
}

/** `250` → `"two hundred and fiftieth"`. */
export function ordinalWords(value: number): string {
  const words = numberWords(value)
  return words.replace(/([a-z]+)$/, (last) => {
    if (ORDINAL_IRREGULAR[last]) return ORDINAL_IRREGULAR[last]
    if (last.endsWith("y")) return `${last.slice(0, -1)}ieth`
    return `${last}th`
  })
}
