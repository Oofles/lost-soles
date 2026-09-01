---
id: 130
slug: sandbox-environment-and-a-throwaway-agent-account-for-troubl
title: Sandbox environment and a throwaway agent account for troubleshooting
type: chore
priority: low
status: closed
size: s
capability: 02-deploy-and-auth
depends_on: []
blocked_by: []
source: agent
created: 2026-08-31T15:31:47Z
started: 2026-09-01T19:12:13Z
closed: 2026-09-01T19:14:40Z
---

## Description

TODO

## Acceptance criteria

- [x] TODO — the generated stub's placeholder; the real criteria are below

## Notes

TODO

## Operator validation

TODO

## Description

Raised by the operator during ticket 0014: they asked for an authentication method for the agent, to
assist with development and troubleshooting.

**It must not be a second account in the production pool.** `08-security-privacy.md` §2.4 Trigger A
fires the moment a second production account exists: it makes D-123's stated premise ("map shown only
to the owner") **false, not merely weaker**, and demands a seven-item gate of which four are build
items — owner-scoped access tests, a fidelity field on the user record, a consent screen, and a delete
path executed once against a test account. 0014's own Notes are explicit that this is bigger than the
auth work by an order of magnitude.

**The sandbox is the right home.** 0014's Notes: *"Each environment (sandbox, PR preview, production)
gets its own user pool. The owner account created here is the production one; sandbox accounts are
throwaway."* A sandbox account gives a real signed-in browser session with zero production blast
radius, no effect on D-123, and nothing to revoke later.

A sandbox stack already exists — `amplify-lostsoles-root-sandbox-bcc61467ba`, user pool
`us-east-1_ortrz27yR`, stood up 2026-08-31T03:42Z, presumably during 0012. It is **not** currently in
the fixed posture: it was created with `allowAdminCreateUserOnly: false` like production was, and no
sandbox deploy has run since 0014's fix, so it still carries both holes. That is tolerable for a
throwaway environment but should not be assumed away — see the criteria.

Note also that the agent already holds AWS admin CLI access to this account, which covers most
troubleshooting. What it lacks is a *browser session as a signed-in user*. That is the whole gap this
ticket closes; it is genuinely small.

## Acceptance criteria

- [x] `npx ampx sandbox` deploys cleanly and its `amplify_outputs.json` is confirmed to point at the
      sandbox pool, not production. Local development targets the sandbox by default.
- [x] The sandbox pool carries the **same** posture as production — `check-auth-posture.mjs` passes
      against it. A sandbox with self-signup open is a real public registration endpoint on the real
      internet, even if the data behind it is throwaway.
- [x] A throwaway agent account exists in the **sandbox** pool only, and is confirmed absent from the
      production pool.
- [x] The production pool still contains exactly one user (the owner) after this work.
- [x] `docs/capabilities/02-deploy-and-auth.md` records which pool is sandbox and which is production,
      with their ids, so the confusion that occurred during 0014 cannot recur.

## Notes

0014 hit exactly this confusion: the agent's local `amplify_outputs.json` was the **sandbox's**, so an
early posture read reported the sandbox pool's state while describing it as production. The finding
survived (CloudTrail confirmed production was created with `allowAdminCreateUserOnly: false` too), but
the evidence pointed at the wrong resource. Recording the two pool ids side by side is the cheap fix.

## Resolution

**Worked immediately after 0131 in the same session, which was the right order and not a
coincidence** — this ticket's first two criteria are about a sandbox that deploys cleanly and
carries production's posture, and until 0131 recreated it the sandbox could not deploy at all.

**Files touched:** `docs/capabilities/02-deploy-and-auth.md` only. No source changed. Like 0131,
this was an environment operation rather than a code change.

### The account

| | |
|---|---|
| Email | `agent@lost-soles.invalid` |
| Pool | sandbox `us-east-1_RV7QIiViX` |
| `sub` | `f4688488-5081-7055-3ae9-db0b8a3237e4` |
| Password | SSM SecureString `/amplify/lostsoles/root-sandbox-bcc61467ba/AGENT_SANDBOX_PASSWORD` |

