---
id: 131
slug: sandbox-stack-is-update-failed-its-cognito-pool-predates-001
title: Sandbox stack is UPDATE_FAILED — its Cognito pool predates 0014 and cannot be updated in place
type: bug
priority: med
status: open
size: s
capability: 02-deploy-and-auth
depends_on: []
blocked_by: []
source: agent
created: 2026-08-31T20:10:12Z
---

## Description

Found during ticket 0017, while deploying the `secret-smoke-test` function to the sandbox to prove
`secret()` resolves. The function stack deployed cleanly; the **auth** stack did not:

```
UPDATE_FAILED | AWS::Cognito::UserPool | auth/amplifyAuth/UserPool
  Resource handler returned message: "Invalid AttributeDataType input, consider using the
  provided AttributeDataType enum."
[CFNUpdateNotSupportedError] User pool attributes cannot be changed after a user pool has
been created.
```

`amplify-lostsoles-root-sandbox-bcc61467ba` and its nested `auth179371D7` stack are both left in
**`UPDATE_FAILED`**, which means **every subsequent `ampx sandbox` deploy will fail** until the
sandbox is recreated. It is a latent block on any future ticket that needs a sandbox deploy.

**Nothing about this was caused by 0017.** The sandbox user pool was created by ticket 0012's
skeleton deploy and never took 0014's changes; adding any resource forces a full stack update, which
is what surfaced it. `ampx` offered to recreate the sandbox (deleting all sandbox user data) and
that offer was **declined** — recreating an environment is not something to do inside an unrelated
ticket, and the operator has not been asked.

**The `main` branch environment is unaffected and healthy.** All four of its stacks report
`UPDATE_COMPLETE`, because 0014 replaced the production pool rather than updating it — which is
exactly why `docs/capabilities/02-deploy-and-auth.md` records that the production pool "has already
been replaced once" and pins the posture-check IAM policy to a wildcard pool ARN rather than a
specific one. The same replacement never happened in the sandbox.

## Steps to reproduce

1. `AWS_PROFILE=devault npx ampx sandbox --once` with any new resource added to `amplify/backend.ts`
   (0017 added `secretSmokeTest`; any resource forces the same full-stack update).
2. Watch the `auth` nested stack.

## Expected vs actual

**Expected:** the auth stack is unchanged by adding an unrelated function, so CloudFormation makes no
update to it and the deploy completes.

**Actual:** the auth stack attempts an update, Cognito rejects it with `Invalid AttributeDataType
input`, and `ampx` reports `CFNUpdateNotSupportedError: User pool attributes cannot be changed after
a user pool has been created`. The parent stack and `auth179371D7` are both left `UPDATE_FAILED`, so
the next sandbox deploy fails too. Verified 2026-08-31 via
`aws cloudformation describe-stacks --stack-name amplify-lostsoles-root-sandbox-bcc61467ba`.

## Acceptance criteria

- [ ] `ampx sandbox` deploys cleanly from a standing start, with `amplify-lostsoles-root-sandbox-*`
      and every nested stack reporting `CREATE_COMPLETE` or `UPDATE_COMPLETE`.
- [ ] The recreated sandbox pool's posture matches the production one — `AllowAdminCreateUserOnly`
      true, `AllowUnauthenticatedIdentities` false — verified by running
      `scripts/check-auth-posture.mjs` against the sandbox, not only against `main`.
- [ ] Whatever was lost by recreating the sandbox is named in the Resolution. If nothing was lost,
      say that and say how it was confirmed, rather than assuming an empty pool.
- [ ] The `secret-smoke-test` function still deploys and still resolves its secret afterwards, unless
      ticket 0094 has already landed and deleted it.
- [ ] `docs/capabilities/02-deploy-and-auth.md` records the sandbox recreation alongside the
      production pool replacement, so the two environments' histories are readable together.

## Notes

The fix `ampx` itself suggests is to recreate the sandbox, deleting all sandbox user data. That is
almost certainly harmless here — the operator's real account lives in the `main` branch pool, and
0014's operator validation was performed there — but "almost certainly" is not a basis for deleting
an environment, so **confirm with the operator before recreating.**

Related but distinct from ticket `0130` (a throwaway agent account for troubleshooting). 0130 is
about *what identity* the agent uses; this is about the sandbox *stack* being wedged. They will
likely be worked in the same session, and 0130 cannot be validated until this is cleared.

## Operator validation

Run `npx ampx sandbox --once --profile devault` on the laptop and watch it reach
`Deployment completed` with no `UPDATE_FAILED` line. Then, in the AWS console on the desktop, open
CloudFormation and confirm `amplify-lostsoles-root-sandbox-bcc61467ba` and all four nested stacks
are green.
