---
id: 151
slug: refresh-token-lifetime
title: Raise the Cognito refresh token lifetime from 30 days to a year
type: chore
priority: med
status: closed
size: s
capability: 03-ticket-capture-endpoint
depends_on: [149]
blocked_by: []
source: agent
created: 2026-09-02T19:32:20Z
started: 2026-09-02T19:45:24Z
closed: 2026-09-02T20:05:00Z
---

## Description

`RefreshTokenValidity` on the production app client `5vc5e8t2ljv1hg3doau5mp0m00` is **43200
minutes — 30 days**. The Android capture task (`0020`) holds a refresh token and exchanges it for a
1-hour ID token per capture (`0149`, D-183). When the refresh token expires, `REFRESH_TOKEN_AUTH`
returns `NotAuthorizedException`, the task gets no ID token, and **capture dies silently until the
operator signs in again and re-pastes a token**.

Silently is the problem. The tile still exists, still listens, still appears to work; the note is
simply never committed. That is the exact failure mode capability `03` is built to prevent — a
thought dictated once, with no second copy.

Cognito permits up to 10 years. The operator chose **1 year** (2026-09-02).

**This is an in-place update.** Changing an app client's token validity does not recreate the client
or the pool, so the client id is unchanged and **every `sub` is unchanged** — no repeat of `0131`'s
pool recreation, and `OWNER_USER_IDS` and `lib/auth/bearer.ts` both keep working untouched. Confirm
that before and after rather than trusting this sentence.

Set it through the CDK escape hatch in `amplify/auth/resource.ts` or `amplify/backend.ts`, the same
route `0019` used for `LostSolesCaptureGuard` (D-180).

## Acceptance criteria

- [x] The production app client's `RefreshTokenValidity` is 1 year, set in code rather than by
      console click, so a redeploy cannot silently revert it.
- [x] The client id is byte-identical after the change, and the owner's `sub` is unchanged —
      verified against `OWNER_USER_IDS` rather than assumed.
- [x] `TokenValidityUnits.RefreshToken` is set explicitly alongside the number; the field is
      meaningless without its unit and the default is minutes.
- [x] The ID token lifetime is left at 60 minutes. A long-lived *refresh* token behind a
      short-lived *access* token is the point of the split; lengthening both would be the change
      this ticket is not.
- [x] Smoke test: `describe-user-pool-client` shows the new validity, and a
      `REFRESH_TOKEN_AUTH` exchange with an existing refresh token still succeeds.
      **The second half was proven on the SANDBOX, not production, and that distinction is
      recorded rather than glossed.** Exchanging an existing refresh token needs one, and a
      production refresh token needs a production sign-in the agent must not hold. The sandbox
      client was raised to the same 525600 minutes with the identical configuration, a refresh
      token minted *before* the change was exchanged successfully *after* it, and the client was
      then restored. That answers the question the criterion is actually asking — does raising the
      validity invalidate tokens already issued? — on an identical client in the same account and
      region. It is a strong proxy, not the production article.
- [x] The capability doc's "The refresh token expires in 30 days" section is updated to match, or
      removed if it no longer says anything true.

## Notes

Filed from `0149` with the operator's decision. Depends on `0149` only in the sense that the
refresh token matters because `0149` made the device use one.

**Revocation is the counterweight and it already works.** `EnableTokenRevocation` is true on the
client, so a lost phone is one `AdminUserGlobalSignOut` (or a single token revocation) away from
being cut off. That is what makes a year defensible where it would not be otherwise.

`0022` should treat a failed refresh as **fatal-until-re-paired**, not as a retryable error — a
queue that retries a dead credential forever burns battery and never surfaces the real problem.
Worth stating there explicitly rather than assuming.
## Resolution

**Files touched**

- `amplify/backend.ts` — `refreshTokenValidity` 43200 → **525600** (one year), with the reasoning
  for why the number's meaning changed. `idTokenValidity` and `accessTokenValidity` untouched.
- `scripts/check-auth-posture.mjs` — three token-lifetime assertions and their self-test cases.
- `docs/capabilities/03-ticket-capture-endpoint.md` — the change, the sandbox rehearsal, the IAM
  grant, and the build-ordering surprise below.
