---
id: 90
slug: derived-stats-feed
title: Derived stats feed — per-run territory counts, lifetime totals, and the frontier primitive
type: feature
priority: med
status: open
size: m
capability: 13-home-plinth-and-chronicle
depends_on: [49, 62, 86]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
---

## Description

One place that computes the numbers the plinth, the tally and the chronicle lines all read.
`05-fog-of-war.md` §8.2–8.4.

**Per run — the Cartography feed (§8.2).** Fed **directly** by the ledger entry written at
projection time. **Nothing is recomputed:**

```
run.newCellCount       # never-seen cells        → 1.0 credit each
run.rearmedCellCount   # >6mo cells (D-120)      → 0.5 credit each
run.cooledCellCount    # <6mo cells              → 0.0
run.discoveryCredits   # = newCellCount + 0.5 * rearmedCellCount
run.cartographyXp      # = round(discoveryCredits * XP_PER_CELL)
```

Surface **all three counts, not just the total**: *"112 cells run · 41 new · 12 rediscovered · 59
familiar"* tells a story a single XP number cannot. That breakdown is what 0081's tap-to-expand and
0083's chronicle templates consume.

**Lifetime totals (§8.3)** — cheap aggregates, computed on `manifest.json` generation change and
memoised, never on every render:

| Stat | Computation |
|---|---|
| Territory revealed | `exploredSet.size`; area via `sum(cellArea(c,'km2'))` — **use `cellArea`, never size × an average**, it varies with latitude |
| Explorer since | `min(firstRunAt)` |
| Total distance / runs | the run ledger, not the cell set |
| Cells re-armed lifetime | `sum(discoveryCount - 1)` |
| Most-run ground | `max(visitCount)` — good flavour text |
| Frontier length | explored cells with ≥1 unexplored `gridDisk(c,1)` neighbour |

**The frontier primitive (§8.4)** — the res-8 clustered novelty scan that answers "unexplored ground
1.2 km north". It is ~20 lines, it is what beat 5 (0083) renders and what the frontier line's tap
recentres on. **Build it reusable**: the deferred route planner (D-070) consumes exactly this
structure as its profit input — do not fork it later, and do not inline a second copy in the
post-run moment.

Everything here is **derived**. Nothing in this feed is a source of truth, nothing is persisted as a
new authority, and a wrong number here is fixed by recomputing, never by writing a correction. The
one thing it may not do is disagree with the ledger: `05-fog-of-war.md` §8.2's whole point is that
these counts come *from* the ledger entry rather than being recalculated beside it.

## Acceptance criteria

- [ ] Per-run counts (`new` / `rearmed` / `cooled`) are read from the projection's ledger entry;
      a test asserts no recomputation from the cell set occurs on the read path.
- [ ] `discoveryCredits` and `cartographyXp` match the `04-game-design.md` §8.2/§8.3 worked examples
      exactly.
- [ ] Territory area uses per-cell `cellArea`; a test at two latitudes 20° apart shows the totals
      differ from an average-multiplied estimate.
- [ ] Lifetime totals are memoised and recomputed only when `manifest.json` `generation` changes;
      a test asserts two consecutive reads at the same generation do one computation.
- [ ] The frontier primitive returns clusters at res-8 with `noveltyFraction`, `distanceM`,
      `bearing` and `score`, sorted by score descending.
- [ ] The frontier primitive is a single exported function with no UI imports, callable from both
      0083 and a future planner; a grep finds exactly one implementation.
- [ ] A run with no new territory returns `newCellCount = 0` and a well-formed record — never
      `null`, never a thrown error, never a missing field.
- [ ] Lifetime cell count shown on the plinth equals `exploredSet.size` from the loaded
      `explored-r10.bin`, asserted against the blob rather than a cached number.
- [ ] Computing lifetime totals over a year-five-scale fixture stays inside the frame budget or runs
      off the main thread.

## Notes

Depends on 0049 (`explored-r10.bin` + `manifest.json` generation counter), 0062 (the XP ledger) and
0086 (the plinth that displays it).

Frontier length and the §8.4 scan are the "edge of the known world" numbers and they are the most
expensive things in this feed. Bound them: the scan takes a radius, and the plinth never needs one
at all — only beat 5 does, once per run.

Resist adding period aggregates here even though they would be trivial. There is no consumer for
"this week's distance" in the design and the moment one exists on a screen, N2 follows
(`06-ui-ux.md` §2.3).

## Operator validation

On the Android phone after importing a real run: compare the tally's `21 cells claimed · 8
remembered` against the same run's row in the Chronicle and against the tap-expanded breakdown. All
three must agree — a disagreement between two screens showing the same run is the bug this feed
exists to prevent, and it is only ever caught by a human looking at both.

Check the plinth's lifetime cell count against the map: after a run that revealed new ground, it must
have gone up by the run's new-cell count exactly, not approximately.

Then tap the frontier line and drive or walk toward what it named. If it points at somewhere you have
obviously already run, the novelty scan is reading a stale generation.
