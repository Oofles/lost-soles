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

- [ ] Every Lost Soles Lambda log group is created by IaC with 30-day retention, so a new function inherits it.
- [ ] The Amplify app log group is set to 30 days (in IaC if reachable, else recorded as a one-off with the command).
- [ ] A synth test fails on a Lost Soles function without 30-day retention.
- [ ] The live read shows 30 on all of them after deploy.

## Notes

Check how Amplify Gen 2 functions create their log groups before choosing between `logRetention` and an explicit `LogGroup`; switching ownership of an existing group can fail a deploy with `AlreadyExists`.

## Operator validation

Smoke test: the describe-log-groups read above, all 30. No perceptual check.

D-123 trigger checked? none.
