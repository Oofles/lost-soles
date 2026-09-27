---
id: 181
slug: cognito-client-drift-amplify-outputs-json-and-cloudformation
title: Cognito client drift — amplify_outputs.json and CloudFormation name a client that does not exist
type: bug
priority: high
status: open
size: s
capability: 02-deploy-and-auth
depends_on: []
blocked_by: []
source: agent
created: 2026-09-08T13:56:52Z
started: 2026-09-27T03:53:22Z
---

## Description

`node scripts/check-auth-posture.mjs` fails locally, and the reason is not the posture setting
it names. Found while running the gate list at the close of ticket `0049`; unrelated to that
ticket's changes.

**What the check reports**

```
Cognito posture — user pool us-east-1_RV7QIiViX
                identity pool us-east-1:fcfbad08-f483-4bbb-94cc-050f74126c70
                (target from amplify_outputs.json)
  FAIL  refresh token is one year, in MINUTES
        RefreshTokenValidity is 43200 minutes, expected 525600 (one year)
```

**What is actually wrong**

Three facts that cannot all be right:

1. `amplify_outputs.json` (local) names client `mvld8ja1nrdmmi9n9ji7j217v`. That client exists,
   and its `RefreshTokenValidity` is **43200** — Cognito's 30-day default, not the year
   `amplify/backend.ts:159` sets. `LastModifiedDate` is `2026-09-02T15:47:07-04:00`, which is
   **23 seconds BEFORE** commit `67115fd` ("0151: raise the refresh token to a year") was
   authored. The escape hatch has never reached this client.
2. CloudFormation stack `amplify-…-main-branch-843f54c241-auth179371D7-11P63LR6892BM` records its
   `AWS::Cognito::UserPoolClient` physical id as **`5vc5e8t2ljv1hg3doau5mp0m00`**, with
   `LastUpdatedTimestamp: None`.
3. `describe-user-pool-client` for `5vc5e8t2ljv1hg3doau5mp0m00` returns
   **`ResourceNotFoundException`** — CloudFormation believes it manages a client that does not
   exist. It is the only `UserPoolClient` in that stack, and `mvld8ja1nrdmmi9n9ji7j217v` is the
   only client in the pool.

So the deployed stack manages a phantom, the app authenticates against a client CloudFormation
does not think it owns, and `backend.ts`'s token settings apply to neither.

**Why it matters more than one setting**

`08-security-privacy.md` §5.1 calls this the highest-consequence misconfiguration class in the
system, and `check-auth-posture.mjs` exists (0014) because self-signup and guest identities were
**live-wrong** while the source said otherwise. That is exactly the shape of this: a source file
that reads correct, a check that reads the right pool, and a live client neither of them governs.
Every assertion the posture check makes about this pool — self-signup, guest identities, MFA,
revocation — is only as good as the client it lands on.

The immediate user-visible consequence is 0151's: at 30 days rather than a year, **the
quick-settings capture tile stops working every month, silently**. It still listens, still takes
the dictation, and the note is never committed.

**Also unexplained, and part of the investigation**

Amplify jobs 132–135 (all 2026-09-08) report SUCCEED. `check-auth-posture.mjs` runs in the
BACKEND phase, after `pipeline-deploy`, and its header is explicit that it never skips —
*"an unparseable response — every one of those is an exit 1, never a skip"*. Either the check is
not running in those jobs, or it is resolving a different client than the local run does. Find out
which before trusting any green build that has run since 0014.

## Steps to reproduce

```bash
export AWS_PROFILE=devault
node scripts/check-auth-posture.mjs                 # FAILs on refresh token validity

python3 -c "import json;d=json.load(open('amplify_outputs.json'));print(d['auth']['user_pool_client_id'])"
#   -> mvld8ja1nrdmmi9n9ji7j217v

aws cloudformation describe-stack-resources \
  --stack-name amplify-d14fhvl4rp79nn-main-branch-843f54c241-auth179371D7-11P63LR6892BM \
  --query 'StackResources[?ResourceType==`AWS::Cognito::UserPoolClient`].PhysicalResourceId'
#   -> 5vc5e8t2ljv1hg3doau5mp0m00        (a DIFFERENT id)

aws cognito-idp describe-user-pool-client \
  --user-pool-id us-east-1_RV7QIiViX --client-id 5vc5e8t2ljv1hg3doau5mp0m00
#   -> ResourceNotFoundException

aws cognito-idp list-user-pool-clients --user-pool-id us-east-1_RV7QIiViX
#   -> exactly one client, mvld8ja1nrdmmi9n9ji7j217v
```