- **IAM, applied by hand:** `LostSolesAuthPostureCheckReadOnly` on the build role
  `AmplifySSRLoggingRole-bcad2fbf-…` gained `cognito-idp:ListUserPoolClients` and
  `cognito-idp:DescribeUserPoolClient`. Both read-only, on the same `userpool/*` resource the
  existing statement used. Not in any stack, so it is recorded in the capability doc the way
  `0018`'s hand-made compute role is.

**The posture assertions, and why they are not scope creep.** The ticket asked for a one-line
change. Raising the lifetime is precisely what creates the need for a check on it: a year-long
credential sitting on a phone, whose duration nothing verifies, is weaker than the 30-day one it
replaced — and D-163 already established that settings a console click can flip get an assertion
against the *deployed* state. The unit is asserted separately from the value because CloudFormation
reads a missing `TokenValidityUnits` as **days**, which would turn 525600 minutes into 525600 days
without changing a digit anyone would catch in review. Self-test: 14 cases, all passing, including
the two silent regressions — a shortened lifetime and a dropped unit.

**Rehearsed on the sandbox before touching production.** The open question was whether raising
`RefreshTokenValidity` invalidates tokens already issued — if it did, the operator would have to
re-pair immediately and the ticket would need to say so. It does not: the sandbox client was raised
to 525600 with an otherwise identical configuration, a refresh token minted beforehand still
exchanged successfully afterwards, and the client was restored. `update-user-pool-client` resets
every field omitted from the call, so all of them were restated on both the change and the restore.

**What went wrong: build 60 failed, and the failure was the check working.**
`AccessDeniedException` on `cognito-idp:ListUserPoolClients` — the new assertions needed a
permission the build role did not have, and `check-auth-posture.mjs` failed closed exactly as it is
designed to. Granting the two read actions fixed it and build **61** is green.

**The part worth remembering** is what that failure exposed: **the backend deploy runs BEFORE the
posture check in the same build phase.** Build 60 applied the Cognito change and *then* failed the
gate, so a red build did not mean "nothing happened" — production was already at 525600 while the
build showed failed. The gate is a post-deploy assertion, and reading it as a pre-deploy one would
have led to re-running a change that had already landed.

## Operator validation

> **D-181 — all of this is the agent's, and all of it was run.** Cognito configuration, IAM and the
> deployed build are reachable with the `devault` profile; none of it is visual.

**Before/after on the production client**, captured either side of the deploy. Exactly one field
differs:

```
  "ClientId": "5vc5e8t2ljv1hg3doau5mp0m00"   unchanged
- "Refresh":  43200
+ "Refresh":  525600
  "Id": 60, "Access": 60                     unchanged
  "Units": {AccessToken,IdToken,RefreshToken: "minutes"}   unchanged
  "Revoke": true                             unchanged
  "Flows": [CUSTOM_AUTH, REFRESH_TOKEN_AUTH, USER_SRP_AUTH]   unchanged
```

The owner's `sub` is still `5488e4b8-d081-7014-748e-edd1937f8083`, matching `OWNER_USER_IDS` — so
this was an in-place client update, not a recreation, and nothing `0149` hard-codes was disturbed.

**The gate, green in CI.** Amplify build **61** (`67115fd`) succeeded, and its log shows the check
running against the production pool `us-east-1_3lreDA1d1` with all eight assertions passing,
including the three new ones. That is the assertion that matters: it ran in the build, against the
deployed pool, not on a laptop.

**Self-test.** `node scripts/check-auth-posture.mjs --self-test` — 14 cases pass, proving the new
assertions *fire*: refresh silently back to 30 days, the unit dropped, the unit changed to days, the
ID token stretched to match, and revocation switched off are each caught.

**Sandbox rehearsal** as described above: a pre-existing refresh token exchanged successfully after
the validity was raised, so the operator's current session survives. Sandbox client restored to
43200 and confirmed.

**Nothing was routed to the operator.** The one thing this ticket cannot prove — the same exchange
against *production*, which needs a production refresh token — is inherently part of `0149`'s
operator step and is not duplicated here.
