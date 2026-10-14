import { simplifyLine, type Position } from "@/src/domain/simplify-line"

/**
 * THE WEB OF WORN PATHS. Ticket `0085`, D-299. `06-ui-ux.md` §3.5 rule 2.
 *
 * Every route ever run, drawn once, faintly, with the ground run most drawn darker. Pure: the stored
 * routes in, one GeoJSON `FeatureCollection` out, so the home map, beat 1's *"before"* and a test all
 * build it the same way.
 *
 * ─── WHY EACH PIECE OF GROUND IS DRAWN ONCE ─────────────────────────────────
 *
 * MapLibre alpha-blends overlapping features in one line layer, so fifty runs of the same commute
 * drawn fifty times at 0.28 saturate to `1 − 0.72⁵⁰` — black. Criterion 2 forbids that. So the build
 * walks the runs oldest first and draws a stretch only where no earlier run already did; a stretch
 * already drawn is not drawn again, it gets darker. How dark is a bounded step of how many runs passed
 * it (`WEAR`), and the darkest step is `WEAR_MAX`, whatever the count.
 *
 * "Passed it" is a ~10 m grid with its neighbours, not exact geometry: two runs down the same street
 * are a few metres apart and are the same path, and two parallel streets are tens of metres apart and
 * are not. The grid is metric about a fixed latitude, and integer-keyed, because five years of running
 * is ~1.5 M samples and an H3 lookup per sample would cost seconds on the main thread.
 *
 * ─── NOTHING IN HERE IS A SCORE ─────────────────────────────────────────────
 *
 * §3.5: *"not a repetition reward (P6) — nothing is scored off it, there is no '10th time' badge"*.
 * The output carries a paint value, `wear`, and nothing else: no count reaches the map, so none can
 * reach the screen. `web.test.ts` holds that, and the grep that no scoring module imports this.
 */

export interface WebRunInput {
  activityId: string
  startedAt: string
  lines: Position[][]
}

export interface WebFeature {
  type: "Feature"
  geometry: { type: "LineString"; coordinates: Position[] }
  properties: { wear: number }
}

export interface WebFeatureCollection {
  type: "FeatureCollection"
  features: WebFeature[]
}

export const EMPTY_WEB: WebFeatureCollection = { type: "FeatureCollection", features: [] }

/**
 * THE PAINT, BY HOW WORN THE GROUND IS. §3.5: `--ink-300` at 0.28 for a path run once, and *"the
 * segments you have run most darken perceptibly"*. Steps of doubling — 1, 2, 3–4, 5–8, 9+ — because a
 * second pass is a visible event and a fiftieth is not; and capped, so a daily commute stops at
 * `WEAR_MAX` instead of saturating (criterion 2).
 */
export const WEAR = [0.28, 0.36, 0.44, 0.52, 0.6] as const
export const WEAR_MAX = WEAR[WEAR.length - 1]!

/** The step for ground passed by `n` runs. */
export function wearStep(n: number): number {
  return n <= 1 ? 0 : Math.min(WEAR.length - 1, Math.ceil(Math.log2(n)))
}

/** The grid's cell, metres. */
export const GRID_M = 10
/** Densify to this spacing before sampling, so no cell is stepped over. */
const SAMPLE_M = 4
/**
 * A run does not block itself until it is this far past a cell — so an out-and-back draws its
 * return leg over its outbound one rather than twice, without the outbound blocking its own next step.
 */
const SELF_LAG_M = 40
/** A step shorter than this many samples is folded into its neighbour, so a piece does not flicker. */
const MIN_STEP_SAMPLES = 5

const R_EARTH = 6_371_008.8
const RAD = Math.PI / 180
const OFFSET = 2 ** 22
/** One step in x, in the packed cell key. */
const ROW = 2 ** 23

interface Sample {
  p: Position
  cell: number
  /** Distance along the run, metres. */
  at: number
  /** First sample of a line: the piece cannot reach back past it. */
  head: boolean
}

