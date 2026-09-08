---
id: 46
slug: reveal-radius-and-corridor-fill
title: REVEAL_R_M = 65 m exact-radius filter and corridor fill
type: feature
priority: high
status: open
size: m
capability: 07-fog-projection-and-cells
depends_on: [45]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
---

## Description

Step 5 of `05-fog-of-war.md` §2.2, and the definition of the word "revealed":

```
return filter(cells, c => distancePointToPolyline(cellToLatLng(c), segments) <= REVEAL_R_M)
```

**`REVEAL_R_M = 65` metres either side of the path — a ~130 m corridor.** Res 10's inradius is
**65.7 m**, so the game rule and the geometry land on the same number: the reveal is, to within
rounding, "the cell you ran through", with this filter correcting the cases where the path clips a
corner without passing near the centre. There is no fudge factor to tune, and that coincidence is
one of the three reasons D-115 could settle on res 10 at all.

**Correction to the roadmap.** `09-roadmap.md` §3 `07`/2 says "reveal radius (50 m assumed)".
That is stale; `05-fog-of-war.md` §2.3 states 65 m with its justification, and 65 is what matches
the inradius. Use 65. Fix the roadmap line in the same commit so the two cannot drift.

Why not `k = 1`: `gridDisk(c, 1)` is 7 cells, ~394 m across, effective radius near 200 m. On a US
grid with 80–120 m block spacing, running one street would reveal both parallel streets. D-012 says
the point is running new places; the map must not gift you ground you never saw.

Why 65 is defensible in both directions: it is the far side of a street plus a front yard — you can
genuinely claim to have seen it — and it is generous enough to swallow consumer GPS error (5–15 m
open, 20–40 m urban canyon) without per-sample error modelling.

**Do not confuse the reveal radius with the render radius.** `REVEAL_R_M = 65 m` is scoring and set
membership, server-side, authoritative. `revealScale × circumradius ≈ 1.35 × 75.9 ≈ 102 m` is the
soft disc splatted in the mask shader (0055) and overspills the hexagon *on purpose*. The render
constant must never feed back into what counts as explored — there must be no import path from the
renderer into `src/domain/fog.ts`.

Every Cartography number scales linearly with this constant (`04-game-design.md` §10). Changing it
after ship is a rebalance, not a tweak; label the constant accordingly.

## Acceptance criteria

- [x] `REVEAL_R_M = 65` is a single named export in `src/domain/fog.ts` with a comment tying it to
      res 10's 65.7 m inradius and to D-115.
- [x] ~~`distancePointToPolyline`~~ **`distancePointToSegments`** measures to the **polyline
      segments**, not to the nearest vertex; a test with a long straight segment and a far-apart
      vertex pair proves the difference.
      *Amended: the name in §2.2's pseudocode cannot live in `src/domain` — `check-boundaries.mjs`
      bans the word `polyline` there (D-121/D-100) and caught the first draft. The gate is right
      and the doc was corrected, not the gate. Substance unchanged.*
- [x] Distance is computed per segment, respecting the splits from 0045 — the joining chord across
      a split contributes no distance.
- [x] A cell whose centre is 64 m from the path is included; 66 m is excluded (boundary test).
- [x] A single wild outlier sample qualifies only cells within 65 m of it, and the result contains
      no spike of cells stretching toward it.
- [x] The filtered result for the real Strava fixture stays in the 40–130 cell band and is a
      contiguous corridor — a test asserts every cell has at least one **`gridDisk(c,2)`**
      neighbour in the set, except for genuinely split segments.
      *Amended from `gridDisk(c,1)`, with measurements, and recorded as **D-216**. The fixture has
      no splits and one cell still failed at ring 1. That is not a defect in the filter: dropping
      a corner-clipped cell can leave the two cells either side of it two rings apart. Over 60
      straight 5 km lines at one-degree bearing increments, ring-1 isolation occurs at 8 of 60
      bearings (≤3 cells) and **ring-2 isolation at none**. Ring 2 is the honest statement of
      "one corridor" and keeps every tooth the criterion wanted — a spike, a scatter or a second
      parallel street all fail it just as hard.*
- [x] A grep/lint check asserts nothing in `src/domain/fog.ts` imports from the renderer, and that
      `revealScale` appears only in renderer code.
