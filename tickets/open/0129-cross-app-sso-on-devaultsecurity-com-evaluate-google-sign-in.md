---
id: 129
slug: cross-app-sso-on-devaultsecurity-com-evaluate-google-sign-in
title: Cross-app SSO on devaultsecurity.com — evaluate Google sign-in against 08 section 5.1
type: chore
priority: med
status: open
size: m
capability: 02-deploy-and-auth
depends_on: []
blocked_by: []
source: agent
created: 2026-08-31T15:31:42Z
---

## Description

TODO

## Acceptance criteria

- [ ] TODO

## Notes

TODO

## Operator validation

TODO

## Description

Raised by the operator during ticket 0014: *"I added in Google Authentication capabilities in my
school-hub project. Can we reuse that infrastructure for auth?"*

**The premise does not hold as stated, and that is the useful part of this ticket.** `school-hub` has
no `amplify/` directory and does not use Cognito at all. Its Google sign-in is **Auth.js / NextAuth
v5** (`lib/auth/config.ts`) with JWT session cookies and an `AUTH_ALLOWED_EMAILS` allowlist. Both
Cognito pools in account `286588821906` have **zero** identity providers configured. There is no
Cognito federation to reuse.

So "reuse it" resolves to one of two very different changes:

1. **Add Google as a federated IdP on Lost Soles' own Cognito pool.** Reuses nothing from school-hub,
   and — importantly — does **not** give shared-session SSO with it, because that app authenticates
   with Auth.js cookies rather than Cognito. The operator would still sign in twice.
2. **Adopt Auth.js in Lost Soles, displacing Cognito.** The only path to true cross-subdomain SSO.
   `school-hub`'s config is explicitly written for it: *"this module is intended to be copied verbatim
   into the other devaultsecurity.com Next.js apps"*, with `AUTH_COOKIE_DOMAIN=".devaultsecurity.com"`
   giving a session cookie valid across every subdomain, and Lost Soles lives at
   `soles.devaultsecurity.com`. But `amplify/data` uses `defaultAuthorizationMode: "userPool"` and
   `amplify/storage` scopes S3 with `allow.entity("identity")` — both Cognito-specific. Auth.js yields
   a session cookie, not identity-pool credentials, so AppSync authorization and per-identity S3
   scoping both need redesigning. This is capability-sized, not ticket-sized.

**Why this needs a decision and not just an implementation.** `08-security-privacy.md` §5.1 rules
social IdPs out — *"no hosted social IdPs (Google/Facebook sign-in adds an external trust dependency
to buy nothing for six known humans)"* — and ticket 0014 criterion 3 makes their absence a checked
criterion, now enforced on every deploy by `scripts/check-auth-posture.mjs`.

That reasoning is **weaker than it looks**, and should be re-examined rather than deferred to: §5.1
weighed a social IdP as buying "nothing", but it did not consider one sign-in across the operator's
own suite of apps on one domain. That is a real benefit to the actual user. A decision that was right
under the conditions it was made under may not be right under conditions it never contemplated.

Whatever is decided, it is recorded as a `D-xxx` that supersedes or re-affirms §5.1 explicitly — and
if a provider is ever added, the `no federated identity providers` assertion in
`check-auth-posture.mjs` must be amended in the same commit, not deleted.

## Acceptance criteria

- [ ] The two options above are costed concretely: what changes in `amplify/data`, `amplify/storage`,
      and any code reading the Cognito session, for the Auth.js path.
- [ ] A decision is recorded as a new `D-xxx` in `docs/decisions/DECISIONS.md`, explicitly superseding
      or re-affirming `08-security-privacy.md` §5.1, with the SSO benefit named rather than dismissed.
- [ ] If the decision keeps Cognito with no IdP, §5.1 is annotated with the reasoning so this is not
      re-litigated a third time.
- [ ] If the decision adds any provider, the `no federated identity providers` assertion in
      `scripts/check-auth-posture.mjs` is amended in the same commit, and 0014's criterion 3 is
      annotated as superseded.
- [ ] Whichever way it goes, `selfSignUpEnabled` stays OFF. Federation is about *how* a known account
      authenticates, never about *whether an unknown person can create one* — an IdP that lets any
      Google account sign in is a public registration endpoint wearing a different hat.

## Notes

Do not treat this as a config toggle. The last line of the acceptance criteria is the one that
matters: the security posture 0014 established is about who may hold an account, and no SSO
convenience is allowed to quietly reopen that.
