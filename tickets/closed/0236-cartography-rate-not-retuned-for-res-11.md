---
id: 236
slug: cartography-rate-not-retuned-for-res-11
title: Cartography pays ~7x its intended rate at res 11 — measure live cells/km and ship xp-rules-v2
type: bug
priority: high
status: closed
size: m
capability: 09-xp-engine-and-ledger
depends_on: []
blocked_by: []
source: agent
created: 2026-10-02T15:19:39Z
started: 2026-10-02T16:42:38Z
closed: 2026-10-02T17:12:34Z
---

## Description

**Found by capability 09's drift audit (2026-10-02).** `rules/xp-rules-v1.yaml:286` pays
Cartography `xpPerUnit: 13` per new cell. D-215 tuned that against **H3 res-10** density —
7.67 cells/km × 13 ≈ 100 XP/km, parity with Wayfaring (04 §3.2). D-237 (ticket `0194`) then moved
the canonical resolution to **res 11**, about 7× the cells for the same ground, and said so
explicitly: *"XP-per-cell is a free parameter `09` has not yet set — 7× cells at ⅐ the rate"*.
Capability 09 never set it. The yaml comment at `:279` still says "H3 res-10 (D-115)".

`src/adapters/strava/fog-projection.test.ts:102` measures 312 cells for a 6.0 km run (≈52 cells/km),
so new ground pays ≈676 Cartography XP/km against Wayfaring's 100. Live state confirms it:
Cartography 14,807 XP / L22 against Wayfaring 4,661 / L15. This is exactly the "Cartography
quietly becomes the dominant skill" failure D-215's own comment warns about.

The §8.2 test passes only because it feeds synthetic res-10-shaped counts (25/9/30).

**Operator decision (2026-10-02, audit session):** measure the real density from live data first,
then set the rate — not the fixture figure.

## Acceptance criteria

- [x] Real new-cell density (cells per km of brand-new ground) measured from the operator's live
      runs (T3 `newCellCount` against trace distance, or per-run blobs), with the method and the
      figure recorded in `## Resolution`.
- [x] `rules/xp-rules-v2.yaml` sets Cartography's `xpPerUnit` so new ground pays ≈100 XP/km at the
      measured density; every other row carried over unchanged; the unit comment says res 11.
- [x] A new `D-xxx` records the rate and the measurement, superseding D-215's figure.
- [x] 05 §8.2's worked example and its test are re-derived at res-11 density, not left on the
      res-10 synthetic counts.
- [x] An XP replay to v2 runs against the live account. Cartography XP already awarded under v1
      stays as a `retained_floor` (D-135); the Resolution records before/after per skill.

## Steps to reproduce

1. Read the live T2 SkillState rows for the operator (or the `snapshots/skillstate/` blob).
2. Compare Cartography's `xp` with Wayfaring's: 14,807 against 4,661.
3. Compute `xpPerUnit × cells/km` at res 11: 13 × ≈52 ≈ 676 XP/km.

## Expected vs actual

- **Expected:** new ground pays Cartography ≈100 XP/km, parity with Wayfaring (04 §3.2, D-215).
- **Actual:** ≈676 XP/km, because the rate was tuned at res 10 and never retuned after D-237.

## Notes

Under D-135 the inflated XP is permanent as a floor: Cartography will not visibly move until
real v2 discovery passes the floor. That is accepted — XP never decreases — but say it in the
Resolution so nobody reads a flat Cartography bar as a bug.

## Resolution

**Measurement (criterion 1).** I scanned the live T4 ledger and, for each activity, summed the
non-floor Cartography `cells_new` units and the Wayfaring `new_ground` km. The same ingest writes
both, so their ratio is cells per km of *new* ground, which is what the parity claim is about.
Pooled over the 13 runs that have both: **1,134 cells / 24.404 km = 46.47 cells/km**. Per-run
values ranged from 26 to 67, which is why I pooled rather than averaged. The fixture's 52 cells/km
is a whole-run figure and includes ground that is not new, so I did not use it. The script was
`tmp/0236/measure.ts`; it is gitignored scratch because it was a one-off.

**Rate (criteria 2–3).** 100 / 46.47 = 2.152, so the rate is **2.15** (99.9 XP/km). Re-armed cells
pay 1.075 through the unchanged `unitMultipliers`. `rules/xp-rules-v2.yaml` differs from v1 only in
that field, the unit comment (res 11, D-237), `version`, `effectiveFrom` and the header comment.
v1 is left untouched because live ledger rows cite it. Its `.json` and `xp-rules.bundled.ts` were
regenerated with `scripts/build-rules-json.mjs`. **D-279** records the measurement and the rate,
and D-215 and D-130 now carry notes pointing to it.