export function buildWeb(
  input: readonly WebRunInput[],
  options: { exclude?: string } = {},
): WebFeatureCollection {
  const runs = input
    .filter((r) => r.activityId !== options.exclude && r.lines.some((l) => l.length >= 2))
    .slice()
    .sort((a, b) => (a.startedAt === b.startedAt ? cmp(a.activityId, b.activityId) : cmp(a.startedAt, b.startedAt)))
  if (runs.length === 0) return EMPTY_WEB

  const firstLat = runs[0]!.lines.find((l) => l.length >= 2)![0]![1]
  const kx = (R_EARTH * RAD * Math.cos(firstLat * RAD)) / GRID_M
  const ky = (R_EARTH * RAD) / GRID_M
  const cellOf = (p: Position) =>
    (Math.floor(p[0] * kx) + OFFSET) * ROW + (Math.floor(p[1] * ky) + OFFSET)
  /** The cell and its eight neighbours, into `into`. A loop, not an array: this runs per sample. */
  const widen = (cell: number, into: Set<number>) => {
    for (let dx = -ROW; dx <= ROW; dx += ROW) for (let dy = -1; dy <= 1; dy++) into.add(cell + dx + dy)
  }

  const samples = runs.map((run) => sampleRun(run.lines, cellOf))

  // How many runs passed each cell — counted with each run's cells widened by one, once per run.
  const passes = new Map<number, number>()
  for (const run of samples) {
    const own = new Set<number>()
    for (const s of run) own.add(s.cell)
    const seen = new Set<number>()
    for (const c of own) widen(c, seen)
    for (const c of seen) passes.set(c, (passes.get(c) ?? 0) + 1)
  }

  const features: WebFeature[] = []
  const drawn = new Set<number>()
  for (const run of samples) {
    const pending: Sample[] = []
    let next = 0
    let last = NaN
    const settle = (upTo: number) => {
      while (next < pending.length && pending[next]!.at < upTo) {
        const cell = pending[next++]!.cell
        if (cell !== last) widen(cell, drawn)
        last = cell
      }
    }
    const steps = smoothSteps(run.map((s) => wearStep(passes.get(s.cell) ?? 1)))
    let piece: Position[] = []
    let pieceStep = -1
    const flush = () => {
      if (piece.length >= 2) {
        features.push({
          type: "Feature",
          geometry: { type: "LineString", coordinates: simplifyLine(piece) },
          properties: { wear: WEAR[pieceStep]! },
        })
      }
      piece = []
      pieceStep = -1
    }
    for (let i = 0; i < run.length; i++) {
      const s = run[i]!
      settle(s.at - SELF_LAG_M)
      pending.push(s)
      if (s.head) flush()
      if (drawn.has(s.cell)) {
        // Close the piece onto this point, so the new ground meets the web without a gap.
        if (piece.length > 0) piece.push(s.p)
        flush()
        continue
      }
      const step = steps[i]!
      if (piece.length === 0) {
        // Reach back one sample to join whatever this leaves, unless this is the start of a line.
        const prev = run[i - 1]
        if (prev && !s.head) piece.push(prev.p)
        pieceStep = step
      } else if (step !== pieceStep) {
        piece.push(s.p)
        flush()
        piece.push(s.p)
        pieceStep = step
        continue
      }
      piece.push(s.p)
    }
    flush()
    settle(Infinity)
  }
  return { type: "FeatureCollection", features }
}

function sampleRun(lines: readonly Position[][], cellOf: (p: Position) => number): Sample[] {
  const out: Sample[] = []
  let at = 0
  for (const line of lines) {
    if (line.length < 2) continue
    let head = true
    for (let i = 0; i < line.length; i++) {
      const b = line[i]!
      if (i > 0) {
        const a = line[i - 1]!
        const d = metres(a, b)
        const n = Math.max(1, Math.ceil(d / SAMPLE_M))
        for (let k = 1; k < n; k++) {
          const t = k / n
          const p: Position = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
          out.push({ p, cell: cellOf(p), at: at + d * t, head: false })
        }
        at += d
      }
      out.push({ p: b, cell: cellOf(b), at, head })
      head = false
    }
  }
  return out
}

/** Steps shorter than `MIN_STEP_SAMPLES` take the step before them (or after, at the start). */
function smoothSteps(steps: number[]): number[] {
  const out = steps.slice()
  let i = 0
  while (i < out.length) {
    let j = i
    while (j < out.length && out[j] === out[i]) j++
    if (j - i < MIN_STEP_SAMPLES) {
      const fill = i > 0 ? out[i - 1]! : j < out.length ? out[j]! : out[i]!
      for (let k = i; k < j; k++) out[k] = fill
    }
    i = j
  }
  return out
}

function metres(a: Position, b: Position): number {
  const x = (b[0] - a[0]) * Math.cos(((a[1] + b[1]) / 2) * RAD)
  const y = b[1] - a[1]
  return Math.sqrt(x * x + y * y) * RAD * R_EARTH
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
