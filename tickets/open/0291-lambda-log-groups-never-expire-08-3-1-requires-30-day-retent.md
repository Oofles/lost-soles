---
id: 291
slug: lambda-log-groups-never-expire-08-3-1-requires-30-day-retent
title: Lambda log groups never expire; 08 §3.1 requires 30-day retention
type: bug
priority: med
status: open
size: s
capability: 14-webhook-and-automatic-sync
depends_on: []
blocked_by: []
source: agent
created: 2026-10-19T05:19:38Z
---

## Description

`08-security-privacy.md` §3.1 (and the §6 retention table) say CloudWatch log groups get a
**30-day retention**, because logs are where secrets and coordinates leak by accident and an
unbounded group is both a liability and a bill. No `defineFunction` and nothing in
`amplify/backend.ts` sets retention. Queried live on 2026-10-19, every
`/aws/lambda/amplify-d14fhvl4rp79nn-*` group has retention `None` (never expire). That includes
`ingest-webhook`, the one internet-facing surface (§4), plus `reconcile-sweep` and `token-refresh`,
all created in capability `14`, and also `process-activity`, `log-workout`, `set-activity-kind`
and Amplify's custom-resource Lambdas.

Found at capability `14`'s audit (AUDIT.md §2, code-was-wrong). The rule predates this capability,
but this capability cited §3.1 and added three of the groups.

## Steps to reproduce

1. `aws logs describe-log-groups --profile devault --region us-east-1 --log-group-name-prefix
   /aws/lambda/amplify-d14fhvl4rp79nn --query 'logGroups[].[logGroupName,retentionInDays]'`
2. Read the second column.

## Expected vs actual

**Expected:** `30` for every application function (`08` §3.1, §6).
**Actual:** `None` for all fourteen groups, which means they never expire (2026-10-19).

## Acceptance criteria

- [ ] Every application Lambda's log group (`ingest-webhook`, `process-activity`, `token-refresh`,
      `reconcile-sweep`, `log-workout`, `set-activity-kind`, and any other `defineFunction`)
      has a 30-day retention that the backend declares, so a fresh deploy gets it too. Setting it by
      hand alone does not satisfy this.
- [ ] The webhook flood alarm's `MetricFilter` (`amplify/backend.ts`, `WebhookOwnerFloodFilter`)
      still attaches to the same group. **Trap:** the groups already exist, so a CDK-owned `LogGroup`
      with the same name fails the deploy with "already exists". Prefer Amplify's
      `defineFunction({ logging: { retention } })` if the installed backend version supports it.
      Otherwise use a mechanism that adopts or updates the existing group, such as an
      `AwsCustomResource` calling `PutRetentionPolicy`, or `LogRetention`.
- [ ] A synth test asserts the retention for each application function.
- [ ] Amplify's own custom-resource Lambdas (`AmplifyBranchLinker…`, `CustomS3AutoDelete…`,
      `TableManager…`, `CustomCDKBucketDeployment…`): they are covered too, or the Resolution
      says why not.

## Notes

The groups hold webhook decisions, sweep counts and ingest outcomes; by D-345/§4.5 they should
hold no coordinates and no `owner_id`, so the exposure today is low. The point of the rule is that
a future logging mistake ages out.

## Operator validation

None expected. Smoke test after deploy: `aws logs describe-log-groups --profile devault
--log-group-name-prefix /aws/lambda/amplify-d14fhvl4rp79nn` shows `30` for every application
function, and the flood alarm is still `OK`, not `INSUFFICIENT_DATA` from a detached filter.
