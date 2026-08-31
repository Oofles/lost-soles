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

- [ ] `REVEAL_R_M = 65` is a single named export in `src/domain/fog.ts` with a comment tying it to
      res 10's 65.7 m inradius and to D-115.
- [ ] `distancePointToPolyline` measures to the **polyline segments**, not to the nearest vertex; a
      test with a long straight segment and a far-apart vertex pair proves the difference.
- [ ] Distance is computed per segment, respecting the splits from 0045 — the joining chord across
      a split contributes no distance.
- [ ] A cell whose centre is 64 m from the path is included; 66 m is excluded (boundary test).
- [ ] A single wild outlier sample qualifies only cells within 65 m of it, and the result contains
      no spike of cells stretching toward it.
- [ ] The filtered result for the real Strava fixture stays in the 40–130 cell band and is a
      contiguous corridor — a test asserts every cell has at least one `gridDisk(c,1)` neighbour in
      the set, except for genuinely split segments.
- [ ] A grep/lint check asserts nothing in `src/domain/fog.ts` imports from the renderer, and that
      `revealScale` appears only in renderer code.
- [ ] `09-roadmap.md` §3 `07`/2's "50 m assumed" is corrected to 65 m in the same commit.

## Notes

`05-fog-of-war.md` §9.4 accepts that a 131 m corridor over-reveals slightly in dense grids, and
names the exit: raw traces are archived (0039), so the whole cell set can be re-derived at a finer
resolution or a tighter radius from the archive. Nothing about this number is one-way — but it is
expensive to change once XP has been awarded against it, so change it before ship or not at all.

## Operator validation

1. After 0059 lands, open the map at zoom 16 over a street you have run exactly once, on the
   Android phone.
2. The revealed corridor should be about one street wide plus front gardens — roughly 130 m across.
   The parallel street one block over must still be fogged.
3. Find a spot where you stood still (a crossing you always wait at). There must be a normal
   corridor there, not a blob of revealed ground several cells wide.
