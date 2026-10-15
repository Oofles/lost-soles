---
id: 90
slug: derived-stats-feed
title: Derived stats feed — per-run territory counts, lifetime totals, and the frontier primitive
type: feature
priority: med
status: closed
size: m
capability: 13-home-plinth-and-chronicle
depends_on: [49, 62, 86]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
started: 2026-10-15T18:28:53Z
closed: 2026-10-15T20:12:17Z
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
familiar"* tells a story a single XP number cannot. That breakdown is what 0081's click-to-expand and
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
1.2 km north". It is ~20 lines, it is what beat 5 (0083) renders and what the frontier line's click
recentres on. **Build it reusable**: the deferred route planner (D-070) consumes exactly this
structure as its profit input — do not fork it later, and do not inline a second copy in the
post-run moment.

Everything here is **derived**. Nothing in this feed is a source of truth, nothing is persisted as a
new authority, and a wrong number here is fixed by recomputing, never by writing a correction. The
one thing it may not do is disagree with the ledger: `05-fog-of-war.md` §8.2's whole point is that
these counts come *from* the ledger entry rather than being recalculated beside it.

## Acceptance criteria

- [x] Per-run counts (`new` / `rearmed` / `cooled`) are read from the projection's ledger entry;
      a test asserts no recomputation from the cell set occurs on the read path.
- [x] `discoveryCredits` and `cartographyXp` match the `04-game-design.md` §8.2/§8.3 worked examples
      exactly.
- [x] Territory area uses per-cell `cellArea`; a test at two latitudes 20° apart shows the totals
      differ from an average-multiplied estimate.
- [x] Lifetime totals are memoised and recomputed only when `manifest.json` `generation` changes;
      a test asserts two consecutive reads at the same generation do one computation.
- [x] The frontier primitive returns clusters at res-8 with `noveltyFraction`, `distanceM`,
      `bearing` and `score`, sorted by score descending.
- [x] The frontier primitive is a single exported function with no UI imports, callable from both
      0083 and a future planner; a grep finds exactly one implementation.
- [x] A run with no new territory returns `newCellCount = 0` and a well-formed record — never
      `null`, never a thrown error, never a missing field.
- [x] Lifetime cell count shown on the plinth equals `exploredSet.size` from the loaded
      `explored-r10.bin`, asserted against the blob rather than a cached number.
- [x] Computing lifetime totals over a year-five-scale fixture stays inside the frame budget or runs
      off the main thread.

## Notes

**2026-10-13, operator, after `0083` (for the route planner, D-070 — no ticket exists yet; this is
its nearest home):** the frontier line points at the same place on every run, because every run
starts at home and it is measured against today's map. Acceptable for now. Two concerns to settle
when planning comes up, deliberately not decided yet:
- ground that looks unclaimed on the map may be unrunnable for reasons the map cannot show;
- the suggestion should not be the same point every time.

**2026-10-13, from `0083`:** the frontier primitive now exists — `frontier()` and `cellNovelty()` in
`src/domain/frontier.ts`, with its tests. Consume it; do not write a second one (this ticket's own
"a grep finds exactly one implementation" criterion). Two departures from §8.4's sketch are recorded in
its header: it walks the disk at the explored set's `RES`, and its weights are an argument (the
Cartography row's `unitMultipliers`, D-272) rather than constants.

Depends on 0049 (`explored-r10.bin` + `manifest.json` generation counter), 0062 (the XP ledger) and
0086 (the plinth that displays it).

Frontier length and the §8.4 scan are the "edge of the known world" numbers and they are the most
expensive things in this feed. Bound them: the scan takes a radius, and the plinth never needs one
at all — only beat 5 does, once per run.

Resist adding period aggregates here even though they would be trivial. There is no consumer for
"this week's distance" in the design and the moment one exists on a screen, N2 follows
(`06-ui-ux.md` §2.3).

- 2026-10-01 (`0221`, D-272): `DiscoveryAward.discoveryCredits` no longer exists, and nor do
  the `CREDIT_*` constants. Where this ticket says `run.discoveryCredits = new + 0.5 × rearmed`,
  read it as `discoveryCredits(counts, cartographyRow)` from `src/scoring/propagate.ts`. Use the
  row from the run's `xpRulesVersion`. Do not hardcode 0.5.