- [x] ~~`09-roadmap.md` §3 `07`/2's "50 m assumed" is corrected to 65 m in the same commit.~~
      **Already correct; the stale 50 m was somewhere worse.** `09-roadmap.md` §3 `07`/2 has read
      65 m since commit `09b8c6e` ("06 audit"). The live stale assumption was in
      `04-game-design.md` — §10 (*"assumed at 50 m, giving 6.5 cells/km"*), §6.2's Lantern row,
      and, critically, §3.2, which tuned **Cartography's XP rate against that 6.5**. Corrected in
      the same commit, together with the rate it had corrupted: **D-215**. `09-roadmap.md`'s open
      risk row for the assumption was closed in the same commit.

## Notes

`05-fog-of-war.md` §9.4 accepts that a 131 m corridor over-reveals slightly in dense grids, and
names the exit: raw traces are archived (0039), so the whole cell set can be re-derived at a finer
resolution or a tighter radius from the archive. Nothing about this number is one-way — but it is
expensive to change once XP has been awarded against it, so change it before ship or not at all.

## Resolution

**Files touched**

| File | What changed |
|---|---|
| `src/domain/fog.ts` | `REVEAL_R_M = 65`; step 5 added to `traceToCells`, which now returns the **filtered** set; new exported `distancePointToSegments` |
| `src/domain/fog.test.ts` | +13 tests (29 → 42) |
| `src/adapters/strava/fog-projection.test.ts` | the fixture's band moved from the candidate set to the filtered set; contiguity to ring 2; new subset assertion |
| `scripts/check-fog-render-boundary.mjs` | new, with `--self-test` (13 cases) |
| `.github/workflows/gate.yml`, `amplify.yml` | wired it into both CI surfaces (D-163) |
| `docs/05-fog-of-war.md` | §2.2 step 5 note + the rename; §2.3's "to within rounding" corrected with measurements |
| `docs/04-game-design.md` | the D-215 rebalance — §1.3 schema example, §3.1, §3.2, §3.3, §4.2 mock, §5 density, §6.2, §8.1, §8.2 worked example, §10 |
| `rules/xp-rules-v1.yaml` | `cartography.xpPerUnit` 15 → 13 |
| `docs/09-roadmap.md` | the "reveal radius is an assumption" risk row closed |
| `docs/decisions/DECISIONS.md` | D-215, D-216 |

**`traceToCells` now returns the filtered set, not candidates.** §2.2's pseudocode returns the
filtered set and `0045`'s own header said nothing may treat its output as revealed ground until
this ticket landed. Step 5 filters against the **raw** segments from step 3, not the densified
ones — §2.2 passes `segments`, and the distinction is load-bearing: densification puts a vertex
every 30 m, so a nearest-vertex bug measured against `dense` would be within ~1.7 m of the truth
and would hide. Against the raw segments a 400 m sampling gap is one 400 m edge and only a real
point-to-segment measure keeps the corridor between its endpoints.

**Three things went differently from the plan, and all three are recorded rather than papered
over.**

1. **The D-100 gate rejected §2.2's own function name.** `distancePointToPolyline` contains
   `polyline`, which `check-boundaries.mjs`'s STRICT tier bans throughout `src/domain` because
   D-121 makes a `summary_polyline` a degraded trace. The gate was right — the argument is not a
   polyline, it is the segment list step 3 produced — so the function is
   `distancePointToSegments` and §2.2's pseudocode was corrected to match. Weakening the
   strongest check in the project for a naming preference was never the option.

2. **Criterion 6's contiguity was not achievable at ring 1, and the reason is a theorem
   (D-216).** 65 m is below res 10's 65.7 m inradius, so a centre within 65 m of the path has its
   nearest path point *inside* the cell: the filtered set is a **strict subset** of the cells
   entered, always, and step 4's k=1 disc provably contributes nothing at this radius. Removing
   the corner-clipped cells can leave the two survivors either side two rings apart. Measured
   over 60 straight 5 km lines: ring-1 isolation at 8/60 bearings (10 cells total), **ring-2
   isolation at 0**. The criterion moved to ring 2 with the measurements attached. The obvious
   "fix" — union the filtered set with the entered cells — was rejected because by the same
   theorem it reduces to exactly `gridDisk(c, 0)`, making `REVEAL_R_M` decorative.

