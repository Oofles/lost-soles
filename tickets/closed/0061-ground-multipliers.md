---
id: 61
slug: ground-multipliers
title: Ground multipliers — new, re-armed and recent ground (D-120)
type: feature
priority: high
status: closed
size: m
capability: 09-xp-engine-and-ledger
depends_on: [48, 60]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
started: 2026-09-29T01:25:10Z
closed: 2026-09-29T01:29:18Z
---

## Description

Weight a trace-measured activity's units by the state of the ground it covered, per **D-120**
and **D-021**. Three states, per H3 res-10 cell (D-115), classified against the cell's
`lastRunAt`:

| Ground state | Activity XP | Discovery credit | `lastRunAt` |
|---|---|---|---|
| **new** — never seen | 100% | full (owned by `07-fog-projection-and-cells`) | set |
| **re-armed** — last run **> 6 months** ago | **50%** | **50%** | bumped |
| **recent** — last run **≤ 6 months** ago | **50%** | **zero** | bumped |

The multipliers come from the skill row's `groundMultipliers: {new, rearmed, recent}` — they
are **not constants in the scorer**. `groundMultipliers: null` is a documented third state
meaning *this skill is not ground-scored at all* (Vigil), which is distinct from `{1,1,1}`;
a null-ground skill emits a single `distance` row and never a ground row.

Activity XP and discovery credit are **asymmetric on purpose** and must not be conflated.
Re-armed ground pays half activity XP *and* half discovery; recent ground pays half activity
XP *and nothing at all* for discovery — so there is no zero-XP Cartography row, which would
inflate the ledger by roughly 40% for no information (`02-data-model.md` §4.2).

The split is computed per cell over the trace's per-cell segments, then summed into three
`unitsEffective` buckets which become up to three ledger rows with `reason` values
`new_ground`, `rearmed_ground`, `recent_ground`.

## Acceptance criteria

- [x] Distance over cells absent from the explored set is rated at the row's
      `groundMultipliers.new`.
- [x] Distance over cells whose `lastRunAt` is more than 6 months before the activity's
      `startedAt` is rated at `groundMultipliers.rearmed`, and `lastRunAt` is bumped.
- [x] Distance over cells whose `lastRunAt` is 6 months or less before `startedAt` is rated at
      `groundMultipliers.recent`, and `lastRunAt` is bumped.
- [x] The 6-month comparison uses the **activity's own `startedAt`**, never wall-clock `now`,
      so the classification is identical on replay (`04-game-design.md` §7.4).
- [x] A skill with `groundMultipliers: null` is never ground-classified; it emits one row with
      `reason: distance` at full rate.
- [x] An activity crossing all three ground states produces the correct blended total, and
      `Σ unitsEffective` over the three buckets is consistent with the raw `units`.
- [x] Rounding to integer XP happens **once**, at ledger write time, not per segment (I-19).
- [x] Unit tests cover: all-new, all-recent, all-re-armed, all three mixed in one trace, a
      zero-distance trace, and a traceless activity.
- [x] No multiplier literal (`0.5`, `1.0`) appears in the scorer for ground purposes; every
      one is read from the registry row.
- [x] This ticket makes **no** change to Cartography discovery credit, which is awarded by the
      fog subsystem (`05-fog-of-war.md` §8.2) and propagated by 0064.

## Notes

**Cross-capability dependency added during backlog validation (2026-08-30):** 0048 provides the new / re-armed / cooled classification the D-120 multipliers rate.


The ground classification on the ingest path may read `ExploredCell` (T6) as a cache. The
**replay** path must not: `02-data-model.md` §4.4 step 3b reconstructs `firstRunAt`/`lastRunAt`
by folding `cells/<uid>/<activityId>.cells.bin` in `startedAt` order, because `ExploredCell` is
itself a projection of that fold. Share the classifier function between both paths and inject
the ground-state lookup, so replay cannot silently drift from ingest.

D-120 is FINAL: the map never re-fogs. Half XP is not a punishment for repeating a route — it
is what keeps a familiar loop worth running (`06-ui-ux.md` §3.5).

## Operator validation

> **D-181 — most of what follows is the AGENT's to run, not the operator's.**
> Swept 2026-09-02 (ticket `0147`). This ticket's capability has no screen of its own. Before asking
> the operator for any step below, check whether AWS credentials (`AWS_PROFILE=devault`), `curl`, or
> a script can answer it — if so it is a **smoke test**, and what it proved is recorded here at
> close *instead of* the instruction. Keep only what genuinely needs a human eye, a phone, or a real
> run. The text below is the original author's intent, kept as context for **what** to verify — not
> as a list of chores for the operator.

On the **`/run/:activityId` post-run tally** in the desktop browser: import a replayed or synthetic activity over the canal
loop you have already covered this month (manual adapter or through the queue, D-229), and read the tally rows. Wayfaring must show a
**half-XP** line attributed to explored ground, and there must be **no** Cartography row at
all — not a Cartography row reading `+0`. Then import a replayed or synthetic activity over a route you last covered over a year ago (D-229):
the tally must show half activity XP *and* a Cartography row at half credit.