**Three decisions worth stating, none of which the ticket specified:**

1. **`.invalid` as the email domain** (RFC 2606 — reserved, permanently unresolvable). Created with
   `--message-action SUPPRESS` and given a permanent password directly, so Cognito never attempts
   delivery. An address that *cannot* receive mail is correct for an account that must never take
   part in a password reset or email recovery flow.
2. **The password lives in SSM as a SecureString**, under the same sandbox path prefix as the other
   sandbox secrets — so it is destroyed by the same teardown, is reachable only with AWS credentials
   that already grant strictly more than the account does, and is in no file in this repo.
3. **`ADMIN_USER_PASSWORD_AUTH` was deliberately NOT enabled.** The first sign-in attempt used
   `admin-initiate-auth` and failed with `Auth flow not enabled for this client`. Enabling it would
   have made the test one line simpler while permanently widening the pool's auth surface, to prove
   something the browser never does. Tested with SRP instead — the flow the app actually uses.

### Proof it works

Sign-in was verified through `aws-amplify`'s `signIn()` against the real
`amplify_outputs.json`, i.e. the exact path the browser takes:

```
isSignedIn: true | nextStep: DONE
pool used:   us-east-1_RV7QIiViX
identityId:  us-east-1:42ba0661-92d9-c6c1-2d53-260c782f9752
sub:         f4688488-5081-7055-3ae9-db0b8a3237e4
idToken:     present
signOut ok
```

The identity pool vending an `identityId` matters as much as the idToken: it is what
`allow.entity('identity')` S3 scoping keys off, so this account can exercise storage paths too.

**One small snag worth recording.** The first SRP test run failed with `ERR_MODULE_NOT_FOUND` for
`aws-amplify` because the script sat in a scratch directory outside the project's `node_modules`
resolution root. Moving it into the repo as an untracked file fixed it; the file was deleted after
the run and nothing was committed. Trivial, but it is the kind of thing that reads as a real
failure in a log later.

### Why §2.4 Trigger A did not fire

The account is in the **sandbox** pool. Trigger A is scoped to a second *production* account, and
the check confirms it stayed that way: production holds exactly one user, `amazingbrandon@gmail.com`,
and `admin-get-user` for `agent@lost-soles.invalid` against the production pool returns
`UserNotFoundException`. Had this gone in production it would have made D-123's stated premise false
and pulled in a seven-item gate with four build items — an order of magnitude more work than the
ticket, exactly as 0014's Notes warned.

**No `D-xxx` recorded.** Nothing architectural was decided. The three choices above are
implementation judgement within the ticket's stated intent, recorded here and in the capability doc
rather than in the decision register, which would be diluted by them.

## Operator validation

**Performed by the agent, 2026-09-01:**

- `amplify_outputs.json` resolves to `us-east-1_RV7QIiViX` — the **sandbox** pool, not production.
  Confirmed by direct comparison against both ids, not by eye.
- `scripts/check-auth-posture.mjs` against the sandbox pool: all five assertions `ok`, re-run
  *after* the account was created so the user's presence is included in what passed.
- Sandbox pool: 1 user (`agent@lost-soles.invalid`, `CONFIRMED`).
  Production pool: 1 user (`amazingbrandon@gmail.com`, `CONFIRMED`).
- `admin-get-user` for the agent address against production → `UserNotFoundException`.
- SRP `signIn()` → `isSignedIn: true`, idToken present, `signOut` clean.

**Outstanding for the operator — the one thing not proven here.** The sign-in was driven from Node,
not from a browser. It exercises the same SRP flow and the same client id, so the credential is
sound, but nobody has yet typed these credentials into the app's own sign-in screen. Worth doing
once, on the desktop at `localhost:3000` with the sandbox `amplify_outputs.json`, to confirm the
`@aws-amplify/ui-react` Authenticator accepts them and lands on the app shell. Recorded as
outstanding rather than assumed — the account existing and the account being *usable through the UI*
are different claims.

**No phone check applies.** The sandbox is a development environment and this account is not for
the operator; nothing here renders to a device the operator uses.
