---
id: 236
slug: cartography-rate-not-retuned-for-res-11
title: Cartography pays ~7x its intended rate at res 11 — measure live cells/km and ship xp-rules-v2
type: bug
priority: high
status: open
size: m
capability: 09-xp-engine-and-ledger
depends_on: []
blocked_by: []
source: agent
created: 2026-10-02T15:19:39Z
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

- [ ] Real new-cell density (cells per km of brand-new ground) measured from the operator's live
      runs (T3 `newCellCount` against trace distance, or per-run blobs), with the method and the
      figure recorded in `## Resolution`.
- [ ] `rules/xp-rules-v2.yaml` sets Cartography's `xpPerUnit` so new ground pays ≈100 XP/km at the
      measured density; every other row carried over unchanged; the unit comment says res 11.
- [ ] A new `D-xxx` records the rate and the measurement, superseding D-215's figure.
- [ ] 05 §8.2's worked example and its test are re-derived at res-11 density, not left on the
      res-10 synthetic counts.
- [ ] An XP replay to v2 runs against the live account. Cartography XP already awarded under v1
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

## Operator validation

TODO
