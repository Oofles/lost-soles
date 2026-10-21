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
started: 2026-10-21T03:32:09Z
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

- [x] The operator has chosen: enable PITR on the owner-scoped tables, or leave it off. — operator chose enable, 2026-10-20
- [x] If enabled: the CDK stack sets it on every owner-scoped table, and a synth test fails if any
      owner-scoped table lacks it.
- [ ] ~~If left off: a `D-xxx` records why, and `02` §8.1–§8.2 no longer claim otherwise.~~ n/a — the
      operator chose enable. `02` §8.1–§8.2 were amended to state the enabled state instead.
- [x] `08` §6.4's backup paragraph matches what is deployed.

## Notes

D-404 already corrected the docs to state the current truth; this ticket decides the policy.
The deletion confirmation (`0106`) reads PITR per table, so it stays truthful either way.

## Resolution

**Decision (operator, 2026-10-20): enable PITR on every owner-scoped table.** Supersedes D-404's
interim "off" state; D-404 stays as written. The orchestrator allocates the `D-xxx`.

**What "every owner-scoped table" means here.** Every `defineData` model is owner-scoped
(`allow.owner()` or `allow.owner().to(["read"])`), so the set is all model tables: `Activity`,
`Profile`, `SkillState`, `XpLedgerEntry`, `Landmark`, plus `DeploySmokeTest` (owner-scoped too,
costs nothing). T6 `ExploredCell` already had it. Deliberately **not** enabled:
- T7 `LostSolesSourceAccount` — `02` §1.1 says tokens are "not rebuildable, AND MUST NOT BE"
  backed up; the table's own comment in `backend.ts` argues it. The test now pins it off.
- `LostSolesOAuthState` (ten-minute nonces), `LostSolesIngestReceipt` (90-day TTL, an
  optimisation over permanent backstops), `LostSolesCaptureGuard` (not per-user data).
  These three are keyed by user in places but nothing in them is worth restoring.

Files touched:
- `amplify/backend.ts` — a loop over `backend.data.resources.cfnResources.amplifyDynamoDbTables`
  sets `pointInTimeRecoveryEnabled = true`. A loop rather than a list, so a model added later
  inherits it. The `ExploredCell` comment no longer says it is the only table with PITR.
- `amplify/pitr-tables.test.ts` (new) — synth test: every model table's
  `Custom::AmplifyDynamoDBTable` carries `pointInTimeRecoverySpecification:
  {pointInTimeRecoveryEnabled: true}`, the five named models still exist, T6 has it, T7 /
  OAuthState / IngestReceipt / CaptureGuard do not. Checked that it fails with the loop removed:
  Amplify's default is an `Fn::If ShouldUsePointInTimeRecovery` condition, not `true`, so the test
  cannot pass on the default.
- `docs/02-data-model.md` §8.1 (T2/T3/T4 and `Landmark` rows say PITR, with the start date
  caveat), §8.2 (the D-135 durability sentence: PITR covers T2/T4 from the `0300` deploy; before
  that, and beyond 35 days, the newest snapshot is the only backstop).
- `docs/08-security-privacy.md` §6.4 backups paragraph — names the tables with PITR and the
  tables without, and says the window opened at the `0300` deploy.

Not changed: `src/pipeline/skillstate-snapshot.ts`'s header (still accurate; `src/pipeline` is
`0103`'s in this wave). The account-deletion confirmation (`0106`) reads PITR per table at run
time, so it starts stating the 35-day caveat on these tables automatically.

**No backstop before the deploy.** PITR's earliest restorable time is when it was enabled, so a
bad write before the `0300` deploy cannot be restored from PITR. The docs say so.

## Operator validation

No perceptual check. Smoke test, after deploy, agent's to run:
`aws --profile devault --region us-east-1 dynamodb describe-continuous-backups --table-name <t>`
for each table. Expected `ENABLED` on the six `*-nog4xy2l7baqlhghpndh2565qe-NONE` model tables and
`LostSolesExploredCell`; `DISABLED` on `LostSolesSourceAccount`, `LostSolesOAuthState`,
`LostSolesIngestReceipt`, `LostSolesCaptureGuard`. Result: pending deploy (orchestrator).
