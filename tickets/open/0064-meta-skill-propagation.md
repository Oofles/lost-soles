---
id: 64
slug: meta-skill-propagation
title: Meta-skill propagation — Cartography and Constitution via feeds
type: feature
priority: high
status: open
size: m
capability: 09-xp-engine-and-ledger
depends_on: [48, 60, 61, 62]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
started: 2026-09-29T03:06:50Z
---

## Description

Meta skills are never selected by the matcher (`02-data-model.md` §3.4). They arrive by two
routes, both driven by data:

**Constitution — `feeds`.** Every activity skill row carries
`feeds: [{ skill: constitution, rate: 0.3333 }]`. After an activity skill's XP is rated, the
scorer walks `feeds` and emits one additional ledger row per entry with
`reason: constitution_share`. **The 1/3 is a row's attribute, not a constant in the scorer** —
that is the whole point (J4 in §3.1). Constitution is why a session that moves Might 1.8% of a
level still moves *something* visible.

**Cartography — discovery credit.** Awarded by the fog subsystem, not the activity matcher:
**13 XP per newly revealed H3 res-10 cell** (15 until D-215), at full credit for new ground and **50%** for
re-armed ground (last run > 6 months ago). **Recent ground earns zero, and emits no row at
all** — not a row of zero (D-120, §4.2). Rows carry `reason: cells_new` / `cells_rearmed`.

Rates for the record, all from the registry, none hardcoded: **100 XP/km · pushup 4 · situp 3 ·
plank 1.5/sec · new cell 13 · Constitution 1/3 of activity XP.**

Propagation is **one level deep and non-recursive**: a meta skill's own award never feeds
anything. `feeds` on a `kind: meta` row is a seed-time error, not a runtime loop.

## Acceptance criteria

- [x] After the activity skills are rated, the scorer emits one `constitution_share` row per feed
      **target** per activity, valued at `round(Σ feederXp × rate)`. *Amended 2026-09-28
      (D-255). This originally said "one row per `feeds` entry", which collides on T4's id.*
- [x] The 1/3 rate is read from `feeds[].rate` in the registry; no `0.3333`, `1/3` or
      `/ 3` literal appears in the scorer.
- [x] The share is computed from the **post-multiplier** activity XP, so a half-XP re-run feeds
      half the Constitution.
- [x] A strength session that trains Might and Fortitude produces **two** activity rows and
      **one** `constitution_share` row fed by both. *Amended 2026-09-28 (D-255). This originally
      asked for two share rows. The ledger id `activity#skill#reason#v` cannot hold two, and
      `04` §8.3 and `02` §4.2 already describe one.*
- [x] Cartography pays the Cartography row's `xpPerUnit` per new cell (13, D-215; this
      criterion said 15) and `xpPerUnit × unitMultipliers.rearmed`, rounded, per re-armed cell.
      Both numbers come from the row.
- [x] Recent ground produces **no** Cartography ledger row whatsoever; a test asserts the row
      count, not the XP value.
- [x] Propagation does not recurse: a fixture with `feeds` on a meta row fails at **seed time**
      with a named error, and the scorer contains no loop that could follow it.
- [x] No skill id appears in the propagation code path (I-25); `constitution` is reached only as
      the value of `feeds[].skill`.
- [x] Worked examples reproduce to the XP: `04` §8.2 (amended to `Math.round`, D-256: 578 / 384
      / 193) and §8.3 (300 / 270 / 270 / 280), plus the ticket's own example (8.85 km all-new →
      885 / 884 / 295; 30 pushups + 40 situps → 120 / 120 / 80). *Amended 2026-09-28. The ticket's
      example is not in §8.2 or §8.3, so all three are asserted.*

## Notes

**Cross-capability dependency added during backlog validation (2026-08-30):** 0048 provides the per-run new-cell counts Cartography propagates from.


Cartography's award is emitted by the fog stage (`05-fog-of-war.md` §8.2) because that is the
stage that knows the cell set; it is folded into the same `TransactWriteItems`. Keep the rate
lookup in the shared registry accessor so the two stages cannot quote different numbers.

The asymmetry between activity XP and discovery credit on recent ground is deliberate and is
restated in 0061 — repeated ground pays half activity XP *and nothing* for discovery. Do not
"tidy" it into a symmetric multiplier.

Constitution at 1/3 across five activity skills is what makes Total Level move on weeks when no
individual skill does. If it ever needs rebalancing, that is a YAML edit plus a replay (0066),
not a code change — which is the property this ticket is really protecting.

## Resolution

**Code commit `f1eabf4`.** Before starting, the operator approved three design corrections.
All three are recorded.

**Files**
- `src/scoring/propagate.ts` (new):
  - `discoveryRows(award, skills)` turns `newCellCount` / `rearmedCellCount` into `cells_new` /
    `cells_rearmed` rows. It finds the skill as whichever enabled row carries `unitMultipliers`,
    never by name.
  - `feedRows(rated, skills)` sums `xpAwarded × feeds[].rate` over the rated **activity** rows,
    per target.
  - `scoreWithPropagation(activityRows, award, ctx)` rates the activity rows, derives the meta
    rows, then rates the whole set in one `ledgerEntries` call so `seq` numbers all of it. The
    activity rows are rated twice; that is deterministic and cheap.
- `src/pipeline/process-activity.ts`: the ingest score now calls `scoreWithPropagation` with
  the same `award` the cells were classified into. The meta rows ride in the existing
  `persistWithLedger` transaction (`05` §8.2).
- `src/rules/validate.ts`: a new `META_FEEDS:` error for any non-empty `feeds` on a `kind: meta`
  row. The existing cycle check passed Cartography → Constitution because it is acyclic. That
  gap is what the criterion was really about.