3. **Criterion 8 pointed at the wrong document, and the right one was doing arithmetic.**
   `09-roadmap.md` §3 `07`/2 already read 65 m (fixed by `09b8c6e`, the `06` audit). The surviving
   50 m was in `04-game-design.md` §10, §6.2 — and §3.2, which had tuned **Cartography's XP rate
   against the 6.5 cells/km that assumption implies**. The measured density is **7.67 cells/km**,
   so 15 XP/cell would have paid 115 XP/km against Wayfaring's 100 and quietly made Cartography
   dominant. Rate cut to **13** (7.67 × 13 = 99.7), holding XP-per-kilometre — the quantity §3.2
   actually tuned — constant, so the parity claim, the ~31 XP/km steady-state floor and the §5
   projections all survive untouched. Only §8.2's per-run cell counts moved and they were
   recomputed (55 → 64 cells, 375 → 383 XP). **D-215.**

   **Scope note:** the rebalance is outside this ticket and was widened into it on explicit
   operator instruction, offered against the alternative of filing it separately. Recorded here
   because a silent widening is the thing the rule forbids.

**What was deliberately not done.** No spatial index for step 5 — it is O(candidates × vertices)
with no early exit, measured at ~17 ms per 5 km run and running once per activity in the ingest
Lambda. A quadtree buys nothing until something measures slow and costs clarity now.

## Operator validation

**Smoke tests — run by the agent, D-181.** Nothing in this ticket is visible on a screen: it is a
pure function in `src/domain`, and the capability has no UI until `0059`. Everything below was
executed on this machine (Linux, WSL2, node via `npx vitest`), 2026-09-07.

```
REVEAL_R_M            = 65
mean cells/km         = 7.67
subset-of-entered     = 60/60 bearings
ring-1 isolated cells = 10 across 8/60 bearings
ring-2 isolated cells = 0
elapsed               = 1034 ms for 60 x 5 km
```

*(60 synthetic straight 5 km lines at one-degree bearing increments near Point Nemo, D-199. This
is the measurement D-215's rate and D-216's ring-2 amendment both rest on; it is reproducible from
the sweep described in `fog-projection.test.ts`'s contiguity comment.)*

| Check | Command | Result |
|---|---|---|
| Full suite | `npx vitest run` | **1162 passed**, 1 skipped, 63 files |
| Fog unit tests | `npx vitest run src/domain/fog.test.ts` | 42 passed (29 before this ticket) |
| Real trace, end to end | `npx vitest run src/adapters/strava/fog-projection.test.ts` | 6 passed — 6.0 km fixture reveals **45 cells** (in the 40–130 band), enters 58, subset holds, ring-2 contiguous |
| Types | `npm run typecheck` | clean |
| Lint | `npm run lint` | clean, `--max-warnings 0` |
| **New gate, self-test** | `node scripts/check-fog-render-boundary.mjs --self-test` | **13/13** — fires on a maplibre/component/shader/`require` import into `src/domain`, fires on `revealScale` anywhere under `src/`, stays quiet when the domain merely *explains* the boundary in prose, and does not fire on `REVEAL_R_M` itself |
| **New gate, live** | `node scripts/check-fog-render-boundary.mjs` | pass — 62 files scanned (it refuses to pass on a zero-file scan) |
| D-100 boundary | `node scripts/check-boundaries.mjs` | pass — **after** it caught the `polyline` name and forced the rename |
| Other gates | `check-design-tokens`, `check-fixture-geography`, `check-adapter-deletion` | all pass |

**Still needs a human eye, and cannot be done yet.** The original steps below need the map, which
is ticket `0059` in capability `08`. Carry them there rather than to this close:

1. Zoom 16 over a street run exactly once, on the Android phone: the corridor should read as about
   one street wide plus front gardens (~130 m), and the parallel street one block over must still
   be fogged.
2. A spot where you always stand still (a crossing) must show a normal corridor, not a blob several
   cells wide.
3. **New, from D-216:** watch for a single missing cell mid-corridor. It is expected in the data
   (18% of entered cells are dropped as corner clips) and the ~102 m render discs should cover it
   completely. If a hole is *visible* on screen, that is a finding worth a ticket — against the
   renderer, not against this filter.