## Operator validation

In the desktop browser after importing a run: compare the tally's `21 cells claimed · 8
remembered` against the same run's row in the Chronicle and against the click-expanded breakdown. All
three must agree — a disagreement between two screens showing the same run is the bug this feed
exists to prevent, and it is only ever caught by a human looking at both.

Check the plinth's lifetime cell count against the map: after a run that revealed new ground, it must
have gone up by the run's new-cell count exactly, not approximately.

Then click the frontier line and drive or walk toward what it named. If it points at somewhere you have
obviously already run, the novelty scan is reading a stale generation.

**Agent smoke test, deployed `e15122d` (Amplify job 404), 2026-10-15.** Headless Chromium against soles.devaultsecurity.com as a throwaway Cognito user with 18 seeded runs (4 traced), everything deleted and re-verified afterwards. The plinth's lifetime cells read 225 for 225 seeded. The tally matches the Chronicle row for both checked runs: `57 cells claimed` / `57 new`, and `58 cells claimed · 2 remembered` / `58 new`. The click-expanded breakdown reads `125 new cells · 2 remembered cells`. Those are XP amounts labelled as cells (58 × 2.15, 2 × 0.5 × 2.15), not a disagreement in the feed. Filed as `0277`.

**Operator, desktop browser, 2026-10-15:** the frontier line and the cross-screen counts: good.

## Resolution

**Built the feed in one module, `lib/stats/derived.ts`, and pointed the plinth's cell count at it.
Three of §8.3's six lifetime stats are built; the other three need data the browser does not hold,
and are left for a decision (below), not guessed at.**

Files touched:
- `lib/stats/derived.ts` (new) — the feed.
  - `runTerritory(stored, rules)` — the per-run Cartography feed (§8.2). Takes the counts the
    projection wrote on the activity row and the run's own ruleset, and **no cell set**, so there is
    no path by which it could reclassify. Returns `cellCount`, `newCellCount`, `rearmedCellCount`,
    `cooledCellCount`, `deferredCellCount`, `discoveryCredits`, `cartographyXp` — always all seven, all
    finite numbers; a column a row predates reads as 0.
    `discoveryCredits` is `discoveryCredits(counts, row)` from `src/scoring/propagate.ts` (D-272), with
    the discovery row found by data (`enabled && unitMultipliers`, D-031). `cartographyXp` rates
    `discoveryRows` through `ledgerEntries`, so it rounds **per row** exactly as the ledger does.
  - `lifetimeCells(set)` — the loaded set's `size`. What the plinth shows.
  - `lifetimeTerritory(set)` — cells, `areaKm2` (`Σ cellArea(c,'km2')`), `frontierLength` (explored
    cells with an unexplored `gridDisk(c,1)` neighbour). Time-sliced: yields every `SLICE_BUDGET_MS`
    (6 ms), checking the clock every 128 cells. Membership is asked of the array captured at the start,
    so a delta landing mid-walk (which replaces the set's array) cannot mix two generations.
  - `lifetimeFeed(compute?)` — memo keyed on (set, generation); a second read at one generation
    returns the same promise.
- `lib/stats/derived.test.ts` (new) — 14 tests, one or more per criterion, below.
- `lib/runs/wire.ts`, `lib/runs/server.ts` — `RunSummary` gains **optional** `cooledCellCount` and
  `deferredCellCount`, read by `runById` from the T3 columns `persist.ts` already writes. Additive
  only: `recentRuns`/`RunListItem` and `/api/runs/latest` are unchanged.
- `components/plinth/home-screen.tsx` — the plinth's cells input is `lifetimeCells(explored.set)`.
  Same value as before, from the same provider; no new fetch.

How each criterion is met:
1. `runById` over a row written by the shipped `activityItem` → `runTerritory` returns the stored
   counts, with every classifier export (`classifyCells`, `awardOf`, `runClassesOf`, `rearmSoonOf`)
   spied and called 0 times; plus a stored record no classifier could produce (5 new of 3 cells)
   comes back verbatim, and the function's arity is 2 (no set argument).
2. Example A: 148 + 58 → 177 credits, **380 XP** (318 + 62). Example B: zeros. A v1 test shows the
   rate is the run's version's, not today's.
3. Two 20 km-scale discs at lat 20° and 40°: same count, so `size × getHexagonAreaAvg` calls them
   equal; the per-cell sums differ by >1 %, and match `Σ cellArea` exactly.
4. `lifetimeFeed` with a counted `compute`: two reads → 1 call; an `applyDelta` to gen 8 → exactly
   one more.
5–6. The primitive is `0083`'s, unchanged. A source walk over `app components lib src amplify tools`
   finds exactly one `frontier` and one `cellNovelty` definition, both in `src/domain/frontier.ts`,
   whose imports are `h3-js` and `./` only. (Its own test already covers the cluster fields and sort.)
7. Three empty-shaped records (zeros, missing columns, nulls) → every field finite, `newCellCount 0`.
8. `encodeExploredBlob` → `ExploredSet.fromBlob` → `plinthModel({cells: lifetimeCells(set)})` equals
   the formatted `decodeExploredBlob(bytes).cells.length`; a source assertion pins the home screen to
   `lifetimeCells(explored.set)`.
9. Over the 150k perf disc (year five at res 11 — 02 §2's 20–50k res-10 cells × ~6 for res 11), the
   walk takes ~0.5 s in total; p95 slice < 16.7 ms. Measured before slicing: 215 ms area + 254 ms
   frontier, unsliced — which is why it is sliced.

Decisions made, and why:
- **`cartographyXp` is Σ per-row rounded XP, not `round(credits × rate)`.** The ticket's formula would
  give 381 for Example A; `04` §8.2 says 380 "rounded per ledger row" (I-19, D-256) and the ledger
  holds 318 + 62. The feed may not disagree with the ledger, so the doc wins over the ticket's sketch.
- **Per-run counts are read off the activity row (T3), which is "the ledger entry written at
  projection time" of §8.2/§3.2** — the award columns `persist.ts` stores and says must never be
  recomputed. Not T4's XP rows: those carry no cooled or deferred count.
- **The heavy totals are lazy.** Nothing calls `lifetimeTerritory` on render; the plinth reads only
  `lifetimeCells`, O(1). The frontier scan stays where it is (beat 5, once per run, bounded radius).
- **Existing per-run surfaces are not rewired.** The tally footer, `chronicleFor` and the plinth's
  last-run line already read the same stored columns `runTerritory` reads; rewriting them through the
  feed would change nothing a test or a person could see, and two of them sit in `0088`'s path this
  wave. A screen that needs credits, XP, or the familiar count reads `runTerritory`.
- **No period aggregates.** Nothing in the module takes a date or a range.

**Not built — open question for the orchestrator (D-152):** §8.3's *Explorer since*
(`min(firstRunAt)`), *Cells re-armed lifetime* (`Σ discoveryCount − 1`), *Most-run ground*
(`max(visitCount)`) and *Total distance / runs*. The browser holds only the cell ids (`LSFG`) and,
optionally, last-run days (`LSFL`); `firstRunAt`, `discoveryCount` and `visitCount` live only in the
server's cell table, and the run ledger is only paged 50 at a time to the client. §8 says these run
"client-side against the in-memory set … no new endpoints", which they cannot. No screen consumes
any of them yet (the plinth shows cells only; `0088` has no totals criterion). Options: (a) defer
them to a ticket opened when a screen needs them; (b) a server-side aggregate on the Chronicle's
SSR read; (c) a new small payload beside the blob.

Verification: all amplify.yml build-phase guards, `npm run typecheck`, `npm run lint`,
`npx vitest run` (196 files, 3491 passed), `npm run build`, and the post-build bundle-leak and
home-not-in-client guards — all green in the worktree.

**Decisions recorded at merge (orchestrator):** D-327 (`cartographyXp` sums the rounded ledger rows) and D-328 (the per-run feed reads T3's award columns). Open question 1 was settled by the operator as D-329: the four unbuilt §8.3 stats wait for a consuming screen, as `0275`. Questions 2 and 3: the Chronicle carries no totals (D-329), and the existing readers stay unrewired.