- Tests:
  - `src/scoring/propagate.test.ts` (16): the share rate follows the data; the post-multiplier
    half; one share row for a two-skill session; a meta award never feeds; a meta row's feeds
    are not followed even when forced past the validator; recent-only emits 0 rows (count
    asserted); zero-multiplier and disabled skills emit nothing; a source scan for share
    literals and skill ids; and the three worked examples.
  - `validate.test.ts`: `META_FEEDS` via both `validateRuleSet` and `assertValidRuleSet`.
- Two `process-activity.test.ts` cases from `0062` hard-coded a single ledger row. They now
  expect Wayfaring + `cells_new` + `constitution_share` (traced) and `distance` + share
  (traceless).

**Decisions**
- **D-255 — one `constitution_share` row per activity, summed over its feeders.** Criterion 4
  asked for one row per feeding skill, but T4's id is `activity#skill#reason#v`, so the second
  row collides. `units` records the feeder XP that fed it (240 for 30 pushups + 40 situps).
  Criteria 1 and 4 were amended, and so was `02` §4.2's reason table.
- **D-256 — `Math.round`, not floor.** `04` §3.4, §8.1 and §8.2 floored each row; I-19 and the
  shipped `0062` round. The doc was amended: Example A is now 578 / 384 / 193 (was 576 / 383 /
  192). §8.3's parity line moves from "within 2%" to "within 3%" (1,155 vs 1,120). §8.3's parity
  table had also carried a stale `375` for Example A's Cartography; that is fixed too.
- The criteria's **15 XP/cell** was stale (13 since D-215). The code reads `xpPerUnit`, so
  only the text changed. The ticket's own worked example is not in `04`, so it is asserted
  alongside §8.2 and §8.3 rather than instead of them.
- `02` §3.8 check 2 now states the meta-feeds rule.

**What went wrong / left over**
- My first "half the share" test compared `round(fresh/2)` with `round(half)`: 84 vs 83. The
  test was wrong about double rounding, not the code; it now asserts both shares against the
  rate directly.
- `src/domain/discovery.ts` still hardcodes `CREDIT_NEW` / `CREDIT_REARM` for
  `discoveryCredits`, which `fold.ts` sums. The ticket's Notes wanted one rate lookup. Filed as
  **`0221`** rather than widening this ticket; it matters once the replay job (`0066`) reads
  credits.
- `tickets.mjs create` silently ignored `--depends-on 64`, so `0221` records the dependency in
  its Notes.

## Operator validation

**Nothing here needs the operator yet** (D-181/D-229). The screen the original text names,
`/run/:activityId`, is still a `Stub` (`app/run/[activityId]/page.tsx`), so there is no tally to
look at. Everything below was run by the agent on 2026-09-28 against account `286588821906`.

**Automated.**
- `npm run typecheck` and `npm run lint` are clean.
- All 125 test files pass (2,316 tests).
- `check-boundaries` and `check-skills` pass, and so does the decisions-register test.
- `tickets.mjs validate` reports 0 errors.

**Live smoke test: 12/12, on real DynamoDB.** The script drove the shipped path
(`scoreUnits → scoreGround → scoreWithPropagation → persistWithLedger`) into the deployed
`Activity-…`, `XpLedgerEntry-…`, `SkillState-…` and `LostSolesIngestReceipt` tables, as the
synthetic user `smoke-0064-<ts>`. Every row was deleted afterwards; 0 ledger and 0 SkillState
rows remained.

| # | What it proved |
|---|---|
| 1 | **`04` §8.2** (8.368 km; 25 new / 9 re-armed / 30 recent cells) wrote exactly six rows in §8.2's order: `wayfaring` 318 / 63 / 197, `cartography` `cells_new` 325 / `cells_rearmed` 59, `constitution_share` 193. The result was 1,155 XP, 6 rows. The 30 recent cells wrote no row. |
| 2 | A `/log`-shaped session (30 pushups + 40 situps) wrote `might` 120, `fortitude` 120 and **one** `constitution_share` of 80, with `units: 240` (D-255). |
| 3 | Re-delivering the run as all-recent wrote 0 rows (`alreadyScored`). D-254 holds with propagated rows. |
| 4 | SkillState per skill: wayfaring 578, cartography 384, constitution 273, might 120, fortitude 120. `xpLedgerSum == displayedXp` on each. I-15 holds: Σ ledger = 1,475 over 9 rows. |

**Deployed worker.** Amplify job 241 (commit `f1eabf4`) SUCCEEDED. The
`processactivitylambda` was redeployed at 03:16 UTC, and an invoke with `{"Records":[]}`
returned 200 with no `FunctionError`, so the module loads with the new scoring import.

**Not exercised: a real activity through the queue.** The reason is the same as `0062`'s: a
`reingest` of an archived run would reclassify as `recent` and write distorted permanent XP for
the real account (`0220`). The first real import after this deploy is the end-to-end check;
read the `xp` line in the worker's `process-activity` log (expect `rowsWritten` ≈ 5–6 for a run).

**★ Deferred perceptual check ★** — belongs to the ticket that builds the post-run tally
(capability 12). There, on the desktop browser: after a mostly-new run, Wayfaring, Cartography
and Constitution appear as separate lines, with Constitution about a third of Wayfaring. After
logging 30 pushups + 40 situps, **three** lines appear: Might, Fortitude, and one Constitution
(D-255 amended this from four).

> Original author's intent, kept as context: *the parchment ledger must list Wayfaring,
> Cartography and Constitution as separate rows … log 30 pushups and 40 situps … four rows.*
> Superseded in its count by D-255.