## Expected vs actual

**Expected.** `amplify/backend.ts:159` sets `refreshTokenValidity = 525600` with
`tokenValidityUnits.refreshToken = "minutes"` (ticket `0151`). CloudFormation manages that client,
`amplify_outputs.json` names it, and `check-auth-posture.mjs` reads 525600 from it and exits 0.

**Actual.** CloudFormation records a client id that does not resolve. The pool's only real client
carries the Cognito default of 43200 minutes (30 days) and was last modified 23 seconds *before*
the commit that raised it. The posture check reads that client and fails — correctly. And Amplify
jobs 132-135 reported SUCCEED while all of this was true.

## Acceptance criteria

- [x] The cause of the CloudFormation/live mismatch is identified and written down — a manual
      console action, a stack rollback, a resource replacement CFN did not record, or something
      else. **Do not repair before the cause is known**; a silent re-create loses the evidence.
- [x] CloudFormation and the live pool agree: the recorded physical id resolves, and it is the
      client `amplify_outputs.json` names.
- [x] `RefreshTokenValidity` on the live client is 525600 with `TokenValidityUnits.RefreshToken`
      = `minutes` (0151, `08` §5.3), verified with `describe-user-pool-client`, not with a synth.
- [x] `node scripts/check-auth-posture.mjs` exits 0 against the deployed pool.
- [x] It is established whether jobs 132–135 ran this check at all. If a green Amplify build can
      pass while the live posture is wrong, that is a worse bug than the drift and gets its own
      ticket — the check is the lock, not the alarm (D-163).
- [x] Every other assertion the posture check makes is re-verified against the client the app
      actually uses: self-signup off, unauthenticated identities off, no federated providers, no
      SMS MFA, ID token 60 minutes, revocation enabled.
- [x] `amplify_outputs.json` in the repo is either refreshed or confirmed to be a generated
      artifact whose staleness is expected, and the check states which copy it targets.

## Notes

**2026-09-08 — capability corrected from `00-foundations` to `02-deploy-and-auth`.** There is no
capability called `00-foundations`; it was never in `ROADMAP.md` and has no doc. Because
`auditBlockers()` enumerates capabilities from **ticket frontmatter** rather than from
`docs/capabilities/`, that one field invented a phantom capability sorting below everything, with
no doc and therefore no possible audit record — which gated all 18 ready tickets in capability
`>= 02` for four days. `validate` reported it, as a *warning*. This ticket's subject matter —
Cognito user pool clients, `amplify_outputs.json`, the CloudFormation auth stack — is
`02-deploy-and-auth` on the merits, not merely the nearest valid name.

Note that `02-deploy-and-auth` already has a recorded audit (`forced`, 2026-09-05). This ticket
being open means a re-audit of `02` fails `capability-tickets-closed` until it closes. That is
correct and deliberate: the capability really does have open work.


Do not "fix" this by editing `amplify_outputs.json` or by weakening the check. The check header
says it plainly and it is right: *"the deploy is failed deliberately. Fix `amplify/backend.ts`;
do not weaken this check."* The finding here is that the deploy is **not** failing when it should.

Evidence gathered 2026-09-08 with `AWS_PROFILE=devault`, account `286588821906`, `us-east-1`.

## Resolution

**There was no drift. The ticket compared a SANDBOX pool's client against the PRODUCTION stack.**
Criterion 1's cause, established before anything was changed (nothing needed repairing, so no
evidence was at risk):

| | Pool | Owner (pool tags) | Client | Refresh token |
|---|---|---|---|---|
| The ticket's "live pool" | `us-east-1_RV7QIiViX` | `amplify:deployment-type=sandbox`, stack `amplify-lostsoles-root-sandbox-bcc61467ba-auth…`, created 2026-09-01 | `mvld8ja1nrdmmi9n9ji7j217v` | 43200 min |
| Production | `us-east-1_3lreDA1d1` | `amplify:deployment-type=branch`, `amplify:branch-name=main`, stack `amplify-d14fhvl4rp79nn-main-branch-…-auth179371D7-11P63LR6892BM` | `5vc5e8t2ljv1hg3doau5mp0m00` | **525600 min** |

