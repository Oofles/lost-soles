---
id: 151
slug: refresh-token-lifetime
title: Raise the Cognito refresh token lifetime from 30 days to a year
type: chore
priority: med
status: open
size: s
capability: 03-ticket-capture-endpoint
depends_on: [149]
blocked_by: []
source: agent
created: 2026-09-02T19:32:20Z
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

- [ ] The production app client's `RefreshTokenValidity` is 1 year, set in code rather than by
      console click, so a redeploy cannot silently revert it.
- [ ] The client id is byte-identical after the change, and the owner's `sub` is unchanged —
      verified against `OWNER_USER_IDS` rather than assumed.
- [ ] `TokenValidityUnits.RefreshToken` is set explicitly alongside the number; the field is
      meaningless without its unit and the default is minutes.
- [ ] The ID token lifetime is left at 60 minutes. A long-lived *refresh* token behind a
      short-lived *access* token is the point of the split; lengthening both would be the change
      this ticket is not.
- [ ] Smoke test: `describe-user-pool-client` shows the new validity, and a
      `REFRESH_TOKEN_AUTH` exchange with an existing refresh token still succeeds.
- [ ] The capability doc's "The refresh token expires in 30 days" section is updated to match, or
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

## Operator validation

> **D-181 — this is the agent's.** `describe-user-pool-client`, the client id comparison and the
> `REFRESH_TOKEN_AUTH` round trip are all reachable with the `devault` profile and `curl`.

Recorded here at close as a smoke test. Nothing about this is visual and nothing needs the phone —
the phone-side consequence is `0020`'s to validate, once, when the tile is built.
