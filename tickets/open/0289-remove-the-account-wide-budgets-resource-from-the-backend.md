---
id: 289
slug: remove-the-account-wide-budgets-resource-from-the-backend
title: Remove the account-wide Budgets resource from the backend
type: chore
priority: low
status: open
size: s
capability: 14-webhook-and-automatic-sync
depends_on: []
blocked_by: []
source: agent
created: 2026-10-19T03:32:39Z
---

## Description

D-361 (operator, 2026-10-18) takes AWS cost alerting off this project. The account is shared with
the operator's other apps, so 0093's account-wide `CfnBudget` "Lost Soles monthly cost" ($10/$25,
email) measures those apps, not Lost Soles. It was already in ALARM when it deployed. The operator
manages the account's cost separately, so a project-owned budget only duplicates that.

Remove the `CfnBudget` (`amplify/backend.ts`, `MonthlyCostBudget`, and its `aws-budgets` import),
and the synth test that pins it (`amplify/ingest-webhook-stack.test.ts`, the budgets assertion).
Deploying the change deletes the budget.

## Acceptance criteria

- [ ] No `AWS::Budgets::Budget` resource is synthesized by any stack, asserted by a synth test
      (the existing assertion inverted to expect none).
- [ ] The `aws-budgets` import and the comment block above `MonthlyCostBudget` are gone from
      `amplify/backend.ts`.
- [ ] After deploy, `aws budgets describe-budgets --account-id 286588821906 --profile devault`
      no longer lists "Lost Soles monthly cost".

## Notes

Filed at 0093's close. The design docs were already amended under D-361 (`08` §4.4 item 7, the
incident-response Detect lines, the not-doing table; `01` §4's alarm line). The cost-DoS bound is
the webhook's reserved concurrency (0093), which stays.

## Operator validation

None expected. Smoke test: `describe-budgets` after deploy, as in the last criterion.
