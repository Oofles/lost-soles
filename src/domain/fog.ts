import {
  cellToLatLng,
  cellToParent,
  getHexagonEdgeLengthAvg,
  gridDisk,
  latLngToCell,
  UNITS,
  type H3Index,
} from "h3-js"

import type { GeoPoint, Trace } from "./activity"
import { MAX_IMPLIED_SPEED_MS, impliedSpeedMs, metresBetween } from "./geo"

/**
 * TRACE → TERRITORY. Tickets `0045` and `0046`. `05-fog-of-war.md` §2.2 is the
 * specification and its pseudocode is normative.
 *
 * `traceToCells` turns a normalised `Trace` into the set of H3 res-11 cells a run
 * reveals. `0045` built steps 0–4 — split on gaps, clean, collapse dwells, split on
 * implausible jumps, densify and collect a deliberately generous candidate set. `0046`
 * added **step 5, the exact `REVEAL_R_M` filter**, and step 5 is where the word
 * "revealed" acquires its meaning: before it the output was candidates and nothing was
 * allowed to treat them as ground. `0047`, which writes `ExploredCell`, depended on
 * `0046` for exactly that reason and may now read this function's output directly.
 *
 * PURE. No clock, no network, no randomness, no store access. It runs server-side in the
 * ingest Lambda, always (§2.2) — the client never computes cells for scoring. With one
 * user that trust boundary is theoretical, and it costs nothing to get right.
 *
 * ─── WHY A `Set`, AND WHY THAT IS NOT AN IMPLEMENTATION DETAIL ──────────────
 *
 * Every same-run property in §3.3 falls out of the return type alone. An out-and-back over
 * one street, a loop, a figure-eight, crossing your own path at mile four — each is a cell
 * appearing in the set once or not at all, with no code anywhere that knows those cases
 * exist. Do not "optimise" it into an array; the deduplication IS the feature.
 *
 * ─── RESOLUTION 11, CANONICAL, NEVER MIXED (D-237, superseding D-115) ───────
 *
 * A res-10 cell and its res-11 children are different ids, and `gridDisk`, `gridDistance`
 * and `gridPathCells` all refuse to cross resolutions. Res 11 is the only resolution this
 * function ever emits. Coarser resolutions exist only as derived render aggregates
 * (`0058`) and only as a transport option (`0049`) — and a compacted array must go back
 * through `uncompactCells(arr, RES)` before any membership test.
 *
 * **It was res 10 until `0194`.** D-115 chose 10 and §9.4 accepted its over-reveal *"with an
 * exit"*; `0194` took the exit. The operator's complaint was specific and geometric — on a
 * street run at an angle, the revealed corridor visibly zig-zagged rather than following the
 * line. The cause is not the grid but the BRUSH: cell centres sit a median 28 m off the route
 * (that is `REVEAL_R_M`, and res 11 does not change it — median 32 m, p95 61 m against res 10's
 * 62 m), and a 28 m wander painted with res 10's 102 m render disc reads as a zig-zag where the
 * same wander painted with res 11's 39 m disc reads as a line.
 */

/** The one resolution. D-237, superseding D-115; see the header. */
export const RES = 11

/**
 * THE PARENT RESOLUTION — res 6, and it is one decision with three payoffs.
 * `02-data-model.md` T6 and §2.4; `05-fog-of-war.md` §6.2; ticket `0047`.
 *
 * A res-6 cell is ~36.13 km² and had exactly **7⁴ = 2,401** res-10 children, which is a
 * *hard ceiling*, not an average. That single fact did all three jobs:
 *
 *   1. **It bounds a DynamoDB partition.** 2,401 × ~160 B ≈ 384 KB, three orders of
 *      magnitude under the 10 GB limit, so T6's partition key can be the parent and no
 *      partition can ever go hot.
 *   2. **It bounds a viewport read** to 1–20 `Query` calls (AP-15/AP-16), and one 5-mile
 *      run touches 1–2 parents.
 *   3. **It hands the client its bucketing for free** (§6.2) and the delta-invalidation
 *      key with it (§7.4).
 *
 * Res 7 was rejected — 343 children makes partitions too small and multiplies rebuild
 * queries by 7 — and res 5 too, at 16,807 children and ~2.7 MB partitions.
 *
 * ─── AND D-237 MOVED THE GRID OUT FROM UNDER IT. TICKET `0198` OWNS THE FIX ──
 *
 * At res 11 a res-6 parent has **7⁵ = 16,807** children, not 2,401 — *precisely the number
 * rejected above for res 5*, at ~2.7 MB per partition. Nothing breaks today: 2.7 MB is still
 * three orders of magnitude under the 10 GB partition limit and the account holds 695 cells,
 * so payoff (1) survives with a smaller margin. What degrades is (2) — a viewport read pulls
 * up to 7x the items per `Query`.
 *
 * **The fix is res 7, and it is exactly the arithmetic this comment already describes:** a
 * res-7 parent has 7⁴ = 2,401 res-11 children, restoring every number above unchanged. It is
 * not done here because it re-keys every T6 row and touches AP-15/AP-16, §6.2's client
 * bucketing and §7.4's delta-invalidation key — a migration in its own right, filed as `0198`.
 * Left as res 6 deliberately and visibly, rather than changed quietly along with `RES`.
 *
 * NOT A SECOND CANONICAL RESOLUTION. Nothing is ever *stored* at res 6: it is a grouping
 * of res-10 ids, derived on demand, and `RES` remains the only resolution this module
 * emits (D-115).
 */
