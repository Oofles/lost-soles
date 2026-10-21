---
id: 105
slug: execute-the-drill-for-real
title: EXECUTE THE DRILL FOR REAL, once, before MVP ship — four numbers pasted or it did not happen
type: chore
priority: high
status: open
size: m
capability: 16-rebuild-drill
depends_on: [103, 104]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
---

## Description

Run the full §8.3 drill **once, for real, against the live raw archive**, into a parallel stack,
with the cutover **not** performed.

**This is the ticket that turns D-101 from a claim into a measurement, and it is what proves the
D-121 Strava decision is reversible.** The entire justification for building MVP ingestion on an
API whose terms forbid retention, and whose athlete cap can revoke access without notice, is that
the raw archive can rebuild everything without that API. Until this run happens, that is an
argument. After it, it is a number.

**It is also the ticket most likely to be skipped**, because by the time Phase 3 arrives the app
works, CI is green, and the drill feels like ceremony (roadmap §4.3). It is not ceremony. CI
proves the code path works at 20 objects against fixtures the code's authors chose. This proves it
works at real volume against real objects written by the real adapter over months, including the
ones that were written before some refactor nobody remembers.

**Done-condition: a pasted result.** These four numbers go into
`docs/capabilities/16-rebuild-drill.md`, with the date and the commit sha of the drill run:

1. **Object count** under `raw/<uid>/` at drill start.
2. **`normalize()` failure count** (must be 0).
3. **Final `cellCount`** against `manifest.json`'s step-0 `cellCount`.
4. **Final Total XP** against the `snapshots/skillstate/` snapshot's total.

**If those four numbers are not in the capability doc, the drill did not happen.** A checked box,
a green CI run, a "ran it, looked fine" in a commit message, and a summary that says PASS without
the values are all explicitly insufficient — this ticket cannot be closed by assertion.

Constraints on the run itself:

- Into a **parallel CDK stack** with new empty tables. Cutover is **not** performed. Tear the
  stack down afterwards and record the teardown.
- The step-0 snapshot is written **before** the run and its path is recorded.
- Step 9 (reconnect sources) is **not** performed — there is nothing to reconnect, because the
  live stack was never touched.
- Record wall-clock and the actual AWS cost of the run against the §8.3 estimates (under 30
  minutes, roughly $0.50). If either is off by an order of magnitude, that is a finding worth
  writing down, not rounding away.

## Acceptance criteria

- [x] The drill has been executed against the live archive, into a parallel stack, and the stack
      has been torn down; the CloudFormation stack name and deletion time are recorded.
- [x] All six step-8 assertions passed; the assertion table as printed by the run is pasted into
      `docs/capabilities/16-rebuild-drill.md` verbatim.
- [x] The **four numbers** above are pasted into that doc with the run date and commit sha, and
      each is the value the run printed — not a value typed from memory.
- [x] `normalize()` failure count is **0**. Any non-zero count means investigating the specific
      key and re-running; it does not mean lowering the bar.
- [x] Final `cellCount` **equals** the step-0 `cellCount` (`fogAlgoVersion` unchanged). A `≥` is
      only acceptable with a recorded `fogAlgoVersion` change and its reason.
- [x] Every skill's rebuilt `displayedXp` ≥ the snapshot's, and the per-skill comparison table is
      pasted alongside the four numbers.
- [x] Measured wall-clock and cost are recorded next to the §8.3 estimates.
- [x] The live map was untouched: the live `manifest.json` `generation` is identical before and
      after, recorded as two values in the doc.

## Notes

Do this while there is no pressure. The same drill is scheduled again immediately before any D-121
migration, and that run will happen under pressure — the value of this one is that it finds the
surprises first.

If the run reveals raw objects the current adapters cannot normalize (an old adapter version's
output shape, an object written during a partial deploy), that is exactly the finding this ticket
exists to produce. File it as a new ticket against the adapter, fix it, re-run. Do not exclude the
object from the enumeration to make the numbers match — that converts a real gap into a clean
report, which is the specific failure this whole capability is designed to prevent.


**2026-10-21 (orchestrator, wave 16.3):** the drill target now has **six** table roles (D-418): the
parallel stack must include a `Landmark` table (`userId` + `skillLevel`), named as `landmark` in the
target JSON, or the drill refuses it. The rebuild also backfills landmarks at the end of step 6
(D-420) and tombstones retracted activities from `raw/…retracted.json` records (D-421, D-422).