The old machine's `amplify_outputs.json` had been written by `ampx sandbox`, so it named the
sandbox pool. The three "facts that cannot all be right" were all right: the CFN stack's client
`5vc5e…` does not exist in `RV7QIiViX` because it lives in `3lreDA1d1`, where the same stack's
`AWS::Cognito::UserPool` resource points (`amplifyAuthUserPool4BA7F805` → `us-east-1_3lreDA1d1`).
The investigation only ever asked the wrong pool for it. The sandbox client's 43200 is simply a
sandbox that has not been redeployed since 0151 (`LastModifiedDate` 2026-09-02 15:47, the
"23 seconds before" 0151's commit, is when that sandbox last synced).

**This is `0014`'s mistake again**, and `check-auth-posture.mjs`'s header already warned about it
in words — *"LOCALLY it is usually the sandbox's. During 0014 that difference caused a posture read
of the sandbox pool to be reported as production."* The banner printed the pool id, and the pool id
was not enough twice.

**The builds were never wrong (criterion 5).** Build logs for jobs 132, 135, 217 and 218 each show
`check-auth-posture.mjs` running in the backend phase against `us-east-1_3lreDA1d1` with all eight
assertions `ok`, including *"refresh token is one year, in MINUTES"*. The lock (D-163) worked; the
green builds meant what they said. No follow-up ticket needed.

**Criterion 7 — the check now states which copy it targets, in words.** The banner gains an
`environment:` line read from the pool's own `amplify:deployment-type` / `amplify:branch-name`
tags, which `describe-user-pool` already returns — no new API call and no new IAM grant for the
Amplify build role. It prints `branch 'main' (deployed)`, or `SANDBOX — not production; a failure
here says nothing about the deployed app`, or `UNKNOWN` for an untagged pool. It is a label, not an
assertion: checking a sandbox deliberately is legitimate. `amplify_outputs.json` is gitignored and
generated per environment, so "in the repo" means the local copy: regenerated here with
`npx ampx generate outputs --app-id d14fhvl4rp79nn --branch main` (it names `3lreDA1d1` /
`5vc5e…`), and its staleness after any `ampx sandbox` run is expected and now visible in the banner.

**Nothing in AWS was changed.** No repair was needed, so the sandbox stack was left as found.

**Scope notes.**
- The sandbox stack (`amplify-lostsoles-root-sandbox-bcc61467ba`, 7 CFN stacks, live since
  2026-09-01) is abandoned: nothing uses it, and `tools/capture/capture.sh` hardcodes the production
  client `5vc5e…`. Deleting it is an operator decision, not this ticket's; raised in the session
  summary rather than done.
- `## Operator validation` item 1 (sign in on the phone, re-check 31 days later) was **replaced with
  the operator's agreement** on 2026-09-26: it asked for the phone and for waiting out an expiry,
  both ruled out by D-229. The token lifetime is a pool-client setting Cognito enforces; reading it
  from the live production client is the check, and the deploy lock re-asserts it on every build.

Files: `scripts/check-auth-posture.mjs` (the `environment:` banner line and `environmentOf()`).
Tests: `--self-test` still 14/14; the new line is exercised against both real pools below.

## Operator validation

None needed from the operator — nothing rendered changed, and the phone check this ticket
originally asked for was replaced (see Resolution, D-229). Smoke tests run by the agent,
2026-09-27, `AWS_PROFILE=devault`, account 286588821906:
- `check-auth-posture.mjs --user-pool-id us-east-1_3lreDA1d1 --identity-pool-id us-east-1:8738715f-…`
  → `environment: branch 'main' (deployed)`, 8/8 ok, exit 0.
- Same against `us-east-1_RV7QIiViX` / `us-east-1:fcfbad08-…` → `environment: SANDBOX — not
  production…`, reproduces the ticket's exact FAIL (43200 minutes), exit 1. The label fires where it
  should have in the original report.
- `describe-user-pool-client` on `3lreDA1d1` / `5vc5e…` → `RefreshTokenValidity 525600`,
  `TokenValidityUnits.RefreshToken minutes`, `IdTokenValidity 60`, `EnableTokenRevocation True`.
- `describe-stack-resources` on the main-branch auth stack → pool `us-east-1_3lreDA1d1`, client
  `5vc5e…`, both resolve; `list-user-pool-clients` on that pool → exactly that one client.
- Regenerated `amplify_outputs.json` → names `3lreDA1d1` / `5vc5e…`; the check against it exits 0.
- Amplify job 218 (this session's push) build log → posture check ran against `3lreDA1d1`, passed.
