---
id: 300
slug: enable-pitr-on-the-owner-scoped-tables-or-record-that-it-sta
title: Enable PITR on the owner-scoped tables, or record that it stays off
type: chore
priority: low
status: open
size: s
capability: 16-rebuild-drill
depends_on: []
blocked_by: []
source: agent
created: 2026-10-20T17:50:34Z
---

## Description

Found by `0106` (D-404): DynamoDB point-in-time recovery is enabled on `LostSolesExploredCell`
only. The other eight tables — including `Activity`, `XpLedgerEntry` and `SkillState` — have it
off, while `02` §8.1 said "PITR on" and §8.2 leans on PITR's 35-day window as the backstop under
the D-135 waterline. A bug or a mistaken delete on those tables cannot be undone today except by a
full rebuild from `raw/`, and `SkillState`'s displayed values are only partly covered by the
D-259 snapshots.

Decide, then make the stack match the decision: either enable PITR in `amplify/backend.ts` on
every owner-scoped table (cost is pennies at this size), or keep it off and record why in a
`D-xxx`, amending `02` §8.1–§8.2 and `08` §6.4 to match.

## Acceptance criteria

- [ ] The operator has chosen: enable PITR on the owner-scoped tables, or leave it off.
- [ ] If enabled: the CDK stack sets it on every owner-scoped table, and a synth test fails if any
      owner-scoped table lacks it.
- [ ] If left off: a `D-xxx` records why, and `02` §8.1–§8.2 no longer claim otherwise.
- [ ] `08` §6.4's backup paragraph matches what is deployed.

## Notes

D-404 already corrected the docs to state the current truth; this ticket decides the policy.
The deletion confirmation (`0106`) reads PITR per table, so it stays truthful either way.

## Operator validation

Smoke test, agent's to run: `aws dynamodb describe-continuous-backups` for each table, compared
against the decision. No perceptual check.