## Operator validation

**Smoke test, orchestrator, 2026-10-21, laptop, `AWS_PROFILE=devault`.** There is no perceptual
check (D-229). The original text asked the operator to compare two figures by eye: the `/` map
against "as it was", and `/skills` Total XP against the pasted number. Both are queries, run below.

- **The map is untouched.** Live `users/<uid>/manifest.json` before and after the drill is
  byte-identical (`cmp`): `generation` 269, `cellCount` 5,211, ETag `861cb104…`, `LastModified`
  2026-10-18T13:23:30Z. `/` renders from that manifest (S-1), so it draws the same map.
- **Total XP agrees from both sources.** The live `SkillState` rows, which `/skills` reads (AP-2),
  sum to **70,994**. The target `SkillState` rebuilt from nothing but `raw/` sums to **70,994**.
  So does the snapshot. Every skill agrees, per skill, across all three (table in
  `docs/capabilities/16-rebuild-drill.md`).
- **The four numbers are in the doc, as printed by the run:** 123 objects · 0 normalize failures ·
  cellCount 5,211 == 5,211 · Total XP 70,994 vs 70,994. Run 2026-10-21, drill code at `dfb844a`.
- **Teardown verified:** `LostSolesRebuildDrill-20261021` is `DELETE_COMPLETE` (deleted
  20:21:00Z), `list-tables` shows no `LostSolesDrill-*` table, and the drill bucket's `HeadBucket`
  returns 404.

## Resolution

The drill ran once, for real, and every check passed on the first attempt: 123 raw objects, 0
normalize failures, 5,211 cells against step 0's 5,211, and Total XP 70,994 against the
snapshot's 70,994. The full record is in `docs/capabilities/16-rebuild-drill.md` under *The drill,
executed for real*: the four numbers, the step-8 output verbatim, the per-skill table, the live
manifest before and after, wall-clock and cost, and the teardown.

**Files**

- `tools/drill/target-stack.ts` (new). The parallel stack, as a CDK app:
  `npx tsx tools/drill/target-stack.ts <tag> <outDir>`. It writes a CloudFormation template and the
  drill's `target.json`. The six table roles mirror the live key schemas and GSIs, including
  `byUserAndDay`'s INCLUDE projection, read from `describe-table`. The stack also holds its own
  bucket. Everything is DESTROY. The template is deployed with `aws cloudformation deploy`. No CDK
  CLI is installed, and the template carries no assets, so `generateBootstrapVersionRule: false`
  and no bootstrap is needed. It is committed so the pre-D-121 re-run (§8.4) is one command, not a
  re-derivation.
- `docs/capabilities/16-rebuild-drill.md`. The result section.

**How it went**

- The `enumerate` phase (read-only) and a `--dry-run` of `rebuild` against the target came first.
  The dry run confirmed the target was accepted and that nothing was written. Then the stack was
  deployed (66 s) and the drill ran (64 s, exit 0). The rebuilt `SkillState` was read back, the
  live manifest was re-read, and the bucket was emptied (337 objects) and the stack deleted (32 s).
- The drill's own code is unchanged. It ran at `dfb844a`. Only the stack definition is new.
- **Wall-clock and cost are both more than 10× under §8.3's estimate** (64 s vs 30 min, about $0.01
  vs $0.50). This is written down, not rounded away. The cause is volume: §8.3 assumed five years
  of archive, 2,000–5,000 objects, while today there are 123. Taking all 64 s as scaling with cell
  count, 150k cells would land at about the 30-minute ceiling. That is plausible, but unproven at
  volume.
- The cost is an estimate from counted requests, not a billed figure. Cost Explorer lags by about a
  day, and the stack's tags (`purpose=rebuild-drill-0105`) are not activated for cost allocation.
  The doc says so.
- Two figures looked odd and were checked. **0 landmarks:** the live `Landmark` table holds 0
  items, so 0 is correct. **1 kind override applied of 5 objects:** all five are overrides of one
  activity, `strava/20076758956`, and only the newest applies.
- The bucket was emptied with `aws s3 rm`, outside `tools/drill/`. `check-drill-no-delete` forbids
  any delete in the drill's code, and the teardown is not the drill.

**Decisions:** none new. The stack-as-parameter split was settled by `0103` (D-405–D-413).

**Not done, by design:** no cutover, no step 9 (the live stack was never touched).