export const RES_PARENT = 6

/**
 * The res-6 parent of a res-11 cell — T6's partition key, minus the `U#<uid>#C#` prefix
 * that `src/pipeline/explored-cells.ts` owns.
 *
 * Here rather than in the pipeline because it is pure H3 and because D-115's
 * never-mix rule is stated in this file: `cellToParent` is one of the few calls in the
 * library that legitimately crosses resolutions, and it belongs next to the constant that
 * says crossing is otherwise forbidden.
 */
export function parentOf(cell: H3Index): H3Index {
  return cellToParent(cell, RES_PARENT)
}

/**
 * **THE DEFINITION OF THE WORD "REVEALED": 65 metres either side of the path.** A ~130 m
 * corridor. Ticket `0046`; `05-fog-of-war.md` §2.3; D-115.
 *
 * **It is not a tuning knob and it has no fudge factor.** It is also, since D-237, no longer
 * tied to the grid. At res 10 the inradius was **65.7 m** and the game rule and the geometry
 * landed on the same number, so the reveal was to within rounding *"the cell you ran through"*
 * (D-216). **That coincidence is gone**: res 11's inradius is 24.8 m, 65 m is 2.6 inradii, and
 * a revealed cell need not have been entered. See `CANDIDATE_K`, which is what the coincidence
 * used to make unnecessary.
 *
 * **The corridor on the ground did not move.** That is the point of changing the grid and not
 * this number: membership is "centre within 65 m of the path" at either resolution, so the
 * same ground is revealed — measured across the operator's eleven archived runs, 1.343 km² at
 * res 10 against 1.359 km² at res 11, a 1.2% difference that is the finer grid resolving the
 * same boundary. Only the RENDER brush narrowed, 102 m to 39 m.
 *
 * Why the reveal is not simply a wide candidate disc: at res 10 `gridDisk(c, 1)` was 7 cells
 * and ~394 m across, effective radius near 200 m (R3 §1.1). On a US grid with 80–120 m block
 * spacing, running one street would reveal both parallel streets. D-012 says the point is
 * running new places, and a map that gifts you ground you never saw attacks that directly.
 * Step 5 is what keeps the candidate disc from becoming the reveal.
 *
 * Defensible in both directions: 65 m is the far side of a street plus a front garden, so
 * you can genuinely claim to have seen it; and it is generous enough to swallow consumer
 * GPS error (5–15 m in the open, 20–40 m in an urban canyon) with no per-sample error
 * modelling.
 *
 * ─── NOT THE RENDER RADIUS. THEY MUST NEVER MEET ────────────────────────────
 *
 * `REVEAL_R_M` is scoring and set membership: server-side, authoritative, permanent under
 * D-020. The renderer's `revealScale × circumradius ≈ 1.35 × 28.7 ≈ 39 m` (§4, ticket
 * `0055`; 102 m before D-237) is a soft disc splatted into the mask shader that **overspills the hexagon on
 * purpose**, so neighbouring discs merge without scalloping. It is a look, not a fact, and
 * it must never feed back into what counts as explored. `scripts/check-fog-render-boundary.mjs`
 * enforces both halves: no renderer import reaches `src/domain/`, and `revealScale` may not
 * appear under `src/` at all.
 *
 * ─── CHANGING IT IS A REBALANCE, NOT A TWEAK ────────────────────────────────
 *
 * Every Cartography number scales linearly with this constant (`04-game-design.md` §10,
 * D-215). §9.4 accepts that a 131 m corridor over-reveals slightly in dense grids and names
 * the exit — raw traces are archived (`0039`), so the whole cell set can be re-derived at a
 * finer resolution or a tighter radius. Nothing here is one-way — `0194` proved it by taking
 * exactly that exit, re-deriving the whole set from the S3 archive through `0192`'s replay
 * path. But it is expensive once XP has been awarded against it: change it before ship, or
 * not at all. That is why `0194` was worked BEFORE capability `09` wrote its first ledger row.
 */
