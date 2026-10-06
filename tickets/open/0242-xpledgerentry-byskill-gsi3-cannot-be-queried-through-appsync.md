---
id: 242
slug: xpledgerentry-byskill-gsi3-cannot-be-queried-through-appsync
title: XpLedgerEntry bySkill (GSI3) cannot be queried through AppSync — its INCLUDE projection lacks owner
type: bug
priority: high
status: open
size: s
capability: 11-skills-panel
depends_on: []
blocked_by: []
source: agent
created: 2026-10-06T19:45:30Z
---

## Description

`XpLedgerEntry`'s `bySkill` index (GSI3, `amplify/data/resource.ts`, ticket `0062`) projects
`INCLUDE [xpAwarded, xpRulesVersion]`. AppSync's owner rule (`allow.owner().to(["read"])`)
filters every list query on the `owner` attribute, and **DynamoDB refuses a filter on an
attribute the index does not project.** So every `bySkill` query from the browser fails. It does
not return an empty list; it fails outright.

The schema comment says `bySkill` exists for "the skill sheet's `RECENT` list" (`0074`, `06`
§5.5). As shipped, `0074` cannot use it.

Found by `0073`'s smoke test (`tmp/0073/smoke.ts`, 2026-10-06), which seeded ledger rows for a
throwaway Cognito user and queried them through the shipped transport. `0073` worked around it
by reading `byUserAndSeq` (GSI2, `ALL` projection), which was the right read for the NEXT line
anyway. That workaround does not suit `0074`: a skill trained rarely is buried under every other
skill's rows in GSI2.

## Acceptance criteria

- [ ] `bySkill` can be queried through AppSync by its owner. Either add `owner` to the INCLUDE
      projection, or project ALL if the cost is negligible at this table's size. The choice and
      its reasoning go in `## Resolution`.
- [ ] The deploy plan accounts for DynamoDB's rule that a GSI's projection cannot be changed in
      place: the index is dropped and recreated, and CloudFormation allows one GSI create or
      delete per update. State whether that is two deploys, and what reads `bySkill` while the
      index is gone (today, nothing).
- [ ] A smoke test against the deployed stack seeds rows for a throwaway user and reads them
      back through `listXpLedgerEntryByUserIdSkillIdAndAwardedAt`, then deletes the user and
      the rows.
- [ ] `02-data-model.md` T4's GSI3 row states the projection that actually ships.

## Steps to reproduce

1. Sign in as any user who owns `XpLedgerEntry` rows.
2. Call `client.models.XpLedgerEntry.listXpLedgerEntryByUserIdSkillIdAndAwardedAt({ userIdSkillId })`.

## Expected vs actual

**Expected:** that user's rows for that skill, newest last.

**Actual:** `Secondary index bySkill does not project one or more filter attributes: [owner]`
(a DynamoDB 400, surfaced as a GraphQL error).

## Notes

This should land before `0074`, whose `RECENT` list is the index's stated purpose. It does not
block anything already built: no shipped code reads `bySkill`.

## Operator validation

None needed. This is invisible infrastructure. The smoke test above is the evidence.
