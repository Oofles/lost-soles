---
id: 242
slug: xpledgerentry-byskill-gsi3-cannot-be-queried-through-appsync
title: XpLedgerEntry bySkill (GSI3) cannot be queried through AppSync — its INCLUDE projection lacks owner
type: bug
priority: high
status: closed
size: s
capability: 11-skills-panel
depends_on: []
blocked_by: []
source: agent
created: 2026-10-06T19:45:30Z
started: 2026-10-07T19:20:00Z
closed: 2026-10-07T19:48:18Z
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

- [x] `bySkill` can be queried through AppSync by its owner. Either add `owner` to the INCLUDE
      projection, or project ALL if the cost is negligible at this table's size. The choice and
      its reasoning go in `## Resolution`.
- [x] The deploy plan accounts for DynamoDB's rule that a GSI's projection cannot be changed in
      place: the index is dropped and recreated, and CloudFormation allows one GSI create or
      delete per update. State whether that is two deploys, and what reads `bySkill` while the
      index is gone (today, nothing).
- [x] A smoke test against the deployed stack seeds rows for a throwaway user and reads them
      back through `listXpLedgerEntryByUserIdSkillIdAndAwardedAt`, then deletes the user and
      the rows.
- [x] `02-data-model.md` T4's GSI3 row states the projection that actually ships.

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

## Resolution

**`bySkill` now projects ALL** (`amplify/data/resource.ts`), not INCLUDE + `owner`. Adding
`owner` alone would not have been enough. The Amplify client's default selection set asks for
every field of the model, including required ones the index would not carry (`reason`,
`activityId`, `units`, `seq`…). Those come back null and error unless every caller hand-writes a
narrow selection set. 0074's RECENT list needs `reason` and `activityId` anyway. The cost: the
table is 78 rows and about 55 KB, at roughly 0.7 KB a row. ALL roughly doubles that, which is
nothing on on-demand billing. AP-9's estimate goes from "1–13 RRU" to "~5–45 RRU" for 50–500
rows, still well under a cent a month.

**Deploy plan, as it actually went: one deploy.** The table is `Custom::AmplifyDynamoDBTable`,
confirmed in the stack before pushing. That is Amplify's table-manager custom resource, not a
plain `AWS::DynamoDB::Table`. It applies index changes itself, one `UpdateTable` at a time
(delete the old `bySkill`, then create and backfill the new one), inside a single
CloudFormation update. So CloudFormation's one-GSI-change-per-update limit never applied. Amplify
job 325 ran 15:25–15:46 (21 min) and succeeded. Nothing read `bySkill` while it was gone: no
shipped code queries it.

**Files touched:**
- `amplify/data/resource.ts`: the projection, plus a comment saying why it is not INCLUDE.
- `amplify/xp-ledger-tables.test.ts`: the synthesised-template assertion now expects ALL.
- `docs/02-data-model.md`: T4's GSI3 row and AP-9's cost.
- `lib/skills/transport.ts`: the comment said `bySkill` was unqueryable. It now says the real
  reason NEXT reads GSI2 instead: NEXT wants sessions across all skills, and GSI3 holds one.

No new `D-xxx`: this fixes the projection to match an access path already decided (AP-9), and
D-xxx at DECISIONS.md:4294, which records the bug, stays true as history.

**What went wrong:** the first post-deploy smoke run reported one FAIL, and the script was
wrong, not the stack. AppSync returns `owner` as the bare Cognito `sub`, not the stored
`sub::username`, so the script's equality check could never match. The rows themselves were
right. Before the fix, the "fields RECENT needs" check also passed on an empty list, because
`[].every` is true. Both are fixed in the script, and the run below is after the fix.

## Operator validation

None needed from the operator: invisible infrastructure. Agent smoke test, 2026-10-07,
`devault`, live stack:

- **Before the deploy,** `tmp/0242/smoke.ts` (gitignored) reproduced the bug through the
  generated `listXpLedgerEntryByUserIdSkillIdAndAwardedAt`: `DynamoDB:DynamoDbException …
  Secondary index bySkill does not project one or more filter attributes: [owner, owner, owner]`.
- **After the deploy** (job 325 `SUCCEED`), `describe-table` shows `bySkill` as `ACTIVE`,
  projection `ALL`.
- **The same script, as a throwaway Cognito user, passed every check.** It seeded 2 Wayfaring
  rows, 1 Might row, and 1 Wayfaring row under a *different* owner in the same partition key:
  - the query returns no GraphQL error;
  - it returns exactly the user's 2 Wayfaring rows, without the other skill's row or the
    other owner's row;
  - the rows come back in `awardedAt` order, newest last;
  - `reason`, `activityId`, `xpAwarded` and `xpRulesVersion` are all present.
  
  The seeded rows and the user were deleted, and a check confirmed neither remains.
- **The backfill covered the operator's real rows.** A direct `Query` on `bySkill` returns
  Wayfaring 33, Cartography 21, Constitution 19 and Might 1, matching the base table's per-skill
  ledger counts. (`describe-table`'s index `ItemCount` still said 0, because DynamoDB refreshes
  it roughly every 6 hours. It is not evidence either way.)