export const REVEAL_R_M = 65

/** Drop samples with worse reported accuracy. Absent accuracy is unknown, NOT bad. */
export const MAX_ACC_M = 50

/** Below this speed a runner is not running. §2.2. */
export const DWELL_SPEED_MS = 0.5

/** ...and below it for this long, they are standing still. §2.2. */
export const DWELL_MIN_S = 60

/**
 * THE SPEED ABOVE WHICH A STEP IS A LOST FIX, NOT A RUN — and it is the SAME NUMBER the
 * ingestion sanitizer gates on, deliberately. Ticket `0045` criterion 11; D-197.
 *
 * §2.2 as written says `TELEPORT_SPEED = 12.0`, and the `05-strava-adapter` drift audit
 * (2026-09-06, divergence 2) flagged that it contradicts the sanitizer, which D-197 set to
 * **12.5 m/s** for foot activities after measuring 21,225 real fixes. The audit left the
 * number unresolved on purpose and made reconciling it this ticket's obligation, because
 * §9.5 says to measure before touching these constants and the measurement already existed.
 *
 * **12.0 is wrong, and the reasoning is D-197's own.** A trace reaching this function has
 * already passed the sanitizer's gate, so a 12.0 threshold here can only ever fire in the
 * band 12.0–12.5 — on exactly the fixes D-197 deliberately decided to KEEP, having found
 * that an 8 m/s gate caught zero GPS jumps and rejected five plausible human bursts. And
 * firing is not free: a split writes a break into the corridor, which is the "dotted
 * corridor" §9.5 warns about and which D-197 treats as a real harm rather than the safe
 * direction. Shipping 12.0 would mean the fog layer re-introducing, one module later, the
 * precise defect the sanitizer was re-measured to remove.
 *
 * **So the two gates are one gate, with one owner.** The table lives in `./geo.ts` (moved
 * there by this ticket) and both consumers read it; restating `12.5` here would be the
 * two-owners-of-one-value failure D-193 names, and the next measurement would move one and
 * not the other.
 *
 * **Why the `run` row specifically, with no `ActivityKind` parameter.** Exactly one skill
 * row in `rules/xp-rules-v1.yaml` carries `revealsGround: true` (D-189), and its `match`
 * names the three on-foot kinds — all of which hold the same 12.5. Wheeled activities
 * never reach this function, so the sanitizer's 30 m/s row is irrelevant here, and
 * threading a kind through `traceToCells` would buy a distinction that cannot arise.
 *
 * (The row is not named here. Naming a skill id outside the rules layer is the coupling
 * D-031 forbids, and `src/rules/no-skill-names.test.ts` fires on it — as it did on the
 * first draft of this comment.)
 *
 * If a future row ever sets `revealsGround: true` for a wheeled kind, THIS is the line
 * that has to grow a parameter. The comment is here so whoever does it knows the
 * constraint was considered rather than missed.
 */
export const TELEPORT_SPEED_MS = MAX_IMPLIED_SPEED_MS.run

/** A gap this wide (§2.2)... */
export const SPLIT_GAP_M = 250

/** ...lasting this long is a dropout, not a stride. */
export const SPLIT_GAP_S = 120

/**
 * Densify to at most this spacing before indexing.
 *
 * Comfortably under the **24.8 m inradius** of res 11, so no cell along the path can be
 * skipped when the stream drops points in a tunnel or under tree cover. `gridPathCells(a, b)`
 * is the cheaper alternative and it is wrong: it returns a *grid* line rather than a geodesic
 * one, fails across pentagons, and errors outright on long distances. Densify-then-index
 * is boring and correct; prefer it.
 *
 * **Was 30 m at res 10** (D-115), where the inradius was 65.7 m. D-237 moved the grid and this
 * had to move with it: 30 m is 1.2x res 11's inradius, which is exactly the skip this constant
 * exists to prevent. The ratio to the inradius is what is preserved (~0.46), not the number.
 */
export const DENSIFY_STEP_M = 12

