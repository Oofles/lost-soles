---
id: 14
slug: cognito-email-signin-locked-down
title: Cognito — email sign-in, self-signup OFF, unauthenticated identities OFF
type: feature
priority: high
status: open
size: m
capability: 02-deploy-and-auth
depends_on: [12]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
---

## Description

Configure the Cognito user pool in `amplify/auth/resource.ts`. `08-security-privacy.md` §5.1: **two
settings carry almost the entire security posture of the application.**

```ts
allowUnauthenticatedIdentities: false      // no anonymous identity, ever
selfSignUpEnabled:              false      // no public registration endpoint
```

- **`selfSignUpEnabled: false` is non-negotiable and is the single most important line in the auth
  config.** A default-on Cognito pool **is a public registration endpoint**. Left on, an app whose
  entire threat model assumes "the only accounts are ones the owner created" would be false from the
  day it deployed — anyone on the internet could mint an account, and §2.4's Trigger A ("a second
  user account is created") would fire *without anyone noticing it had*. Self-signup is not a
  convenience we are declining; it is a hole we are not drilling.
- **`allowUnauthenticatedIdentities: false`** means the identity pool vends no guest credentials.
  Combined with `entity('identity')` S3 scoping (§6.2), there is no unauthenticated principal in the
  account that can touch storage at all.

Pool configuration: **Essentials tier, email sign-in**, which includes Managed Login and
passwordless/passkey (WebAuthn) sign-in, with 10,000 MAU free and — confirmed — **non-expiring**, so
auth costs $0.00 forever at this scale (D-083).

**Deliberately off or absent:** no hosted social IdPs (Google/Facebook sign-in adds an external trust
dependency to buy nothing for six known humans), no SAML/OIDC federation, no SMS MFA (SMS costs real
SNS money and is the weakest second factor available). If a second factor is ever wanted beyond
passkeys, it is **TOTP**, which is free.

**The owner account is created by hand**, in the Cognito console or via `admin-create-user`. There is
no invite feature, no signup page, and no "add a friend" button (§5.4). At the first-usable milestone
sign-in is the **raw Amplify UI component** — email + password, passkeys later
(`09-roadmap.md` §2.3).

**The verification gate is part of this ticket, not a follow-up.** Self-signup and unauthenticated
identities are two booleans that a console click or a careless `defineAuth` edit can flip back. A
one-line post-deploy check — `aws cognito-idp describe-user-pool` asserting the admin-only signup
policy — belongs in the same CI step as the secret grep (§5.1). It is the cheapest possible guard
against the highest-consequence misconfiguration in the system.

## Acceptance criteria

- [ ] `amplify/auth/resource.ts` sets `selfSignUpEnabled: false` and
      `allowUnauthenticatedIdentities: false`, and both lines carry a comment explaining why.
- [ ] The deployed user pool is on the **Essentials** tier with email sign-in enabled.
- [ ] No social IdP, no SAML/OIDC federation and no SMS MFA is configured on the pool.
- [ ] The owner account exists, created by hand, and can sign in to the deployed app.
- [ ] The app renders the Amplify UI Authenticator and an unauthenticated visitor cannot reach any
      app route — every route redirects to sign-in.
- [ ] **Self-signup is proven off by attack, not by config read**: a direct `SignUp` API call against
      the user pool's app client (e.g. `aws cognito-idp sign-up --client-id ... --username
      throwaway@example.com`) is **rejected**, and the rejection is recorded in
      `docs/capabilities/02-deploy-and-auth.md`.
- [ ] **Unauthenticated identities are proven off by attack**: an attempt to obtain guest credentials
      from the identity pool fails, and the failure is recorded in the capability doc.
- [ ] A CI step runs `aws cognito-idp describe-user-pool` (and the identity-pool equivalent) and
      **fails the build** if `AllowAdminCreateUserOnly` is not true or if unauthenticated identities
      are enabled.
- [ ] That CI check is proven capable of failing: flip the setting in a sandbox environment, watch
      the check go red, flip it back.
- [ ] Session handling follows §5.3 and no token of any kind is written to `localStorage` by our own
      code.
- [ ] `docs/capabilities/02-deploy-and-auth.md` records the pool id, app client id and the owner's
      Cognito `sub`, because `sub` is the partition key for everything the user owns (§5.4 step 6) and
      rebuilding a pool without preserving it orphans a permanent map (D-020).

## Notes

**Do not build a provisioning flow.** Adding a second user is an operator action gated by the §2.4
Trigger A checklist — seven items, four of which are *build* items (owner-scoped access tests, a
fidelity field on the user record, a consent screen, and a delete path executed once against a test
account). §5.4 is explicit that the multi-user story is *not* "add a Cognito user"; it is bigger than
the auth work by an order of magnitude. Anyone estimating "add friends" as a small ticket has not
read §2.4. Creating a second account also makes D-123's stated premise ("map shown only to the
owner") **false**, not merely weaker, and requires reopening D-123 with a recorded successor
decision.

Passkeys are the preferred long-term factor — for an Android-first app (D-124) the credential lives
in Google Password Manager, syncs across devices, and is phishing-resistant by construction — but
they are **not** required at the first-usable milestone, where the raw Amplify UI component with
email + password is explicitly acceptable (`09-roadmap.md` §2.3). Do not let passkey work expand this
ticket.

Each environment (sandbox, PR preview, production) gets its **own** user pool. The owner account
created here is the production one; sandbox accounts are throwaway.

## Operator validation

1. On the **Android phone**, in Chrome, open the app's URL while signed out. You must land on the
   sign-in screen and be unable to reach any other route by typing its path — try `/skills` directly
   and confirm you are bounced.
2. On the Android phone, sign in with the owner email and password. Confirm you reach the app. Then
   check the sign-in screen carefully: there must be **no "Create account" or "Sign up" link** on it.
   That link's absence is the visible face of `selfSignUpEnabled: false`.
3. In a desktop browser, open the Cognito console → the user pool → **Sign-up experience**. Confirm
   "Self-service sign-up" reads disabled and "Cognito-assisted verification" is not offering public
   registration. Then → **Users**: exactly one user exists.
4. In a desktop browser, open the Cognito console → Identity pool → confirm "Guest access" /
   unauthenticated identities is disabled.
5. On the laptop, run the `sign-up` CLI call from the acceptance criteria and read the error. It must
   be a refusal from Cognito, not a network or credential error — an ambiguous failure is not proof.
