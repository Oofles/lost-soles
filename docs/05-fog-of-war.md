# 05 — Fog of War

**Status:** Design spec. No code exists yet (D-001).
**Authority:** `docs/decisions/DECISIONS.md`. Every `D-xxx` cited here is settled and
user-confirmed. Nothing in this document may contradict it.
**Research inputs:** `docs/research/R3-geospatial.md` (data model, volume math, storage),
`docs/research/R4-map-rendering.md` (rendering technique).
**Scope:** the fog-of-war mechanic end to end — what it means, how territory is represented,
how discovery is scored, how it is drawn, how the data reaches the browser, and what it derives.

> **Standing correction to the research.** R3 §3.6 and R4 §3.6/§4.2 both say "store at res 11".
> That predates **D-115**, which settles the canonical resolution at **H3 res 10**. Where those
> documents say res 11, read res 10. Do not "fix" this back — see §2.1 for the reasoning.

---

## Table of contents

1. [The mechanic, stated plainly](#1-the-mechanic-stated-plainly)
2. [Territory representation](#2-territory-representation)
3. [The discovery-scoring algorithm](#3-the-discovery-scoring-algorithm)
4. [Rendering](#4-rendering)
5. [The two map modes](#5-the-two-map-modes)
6. [Performance](#6-performance)
7. [Data delivery](#7-data-delivery)
8. [Derived statistics](#8-derived-statistics)
9. [Open questions and risks](#9-open-questions-and-risks)

---

## 1. The mechanic, stated plainly

The map opens as a sheet of dark, drifting mist over a warm parchment street map. Wherever you
have run, the mist is gone and the streets show through. Every run you upload clears a little
more. **It never comes back** (D-020, D-120).

That is the whole user-facing promise, and it is deliberately small. The novelty motivator
(D-012) and the low-upkeep constraint (D-013) both argue against anything the user has to
maintain. There is no fog decay, no territory to defend, no daily anything.

### 1.1 Two different things happen to the same cell

This is the single most important distinction in this document, and conflating them **will**
cause bugs. A cell has two independent properties:

| | **Revealed** | **Discovered** |
|---|---|---|
| What it is | A *visual* state of the map | A *scoring event* on a run |
| Lives where | The explored-cell set shipped to the browser | The run ledger + `lastRunAt` on the cell |
| Lifetime | **Permanent. Forever. Never re-fogs.** (D-020, D-120) | Instantaneous — it happens once, on one run |
| Re-arms? | No. There is no mechanism that can un-reveal a cell. | Yes. After 6 months, at 50% credit (D-120) |
| Drives | The fog shader | Cartography XP (D-032), the "new territory" number on a run |
| Storage | Presence in the set | `lastRunAt` timestamp — **not** a presence bit (D-120) |

Restated as rules:

- **Revealed is monotonic.** The explored set is append-only. Nothing removes a cell from it.
  Ever. This is an architectural invariant, not a preference — the data model is append-only
  (D-020) and the client caches the set aggressively (§7) on the assumption that it only grows.
- **Discovered is an event with a cooldown.** Running ground you last touched within 6 months
  scores **zero** discovery credit. Running ground you last touched more than 6 months ago
  re-arms it for **50%** credit. Genuinely never-seen ground scores **100%** (D-120).
- **The user cannot see the cooldown on the map**, because seeing it would mean re-fogging, which
  D-120 forbids. If we want to surface it, it goes in a *separate, opt-in* overlay — see §8.5
  and the open question in §9.7.

### 1.2 Worked example

You run the same loop three times.

| Run | Date | What the map does | Discovery credit | Wayfaring XP |
|---|---|---|---|---|
| 1 | Jan 2 | Loop clears out of the mist | 100% × ~110 cells | full |
| 2 | Feb 14 | Nothing visible changes (already clear) | **0** — inside the 6-month window | half (D-021, D-120) |
| 3 | Sep 30 | Nothing visible changes (still clear) | **50%** — `lastRunAt` was Feb 14, >6 months ago | half |

Run 3 is the case the whole `lastRunAt` design exists to serve: the map looks identical, but the
scoring differs. A presence bit could not tell run 2 from run 3.

### 1.3 What the fog is *not*

- Not a competitive surface. Nobody else's territory appears on it (D-011, D-014).
- Not a chore. There is nothing to claim, refresh, defend, or check into (D-013).
- Not a replacement for the street map. **The streets stay readable in both modes** (D-051).

---

## 2. Territory representation

### 2.1 H3 resolution 10, canonical, never mixed

**D-115 settles this: resolution 10.** The numbers that make it right:

| Property (H3 res 10) | Value |
|---|---|
| Edge length = circumradius | **75.9 m** |
| Inradius (centre → edge midpoint) | **65.7 m** (= 75.9 × √3⁄2) |
| Centre-to-centre spacing of neighbours | **131.4 m** |
| Average area | **15,048 m²** (~1.5 ha) |

Three independent reasons res 10 is the answer:

1. **The inradius already *is* the reveal radius.** We want to reveal roughly 65 m either side of
   the path (§2.3). At res 10 that is exactly `k = 0` — the cell you are standing in. The
   geometry and the game rule land on the same number, so the algorithm is trivial and there is
   no fudge factor to tune.
2. **Res 11 buys nothing visually.** R4's core rendering call (§4) is that explored cells are
   splatted as **soft radial discs**, not hexagons. Hex geometry never reaches the screen. A
   finer hex grid would only make the disc field slightly denser — an effect that is invisible
   under a noise-perturbed mist edge. R4 §3.5.
3. **Res 11 costs 4.4×.** R3 §2: five years, worst case, res 10 = 147,782 cells = 1.18 MB raw;
   res 11 = 657,289 cells = 5.26 MB. Realistic (a home-based runner, heavy overlap) is
   20k–50k res-10 cells. The whole point of the architecture (§7) is that the explored set fits
   in a browser tab; res 10 keeps the wire payload at ~300–450 KB gzipped, res 11 pushes it to
   ~1.5–2 MB. That is the difference between "ship it all, once" and "think about paging".

**Never store a mixed-resolution set.** A res-9 cell and its res-10 children are different IDs;
`gridDisk`, `gridDistance` and `gridPathCells` all refuse to cross resolutions. Res 10 is the
only resolution written to the store. Coarser resolutions exist *only* as derived render/zoom
aggregates (§6.1) and *only* as a transport optimisation via `compactCells` (§7.2) — and a
compacted array must be passed through `uncompactCells(arr, 10)` before any membership test.

**The escape hatch is real.** Raw traces are archived immutably in S3 (D-101, D-121 mitigation 2).
If res 10 ever proves too coarse, the entire cell set can be re-derived at res 11 from the
archive. Nothing about this decision is one-way.

### 2.2 Trace → cells

Input is the normalised `Trace` from the ingestion adapter boundary (D-100): an ordered list of
`{lat, lng, t, accuracyM?}`. For the MVP Strava adapter this comes from the **full `latlng`
stream, never `summary_polyline`** (D-121 mitigation 4 — Douglas–Peucker cuts corners and
collapses loops to chords, which would silently erase territory), fetched with
`activity:read_all` so privacy-zone truncation never blanks the map around home
(D-121 mitigation 3, D-123).

The conversion runs **server-side, in the ingest Lambda, always** (R3 §6). The client never
computes cells for scoring purposes. With 1–5 trusted users this is theoretical, but the cost of
getting the trust boundary right is zero.

```
CONSTANTS
  RES            = 10
  REVEAL_R_M     = 65          # metres either side of the path; see §2.3
  MAX_ACC_M      = 50          # drop samples with worse reported accuracy
  DWELL_SPEED    = 0.5         # m/s
  DWELL_MIN_S    = 60          # seconds
  TELEPORT_SPEED = 12.0        # m/s (43 km/h) — not a run
  SPLIT_GAP_M    = 250         # gap beyond which we refuse to interpolate
  SPLIT_GAP_S    = 120
  DENSIFY_STEP_M = 30          # < inradius, so no cell can be skipped

function traceToCells(points):
  # ---- 1. clean --------------------------------------------------------
  pts = points
        .filter(p => p.accuracyM == null or p.accuracyM <= MAX_ACC_M)
        .filter(p => isFinite(p.lat) and isFinite(p.lng))
        .dedupeConsecutiveIdentical()

  # ---- 2. collapse pauses ---------------------------------------------
  # A stationary runner (traffic light, water fountain, shoe retie) keeps
  # emitting points that wander with GPS drift. Left alone, a 3-minute pause
  # smears a disc of noise cells around a single spot. Collapse each dwell
  # to its geometric median.
  pts = collapseDwells(pts, DWELL_SPEED, DWELL_MIN_S)

  # ---- 3. split on implausible jumps ----------------------------------
  # A lost fix that reacquires 400 m away must NOT be interpolated: that
  # would reveal a corridor through buildings the user never ran. Likewise
  # a drive between a trailhead and home inside one recorded "activity".
  segments = splitWhere(pts, (a, b) =>
      speed(a, b) > TELEPORT_SPEED or
      (haversine(a, b) > SPLIT_GAP_M and (b.t - a.t) > SPLIT_GAP_S))

  # ---- 4. densify + collect candidates --------------------------------
  cells = new Set()
  for seg in segments:
    dense = densifyGeodesic(seg, DENSIFY_STEP_M)   # handles sampling gaps
    for p in dense:
      c = latLngToCell(p.lat, p.lng, RES)
      # k=1 candidates so a path grazing a cell's edge still qualifies it
      for cand in gridDisk(c, 1):
        cells.add(cand)

  # ---- 5. exact radius filter -----------------------------------------
  # Candidate set is generous; this is the definition of "revealed".
  return filter(cells, c =>
      distancePointToPolyline(cellToLatLng(c), segments) <= REVEAL_R_M)
```

Notes on the steps that matter:

- **Sampling gaps (step 4).** Strava's `latlng` stream is nominally ~1 Hz but drops points in
  tunnels, under tree cover and when the watch throttles. `densifyGeodesic` at 30 m — comfortably
  under the 65.7 m inradius — guarantees no cell along the path is skipped. The alternative,
  `h3.gridPathCells(a, b)`, is cheaper but returns a *grid* line, not a *geodesic* line, fails
  across pentagons, and errors on long distances. Densify-then-index is boring and correct;
  prefer it.
- **Noise (steps 1, 2, 5).** Step 1 uses reported accuracy where the adapter provides it (Health
  Connect `ExerciseRoute` does, D-113; Strava's stream does not). Step 5 is the real noise
  defence: an outlier sample only qualifies cells within 65 m of *the polyline*, and a single
  wild point is bounded to its own neighbourhood rather than drawing a spike.
- **Pauses (step 2).** Collapsing rather than dropping matters: the dwell point is still on the
  route and must still reveal its own cell.
- **Splits (step 3).** Splitting rather than joining is the conservative choice. Under-revealing
  is recoverable (run it again). Over-revealing is not — D-020 makes it permanent.
- **The output is a `Set`.** Every downstream property in §3 — out-and-backs, loops, figure-eights,
  crossing your own path — falls out of this one fact. A cell appears in the set once or not at
  all.

### 2.3 The reveal radius

**REVEAL_R_M = 65 metres either side of the path** — a ~130 m corridor.

Justification:

- **It matches the geometry.** Res 10's inradius is 65.7 m. A 65 m radius means the algorithm is,
  to within rounding, "the cell you ran through" — `gridDisk(c, 0)` — with the §2.2 step-5 filter
  correcting the cases where the path clips a cell's corner without passing near its centre. One
  cell wide, one honest street-shaped corridor.
- **`k = 1` is far too much.** `gridDisk(c, 1)` is 7 cells, ~394 m across. R3 §1.1 puts its
  effective radius near 200 m. On a typical US grid with 80–120 m block spacing, running one
  street would reveal the two parallel streets on either side. That directly attacks D-012: the
  point is running *new places*, and the map must not gift you ground you never saw.
- **It is roughly what you can actually see.** 65 m is the far side of a street plus a front yard.
  Claiming it as "explored" is defensible. Claiming 200 m is not.
- **It is generous enough to absorb GPS error.** Consumer GPS on a phone or watch is good to
  5–15 m in the open and 20–40 m in an urban canyon. A 65 m corridor swallows that without
  needing per-sample error modelling.

**Do not confuse the reveal radius with the render radius.** They are different numbers for
different jobs:

| | Value | Purpose |
|---|---|---|
| `REVEAL_R_M` | **65 m** | Scoring + set membership. Server-side. Authoritative. |
| `revealScale × circumradius` | **1.35 × 75.9 ≈ 102 m** | The soft disc splatted in the mask shader (§4). Overspills the hexagon *on purpose* so neighbouring discs merge with no scalloping (R4 §4.4). Visual only. |

The render radius is a shader tuning constant. Changing it changes how the fog looks. It must
never feed back into what counts as explored.

### 2.4 The per-cell record

D-120 is explicit: **each explored cell needs a `lastRunAt` timestamp, not just a presence bit**,
because discovery scoring is a function of `now - lastRunAt`. It also needs `firstRunAt`, which
D-120 does not call out but which lifetime statistics require and which cannot be reconstructed
from `lastRunAt` once the cell has been re-run.

Extending R3 §7's schema (DynamoDB, single table, partitioned by res-6 parent per D-082):

```
# ---- Explored cells ----
PK: USER#<uid>#CELLS#<res6ParentId>     SK: <res10CellId>
attrs:
  firstRunAt    : ISO8601   # IMMUTABLE once written. Lifetime stats, "explorer since".
                            #   On backfill of an older activity: min(existing, incoming).
  firstRunId    : string    # the run that discovered it — auditable
  lastRunAt     : ISO8601   # THE cooldown input (D-120). max(existing, incoming).
  lastRunId     : string
  visitCount    : number    # how many distinct activities touched it. Flavour + stats.
  discoveryCount: number    # how many times it awarded credit (1 + one per re-arm)
```

Why each field earns its place:

- `firstRunAt` — immutable. Lifetime totals, "you first set foot here on…", and the only way to
  order territory by age of discovery. Must use `min()` on write, because activities can arrive
  out of order (§3.4).
- `lastRunAt` — mutable, `max()` on write. This is the cooldown clock. **A presence bit here is
  the bug D-120 was written to prevent.**
- `visitCount` — cheap, and it is what a future "most-run ground" heat view needs.
- `discoveryCount` — separates "I've run this 40 times" from "this has re-armed twice", which are
  different stories and both interesting.

`res6ParentId` in the partition key is not decoration: a res-6 partition is ~36 km² and holds at
most ~2,401 res-10 children, which bounds partition size, makes a viewport read 1–20 `Query`
calls, and — see §6.2 — gives the client a ready-made spatial bucketing for viewport culling.

---

## 3. The discovery-scoring algorithm

Per **D-120**, verbatim:

- Never-seen ground → **full** discovery credit.
- Ground run within the last 6 months → **zero** discovery credit.
- Ground last run more than 6 months ago → **50%** discovery credit, and it re-arms.
- Re-running previously explored ground → **half XP** to the activity skill (Wayfaring)
  (D-021, D-120).

### 3.1 Definitions

```
SIX_MONTHS_MS = 183 * 24 * 60 * 60 * 1000     # see §9.2 — 183 days, UTC, not calendar months
CREDIT_NEW    = 1.0
CREDIT_REARM  = 0.5
CREDIT_COOLED = 0.0
```

**Scoring time is the activity's `startedAt`, never the ingest time.** A run uploaded three days
late must score as it would have on the day it happened. Using wall-clock ingest time makes
scoring non-deterministic and un-replayable.

### 3.2 The algorithm

```
function scoreActivity(activity, trace, store):

  # ---------- 0. IDEMPOTENCY GATE (see §3.5) ----------
  key = idempotencyKey(activity, trace)
  existing = store.getLedgerEntry(key)
  if existing != null:
      return existing.award            # exact replay of the previous result. No writes.

  at = activity.startedAt              # NOT now()

  # ---------- 1. CELLS ----------
  cells = traceToCells(trace)          # §2.2 — a Set, so each cell appears at most once
  if cells.size == 0:
      return scoreNoGpsActivity(activity)   # §3.6

  # ---------- 2. CLASSIFY ----------
  credits = 0.0
  newCells = [];  rearmedCells = [];  cooledCells = []

  for cell in cells:                   # iteration order is irrelevant; classes are disjoint
      rec = store.getCell(cell)

      if rec == null:
          credits += CREDIT_NEW
          newCells.push(cell)

      else if (at - rec.lastRunAt) < SIX_MONTHS_MS:
          credits += CREDIT_COOLED     # i.e. += 0. Written out for symmetry.
          cooledCells.push(cell)

      else:
          credits += CREDIT_REARM
          rearmedCells.push(cell)

  # ---------- 3. XP ----------
  # Cartography (D-032): purely a function of discovery credit.
  cartographyXp = round(credits * XP_PER_CELL)

  # Wayfaring (D-031): distance/duration-based, halved on known ground (D-021).
  # Blend by the share of the run that was new, so a run that is half new
  # ground earns 75% — full rate on the new half, half rate on the known half.
  newShare      = newCells.length / cells.size
  wayfaringXp   = round(baseWayfaringXp(activity) * (newShare + 0.5 * (1 - newShare)))

  # ---------- 4. WRITE (one transaction, see §3.3) ----------
  # `rec` below is the record read in phase 2 and carried alongside each cell;
  # it is deliberately NOT re-read here, so writes cannot see this run's own effects.
  store.transact(() => {
      for cell in newCells:
          store.putCell(cell, { firstRunAt: at, firstRunId: activity.id,
                                lastRunAt: at,  lastRunId: activity.id,
                                visitCount: 1,  discoveryCount: 1 })

      for cell in rearmedCells:
          store.updateCell(cell, {
              firstRunAt    : min(rec.firstRunAt, at),      # immutable-ish: min on backfill
              lastRunAt     : max(rec.lastRunAt, at),
              lastRunId     : at >= rec.lastRunAt ? activity.id : rec.lastRunId,
              visitCount    : rec.visitCount + 1,
              discoveryCount: rec.discoveryCount + 1 })

      for cell in cooledCells:
          store.updateCell(cell, {
              firstRunAt : min(rec.firstRunAt, at),
              lastRunAt  : max(rec.lastRunAt, at),
              lastRunId  : at >= rec.lastRunAt ? activity.id : rec.lastRunId,
              visitCount : rec.visitCount + 1 })       # discoveryCount unchanged

      award = { key, activityId: activity.id, at,
                cellCount: cells.size,
                newCellCount: newCells.length,
                rearmedCellCount: rearmedCells.length,
                cooledCellCount: cooledCells.length,
                discoveryCredits: credits,
                cartographyXp, wayfaringXp,
                res: 10, algoVersion: FOG_ALGO_VERSION }

      store.putLedgerEntry(key, award)                 # conditional on attribute_not_exists
      store.appendCellsToRun(activity.id, cells)       # for audit / un-award
      store.bumpAggregates(newCells)                   # §6.1 parent-res counters
      store.bumpGeneration()                           # §7.3 — triggers the client delta
  })

  return award
```

**The award is stored, not recomputed.** Everything the UI shows about a run — "41 new cells",
"+410 Cartography" — reads the ledger entry. Recomputing it later would give a different answer
(the cells are now in the store) and would make XP silently drift. R3 §4(e) makes the same point.

### 3.3 Same-run edge cases

All of these are solved by one design decision — `traceToCells` returns a **`Set`** — but each
deserves an explicit statement so nobody "optimises" it away:

- **A cell crossed twice in one activity scores once.** The set contains it once. The classify
  loop visits it once. `visitCount` increments by 1, not 2, because visits are counted *per
  activity*, not per traversal.
- **Out-and-backs.** The return leg re-covers the outbound cells. They are already in the set;
  the set absorbs them. An out-and-back scores exactly the same discovery credit as the one-way
  version of itself. This is correct: you discovered that ground once.
- **Loops and figure-eights.** Identical reasoning. The crossing cell in a figure-eight is one
  cell.
- **Two activities on the same day.** These are *different* activities, so they score
  independently and sequentially. The second run over the same ground finds `lastRunAt` set to
  a few hours ago and scores **zero** (cooled). Correct per D-120 — the cooldown does not care
  that it is the same day.
- **An activity that overlaps itself in time** (a paused-and-resumed recording that the adapter
  emits as one trace) is one activity. Segment splitting (§2.2 step 3) keeps its geometry honest
  but does not split the scoring.
- **Ordering within the loop.** The three classes are disjoint and each cell is classified
  against the store state *as it was before this activity*. Do not update `lastRunAt` inside the
  classify loop — if you do, a cell would be re-read as "cooled" by a later iteration. Classify
  fully, then write. The pseudocode above enforces this by separating phase 2 from phase 4.

### 3.4 Out-of-order and backfilled activities

Activities do not arrive in chronological order. Strava webhooks redeliver, a historical backfill
imports years at once, and a future adapter (D-112, D-113) may import an old GPX.

The naive `at - rec.lastRunAt` goes negative and the comparison silently yields "cooled".

**Rule: the canonical score of a user's history is a deterministic fold over their activities
sorted ascending by `startedAt`.** Concretely:

- Normal case — the incoming activity's `startedAt` is later than every scored activity: score
  incrementally as in §3.2. This is the overwhelmingly common path.
- Out-of-order case — the incoming `startedAt` precedes an already-scored activity: enqueue a
  **replay** from that timestamp forward. Re-derive cell state by folding the (already-stored,
  already-cell-ised) activities in date order, rewrite the affected cell records and ledger
  entries, and recompute the affected XP awards.
- Replay is cheap and bounded: five years is ~1,000 activities × ~110 cells ≈ 110k operations,
  in memory, in one Lambda invocation. Never do it on the request path; queue it.
- **Replay must be idempotent and must never un-reveal a cell.** It rewrites `lastRunAt`,
  `firstRunAt`, `discoveryCount` and XP awards. It never deletes a cell — D-020 forbids that
  outright, and in any case a replay of a superset of activities can only ever produce a superset
  of cells.
- Guard: `at - rec.lastRunAt < 0` should assert/log rather than pass silently. If a negative
  delta reaches the classifier, the replay queue has a bug.

Risk: replay can *lower* a previously displayed XP total. See §9.3.

### 3.5 Idempotency

Re-importing the same activity must not re-award anything. Two layers:

```
function idempotencyKey(activity, trace):
    # Layer 1: source identity. Catches Strava webhook redelivery (R3 §4d).
    src  = activity.source + '#' + activity.sourceActivityId      # e.g. "strava#123456"
    # Layer 2: content hash. Catches the case where the SAME source id now has
    # DIFFERENT geometry — the user cropped the activity, or corrected its start time.
    body = sha256(canonicalJson({ points: trace.points, startedAt: activity.startedAt }))
    return src + '#' + body.slice(0, 16) + '#v' + FOG_ALGO_VERSION
```

- The ledger `putLedgerEntry` is a **conditional put on `attribute_not_exists`**. A concurrent
  duplicate webhook loses the race and returns the winner's award. Cell writes are idempotent by
  construction (`min`/`max`/set-insert), so a partial retry converges.
- **Same source id, same content** → key hits, nothing is written, the stored award is returned.
  The map does not change, XP does not change.
- **Same source id, different content** (edited activity) → key misses. This is a *revision*, not
  a new activity: look up the prior ledger entry by `src`, **un-award** it (subtract its XP,
  decrement `visitCount`/`discoveryCount` on its cells, restore `lastRunAt`/`lastRunId` by
  replay), then score the new version. Do **not** remove cells — D-020. Ground that was revealed
  stays revealed even if the activity that revealed it was edited to exclude it.
- **`FOG_ALGO_VERSION` is in the key** so that a deliberate algorithm change invalidates every
  key and forces a full, auditable rescore rather than a silent mix of old and new scoring.
- `store.appendCellsToRun(activity.id, cells)` exists precisely so un-award is possible without
  re-deriving geometry.

### 3.6 Treadmill and no-GPS activities

An indoor run, a treadmill session, or any of the strength workouts logged in-app (D-060, D-061)
produce **zero cells**. The fog subsystem's contract for these is narrow and explicit:

- `cells.size == 0` → **zero discovery credit, zero Cartography XP, no cell writes, no
  generation bump.** No fog data changes. This is unambiguous: Cartography (D-032) is the
  new-territory skill, and there is no territory.
- A ledger entry is **still written** (with `cellCount: 0`), so the idempotency gate covers
  no-GPS activities too and re-import stays a no-op.
- Activity-skill XP (Wayfaring, Might, Fortitude, Endurance — D-031) is **not the fog
  subsystem's business.** It is computed by the progression module from distance/duration/reps.
  Fog contributes exactly one input to it: `newShare`, which is `0` when there are no cells.
- **Recommended default for the `newShare = 0` case: treat a treadmill run as known ground —
  half Wayfaring XP.** It is consistent with D-021 (you did not run new ground) and with D-012
  (novelty is the motivator). It is *not* a punishment mechanic under D-013 because nothing is
  lost, deducted, or expires — you simply earn at the rate everyone earns for repeating ground.
  **This is a recommendation, not a settled decision — see §9.1.**
- A trace with points but *all* of them filtered out by §2.2 (an entirely garbage GPS record) is
  treated as no-GPS, and the ingest logs a warning with the reject counts so it is visible rather
  than silently scoring nothing.

---

## 4. Rendering

Follows R4's RECOMMENDATION (R4 §1, §3.5, §4) without deviation.

| Decision | Choice |
|---|---|
| Map library | **MapLibre GL JS 6.x** (`maplibre-gl@6.6.0`, BSD-3, ESM-only). Plain — no deck.gl. |
| Fog technique | **Custom WebGL2 layer**, two passes: coverage-mask FBO → noisy composite |
| Mask primitive | **Instanced soft radial discs**, unioned with `gl.blendEquation(gl.MAX)` |
| Mask target | Half-resolution, single-channel `R8` framebuffer |
| Composite | One full-screen triangle, `smoothstep` threshold perturbed by animated 3-octave fBm, plus a warm rim glow at the boundary |
| Basemap | Protomaps PMTiles on S3 + CloudFront; `@protomaps/basemaps` `light` flavour forked to parchment (R4 §5.1, §6.2) |
| DPR | Capped at 2 (`pixelRatio: Math.min(devicePixelRatio, 2)`) |

### 4.1 Why discs, not hexagons

This is the most important visual decision in the whole product, and it is the reason D-115 could
settle on res 10 at all.

**If you rasterise hexagon geometry into the mask, you get hexagons.** A hexagon has six flat
edges meeting at 120° corners. Those facets survive every amount of blur you can afford: blur
softens the transition but preserves the silhouette's angular frequency content, so the boundary
still reads as a honeycomb. It looks like a strategy-game grid, not like weather. And it looks
*worse* the more the user zooms in, which is exactly where they spend their time.

**If instead you splat a Gaussian-falloff disc at each cell centre** at ~1.35× the cell
circumradius and union the discs with `MAX` blending, three good things happen at once:

1. **Adjacent discs merge.** At 1.35 × 75.9 ≈ 102 m radius against 131.4 m centre spacing, every
   neighbour's disc overlaps yours well past its half-power point. A contiguous run of cells
   becomes one continuous region with no seams and no scalloping. Below ~1.15 you start to see
   scalloping between neighbours; above ~1.6 the territory looks inflated and imprecise
   (R4 §4.4).
2. **The soft edge is structural, not bolted on.** The mist boundary is the disc's own falloff.
   There is no blur pass to pay for, no separate texture, no downsample-upsample chain.
3. **The boundary has no preferred direction.** A disc field's outline is isotropic, so
   perturbing it with noise (§4.3) produces an organic, wispy edge. Perturbing a hex outline with
   noise produces a *wobbly hex outline* — the 120° corners still poke through.

`MAX` blending, not additive, is what makes it a union rather than a sum: two overlapping discs
give coverage `max(a, b)`, so twice-covered ground is not twice as revealed. (WebGL2 only —
`gl.blendEquation(gl.MAX)` is unavailable in WebGL1, which is one more reason MapLibre 6's
WebGL2-only pipeline suits us.)

**The hexagons remain in the data and never appear on screen.** If we ever want the game-y grid
read, it is a *separate* faint decorative `line` layer of hex boundaries, clipped to revealed
ground, at high zoom only — kept strictly out of the mask (R4 §4.4).

### 4.2 Pass 1 — `prerender`: the coverage mask

MapLibre calls `prerender` during its offscreen pass. We bind our own half-resolution `R8`
framebuffer, clear it to 0, and draw the visible explored cells as one instanced draw call.

```glsl
// ---------- MASK PASS: vertex ----------
// `${shaderData.vertexShaderPrelude}` provides projectTile(vec2) — web-mercator
// 0..1 straight to clip space. `${shaderData.define}` provides #define GLOBE.
// Using MapLibre's prelude gives us globe projection and terrain for free.
#version 300 es
${shaderData.vertexShaderPrelude}
${shaderData.define}

in vec2  a_quad;      // unit quad corner, -1..1        (per-vertex, 4 verts)
in vec2  a_center;    // cell centre, web-mercator 0..1  (per-instance)
in float a_radius;    // reveal radius, mercator units   (per-instance)

out vec2 v_uv;

void main() {
    v_uv = a_quad;
    // Offset in mercator space, then let MapLibre project. A mercator-space
    // disc is still a disc on screen, so no latitude correction is needed
    // for the *shape*; a_radius carries the ground-size variation.
    gl_Position = projectTile(a_center + a_quad * a_radius);
}
```

```glsl
// ---------- MASK PASS: fragment ----------
#version 300 es
precision mediump float;

in  vec2 v_uv;
out vec4 fragColor;

void main() {
    // Soft radial falloff. THIS is where the mist edge comes from —
    // it costs nothing and it is why we do not need a blur pass.
    float d = length(v_uv);
    float c = 1.0 - smoothstep(0.45, 1.0, d);
    fragColor = vec4(c, 0.0, 0.0, 1.0);
}
```

GL state for the pass:

```js
gl.bindFramebuffer(gl.FRAMEBUFFER, this.maskFBO);
gl.viewport(0, 0, this.maskW, this.maskH);
gl.clearColor(0, 0, 0, 1);
gl.clear(gl.COLOR_BUFFER_BIT);
gl.disable(gl.DEPTH_TEST);
gl.enable(gl.BLEND);
gl.blendEquation(gl.MAX);        // union, not sum — WebGL2 only
gl.blendFunc(gl.ONE, gl.ONE);

gl.useProgram(this.maskProgram);
setProjectionUniforms(gl, this.maskProgram, opts.defaultProjectionData);
gl.bindVertexArray(this.maskVAO);
gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.visibleCount);
gl.bindVertexArray(null);

gl.blendEquation(gl.FUNC_ADD);   // restore
gl.bindFramebuffer(gl.FRAMEBUFFER, null);
```

The FBO is allocated at **0.5× the drawing buffer**, `R8`, `LINEAR` filtering, `CLAMP_TO_EDGE`.
Half resolution is both cheaper and *better*: the bilinear upsample in the composite pass
contributes a free extra feather (R4 §7.2).

MapLibre explicitly supports binding your own framebuffer here — it calls
`setCustomLayerDefaults()` before and `setDirty()` + `setBaseState()` +
`bindFramebuffer.set(null)` after both custom-layer calls (verified in
`src/webgl/draw/draw_custom.ts`, R4 §3.5). Restore `blendEquation` anyway; leaving `MAX` set is
the kind of bug that shows up three layers later as "why is the basemap wrong".

### 4.3 Pass 2 — `render`: the noisy composite

One full-screen triangle into MapLibre's framebuffer, in the translucent pass.

```glsl
// ---------- COMPOSITE PASS: fragment ----------
#version 300 es
precision highp float;

uniform sampler2D u_mask;
uniform vec2  u_screen;      // drawing-buffer size, px
uniform float u_time;        // seconds
uniform vec3  u_fogDeep;     // e.g. vec3(0.035, 0.045, 0.075)  near-black blue
uniform vec3  u_fogEdge;     // e.g. vec3(0.22,  0.24,  0.30)   lit mist
uniform vec3  u_rimGlow;     // e.g. vec3(0.85,  0.70,  0.42)   warm parchment
uniform float u_maxOpacity;  // 0.94 — never fully 1.0; a hint of the world
                             // showing through reads as mist, not as a hole.
uniform float u_noiseAmp;    // 0.30 adventure / 0.10 atlas   (§5)
uniform float u_rimAmt;      // 0.30 adventure / 0.08 atlas   (§5)

// --- cheap value-noise fBm ---
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

float vnoise(vec2 p){
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i + vec2(0,0)), hash(i + vec2(1,0)), u.x),
               mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), u.x), u.y);
}

float fbm(vec2 p){
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 3; i++) { v += a * vnoise(p); p *= 2.03; a *= 0.5; }
    return v;
}

out vec4 fragColor;

void main() {
    vec2 uv = gl_FragCoord.xy / u_screen;

    float coverage = texture(u_mask, uv).r;

    // Two noise fields drifting at different speeds/scales. The slow one
    // shapes the boundary; the fast one animates wisps.
    vec2  q  = uv * u_screen / 260.0;
    float n1 = fbm(q * 1.0 + vec2( 0.013, 0.008) * u_time);
    float n2 = fbm(q * 2.7 + vec2(-0.021, 0.017) * u_time);
    float n  = mix(n1, n2, 0.35);

    // Perturb the reveal threshold with noise => a ragged, organic mist edge
    // instead of a smooth blurred blob.
    float reveal = smoothstep(0.30, 0.72, coverage + (n - 0.5) * u_noiseAmp);

    float alpha = (1.0 - reveal) * u_maxOpacity;

    // Density variation *inside* the fog so it isn't a flat wash.
    vec3 col = mix(u_fogDeep, u_fogEdge, smoothstep(0.25, 0.85, n));

    // Rim: peaks at the boundary (reveal ~ 0.5) and vanishes on both sides.
    // This is the "torchlight at the edge of the known world" beat, and it is
    // the single detail that sells the effect. Keep it subtle.
    float rim = reveal * (1.0 - reveal) * 4.0;
    col += u_rimGlow * rim * u_rimAmt;
    alpha = max(alpha, rim * 0.10);   // faint glow bleeding into cleared ground

    fragColor = vec4(col * alpha, alpha);   // premultiplied — MapLibre's default
}
```

Composite GL state: `gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);` then
`gl.drawArrays(gl.TRIANGLES, 0, 3)`.

Two constants worth defending:

- **`u_maxOpacity` must never reach 1.0.** Letting 5–8% of the basemap bleed through is what
  makes it read as *mist over a map* rather than *a hole cut in a black sheet*. It is also a
  direct contribution to D-051 — even fully fogged ground retains a ghost of its street grid.
- **The noise scale (`/ 260.0`) must not match the parchment grain.** Parchment grain is fine
  (~2–4 px), mist noise is coarse (~150–300 px). Matching frequencies produces a beat pattern
  that looks like video compression artefacts (R4 §6.6).

### 4.4 Layer order

Layer order is a design decision, not plumbing (R4 §4.3):

```js
map.on('style.load', () => {
  // Fog ABOVE the basemap AND its labels: unexplored place names stay hidden.
  // That is most of the "uncovering the world" feeling — and it is why label
  // placement differs between the two modes (§5).
  map.addLayer(new FogOfWarLayer({ cells: exploredR10 }));

  // Route ABOVE the fog: your own trace is always visible, even over ground
  // whose cells haven't been written yet (e.g. a run still syncing).
  map.addSource('runs', { type: 'geojson', data: runsFC, lineMetrics: true });
  map.addLayer({ id: 'run-glow', type: 'line', source: 'runs',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#ffb347', 'line-width': 12,
             'line-blur': 10, 'line-opacity': 0.35 } });
  map.addLayer({ id: 'run-core', type: 'line', source: 'runs',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#fff2d0', 'line-width': 2.5 } });
});
```

Route colour must survive both backgrounds: warm cream core `#fff2d0` with an amber glow reads on
parchment *and* against dark fog. Pure white blows out on parchment; pure red vanishes into it.

**Optimisation worth taking:** draw the just-uploaded run's polyline into the *mask* as a thick
soft line as well, so the corridor clears the instant the run appears, before the server's cell
write round-trips back (R4 §4.4).

### 4.5 Animation and accessibility

- Drive repaints with `requestAnimationFrame` → `map.triggerRepaint()`, **capped at 30 fps**.
  Drifting mist does not benefit from 60 and it halves the battery cost.
- Pause entirely when `document.hidden`.
- `matchMedia('(prefers-reduced-motion: reduce)')` → stop the rAF loop and render the fog
  statically at `u_time = 0`. Expose the same switch as a manual battery-saver toggle. Atlas mode
  (§5) turns animation off regardless.
- Handle `webglcontextlost` / `webglcontextrestored`: rebuild programs, VAOs and the FBO. On a
  phone this fires for real when the tab is backgrounded under memory pressure.

### 4.6 What R4 ruled out, and why — do not retry these

Recorded so that a future session does not rediscover them the expensive way.

| Approach | Why it is dead |
|---|---|
| **MapLibre `fill` layer: world polygon with explored areas as interior rings** | **Fatally broken, silently.** `EARCUT_MAX_RINGS = 500` in `src/data/bucket/fill_bucket.ts`; `classify_rings.ts` quickselects the 500 **largest by area** per tile and **discards the rest with no warning**. Small explored patches vanish and reappear as you pan. Not workaroundable from userland. It also requires dissolving tens of thousands of hexes first (`turf.union` / `polygon-clipping` locks the main thread for seconds to minutes at 5–10k polygons), and even when it works the edges are hard triangulated facets with no feather. (R4 §3.1) |
| **Canvas2D overlay with `globalCompositeOperation = 'destination-out'`** (the Dawarich approach) | A fine **2-hour prototype** and nothing more. It **cannot feather**: the obvious fix, `ctx.filter = 'blur(24px)'`, is **silently ignored on iOS Safari** — no error, just hard edges, on exactly the device class we care about. The documented workaround (`shadowBlur`) is per-draw-call and multiplies cost by shape count. It also re-projects every vertex with `map.project()` in JS every frame (drops frames past ~3–5k shapes on mobile) and lives in a separate DOM layer above *everything*, so labels cannot go under it and it cannot participate in WebGL blending. (R4 §3.4) |
| **deck.gl `MaskExtension` with `maskInverted: true`** | Correct architecture, wrong ergonomics. The mask is tested as a **boolean** in the masked layer's fragment shader: **hard binary edge, no feather parameter, no alpha ramp, no noise hook**, plus resampling shimmer while panning. Fixing it means forking deck.gl's mask shader module — all the cost of a ~500 KB dependency and all the work of writing our own shader. Also: max 4 simultaneous masks, incompatible with CPU-aggregation layers, unsupported in `GlobeView`. (R4 §3.2) |
| **Precomputed raster fog tiles** | Not wrong — *premature*. It is the right answer at 10M+ cells or 10k+ users. Here it adds a tile-baking pipeline to every ingest, lags the fog behind the run by the bake time, and a plain `raster` layer can only be tinted, not shaded, so animated mist would require managing our own tile cache anyway. **Documented escape hatch, not the plan.** (R4 §3.3) |
| **One draw call per cell** | Draw-call bound around ~2k cells. Use `drawArraysInstanced`. |
| **Sending all cells to the GPU without zoom bucketing** | Falls over past ~100k: massive overdraw at low zoom, VRAM churn. See §6. |

---

## 5. The two map modes

**D-052** mandates two modes with a toggle: **atlas** (high legibility, for planning where to
run) and **adventure** (full atmosphere, for admiring the map).

**D-051 is non-negotiable and binds both modes: the map must remain a real, legible street map.
Atmosphere may never cost legibility.** Adventure mode is allowed to be atmospheric; it is not
allowed to be unusable.

### 5.1 The art-direction call that makes both modes possible

**Parchment basemap, dark fog** (D-053, R4 §6.1). Not dark-on-dark.

The instinct with a "dark fantasy" brief (D-050 — ink, parchment, lantern-light, gold leaf, deep
navy) is a dark basemap. Do not. With a dark basemap, dark fog has almost no contrast against
unexplored ground and **the reveal does not read at all**. The only fix would be to *brighten*
explored ground instead, which means reading back the framebuffer — expensive, awkward, and it
throws away the additive-only shader in §4.3.

Warm parchment + near-black-blue fog gives us maximum known/unknown contrast on a phone screen,
the correct emotional metaphor (an old map being uncovered), a purely additive fog shader with no
readback, and warm/cool complementary tension. `u_rimGlow` picks up the parchment hue at the
boundary, visually stitching the two together.

Corollary for both modes: **keep basemap lightness high and saturation moderate.** The fog does
the darkening. If the basemap is already mid-dark, the fog has nowhere to go.

### 5.2 The difference, exactly

Both modes share one basemap *source* (one PMTiles archive) and one fog shader. They differ in
style-layer configuration and shader uniforms only — no second tileset, no second code path.

| | **Atlas** | **Adventure** |
|---|---|---|
| **Purpose** | Deciding where to run tomorrow | Looking at what you've done |
| `u_maxOpacity` | **0.55** | **0.94** |
| `u_noiseAmp` (threshold perturbation) | **0.10** — edge stays close to true coverage | **0.30** — ragged, organic |
| Noise animation | **Off.** `u_time` frozen at 0 | **On**, 30 fps drift |
| `u_rimAmt` (rim glow) | **0.08** — a hairline, just enough to find the frontier | **0.30** — full lantern-light |
| `u_fogDeep` / `u_fogEdge` | Desaturated, lighter: `(0.10,0.11,0.14)` / `(0.30,0.32,0.36)` | `(0.035,0.045,0.075)` / `(0.22,0.24,0.30)` |
| Mask FBO scale | **0.75×** — tighter, more accurate frontier | **0.5×** — softer, cheaper |
| **Basemap style** | Parchment, **high contrast**: dark road casings, strong hierarchy, water clearly separated from land | Parchment, **aged**: lower contrast, warmer, paper grain, hand-drawn-feeling casings |
| **Label density** | Full: street names down to residential, POIs, park names, house-number-scale labels at z≥16 | Reduced: place names, major roads, parks. Small POIs suppressed |
| **Label layer position** | **ABOVE the fog.** Street names remain readable through fogged ground | **BELOW the fog.** Unexplored place names stay hidden — the discovery beat |
| **Road layer position** | **Road geometry drawn above the fog** at ~0.5 opacity, so the street grid is fully traceable into unexplored ground | Below the fog. Only the ghost that `u_maxOpacity < 1.0` lets through |
| Decorative hex grid | Optional, off by default; if on, at z≥15 only | Off |
| "Unexplored zones near me" overlay (§8.4) | **Available** — this is its home | Hidden |
| Route polyline | Thin, precise, above everything | Glow + core (§4.4) |
| Reduced-motion / battery saver | Already static | Falls back to atlas's static fog, keeps adventure colours |

### 5.3 How this satisfies D-051

- **Atlas mode is the D-051 guarantee.** Fog at 0.55 opacity with road geometry and labels drawn
  *above* it means every street on the map is readable and nameable, explored or not. Planning a
  route into unknown ground — the exact task D-051 was written for — works perfectly.
- **Adventure mode is bounded, not exempt.** `u_maxOpacity` is capped at **0.94**, never 1.0
  (§4.3). Fully fogged ground still shows a ghost of its street grid. Adventure mode hides
  *names*, not *geometry*.
- **The toggle is one tap and its state persists** (localStorage; it is a per-device viewing
  preference, not user data). Nobody should have to hunt for it mid-planning.
- **Default: adventure.** It is the product's identity. Atlas is one tap away and the app should
  suggest it the first time the user opens the route-planning surface.

### 5.4 What the modes are *not* allowed to differ in

- **Neither mode changes what is revealed.** Both render the same cell set with the same
  `revealScale`. A mode toggle must never look like territory appearing or disappearing.
- **Neither mode changes scoring.** Obvious, but worth stating: the modes are a shader-uniform
  and style-layer switch, entirely client-side, with no path back to §3.

---

## 6. Performance

R4's claim (§3.6): **50k–500k stored cells at 60 fps**, because viewport culling means only
~1,500–6,000 instances ever reach the GPU, with a **~1 ms mask + 1–2 ms composite** budget on a
mid-range phone. The claim is true *only if* the bucketing and culling below are implemented. It
is not a property of the GPU; it is a property of the CPU-side data pipeline.

The load-bearing insight: **on-screen cell count is bounded by screen area, not by database
size.** If the render resolution is chosen so a cell is ~8–30 CSS px across, a 400×800 viewport
holds roughly (400×800)/15² ≈ **1,400 cells**. Whether the account holds 50,000 or 500,000 is
irrelevant to the frame. Total stored cells affects *transport and storage only* (§7).

### 6.1 Zoom bucketing

Map zoom selects a render resolution. Res 10 is the canonical stored resolution (D-115) and
therefore the **finest** bucket; coarser buckets are derived by `cellToParent`.

```js
const ZOOM_TO_RES = [
  { maxZoom:  4, res: 4 },  { maxZoom:  6, res: 5 },
  { maxZoom:  8, res: 6 },  { maxZoom: 10, res: 7 },
  { maxZoom: 12, res: 8 },  { maxZoom: 14, res: 9 },
  { maxZoom: Infinity, res: 10 },          // canonical — never finer (D-115)
];
const resForZoom = z => (ZOOM_TO_RES.find(e => z <= e.maxZoom) ?? { res: 10 }).res;
```

Rules:

- **Derive a bucket lazily, once, and cache it.** `_byRes: Map<res, {centers: Float32Array,
  radii: Float32Array, bounds: Float64Array}>`. Building the res-8 bucket from 150k res-10 cells
  is one `cellToParent` pass plus a dedupe — 30–80 ms, done once, off the frame path.
- **Re-derive only when the bucket index changes**, debounced ~250 ms — not on every zoom event.
  This is the single lesson worth copying wholesale from Dawarich (R4 §3.4).
- **Precompute each cell's mercator centre, mercator radius and bbox once per bucket.** Never
  call `cellToBoundary` or `map.project()` per frame. The vertex shader does all projection.
- **Coarse buckets render with partial opacity** from the aggregate `fraction` (R3 §5): a parent
  cell you've run 20% of is a dim glow, not a solid block. Multiply the mask fragment's `c` by
  `a_fraction`. Without this, zooming out turns a sparse city into a solid slab.

### 6.2 Viewport culling

R4's sketch culls by looping every cell in the bucket and doing four float compares against the
padded viewport. At res 10 with 150k cells that is 600k compares *per mask rebuild*, and the mask
rebuilds every frame during a pan. On a mid-range phone that is 1–3 ms of main-thread JS in the
frame path — the largest single cost in the whole system, and the one thing that would break the
60 fps claim.

**Fix: two-level cull, using the res-6 parent grouping that already exists in the storage
partition key (§2.4).**

```
build once per bucket:
  parents        : Map<res6Id, {lo, hi}>          # contiguous index range into the bucket arrays
  parentBounds   : Float64Array                   # 4 floats per parent, mercator bbox
  # cells are sorted by res-6 parent, so each parent owns a contiguous slice

per mask rebuild:
  1. cull PARENTS against the padded viewport         # a few hundred compares, not 600k
  2. for each surviving parent, cull its cells        # only cells that could be on screen
  3. write survivors into the instance Float32Array
  4. gl.bufferData(instanceVBO, survivors)
```

A res-6 parent is ~36 km²; at typical running zooms (z14–17) the viewport intersects 1–6 of them.
Step 1 discards essentially the whole dataset in a few hundred comparisons.

Further reductions, in order of value:

- **Pad the viewport by ~20% and cache the instance buffer.** Only rebuild the VBO when the
  camera leaves the padded region or the bucket changes. Small pans then cost **zero** CPU: the
  mask still re-renders each frame (it is screen-space), but that is one instanced draw call
  against a buffer that is already resident.
- **Separate `maskDirty` from `bufferDirty`.** `maskDirty` on any camera move (cheap: one draw
  call). `bufferDirty` only on bucket change, padded-region exit, or new data (§7.4). The
  composite pass runs every frame because it animates; the mask pass does not need to when the
  camera is still.
- **Skip everything when the layer is hidden.** Detach the move handlers and cancel the rAF loop.
  Hidden fog must not pay the tile walks (R4 §3.4).
- **Cap DPR at 2.** A 3× phone gains essentially nothing on a soft mist effect and costs 2.25×
  the composite fragments. Cheapest mobile win available (R4 §7.2).
- **Consider a Web Worker for bucket derivation** if the 30–80 ms `cellToParent` pass ever shows
  up as a visible hitch on a zoom-out. Not needed at MVP volumes; noted so it isn't a surprise.

### 6.3 Expected budget

| Pass | Work per frame | Mid-range phone |
|---|---|---|
| Mask FBO | 1 instanced draw call, ~1.5–6k quads, 0.5× resolution, ~2–4× overdraw | **< 1 ms** |
| Composite | 1 full-screen triangle, 3-octave fBm, ~40 ALU/fragment, DPR ≤ 2 | **1–2 ms** |
| CPU per frame (camera still, or inside padded region) | none — nothing projected in JS | **~0 ms** |
| CPU on padded-region exit / bucket change | two-level cull + VBO upload | 1–5 ms, off the frame path |
| Bucket derivation (new zoom bucket, cold) | `cellToParent` pass + dedupe + bbox precompute | 30–80 ms, debounced, once per bucket |

That leaves the large majority of a 16.7 ms budget to MapLibre's own basemap drawing.

### 6.4 What to measure to prove it

None of the above is true until measured. The instrumentation is small; build it with the layer,
not after.

**Instrument:**

1. **`visibleInstanceCount`**, sampled per mask rebuild. Log a histogram per zoom level.
   *Assertion: ≤ 6,000 at every zoom, at every dataset size.* If this number tracks total stored
   cells, bucketing or culling is broken — that is the canary for the entire performance claim.
2. **GPU pass timings** via `EXT_disjoint_timer_query_webgl2`, mask and composite separately.
   *Budget: mask < 1 ms, composite < 2 ms.* (The extension is not universally available; guard
   it, and fall back to frame time.)
3. **Frame time p50/p95** from rAF deltas during a **scripted** camera path — a fixed pan/zoom
   sequence replayed identically on every build, so numbers are comparable across commits.
   *Target: p95 < 16.7 ms.*
4. **Main-thread cull time** via `performance.mark`/`measure` around the two-level cull.
   *Budget: < 2 ms, and it must be ~0 ms for pans inside the padded region.*
5. **Bucket-derivation time** per resolution, and its cache hit rate.
6. **Long tasks** via `PerformanceObserver({ entryTypes: ['longtask'] })` during the scripted
   path. *Assertion: zero long tasks attributable to the fog layer during pan.*
7. **Peak JS heap** with a synthetic 500k-cell dataset. *Assertion: the `BigUint64Array` plus
   buckets stays in the low tens of MB.*

**Test with synthetic datasets at 50k / 150k / 500k cells**, generated once and checked in as a
fixture. Real data will not reach 500k for years (R3 §2), and by then the assumption will be
untested unless we test it now. Run the scripted path on a real mid-range Android device, not
only on a desktop — desktop numbers here are worthless.

**Kill criteria** (what "it failed" looks like, decided in advance): if p95 frame time exceeds
16.7 ms at 150k cells on the target phone, the first three levers, in order, are (a) drop mask
scale to 0.35×, (b) drop the animation to 20 fps, (c) drop fBm to 2 octaves. Only if all three
fail do we reach for precomputed raster tiles (§4.6, R4 §3.3).

---

## 7. Data delivery

R3's headline: **this is a few-megabytes problem, not a gigabytes problem.** Five years, worst
case, res 10 = 147,782 cells = 1.18 MB of raw 64-bit IDs; realistically 20k–50k. Sorted H3 IDs in
one metro share their high bits, so **delta encoding + varint gets to ~2–3 bytes per cell**, and
gzip on top lands the pessimistic case at **~300–450 KB over the wire**.

**Architectural consequence: ship the entire explored set to the client, once per session.** One
HTTP GET at app load. After that every fog query — viewport render, % explored, new-territory
count, unexplored-zones-near-me — is an **in-memory `Set`/sorted-array operation** with zero
network round-trips, zero server cost and instant pan/zoom. This is not a scaling compromise; at
this volume it is strictly better than any server-side alternative (R3 §2, §4).

**Do not build a tile server. Do not build a spatial index service. Do not build a per-viewport
query API.**

### 7.1 Payload format — `explored-r10.bin`

Little-endian throughout. Served from S3 with `Content-Encoding: gzip` (CloudFront passes it
through), so the format itself is uncompressed-simple and gzip does the entropy work.

```
offset  size  field
------  ----  ------------------------------------------------------------
0       4     magic       "LSFG"
4       1     version     = 1
5       1     res         = 10                (D-115; a reader MUST reject anything else)
6       1     flags       bit0 = compacted, bit1..7 reserved (0)
7       1     reserved    = 0
8       8     generation  u64 monotonic — see §7.3
16      4     count       u32, number of cell IDs
20      8     baseCell    u64, the first (smallest) H3 ID
28      ...   deltas      (count-1) × LEB128 unsigned varint, ascending gaps
```

- **Sort ascending, delta-encode, LEB128.** Neighbouring res-10 H3 IDs in the same locality
  differ in their low bits only, so most deltas fit in 1–2 varint bytes.
- **`flags` bit0 (`compacted`)** allows shipping `h3.compactCells()` output — a mixed-resolution
  array where any complete set of 7 children is replaced by its parent. It compacts contiguous
  territory 3–10× (R3 §3.6). **If set, the client MUST call `uncompactCells(arr, 10)` before any
  membership test.** Recommendation: **ship uncompacted for v1.** 300–450 KB is already fine, and
  mixed-resolution arrays are the H3 correctness footgun this document warns about twice.
  Compaction is a lever to pull if the payload ever becomes a real cost.
- **Decode to a sorted `BigUint64Array`** (8 bytes/cell — 150k cells = 1.2 MB) *and* build a
  `Set<string>` for O(1) membership. Both, deliberately: the typed array is what the render
  buckets iterate; the `Set` is what stats and `has()` queries use. At 150k entries `Set`
  construction is ~50 ms, once.
- **Never ship JSON hex strings** — roughly 2× the bytes and far slower to parse (R4 §7.1).

### 7.2 The companion payloads

| Object | Contents | When fetched |
|---|---|---|
| `explored-r10.<gen>.bin` | the set above | app load, always |
| `explored-agg.<gen>.json` | res 6/7/8 parent → `{exploredChildren, totalChildren, fraction}` | app load; small (a few KB); powers zoom-out opacity (§6.1) |
| `explored-lastrun-r10.<gen>.bin` | `u16` days-since-2020-01-01, **parallel to the cell array**, same order | **lazily, only when a view needs it** |

`lastRunAt` is deliberately a *separate* object. It roughly doubles the payload (~2 bytes/cell)
and **the fog itself does not need it** — revealed is permanent (D-020), so rendering depends on
presence alone. Only the optional "stale territory" surface (§8.5) needs it. Fetch it on demand,
cache it separately, and never block first paint on it.

### 7.3 Cache and invalidation

```
s3://lost-soles-data/users/<uid>/
  manifest.json                         # small, revalidated
  explored/explored-r10.<gen>.bin       # immutable
  explored/explored-agg.<gen>.json      # immutable
  explored/explored-lastrun-r10.<gen>.bin
  deltas/<fromGen>-<toGen>.bin          # immutable, short-lived
  traces/<activityId>.polyline.gz       # raw, immutable, never deleted (D-101, D-121)
```

- **Everything except `manifest.json` is content-addressed by `generation` and served
  `Cache-Control: public, max-age=31536000, immutable`.** A generation is never rewritten, so
  browser cache and CloudFront cache are always correct and nothing needs purging.
- **`manifest.json` is the only mutable object**, served `Cache-Control: no-cache` (revalidate
  every time; a 304 is a few hundred bytes):

  ```json
  {
    "generation": 412,
    "res": 10,
    "cellCount": 38142,
    "updatedAt": "2026-08-30T14:02:11Z",
    "cells":   "explored/explored-r10.412.bin",
    "agg":     "explored/explored-agg.412.json",
    "lastRun": "explored/explored-lastrun-r10.412.bin",
    "deltasFrom": 396
  }
  ```

- **`generation` is bumped by the ingest Lambda inside the same transaction as the cell writes**
  (§3.2). It is monotonic per user. It is the *only* cache key the client needs.
- **Client cache: IndexedDB**, keyed `{uid, generation}`, storing the decoded `BigUint64Array`
  (not the encoded bytes — skip re-parsing on warm start). Keep the current generation and one
  previous; evict the rest.
- **Boot sequence:**
  1. Read IndexedDB. If a set is cached, **render immediately** from it. Do not wait for the
     network. Stale-but-instant beats correct-but-blank — and the fog is append-only, so "stale"
     can only ever mean "missing the newest run", never "wrong".
  2. Fetch `manifest.json` in parallel.
  3. If `manifest.generation === cached.generation` → done, nothing else fetched.
  4. Else if `cached.generation >= manifest.deltasFrom` → fetch the delta chain (§7.4).
  5. Else → fetch the full `.bin`. Replace the cache.
- **Full-blob regeneration is cheap**: rewriting 150k cells is <100 ms of Lambda work (R3 §6).
  Regenerate on every ingest. There is no reason to be clever about it.
- **Deltas are garbage-collected**, keeping ~20 generations; `deltasFrom` tells the client when
  the chain no longer reaches it.
- **Version skew:** if `manifest.res !== 10` or the blob's `version` is unknown, the client
  discards its cache and refuses to render rather than guessing. A silent mis-parse of cell IDs
  would look like territory teleporting.

### 7.4 Incremental update when a run lands mid-session

The user finishes a run, Strava's webhook fires, the Lambda scores it (§3.2) and bumps
`generation`. The open browser tab must pick this up without a reload and without refetching
450 KB.

```
delta object: deltas/<fromGen>-<toGen>.bin
  magic "LSFD", version, res=10, fromGen u64, toGen u64,
  addedCount u32, then ascending delta-varint cell IDs (adds only)
```

**Adds only. There is no removal opcode, and there must never be one** — D-020 makes the set
append-only, and a client that cannot express a removal cannot be tricked into un-revealing
ground by a malformed payload.

Trigger, in preference order:

1. **AppSync subscription** (Amplify Gen 2 Data, already in the stack per D-080) on the user's
   generation counter. Push, no polling, no VPC (D-081 — nothing here needs a NAT gateway).
2. **Fallback: revalidate `manifest.json` on `visibilitychange` → visible and on `window.focus`.**
   Cheap (a 304), and it covers the common real case — the user finishes a run, opens the app,
   and expects to see the new territory. Do **not** poll on a timer; that is exactly the kind of
   background chore D-013 rejects.
3. Manual: a pull-to-refresh / "sync" affordance.

Applying a delta:

```
function applyDelta(state, delta):
    assert delta.fromGen == state.generation      # else fall back to a full fetch
    added = decodeDeltaVarint(delta)              # typically 40–130 cells (R3 §2)
    if added.length == 0: state.generation = delta.toGen; return

    mergeSortedInPlace(state.cells, added)        # BigUint64Array stays sorted
    for c in added: state.set.add(c)

    # Invalidate only what changed. This is why cells are grouped by res-6 parent (§6.2).
    touchedParents = unique(added.map(c => cellToParent(c, 6)))
    for res in state.buckets.keys():
        state.buckets.get(res).invalidateParents(touchedParents)

    state.generation = delta.toGen
    layer.bufferDirty = true
    layer.maskDirty   = true
    persistToIndexedDB(state)                     # idle callback, not on the frame path
```

- **Only the touched res-6 parents are rebuilt**, not the whole bucket. One run touches 1–2
  parents, so a mid-session update is sub-millisecond of work and one VBO upload.
- **Chain multiple deltas** if the client is several generations behind; each is validated
  `fromGen === state.generation` before applying.
- **Reveal it, don't just repaint it.** A run landing mid-session is the emotional payload of the
  entire product. Animate the new cells' `revealScale` from 0 to 1 over ~800 ms with a slight
  stagger along the route, and pan to the new territory if it is off-screen. This is the only
  place in the fog system where animation is not decoration.
- **The client never invents cells.** Only the server's delta adds to the set. The optimistic
  "draw the just-uploaded polyline into the mask" trick (§4.4) writes to the *mask texture*, never
  to the explored set, and is discarded on the next rebuild.

---

## 8. Derived statistics

Everything here runs **client-side** against the in-memory set (§7), except where noted. No new
endpoints, no new tables, no latency.

### 8.1 % explored of a named region

```js
// Denominator NEVER changes for a given region+resolution. Precompute it
// server-side once per region, ship it in a small regions manifest, cache forever.
const total = region.totalCellsRes10;                       // precomputed
const cells = region.cellsRes10;                            // precomputed, cached in IndexedDB
let explored = 0;
for (const c of cells) if (exploredSet.has(c)) explored++;
const pct = explored / total;
```

At res 10 a 200 km² city is 13,291 cells — milliseconds in the browser (R3 §4b). Cache the
denominator and the cell list per region; recompute the numerator whenever the generation
changes.

**Label this metric honestly.** "% of territory" is not "% of streets". Most of a city's *area*
is buildings and back gardens you can never run, so hex-area coverage understates real progress
and can never reach 100%. The number the user actually wants is **% of streets**, which comes
from the OSM way-segment model — Wandrer's whole product — and is **phase 2**, arriving with the
route planner (D-070, R3 §1.6, §4b). Until then, show territory % and call it *territory*. Never
show an unqualified "% explored".

Region boundaries themselves are an unresolved input (§9.8).

### 8.2 New territory per run — the Cartography feed

Cartography (D-032) is fed **directly** by the ledger entry written in §3.2. Nothing is
recomputed:

```
run.newCellCount       # never-seen cells        → 1.0 credit each
run.rearmedCellCount   # >6mo cells (D-120)      → 0.5 credit each
run.cooledCellCount    # <6mo cells              → 0.0
run.discoveryCredits   # = newCellCount + 0.5 * rearmedCellCount
run.cartographyXp      # = round(discoveryCredits * XP_PER_CELL)
```

One res-10 cell ≈ 15,048 m² ≈ 1.5 ha — a good XP unit. A first-ever run down a new street yields
~80–130 new cells; the same run repeated yields 0. **That diminishing-returns curve *is* the game
mechanic, and it falls out of the data model for free** (R3 §4e).

The UI should surface all three counts, not just the total. "112 cells run · 41 new · 12
rediscovered · 59 familiar" tells the story that a single XP number cannot. The `XP_PER_CELL`
constant and the level curve belong to the progression document, not this one.

### 8.3 Lifetime totals

Cheap aggregates, computed on generation change and memoised:

| Stat | Computation |
|---|---|
| Territory revealed | `exploredSet.size` cells; area via `sum(cellArea(c, 'km2'))` (do not multiply by the average — use `cellArea`, it varies with latitude) |
| Explorer since | `min(firstRunAt)` — the reason `firstRunAt` exists (§2.4) |
| Total distance / runs | run ledger, not the cell set |
| Cells re-armed lifetime | `sum(discoveryCount - 1)` over cells |
| Most-run ground | `max(visitCount)` — one cell, or a cluster; good flavour text |
| Frontier length | count of explored cells with ≥1 unexplored `gridDisk(c,1)` neighbour — a nice "edge of the known world" number, and it is §8.4's precursor |

### 8.4 Unexplored zones near me — and the route-planner precursor

This is the cheap version of D-070's route planner, deferred from MVP by D-122 but worth
building now because it is ~20 lines and genuinely useful on its own (R3 §4c). **Design it to be
reusable**, because the real planner will consume exactly this.

```js
const H3_R10_SPACING_M = 131.4;      // centre-to-centre (§2.1)

/**
 * The reusable frontier primitive. The deferred route planner (D-070) consumes
 * this same structure as its edge/region "profit" input — do not fork it.
 */
function frontier({ origin, radiusM, exploredSet, lastRunAt, now, clusterRes = 8 }) {
  const k    = Math.ceil(radiusM / H3_R10_SPACING_M);
  const disk = gridDisk(latLngToCell(origin.lat, origin.lng, 10), k);

  const clusters = new Map();               // res-8 parent -> accumulator
  for (const c of disk) {
    const parent = cellToParent(c, clusterRes);
    const acc = clusters.get(parent) ?? { parent, total: 0, novelty: 0 };
    acc.total   += 1;
    acc.novelty += cellNovelty(c, exploredSet, lastRunAt, now);   // <-- see below
    clusters.set(parent, acc);
  }

  return [...clusters.values()].map(a => {
    const centre = cellToLatLng(a.parent);
    return {
      parent: a.parent, centre,
      noveltyFraction: a.novelty / a.total,
      distanceM: haversine(origin, centre),
      bearing:   bearing(origin, centre),
      score:     (a.novelty / a.total) / Math.max(1, a.distanceM / 1000),
    };
  }).sort((x, y) => y.score - x.score);
}

/**
 * THE single source of truth for "how much is this cell worth right now".
 * Mirrors §3.2 exactly: 1.0 never-seen / 0.5 re-armed / 0.0 cooled (D-120).
 * The scorer, the planner and this view MUST all call this one function, so
 * the planner optimises precisely what the game rewards.
 */
function cellNovelty(cell, exploredSet, lastRunAt, now) {
  if (!exploredSet.has(cell))                  return 1.0;
  const t = lastRunAt?.get(cell);
  if (t == null)                               return 0.0;   // no lastRun data loaded → assume recent
  return (now - t) >= SIX_MONTHS_MS ? 0.5 : 0.0;
}
```

- A 4 km radius is `k ≈ 31` → ~2,977 cells → a sub-millisecond filter (R3 §4c).
- **`cellNovelty` is the reuse point.** Shared between §3's scorer (server), this view (client)
  and the future planner. Ship it as one module with one test suite. If the planner ever
  optimises a different novelty function than the scorer awards, the feature is broken in a way
  that is very hard to notice.
- Without the optional `lastRunAt` payload (§7.2) this degrades gracefully to binary
  explored/unexplored — which is all the MVP surface needs.
- **Surfaced in atlas mode only** (§5.2), as translucent warm markers over the densest unexplored
  clusters, with distance and bearing. No routing, no directions — just "there is a lot you
  haven't seen 2.1 km north-east".
- The real planner (D-070) replaces the res-8 clustering with an OSM way graph and a
  loop-constrained arc-orienteering heuristic in a Lambda (R3 §4c). It keeps this function's
  signature and its `cellNovelty` weighting.

### 8.5 Optional: stale territory

Ground whose `lastRunAt` is approaching or past 6 months is *re-armed for discovery* and the user
has no way to know. An opt-in atlas overlay tinting those cells warm ("neglected ground — worth
50% again") closes that loop.

**Constraint: this must not look like re-fogging.** It is a tint on *revealed* ground, in one
optional overlay, in one mode. D-020 and D-120 are unambiguous that the map never re-fogs and
that this distinction is visual-vs-scoring (§1.1). Requires the lazy `lastRunAt` payload (§7.2).
See §9.7 — this is a proposal, not a settled decision.

---

## 9. Open questions and risks

Stated honestly. Several of these are things this document *chose* a default for without a
decision to lean on; those are marked **NEEDS DECISION** and should go to the user.

### 9.1 Treadmill / no-GPS Wayfaring XP — **NEEDS DECISION**
D-120 and D-021 cover ground that *has* been run before. They say nothing about ground that does
not exist. §3.6 recommends treating an indoor run as known ground (half Wayfaring XP), on the
grounds that it is consistent with D-012's novelty framing and takes nothing away (D-013). The
alternative — full XP for indoor runs — is defensible too, since a treadmill run is not a
*repeat* of anything. **Ask the user.** Fog-side behaviour (zero Cartography) is settled either
way.

### 9.2 What exactly is "6 months"? — minor, decide now
Calendar months are ambiguous (Aug 31 + 6 months = ?) and drift with month length. **This
document specifies 183 days, UTC.** It is unambiguous, testable, and within a day or two of every
reasonable reading. Flagged only so nobody later "fixes" it into `dateFns.addMonths`.

### 9.3 Replay can lower a displayed XP total — real risk
Backfilling an old activity (§3.4) re-folds history, which can turn a cell that scored 100% into
one that scores 50% (because an even older run now precedes it). **XP the user has already seen
can go down.** That is a bad feeling and it contradicts the spirit of D-013. Options: (a) accept
it, show a "history recalculated" note; (b) make awards immutable once written and accept that
history is only approximately correct; (c) never allow backfill of activities older than the
newest scored one without an explicit user action. **Leaning (c) plus (a)** — backfill is a rare,
deliberate operation, so making it explicit is cheap. Needs a decision before the historical
Strava import ships.

### 9.4 Res 10's 131 m corridor over-reveals in dense grids — accepted, with an exit
On a tight downtown grid with 80–120 m block spacing, running one street can reveal cells whose
centres sit under the parallel street. D-115 accepts this; the §2.2 step-5 radius filter limits
it (a cell only qualifies if its *centre* is within 65 m of the path), but it does not eliminate
it. **The exit is real and cheap:** raw traces are archived immutably (D-101, D-121 mitigation 2),
so the entire set can be re-derived at res 11 at any time. Cost is 4.4× data (~1.5–2 MB wire),
which §7's architecture survives. Revisit only if the user reports the map feeling too generous.

### 9.5 GPS quality in urban canyons, tunnels and under tree cover
The §2.2 pipeline splits rather than interpolates across implausible jumps, so a lost fix
*under*-reveals. Under-revealing is recoverable; over-revealing is permanent (D-020). But
repeated under-reveal on a favourite route would be visible as a dotted corridor. Mitigation if it
shows up: relax `SPLIT_GAP_M` for gaps whose endpoints are collinear with the surrounding track.
Not worth building speculatively — **measure it on the user's real first 20 runs before touching
the constants.**

### 9.6 WebGL2 assumptions
`gl.blendEquation(gl.MAX)` and `R8` render targets are WebGL2-only. MapLibre 6 is WebGL2-only, so
this adds no new constraint — but it does mean **there is no WebGL1 fallback path at all** and the
app is simply unusable on a device without WebGL2. Also unvalidated: `MAX` blending against `R8`
on older Android GPUs via ANGLE. **Verify on a real mid-range Android device in the first week of
implementation**, before the rest of the layer is built on the assumption.

### 9.7 Surfacing the cooldown without breaking D-020 — **NEEDS DECISION**
The 6-month re-arm is invisible on the map by design. §8.5 proposes an opt-in atlas overlay. The
risk is that any visual treatment of "stale" ground reads as the map taking something back, which
is exactly what D-020 promises never happens. **Ask the user whether they want to see it at all.**
It is entirely possible the right answer is: the cooldown is a pleasant surprise in the run
summary and never appears on the map.

### 9.8 Region boundaries are an unchosen input
§8.1 needs polygons for "my city", "my neighbourhood". Candidates: OSM admin relations,
a city open-data portal, or a hand-drawn GeoJSON of the handful of areas the user cares about.
For a 1-user app the last option is honestly the cheapest and best, and it sidesteps the question
of which admin level a "neighbourhood" is. Not blocking; decide when §8.1 is built.

### 9.9 XP constants live elsewhere
`XP_PER_CELL`, the Cartography level curve, and how `newShare` feeds Wayfaring belong in the
progression design doc (D-030..D-033). This document defines the *inputs* — `discoveryCredits`,
`newCellCount`, `newShare` — and deliberately stops there. If the progression doc needs a
different input, that is a change to §3.2's award record, not to the mechanic.

### 9.10 The explored blob is a precise map of the user's home
D-123 explicitly declines special privacy handling: single user, private AWS account, map shown
only to the owner, full-fidelity traces stored, nothing masked. That is correct for MVP and the
document does not second-guess it. **But `explored-r10.bin` is a high-resolution record of where
someone lives and when they are out**, and it is fetched by a browser over a URL. The standing
revisit trigger from D-123 applies to *this artefact specifically*: **the moment friends/family
accounts, sharing, or screenshot export exist, §7's "just fetch the blob" model needs an
authorisation story.** Note it in `08-security-privacy.md` as a standing condition. Concretely,
even at MVP: serve these objects via signed URLs or an authenticated origin, never a public
bucket — that costs nothing today and avoids a migration later.

### 9.11 Strava adapter fragility (context, not a fog problem)
D-121 ships Strava as the MVP adapter over an explicit recommendation against it. For the fog
subsystem specifically the consequence is bounded: cells are derived server-side from traces that
are archived to S3 at ingest (D-121 mitigation 2), so **losing Strava cannot lose the map.** The
adapter boundary (D-100) means §2.2's input contract does not change when the adapter does. The
one fog-visible requirement is non-negotiable and already recorded: `activity:read_all` scope and
the full `latlng` stream, never `summary_polyline` (D-121 mitigations 3 and 4). A privacy-zone
truncated trace would permanently blank the map around home — permanently, because D-020.

---

## Appendix A — invariants an implementer must not violate

1. **The explored set only grows.** No code path removes a cell. (D-020, D-120)
2. **`lastRunAt` is a timestamp, never a boolean.** (D-120)
3. **`firstRunAt` is written with `min`, `lastRunAt` with `max`.** (§3.4)
4. **Cells are res 10, never mixed.** Coarser resolutions are derived, never stored. (D-115)
5. **Cells are computed server-side.** The client never claims territory or XP. (R3 §6)
6. **Scoring uses `activity.startedAt`, never `now()`.** (§3.1)
7. **Classify all cells before writing any.** (§3.3)
8. **Awards are stored, not recomputed.** (§3.2)
9. **`cellNovelty` has exactly one implementation**, shared by scorer, stats and planner. (§8.4)
10. **The reveal radius (65 m) and the render radius (~102 m) are different numbers.** The render
    radius never feeds back into scoring. (§2.3)
11. **`u_maxOpacity` never reaches 1.0, in any mode.** (§4.3, D-051)
12. **Streets stay readable in both modes.** (D-051)