/**
 * HOW WIDE STEP 4's CANDIDATE DISC HAS TO BE — derived from the grid, never guessed.
 *
 * **This is the constant D-216 used to make unnecessary, and D-237 brought back.** At res 10,
 * `REVEAL_R_M` (65 m) sat just under the inradius (65.7 m), so a cell whose centre was within
 * 65 m of the path necessarily CONTAINED a path point — it had been entered — and `gridDisk(c, 1)`
 * around each densified point was generous. The whole candidate question was a coincidence of
 * two numbers landing 0.7 m apart.
 *
 * At res 11 the inradius is 24.8 m and 65 m is **2.6 inradii**, so revealed no longer implies
 * entered and k=1 is too small. Measured on the operator's eleven archived runs during `0194`:
 * k=1 collects 751 candidates and reveals **694** cells; k=2 collects 1,160 and reveals **695**.
 * One cell in 695 — and under D-020 that miss is PERMANENT, curable only by running there again.
 *
 * The bound, rather than the measurement, is what ships. A revealed cell's centre is within
 * `REVEAL_R_M` of some point P on the path; P is within `DENSIFY_STEP_M / 2` of a densified
 * sample S; and S's own cell centre is within one circumradius of S. So the two centres are at
 * most `REVEAL_R_M + DENSIFY_STEP_M / 2 + circumradius` apart, and the closest packing of grid
 * distance k puts centres `k * 2 * inradius` apart. Hence the ceiling below.
 *
 *   res 10: (65 + 6 + 75.9) / 131.4 = 1.12  ->  k = 2   (k=1 also saturates, by D-216's accident)
 *   res 11: (65 + 6 + 28.7) /  49.6 = 2.01  ->  k = 3
 *
 * Deliberately computed and not hard-coded: `RES`, `REVEAL_R_M` and `DENSIFY_STEP_M` have each
 * moved once already, and the next person to move one must not have to rediscover this bound.
 */
export const CANDIDATE_K = Math.ceil(
  (REVEAL_R_M + DENSIFY_STEP_M / 2 + getHexagonEdgeLengthAvg(RES, UNITS.m)) /
    (2 * getHexagonEdgeLengthAvg(RES, UNITS.m) * Math.cos(Math.PI / 6)),
)

/**
 * How many Weiszfeld iterations the geometric median gets. Fixed, because purity means
 * deterministic: an iterate-until-converged loop makes the output depend on floating-point
 * luck, and a dwell is a handful of metres across where 32 iterations is far past the
 * point of measurable movement.
 */
const MEDIAN_ITERATIONS = 32

/**
 * TRACE → REVEALED CELLS. §2.2, all six steps.
 *
 * @returns res-11 cell ids only, every one of them within `REVEAL_R_M` of ground the
 *          runner actually covered.
 */
/**
 * WHY THE PROJECTION DROPPED WHAT IT DROPPED. Ticket `0180`; `05-fog-of-war.md` §3.6's last
 * bullet; `02-data-model.md` T3 `traceRejectCounts`.
 *
 * §3.6: *"A trace with points but ALL of them filtered out by §2.2 is treated as no-GPS, and
 * the ingest logs a warning with the reject counts so it is visible rather than silently
 * scoring nothing."* Without these numbers a watch emitting 2,000 fixes at 60 m accuracy
 * produces an activity indistinguishable from a treadmill run — zero cells, zero credit, no
 * error — and the cause gets diagnosed a month later, if at all.
 *
 * ─── WHAT IS COUNTED, AND WHAT DELIBERATELY IS NOT ──────────────────────────
 *
 * These are the FOG PROJECTION's own drops, step 1 of §2.2. They are per-sample, so they are
 * counts.
 *
 * `segments` is not a drop count and is included anyway: it is the honest output of step 3,
 * the teleport gate, which **splits rather than drops** (D-212). A trace that arrives as one
 * recording and leaves as eleven segments is a diagnostic even when nothing was rejected — and
 * a count of "samples rejected by the speed gate" does not exist here, because no sample is.
 *
 * `speedGate` IS NOT HERE, and `02` T3 named it before that distinction existed (D-222). The
 * per-sample speed-gate count that genuinely exists is the ADAPTER's — `sanitizeTracePoints`
 * drops fixes on `MAX_IMPLIED_SPEED_MS` and reports the number, which already reaches T3
 * inside `source.meta.rejectedPoints`. Copying it here would be the two-owners duplication
 * D-193 names, on a number the row already carries.
 */
export interface TraceRejects {
  /** Fixes whose declared `accuracyM` exceeded `MAX_ACC_M`. A cheap watch, a canyon, a roof. */
  accuracy: number
  /** Consecutive identical coordinates — a receiver repeating itself, contributing no geometry. */
  duplicate: number
  /** `NaN` or `Infinity` in a coordinate. Should be zero; a non-zero value is an adapter bug. */
  nonFinite: number
  /** How many pieces §2.2 steps 1-3 left the trace in. Not a drop count — see above. */
  segments: number
}

/**
 * The cell set, with the counts riding along.
 *
 * **A plain `Set` with one extra property, not a subclass.** `0180`'s criterion is that the
 * `Set` stays *"the primary, ergonomic result"* and that existing callers *"should not have to
 * destructure to get it"* — `for…of`, `.size`, `.has` and spread all behave exactly as before,
 * and `0045`/`0046`'s tests needed no change. A `Set` subclass would do the same but drags in
 * `Symbol.species` and a two-argument constructor for no benefit.
 */