**Docs and tests (criterion 4).** The ticket said "05 §8.2's worked example", but the worked
example (25 / 9 / 30) is actually in **04 §8.2**. 05 §8.2 only has the cell-size paragraph. I
updated both:
- 04 §8.2 is re-derived at each class's km × 46.47: 148 / 58 / 183 cells, giving Cartography
  318 + 62 = 380 (was 384). The result table, the "what the user sees" panel, the §4.2 tally
  mockup and the §8.3 cross-check moved with it. The cross-check is now 1,151 vs 1,120, a 2.8%
  gap, still inside the 3% target.
- The §4.2 mockup had already drifted (576 / 383 / 192 and 62 / 196). I brought it into line
  with §8.2 while I was there.
- 04 §3.2 table, §3.3 formula and amendment note, and the §1.3 schema excerpt now describe v2.
- 05 §8.2 now gives the res-11 cell size (≈2,150 m²) and the measured ~46 cells/km, replacing
  the res-10 figures.
- `src/scoring/propagate.test.ts` checks the §8.2 example under `loadRuleSet(2)`.
  `src/rules/doc-schema.test.ts` compares the §1.3 excerpt against v2. That was its first red
  run: the excerpt still said 13, so the drift gate did its job. The `0064` example (68 cells,
  v1) still runs under v1 because it is historical.
- Full suite: 136 files, 2,556 passed, 1 skipped. Lint is clean on the touched files.
  `build-rules-json --check` is clean. `tsc` errors only in the gitignored
  `tmp/0234`/`tmp/0235` scratch files from earlier sessions.

**Replay (criterion 5).** Sequence: commit `670bb71` was pushed, Amplify job 294 succeeded, so
the worker bundles v2, and then the replay ran. The order matters because a worker without v2
would refuse ingests for a user on v2. The auto-mode classifier blocked the first `--confirm`
attempt, and it ran once the operator said to go ahead. Run
`REPLAY#5488e4b8-…#0MUR7YHB5TX49JV`: 18 activities, 71 rows cleared and rewritten, T6 +0 cells,
generation 130, **1 floor written**, status DONE.

| Skill | Before (v1) | After (v2) |
|---|---|---|
| Cartography | 15,985 / L23 | **15,985 / L23**: 2,643 earned under v2 + **13,342 `retained_floor`** |
| Wayfaring | 4,675 / L15 | 4,675 / L15 (unchanged, as it should be) |
| Constitution | 1,557 / L11 | 1,557 / L11 (unchanged; Cartography never feeds it) |

**Cartography will sit flat for a while, and that is D-135 working, not a bug.** The 13,342 floor
is v1's overpayment. The bar will not move until real v2 discovery passes it. At ~100 XP per new
km, that means roughly 133 km of brand-new ground. 2,643 XP over the archive is about 6× less
than before, which matches the ≈6× correction (13 / 2.15 = 6.05).

## Operator validation

No perceptual check. The visible effect is that Cartography *doesn't* move, and no screen shows
XP until `0073`. The agent ran these smoke tests on 2026-10-02 (UTC), account 286588821906,
us-east-1, against live tables:

- **Deploy:** Amplify job 294 (commit `670bb71`, the commit that adds v2 to
  `xp-rules.bundled.ts`): SUCCEED.
- **Replay:** the dry run, then the `--confirm` run shown above, finished with status DONE and
  `floors: { cartography: 13342 }`.
- **T2 after:** three SkillState rows, all with `rulesVersionLastComputed: 2`. Cartography
  15,985 L23, Wayfaring 4,675 L15, Constitution 1,557 L11.
- **T4 after:** every ledger row cites `xpRulesVersion: 2`. Non-floor sums: Cartography 2,643,
  Wayfaring 4,675, Constitution 1,557, plus one Cartography floor of 13,342.
  2,643 + 13,342 = 15,985, the pre-replay waterline exactly.
- **T1 after:** `ledgerRulesVersion: 2`, `replayInProgress: false`, Total Level 55, 22,217 XP.
  `rulesForUser` therefore resolves the next real ingest to v2, which the deployed worker
  bundles.