## Resolution

**Files added**

- `src/scoring/ground.ts`: `groundSplit(segments, lookup)` walks the segments (`04` §8.1 steps
  5–6) and returns metres per ground state. `rateGround(scored, multipliers, split)` and
  `scoreGround(scored, registry, split)` turn `0060`'s `SkillUnits` into
  `{skillId, reason, units, unitsEffective}` rows. `lookupFromClassified(classified)` is the
  ingest path's lookup.
- `src/scoring/ground.test.ts`: 23 tests. Exported from `src/scoring/index.ts`.

**How it works.** A segment is each consecutive pair of points in `traceToSegments`'s output,
which is the same path the fog measured its cells against. The segment's midpoint cell is
classified, and its length goes into that cell's class. Classification is `classifyCells` from
`0048`, unchanged. The new function takes it through an injected `GroundLookup`, so the replay
path can supply fold state instead of `ExploredCell` (this ticket's Notes). The multipliers are
read only from the row's `groundMultipliers`. `null` returns a single `distance` row.

**Decisions (operator-approved at the start, 2026-09-28)**

- **`deferred` cells are rated as `recent`**, the lowest rate. XP never decreases (D-135), so the
  replay that resolves them can only add.
- **The activity's own `units` is split across the classes by segment-distance share.** The
  filtered path is not `distanceM`; the smoke test below shows it running up to 1% long. The last
  non-empty bucket takes the remainder, so the buckets add up to the raw `units` exactly, not just
  within 1e-15. The §8.2 example needs this too: its buckets sum to the Strava distance.
- **A ground-scored skill with no path left after filtering** gets one `recent_ground` row. This
  follows `05` §3.6's known-ground default for `newShare = 0`. It is also the lowest rate, so a
  correction can only add.
- **Empty buckets are dropped**, for the same reason `0060` drops zero-unit skills.
- **Not wired into `process-activity.ts`.** Nothing consumes the rows until `0062` has a ledger to
  write them to. `0062` owns the call site and the single floor (I-19). Nothing here rounds.

**"`lastRunAt` is bumped" (criteria 2–3) was already true, and I did not duplicate it.** Every
revealed cell goes through `0047`/`0048`'s `writeCells`, which max-writes `lastRunAt`
(`explored-cells.ts`, tested there). A second write path in the scorer would be the two-owners
drift D-193 names.

**The ticket text is stale on resolution.** It says H3 res-10 (D-115). The grid is res 11 since
D-237 (`0194`), and this module uses `fog.ts`'s `RES`. There is no new decision; D-237 already
records it.

**Midpoint-cell invariant.** `groundSplit` throws if a midpoint cell has no verdict. That cannot
happen with a matching lookup, because the midpoint lies on the path, a res-11 cell's circumradius
is about 25 m, and every cell within `REVEAL_R_M` (65 m) is revealed. So reaching the throw means
the lookup was built from a different trace, and scoring against the wrong map would be permanent.

**Proving the guards can fail.** Everything passed after one test-harness fix (a wrong
`runWithPurityTraps` arity in the test itself). Then I sabotaged `ground.ts` in three ways:
mapped `deferred` to `rearmed`, hard-coded the `1.0`/`0.5` literals in place of the row, and
added a `Date.now()`. Four tests went red: the purity test, the row-rates test, the deferred
test and the no-literal test. Then I restored it.

**Gate:** `tsc --noEmit` clean · `eslint --max-warnings 0` clean · `check-boundaries.mjs` exit 0
· `npm test` 120 files, 2216 passed, 1 skipped.

## Operator validation

**Smoke test (agent, 2026-09-28): real archived data through the real code path.** I pulled all
17 raw Strava archives from the user-data bucket's `raw/` prefix. Each went through
`normalizeStrava` → `traceToCells` → `classifyCells`, in `startedAt` order, against an in-memory
record map (the replay fold in miniature), then through `groundSplit` → `scoreUnits` →
`scoreGround` on the v1 registry. Results:

- **All three states appear in real data.** The 2026-09-23 run: new 0.22 / rearmed 1.69 / recent
  1.97 km. The first 2026 run: new 1.38 + rearmed 1.00 km, re-armed against the 2025-08-04 run.
  The repeat loops on 2026-09-01, 09-03, 09-06, 09-07 and 09-10 are **100% `recent_ground`** at
  half rate. That matches the canal-loop scenario this ticket describes.
- **`Σ units` equals the activity's distance on every one of the 17**, to 4 dp. The filtered
  path ran between −0.3% and +0.9% of Strava's `distanceM`, which is why the split is apportioned
  rather than taken raw.
- No throws: every segment midpoint cell had a verdict, across all 17 real traces.

**Perceptual check: handed to `0081`.** The ticket's check reads the rows on the
`/run/:activityId` tally, and that beat is `0081`, not built yet. Nothing writes these rows until
`0062`. I added the scenario, with the archived runs that exercise it, to `0081`'s `## Notes`
rather than asking for it on a screen that does not exist.