export type CellSet = Set<H3Index> & { readonly rejects: TraceRejects }

/**
 * The counts for an activity that was projected and dropped nothing. **Written even when every
 * field is zero**, the same rule `cellCount: 0` follows (§3.6): a reader must never have to
 * distinguish "absent" from "none", and an absent map on a run with perfect GPS would be
 * indistinguishable from a row written before this column existed.
 */
export const NO_REJECTS: TraceRejects = Object.freeze({
  accuracy: 0,
  duplicate: 0,
  nonFinite: 0,
  segments: 0,
})

/**
 * The path the runner actually took, as §2.2 steps 1-3 leave it: split on gaps, cleaned,
 * dwells collapsed, split again on implausible jumps. Ticket `0195`.
 *
 * ─── EXTRACTED SO THE DRAWN ROUTE AND THE REVEALED GROUND ARE ONE COMPUTATION ─
 *
 * This was a local `const` inside `traceToCells` until `0195` needed to STORE it. It is the
 * geometry step 5 measures every candidate cell against, so storing it means the line drawn on
 * the map and the ground that line revealed can never disagree about where the runner was. A
 * second sanitation path written for the renderer would drift from this one, and the map never
 * re-fogs (D-020), so that drift would be permanent.
 *
 * ─── THE JOINING CHORDS ARE NOT FILTERED OUT; THEY NEVER EXIST ──────────────
 *
 * Worth stating because it is what both consumers rely on. `splitOnGaps` and `splitImplausible`
 * each END one segment and BEGIN another — D-212 splits rather than drops — so the chord between
 * two segments is a member of neither. That is how "the chord contributes no distance" is
 * implemented for step 5, and it is equally how a renderer gets "no line drawn across the gap"
 * for free: there is nothing there for it to decline to draw.
 *
 * The segments accumulate ACROSS runs, because step 5 filters once at the end against all of
 * them. A cell qualified as a candidate by one run may be within 65 m of a different run's path
 * — the runner was there, and the answer is a set, not a per-run tally.
 *
 * `rejects` rides along rather than costing a second traversal: `clean` counts per-sample drops
 * as it goes, and `segments` is the count of pieces steps 1-3 left behind.
 */
export function traceToSegments(trace: Trace): { segments: GeoPoint[][]; rejects: TraceRejects } {
  const rejects: TraceRejects = { accuracy: 0, duplicate: 0, nonFinite: 0, segments: 0 }
  const segments: GeoPoint[][] = []

  for (const run of splitOnGaps(trace)) {
    // 1. clean ─────────────────────────────────────────────────────────────
    const cleaned = clean(run, rejects)
    if (cleaned.length === 0) continue

    // 2. collapse pauses ───────────────────────────────────────────────────
    const collapsed = collapseDwells(cleaned)

    // 3. split on implausible jumps ────────────────────────────────────────
    for (const segment of splitImplausible(collapsed)) {
      segments.push(segment)
      rejects.segments++
    }
  }

  return { segments, rejects }
}

export function traceToCells(trace: Trace): CellSet {
  const candidates = new Set<H3Index>()
  const { segments, rejects } = traceToSegments(trace)

  for (const segment of segments) {
    // 4. densify + collect candidates ──────────────────────────────────
    for (const p of densify(segment)) {
      const cell = latLngToCell(p.lat, p.lng, RES)
      // A generous disc, so a path grazing a cell's edge still qualifies it for
      // CONSIDERATION — and at res 11 a cell 65 m off the path is 2.6 inradii out, so k=1
      // would MISS one. `CANDIDATE_K` derives the width from the grid; see it for the bound.
      // Far too much to reveal, which is why step 5 exists and why nothing may read this set.
      for (const candidate of gridDisk(cell, CANDIDATE_K)) candidates.add(candidate)
    }
  }

  // 5. exact radius filter — the definition of "revealed" ──────────────────
  //
  // Measured against the RAW segments, not the densified ones. §2.2 passes `segments`,
  // the output of step 3, and the distinction is load-bearing: densification puts a
  // vertex every 30 m, so a nearest-vertex measure would be within ~1.7 m of the truth
  // there and the bug would hide. Against the raw segments a 400 m sampling gap is a
  // single 400 m edge, and only a genuine point-to-SEGMENT measure keeps the corridor
  // between its endpoints.
  const revealed = new Set<H3Index>()
  for (const c of candidates) {
    const [lat, lng] = cellToLatLng(c)
    if (distancePointToSegments({ lat, lng }, segments) <= REVEAL_R_M) revealed.add(c)
  }
  return Object.assign(revealed, { rejects })
}

