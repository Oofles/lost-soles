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

- [ ] The cause of the CloudFormation/live mismatch is identified and written down — a manual
      console action, a stack rollback, a resource replacement CFN did not record, or something
      else. **Do not repair before the cause is known**; a silent re-create loses the evidence.
- [ ] CloudFormation and the live pool agree: the recorded physical id resolves, and it is the
      client `amplify_outputs.json` names.
- [ ] `RefreshTokenValidity` on the live client is 525600 with `TokenValidityUnits.RefreshToken`
      = `minutes` (0151, `08` §5.3), verified with `describe-user-pool-client`, not with a synth.
- [ ] `node scripts/check-auth-posture.mjs` exits 0 against the deployed pool.
- [ ] It is established whether jobs 132–135 ran this check at all. If a green Amplify build can
      pass while the live posture is wrong, that is a worse bug than the drift and gets its own
      ticket — the check is the lock, not the alarm (D-163).
- [ ] Every other assertion the posture check makes is re-verified against the client the app
      actually uses: self-signup off, unauthenticated identities off, no federated providers, no
      SMS MFA, ID token 60 minutes, revocation enabled.
- [ ] `amplify_outputs.json` in the repo is either refreshed or confirmed to be a generated
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

## Operator validation

> **D-181 — most of what follows is the AGENT's to run, not the operator's.**
> Everything above is reachable with AWS credentials and belongs in a smoke test at close.

1. After the repair, sign in on the phone and confirm the session is still live 31 days later —
   the failure 0151 describes only shows up past the old 30-day boundary, and only on a real
   device that has not re-authenticated in between.
