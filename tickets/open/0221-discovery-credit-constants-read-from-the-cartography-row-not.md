---
id: 221
slug: discovery-credit-constants-read-from-the-cartography-row-not
title: Discovery credit constants read from the Cartography row, not discovery.ts
type: chore
priority: low
status: open
size: s
capability: 09-xp-engine-and-ledger
depends_on: []
blocked_by: []
source: agent
created: 2026-09-29T03:12:47Z
started: 2026-10-02T01:35:51Z
---

## Description

Discovery credit now lives in two places. `0064` pays Cartography from the Cartography row's
`unitMultipliers` (`new: 1.0`, `rearmed: 0.5`) in `src/scoring/propagate.ts`. But
`src/domain/discovery.ts` still hardcodes `CREDIT_NEW = 1.0` / `CREDIT_REARM = 0.5`, and uses
them to compute `DiscoveryAward.discoveryCredits`. `fold.ts` sums that field.

`0064`'s Notes asked for one shared rate lookup so "the two stages cannot quote different numbers".
Today they agree only by coincidence. Change `rearmed: 0.5` in the YAML and the ledger follows,
while `discoveryCredits` and the fold keep the old figure.

## Acceptance criteria

- [x] Nothing outside the rules file states a per-class discovery credit. Either
      `discoveryCredits` is derived from the registry row, or it is removed and its readers
      (`fold.ts`) use the counts × the row's `unitMultipliers`.
- [x] A test changes `unitMultipliers.rearmed` in a cloned ruleset and shows both the ledger and
      whatever replaces `discoveryCredits` move together.
- [x] `src/domain` still imports nothing Strava-shaped (D-100). If the registry cannot be
      imported into `src/domain`, the credit calculation moves out of it rather than the rule
      being bent.

## Notes

Filed by `0064` (agent). Depends on `0064` having landed `scoreWithPropagation`. The script's
`create` did not take `--depends-on`, so it is recorded here.

Check first whether `discoveryCredits` is read anywhere a rules version is in scope. The fold
replays under the activity's `xpRulesVersion`, so the multiplier has to come from *that*
version's row, not from the current one.

## Resolution

**Removed, not derived** (the criterion's second option), recorded as **D-272**.

- **`src/domain/discovery.ts`**: deleted `CREDIT_NEW`/`CREDIT_REARM`/`CREDIT_COOLED`/
  `CREDIT_DEFERRED`, `creditOf`, and `DiscoveryAward.discoveryCredits`. `awardOf` and `NO_CELLS`
  now hold counts only. `awardsDiscovery` stays, because *which* classes earn credit is a domain
  question and *how much* is the row's.
- **`src/domain/fold.ts`**: `totalCredits` → `totalCounts`, which returns
  `{ newCellCount, rearmedCellCount }`. The fold cannot see the registry, and a folded history
  can span rule versions, so it is the caller's job to choose the row.
- **`src/scoring/propagate.ts`**: new `discoveryCredits(counts, row)`, which is
  `Σ unitsEffective` of `discoveryRows(counts, [row])`. It is the ledger's own derivation
  summed, so the two cannot disagree. `ledgerAward` no longer computes the field. Exported from
  `src/scoring/index.ts`.
- **`src/pipeline/persist.ts`**: `readStoredAward` no longer derives the field, and the
  "not a column" comment now points to the rules row.
- **Notes check ("is it read where a rules version is in scope?")**: nothing in production
  read `discoveryCredits` or `totalCredits`; only tests did. That is why I removed the field
  rather than threading a rules version into a value nobody consumes.
  `discoveryCredits`' doc comment says to pass the row from the activity's `xpRulesVersion`.
- **Tests**: `propagate.test.ts` gains a "discovery credit has one owner" block. A cloned
  ruleset sets `rearmed: 0.25`, and the ledger's Cartography `unitsEffective` and
  `discoveryCredits` both move to `10×new + 4×0.25`. A disabled row pays 0. A source scan fails
  if any non-test module under `src/` names `CREDIT_(NEW|REARM|COOLED|DEFERRED)`. I proved it
  bites by adding a probe file, seeing it fail, and removing the probe. About 20 assertions
  across `discovery`, `fold`, `process-activity`, `same-run-cases`, `xp-ledger` and
  `xp-replay-store` tests now assert counts. `discovery.test`'s float-accumulation test became an
  integer-count test: with no float sum on the award, the hazard it guarded is gone. Suite:
  2,529 pass. `tsc` is clean.
- **Design drift fixed in the same commit**: `05-fog-of-war.md` §3.1 drops the `CREDIT_*`
  definitions in favour of the row. The §3.2 pseudocode, §8.2's `run.*` block and §9.9's input
  list no longer name `discoveryCredits` as a stored input. Dated note added to open ticket
  `0090`, whose body still says `run.discoveryCredits = new + 0.5 × rearmed`.
- **D-100**: `src/domain` gained no import. The credit calculation moved out of it into
  `src/scoring`, as the third criterion asks.
- `npm run lint` reports 2 `no-explicit-any` errors, both in the untracked scratch file
  `tmp/0198/verify.ts`, which this ticket did not touch. They are not in `src/`.

## Operator validation

None needed. This is invisible refactoring, and the suite plus a cloned-ruleset test prove it.

**Smoke test, live T4 (read-only), 2026-10-01.** I scanned `XpLedgerEntry-…-NONE` (73 entries)
and grouped the `cells_new`/`cells_rearmed` rows by (activity, skill, `xpRulesVersion`). For each
group I computed `discoveryCredits(creditedCounts(rows), <that version's row>)` and compared it
with the rows' summed `unitsEffective`: **15/15 groups agree, 0 disagree.** So the new helper
reproduces what the deployed ledger actually paid. Nothing was written. No perceptual surface
exists to check: no column, API field or screen ever showed `discoveryCredits`.