/**
 * METRES FROM A POINT TO THE NEAREST POINT ON THE PATH — to the **segments**, never to the
 * vertices. §2.2 step 5. Ticket `0046`.
 *
 * **§2.2 calls this `distancePointToPolyline` and that name cannot live here.**
 * `scripts/check-boundaries.mjs`'s STRICT tier bans the word `polyline` throughout
 * `src/domain` and `src/pipeline`, because D-121 is explicit that a `summary_polyline` is a
 * degraded trace and D-100 says the domain speaks in `GeoPoint`s. The gate caught the first
 * draft of this function, and it was right to: the argument is not a polyline, it is the
 * list of segments step 3 produced. §2.2's pseudocode was corrected to match rather than the
 * gate weakened — a naming preference is not a reason to soften the strongest check in the
 * project.
 *
 * `segments` is a list of polylines rather than one, because that is what step 3 produces
 * and because the emptiness between them is the point: a gap (D-198) or an implausible
 * jump is not an edge of this geometry, so the chord across it contributes no distance and
 * cannot reveal the buildings underneath it. Splitting is the conservative direction and
 * D-020 is why — under-revealing is recoverable by running it again, over-revealing is
 * permanent.
 *
 * A one-vertex segment measures as a point. That is the wild-outlier case: a lost fix that
 * reacquires 400 m away trips step 3 on both sides and becomes a segment of its own, so it
 * qualifies a small blob around itself and draws no spike out from the path.
 *
 * ─── WHY PLANAR ARITHMETIC IS NOT A SHORTCUT HERE ───────────────────────────
 *
 * The frame is anchored at the query point and longitude is scaled by `cos(lat)`, which
 * makes the neighbourhood Euclidean to well under a centimetre at the 65 m scale that
 * decides the answer. A spherical cross-track formula would add trigonometry per vertex to
 * change no verdict. Longitude differences are normalised into ±180° so a segment straddling
 * the antimeridian measures across it rather than the long way round.
 *
 * COST: O(candidates × vertices), with no spatial index. A 6 km run is ~150 candidates over
 * ~2,500 vertices — single-digit milliseconds. A marathon is roughly 40× that and still well
 * inside an ingest Lambda that runs once per activity. Do not add a quadtree until something
 * measures slow; the clarity is worth more than the constant factor.
 */
export function distancePointToSegments(
  point: { lat: number; lng: number },
  segments: readonly (readonly { lat: number; lng: number }[])[],
): number {
  const k = Math.cos((point.lat * Math.PI) / 180)

  // Local metres from the query point, which therefore sits at the origin.
  const x = (p: { lat: number; lng: number }) => {
    let dLng = p.lng - point.lng
    if (dLng > 180) dLng -= 360
    else if (dLng < -180) dLng += 360
    return dLng * k * METRES_PER_DEGREE
  }
  const y = (p: { lat: number; lng: number }) => (p.lat - point.lat) * METRES_PER_DEGREE

  let best = Infinity
  for (const segment of segments) {
    if (segment.length === 0) continue
    if (segment.length === 1) {
      best = Math.min(best, Math.hypot(x(segment[0]), y(segment[0])))
      continue
    }
    for (let i = 0; i < segment.length - 1; i++) {
      const ax = x(segment[i])
      const ay = y(segment[i])
      const bx = x(segment[i + 1])
      const by = y(segment[i + 1])

      const dx = bx - ax
      const dy = by - ay
      const lenSq = dx * dx + dy * dy

      // A zero-length edge is a repeated vertex; `clean` removes those, but this is a
      // public function and a caller may hand it anything.
      const t = lenSq === 0 ? 0 : clamp01(-(ax * dx + ay * dy) / lenSq)
      best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy))
    }
  }
  return best
}

/** Metres per degree of latitude on the same sphere `metresBetween` uses. */
const METRES_PER_DEGREE = (6_371_008.8 * Math.PI) / 180

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

/**
 * STEP 0, WHICH §2.2 DOES NOT HAVE — split on `Trace.gaps` before anything else.
 * Ticket `0045`, D-198.
 *
 * §2.2's pseudocode takes a bare list of points and was written before `gaps` existed. The
 * field arrived with D-198 and carries the one question this function has to ask: *may a
 * corridor be drawn across here?* Two different causes feed it — a time interval past
 * `GAP_THRESHOLD_MS` (30 s, D-195) and a sanitation break where an implausible fix was
 * dropped between two accepted ones — and D-198 is explicit that they share one field
 * precisely so that no consumer can honour one and forget the other. This is a consumer.
 *
 * **It is also strictly stronger than §2.2's own step 3, which is why it goes first.** A
 * 30-second interval breaks the trace regardless of distance; §2.2's rule needs 250 m AND
 * 120 s. Every split §2.2 would make across a dropout, `gaps` has already made. Step 3
 * survives as defence in depth for a `Trace` that did not come through the sanitizer —
 * this is a domain function and it does not get to assume its caller — and it is expected
 * never to fire on a normalised one.
 *
 * A pair is `[startIdx, endIdx]` into `trace.points`. The cut is expressed per adjacency
 * rather than per pair so that a pair spanning more than one step cuts every step it
 * covers and drops no point on the floor. In practice every pair is `[i, i+1]`.
 */
