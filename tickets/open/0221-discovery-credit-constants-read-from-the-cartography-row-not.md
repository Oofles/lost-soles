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

- [ ] Nothing outside the rules file states a per-class discovery credit. Either
      `discoveryCredits` is derived from the registry row, or it is removed and its readers
      (`fold.ts`) use the counts × the row's `unitMultipliers`.
- [ ] A test changes `unitMultipliers.rearmed` in a cloned ruleset and shows both the ledger and
      whatever replaces `discoveryCredits` move together.
- [ ] `src/domain` still imports nothing Strava-shaped (D-100). If the registry cannot be
      imported into `src/domain`, the credit calculation moves out of it rather than the rule
      being bent.

## Notes

Filed by `0064` (agent). Depends on `0064` having landed `scoreWithPropagation`. The script's
`create` did not take `--depends-on`, so it is recorded here.

Check first whether `discoveryCredits` is read anywhere a rules version is in scope. The fold
replays under the activity's `xpRulesVersion`, so the multiplier has to come from *that*
version's row, not from the current one.

## Operator validation

None needed. This is invisible refactoring, and the suite plus a cloned-ruleset test prove it.
