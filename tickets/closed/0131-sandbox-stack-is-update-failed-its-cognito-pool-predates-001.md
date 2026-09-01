---
id: 131
slug: sandbox-stack-is-update-failed-its-cognito-pool-predates-001
title: Sandbox stack is UPDATE_FAILED — its Cognito pool predates 0014 and cannot be updated in place
type: bug
priority: med
status: closed
size: s
capability: 02-deploy-and-auth
depends_on: []
blocked_by: []
source: agent
created: 2026-08-31T20:10:12Z
started: 2026-09-01T19:03:04Z
closed: 2026-09-01T19:11:48Z
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

- [x] `ampx sandbox` deploys cleanly from a standing start, with `amplify-lostsoles-root-sandbox-*`
      and every nested stack reporting `CREATE_COMPLETE` or `UPDATE_COMPLETE`.
- [x] The recreated sandbox pool's posture matches the production one — `AllowAdminCreateUserOnly`
      true, `AllowUnauthenticatedIdentities` false — verified by running
      `scripts/check-auth-posture.mjs` against the sandbox, not only against `main`.
- [x] Whatever was lost by recreating the sandbox is named in the Resolution. If nothing was lost,
      say that and say how it was confirmed, rather than assuming an empty pool.
- [x] The `secret-smoke-test` function still deploys and still resolves its secret afterwards, unless
      ticket 0094 has already landed and deleted it.
- [x] `docs/capabilities/02-deploy-and-auth.md` records the sandbox recreation alongside the
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

## Resolution

**Recreated the sandbox rather than repairing it, because the wedge was unrepairable in place.**
Cognito refuses `AttributeDataType` changes on an existing pool, so no CloudFormation update could
ever have moved the sandbox pool from 0012's config to 0014's. Delete-and-recreate was the only
route, which is why the ticket demanded operator confirmation first — that was sought and given
before anything was deleted.

**Files touched:** `docs/capabilities/02-deploy-and-auth.md` only. **No source changed**, and that
is the significant part of this ticket: `amplify/backend.ts` was already correct. The sandbox was
running old *deployed state*, not old code, so the fix was entirely an environment operation. A
reader looking for the bug in the repo would never have found it.

**What was checked before deleting.** The sandbox pool held zero users
(`aws cognito-idp list-users` → `{"Users": []}`), and production's single owner account was
confirmed present and untouched (`sub 5488e4b8-…`, still exactly 1 user afterwards). The ticket's
Notes said "almost certainly harmless"; this replaced that with a measurement, which is what the
criterion asked for.

**Sequence:** `ampx sandbox delete --yes` (132.9s, exit 0, all nested stacks `DELETE_COMPLETE`) →
`ampx sandbox --once` (144.7s, exit 0). Parent and all four nested stacks now `CREATE_COMPLETE`.

**Two things learned that were not in the ticket, and are now in the capability doc:**

1. **The sandbox secrets survived.** They live in SSM Parameter Store, outside CloudFormation, so
   `sandbox delete` left all three `root-sandbox-bcc61467ba` parameters intact. The stack also came
   back under the *same* name — the sandbox identifier derives from the OS user, not a fresh random
   suffix — so the recreated environment resolved the same secret paths with nothing to re-set.
   This was not obvious in advance and would have cost a confusing session to rediscover.
2. **Both pool ids have now churned.** Production was replaced by 0014, the sandbox by this ticket.
   The capability doc's table gained a date column and an explicit warning to read ids from
   `amplify_outputs.json` rather than from memory or an older section — the id staleness that
   confused 0014 is now a documented hazard rather than a trap.

**Criterion 4 was verified properly rather than by absence of error.** Invoking the redeployed
Lambda returned `{"resolved":true,"length":32,"sha256Prefix":"e5a6d6a0cde8"}`, and an independently
computed SHA-256 of the SSM value gave `len 32 sha256 e5a6d6a0cde8`. The function reporting success
would have proven only that *a* value arrived; matching the hash proves it is the *right* one.

**New pool identifiers:**

| | Old | New |
|---|---|---|
| User pool | `us-east-1_ortrz27yR` | `us-east-1_RV7QIiViX` |
| Identity pool | `us-east-1:d30ffb7f-…` | `us-east-1:fcfbad08-f483-4bbb-94cc-050f74126c70` |
| App client | — | `mvld8ja1nrdmmi9n9ji7j217v` |

**No `D-xxx` recorded.** Nothing architectural was decided — this restored an environment to the
posture D-163 and 0014 already established. Recording a decision here would dilute the register.

**Nothing went wrong during the work**, which is unusual enough to state plainly rather than leave
implied: both operations succeeded first time, and the only surprise (surviving secrets) was
favourable.

**Note for ticket 0130**, which is now unblocked: it can create its throwaway agent account in
`us-east-1_RV7QIiViX`. Its criterion 5 — recording which pool is which — is already substantially
done by this ticket's capability-doc edit.

## Operator validation

**Performed by the agent, 2026-09-01**, since the recreation itself had to happen here:

- `AWS_PROFILE=devault npx ampx sandbox delete --yes` → `Finished deleting.`, exit 0.
- `AWS_PROFILE=devault npx ampx sandbox --once` → `✔ Deployment completed in 144.687 seconds`,
  exit 0, `File written: amplify_outputs.json`. **No `UPDATE_FAILED` line.**
- `describe-stack-resources` on `amplify-lostsoles-root-sandbox-bcc61467ba`: parent
  `CREATE_COMPLETE`, and `auth179371D7` / `data7552DF31` / `function1351588B` / `storage0EC3F24A`
  all `CREATE_COMPLETE`.
- `node scripts/check-auth-posture.mjs --user-pool-id us-east-1_RV7QIiViX --identity-pool-id
  us-east-1:fcfbad08-f483-4bbb-94cc-050f74126c70` → all five assertions `ok`.
- Production pool `us-east-1_3lreDA1d1` still reports exactly **1** user.

**Still outstanding for the operator — the desktop console check.** The ticket asked for
CloudFormation in the AWS console on the desktop showing the sandbox parent and all four nested
stacks green. That was verified here through the CloudFormation *API*, which reads the same state,
but the console view was not opened. It is recorded as outstanding rather than claimed, because
"the API said so" and "I looked at it" are not the same evidence and this ticket exists precisely
because a stack sat wedged without anyone noticing.

**No screen or device is named for the app itself** — this ticket has no user-visible surface. The
sandbox is a development environment; nothing about it renders to the phone.