function splitOnGaps(trace: Trace): GeoPoint[][] {
  const points = trace.points
  if (points.length === 0) return []

  const cutAfter = new Set<number>()
  for (const [start, end] of trace.gaps) {
    for (let i = start; i < end; i++) cutAfter.add(i)
  }

  const runs: GeoPoint[][] = []
  let current: GeoPoint[] = []
  for (let i = 0; i < points.length; i++) {
    current.push(points[i])
    if (cutAfter.has(i)) {
      runs.push(current)
      current = []
    }
  }
  if (current.length) runs.push(current)
  return runs
}

/**
 * STEP 1. Drop what cannot be trusted and what says nothing.
 *
 * Reported accuracy is used where the adapter provides it (Health Connect's
 * `ExerciseRoute` does, D-113; the MVP source's stream does not). **Absent accuracy is
 * unknown, not zero** — `GeoPoint.accuracyM` is optional for that reason, and treating a
 * missing value as a failure would discard every point from the only source that ships.
 *
 * Consecutive identical coordinates are dropped because they contribute nothing to the
 * geometry and would otherwise weight a dwell's geometric median towards whichever fix the
 * receiver happened to repeat.
 */
function clean(points: readonly GeoPoint[], rejects: TraceRejects): GeoPoint[] {
  const out: GeoPoint[] = []
  for (const p of points) {
    if (p.accuracyM != null && p.accuracyM > MAX_ACC_M) {
      rejects.accuracy++
      continue
    }
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) {
      rejects.nonFinite++
      continue
    }
    const last = out[out.length - 1]
    if (last && last.lat === p.lat && last.lng === p.lng) {
      rejects.duplicate++
      continue
    }
    out.push(p)
  }
  return out
}

/**
 * STEP 2. COLLAPSE dwells — do not drop them.
 *
 * A stationary runner at a traffic light, a water fountain or a shoe retie keeps emitting
 * points that wander with GPS drift. Left alone, a three-minute pause smears a disc of
 * noise cells around a single spot — the "blob several cells wide" `0046`'s operator check
 * looks for. Dropping the dwell instead would be worse in the other direction: the runner
 * is still ON the route and that cell must still be revealed.
 *
 * So each dwell becomes exactly one point, at the geometric median of its fixes, timed at
 * the midpoint of the dwell. The midpoint is chosen over either end deliberately: it
 * leaves half the dwell's duration on each side, so neither the step into the dwell nor
 * the step out of it can look implausibly fast to step 3.
 */
function collapseDwells(points: readonly GeoPoint[]): GeoPoint[] {
  if (points.length < 2) return [...points]

  const out: GeoPoint[] = []
  let i = 0
  while (i < points.length) {
    // How far does a run of slow steps extend from here?
    let j = i
    while (
      j + 1 < points.length &&
      impliedSpeedMs(points[j], points[j + 1]) < DWELL_SPEED_MS
    ) {
      j++
    }

    const seconds = (points[j].t - points[i].t) / 1000
    if (j > i && seconds >= DWELL_MIN_S) {
      out.push(geometricMedian(points.slice(i, j + 1)))
      i = j + 1
    } else {
      out.push(points[i])
      i++
    }
  }
  return out
}

/**
 * The geometric median (the point minimising total distance to all of them), by Weiszfeld
 * iteration — NOT the centroid, which a single wild fix drags with it.
 *
 * Computed in a local planar frame: a dwell spans metres, so scaling longitude by
 * `cos(lat)` about the cluster's own mean makes the geometry Euclidean to well under a
 * millimetre, and the alternative — spherical iteration — would add trigonometry to buy
 * nothing at this scale.
 *
 * The timestamp is the dwell's midpoint; see `collapseDwells`.
 */
