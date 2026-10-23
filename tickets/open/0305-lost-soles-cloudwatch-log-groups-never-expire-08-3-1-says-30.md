---
id: 305
slug: lost-soles-cloudwatch-log-groups-never-expire-08-3-1-says-30
title: Lost Soles CloudWatch log groups never expire; 08 §3.1 says 30 days
type: bug
priority: high
status: open
size: s
capability: 18-mvp-hardening
depends_on: []
blocked_by: []
source: agent
created: 2026-10-22T19:51:44Z
started: 2026-10-23T02:20:14Z
---

## Description

All 14 Lost Soles Lambda log groups and `/aws/amplify/d14fhvl4rp79nn` have no retention, so they never expire. `08-security-privacy.md` §3.1 says logs are kept 30 days, and the account-deletion runbook's step 7 ("lines expire under the 30-day retention") relies on that, so it is false until this is fixed. Found by the 0115 agent, wave 18.1.

## Steps to reproduce

1. `aws logs describe-log-groups --profile devault --query 'logGroups[].[logGroupName,retentionInDays]'`.
2. Read the rows for Lost Soles' functions and the Amplify app.

## Expected vs actual

**Expected:** every Lost Soles log group has `retentionInDays: 30`.
**Actual:** `retentionInDays` is absent (never expire) on all 15.

## Acceptance criteria

- [x] Every Lost Soles Lambda log group is created by IaC with 30-day retention, so a new function inherits it. *(Via a `LogRetention` custom resource per function, which creates the group if it is missing and sets retention on it if it exists, rather than a CloudFormation-owned `LogGroup`: see Resolution. The CDK provider Lambda that applies it keeps its own group at 1 day, by CDK design.)*
- [x] The Amplify app log group is set to 30 days (in IaC if reachable, else recorded as a one-off with the command). *(In IaC: a `LogRetention` on `/aws/amplify/d14fhvl4rp79nn`, branch deploys only.)*
- [x] A synth test fails on a Lost Soles function without 30-day retention.
- [ ] The live read shows 30 on all of them after deploy. *(Post-deploy; the orchestrator's read. One orphaned group, `...CustomS3AutoDeleteObject-t69xFGfsdOn4`, belongs to no current function, so IaC cannot reach it and it needs a one-off `put-retention-policy`.)*

## Notes

Check how Amplify Gen 2 functions create their log groups before choosing between `logRetention` and an explicit `LogGroup`; switching ownership of an existing group can fail a deploy with `AlreadyExists`.

## Operator validation

Smoke test: the describe-log-groups read above, all 30. No perceptual check.

D-123 trigger checked? none.

## Resolution

**Files touched**

- `amplify/log-retention.ts` (new): `applyLogRetention(root)`. A CDK Aspect that, for every
  `AWS::Lambda::Function` in every stack of the backend (framework Lambdas included), adds a
  `LogRetention` custom resource setting `/aws/lambda/<Ref>` to 30 days; plus, on a branch deploy
  (`amplify-backend-type` context = `branch`), a `LogRetention` on `/aws/amplify/d14fhvl4rp79nn`.
- `amplify/backend.ts`: imports it and calls `applyLogRetention(backend.stack)` at the bottom.
- `amplify/log-retention.test.ts` (new): synthesizes the backend and asserts, across all 18
  stacks, that every function except the CDK provider has a 30-day `Custom::LogRetention` naming
  its default group; that no function sets `LoggingConfig.LogGroup`; that the hosting group is
  covered once at 30; that no retention resource is `destroy`; and, against a probe stack, that a
  bare function fails the check and passes once `applyLogRetention` is applied.
- `docs/08-security-privacy.md` §3.1: the "not true as built" note now records the fix.
- `docs/01-architecture.md` §2: the escape-hatch count is six; the note below the grants says what
  the sixth is and why not `defineFunction`'s `logging.retention`.

**Why `LogRetention`, not an explicit `LogGroup` or Amplify's `logging.retention`.** All 14 live
groups were created by Lambda on first invoke and are owned by no stack. A CloudFormation
`LogGroup` named `/aws/lambda/<fn>` would fail the deploy with `AlreadyExists` (the ticket's
warning). Amplify Gen 2's `defineFunction({ logging: { retention } })` avoids that by creating a
NEW group with a generated name and repointing the function's `LoggingConfig` — which strands the
existing groups and their contents un-expiring, silently detaches the webhook-flood metric filter
in `backend.ts` (it reads `/aws/lambda/<fn>` by name), and covers only the 7 `defineFunction`s, not
the 7 framework Lambdas (branch linker ×2, table manager ×2, S3 auto-delete ×2, bucket deployment).
`LogRetention` calls `CreateLogGroup` (ignoring `ResourceAlreadyExists`) then
`PutRetentionPolicy` by name: no ownership change, no rename, no deploy-time conflict, and its
default `RETAIN` means a stack teardown never deletes a group.

**Why an Aspect.** It reaches functions that constructs bring in without being asked, and any
function added later inherits it. Coverage at synth: root (branch linker ×2 + hosting group),
`data` (log-workout, set-activity-kind, S3 auto-delete, bucket deployment), the table manager stack
(×2), `function` (the 5 others, secret-smoke-test included), `BasemapTiles` (S3 auto-delete).

**Cost of it.** One CDK `LogRetention` provider Lambda per stack that holds a function (5). Each
sets its own group to 1 day on create. That is stricter than §6.1's 30 days, and giving it a 30-day
`LogRetention` too would race the handler, so the test exempts it by its fixed construct id.

**Out of IaC's reach.** `/aws/lambda/amplify-d14fhvl4rp79nn-ma-CustomS3AutoDeleteObject-t69xFGfsdOn4`
belongs to no current function (an earlier deploy's provider), so it needs a one-off
`put-retention-policy`. The other Amplify app groups in the account (`/aws/amplify/d1at27…` etc.)
and the `amplify-lostsoles-root-sandbox` groups are not this app's branch deploy and are untouched.

**Decisions.** None recorded here (agent rule); proposed to the orchestrator (recorded at merge as D-440): the approach above,
and that the escape-hatch list in `01` §2 grows to six.