function geometricMedian(points: readonly GeoPoint[]): GeoPoint {
  const lat0 = points.reduce((s, p) => s + p.lat, 0) / points.length
  const k = Math.cos((lat0 * Math.PI) / 180)

  const xs = points.map((p) => p.lng * k)
  const ys = points.map((p) => p.lat)

  let x = xs.reduce((s, v) => s + v, 0) / xs.length
  let y = ys.reduce((s, v) => s + v, 0) / ys.length

  for (let iter = 0; iter < MEDIAN_ITERATIONS; iter++) {
    let wx = 0
    let wy = 0
    let w = 0
    let coincident = false
    for (let i = 0; i < xs.length; i++) {
      const d = Math.hypot(xs[i] - x, ys[i] - y)
      // Weiszfeld is undefined AT a sample. Landing exactly on one means the iterate has
      // already converged to it, so stop rather than divide by zero.
      if (d === 0) {
        coincident = true
        break
      }
      wx += xs[i] / d
      wy += ys[i] / d
      w += 1 / d
    }
    if (coincident || w === 0) break
    x = wx / w
    y = wy / w
  }

  const first = points[0]
  const last = points[points.length - 1]
  return {
    lat: y,
    lng: x / k,
    t: Math.round((first.t + last.t) / 2),
  }
}

/**
 * STEP 3. SPLIT, never interpolate, across an implausible jump.
 *
 * A lost fix that reacquires 400 m away must not draw a corridor through the buildings in
 * between, and neither must a drive between a trailhead and home recorded inside one
 * activity. Splitting is the conservative direction and the asymmetry is the whole reason:
 * under-revealing is recoverable — run it again — and over-revealing is not, because D-020
 * makes it permanent.
 *
 * Expected never to fire on a normalised `Trace`: the sanitizer has already applied the
 * same speed gate (see `TELEPORT_SPEED_MS`) and `gaps` has already cut anything past 30 s
 * (see `splitOnGaps`). It is kept because this is a domain function, and a domain function
 * that assumes its input was sanitised is one bad adapter away from a permanent scar.
 */
function splitImplausible(points: readonly GeoPoint[]): GeoPoint[][] {
  if (points.length === 0) return []

  const segments: GeoPoint[][] = []
  let current: GeoPoint[] = [points[0]]

  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    const metres = metresBetween(a, b)
    const seconds = (b.t - a.t) / 1000

    const teleport = impliedSpeedMs(a, b) > TELEPORT_SPEED_MS
    const dropout = metres > SPLIT_GAP_M && seconds > SPLIT_GAP_S

    if (teleport || dropout) {
      segments.push(current)
      current = [b]
    } else {
      current.push(b)
    }
  }
  segments.push(current)
  return segments
}

/**
 * STEP 4a. Interpolate along the great circle so no step exceeds `DENSIFY_STEP_M`.
 *
 * Spherical interpolation rather than linear-in-degrees. At the distances that survive
 * step 3 the two agree to about a centimetre, so this is not chasing accuracy — it is
 * refusing to carry a small-angle assumption in a function whose output is permanent, and
 * costs a handful of trigonometric calls per step.
 *
 * Endpoints are emitted once: each step contributes its start and its interior samples,
 * and the segment's final point is appended at the end.
 */
function densify(points: readonly GeoPoint[]): Array<{ lat: number; lng: number }> {
  if (points.length === 0) return []
  if (points.length === 1) return [{ lat: points[0].lat, lng: points[0].lng }]

  const out: Array<{ lat: number; lng: number }> = []
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]
    const b = points[i + 1]
    const steps = Math.max(1, Math.ceil(metresBetween(a, b) / DENSIFY_STEP_M))
    for (let k = 0; k < steps; k++) out.push(interpolate(a, b, k / steps))
  }
  const last = points[points.length - 1]
  out.push({ lat: last.lat, lng: last.lng })
  return out
}

/** Great-circle point a fraction `f` of the way from `a` to `b`. */
function interpolate(
  a: GeoPoint,
  b: GeoPoint,
  f: number,
): { lat: number; lng: number } {
  const toRad = Math.PI / 180
  const lat1 = a.lat * toRad
  const lng1 = a.lng * toRad
  const lat2 = b.lat * toRad
  const lng2 = b.lng * toRad

  const dLat = lat2 - lat1
  const dLng = lng2 - lng1
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  const d = 2 * Math.asin(Math.min(1, Math.sqrt(h)))

  // Coincident endpoints: the slerp weights below are 0/0 there.
  if (d === 0) return { lat: a.lat, lng: a.lng }

  const wa = Math.sin((1 - f) * d) / Math.sin(d)
  const wb = Math.sin(f * d) / Math.sin(d)

  const x = wa * Math.cos(lat1) * Math.cos(lng1) + wb * Math.cos(lat2) * Math.cos(lng2)
  const y = wa * Math.cos(lat1) * Math.sin(lng1) + wb * Math.cos(lat2) * Math.sin(lng2)
  const z = wa * Math.sin(lat1) + wb * Math.sin(lat2)

  return {
    lat: Math.atan2(z, Math.hypot(x, y)) / toRad,
    lng: Math.atan2(y, x) / toRad,
  }
}
