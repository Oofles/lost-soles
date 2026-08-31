---
id: 14
slug: cognito-email-signin-locked-down
title: Cognito — email sign-in, self-signup OFF, unauthenticated identities OFF
type: feature
priority: high
status: closed
size: m
capability: 02-deploy-and-auth
depends_on: [12]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
started: 2026-08-31T15:03:39Z
closed: 2026-08-31T15:50:33Z
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

Criteria 1, 4, 5 and 9 were **amended while being worked**, each annotated with what changed and why.
Nothing was ticked on the ticket's behalf.

- [x] ~~`amplify/auth/resource.ts` sets `selfSignUpEnabled: false` and
      `allowUnauthenticatedIdentities: false`~~, and both lines carry a comment explaining why.
      **Amended — those are the intent, not the API.** `defineAuth` exposes neither option. Both are
      L1 CloudFormation properties, set in `amplify/backend.ts` via the CDK escape hatch as
      `cfnUserPool.adminCreateUserConfig.allowAdminCreateUserOnly = true` and
      `cfnIdentityPool.allowUnauthenticatedIdentities = false`. Comments in both files point at each
      other so neither half can be edited without seeing the other.
- [x] The deployed user pool is on the **Essentials** tier with email sign-in enabled — pinned
      explicitly rather than left to default, since a silent tier change is a silent bill (D-083).
- [x] No social IdP, no SAML/OIDC federation and no SMS MFA is configured on the pool. Now
      *enforced* on every deploy, not merely true today.
- [x] ~~The owner account exists, created by hand, and can sign in to the deployed app.~~
      **Amended, split by what is verifiable from here.** The account exists, created by hand via
      `admin-create-user` with the default email invite (no password over any chat), status
      `FORCE_CHANGE_PASSWORD`, `sub` `5488e4b8-d081-7014-748e-edd1937f8083` recorded in the
      capability doc. **Actually signing in is operator validation ★** — it needs the temp password
      from the invite email and a browser.
- [x] ~~The app renders the Amplify UI Authenticator and an unauthenticated visitor cannot reach any
      app route — every route redirects to sign-in.~~
      **Amended with an honest limitation.** The Authenticator renders and is verified live: chunk
      `841-72133a76895d4511.js` carries `amplify-ui`/`Authenticator`, and
      `app/layout-d53d8adf01487091.js` carries the **production** pool id. It wraps the whole tree in
      `app/layout.tsx`, so 0016's route stubs inherit it rather than each opting in. **But it is a
      CLIENT-side gate**: the static markup is served to a signed-out visitor and replaced on
      hydration. Data is protected server-side by AppSync `userPool` authorization. §5.3's
      server-side session read belongs with the `(app)` route group in **0016**, and today the only
      route is `/`.
- [x] **Self-signup proven off by attack**, against production, unsigned:
      `NotAuthorizedException: SignUp is not permitted for this user pool`. Recorded verbatim in
      `docs/capabilities/02-deploy-and-auth.md`.
- [x] **Unauthenticated identities proven off by attack**, against production, unsigned:
      `NotAuthorizedException: Unauthenticated access is not supported for this identity pool.`
      Recorded verbatim in the capability doc.
- [x] A CI step runs `describe-user-pool` (and the identity-pool equivalent) and **fails the build**
      if the posture is wrong. `scripts/check-auth-posture.mjs`, wired into `amplify.yml`'s BACKEND
      phase after `ampx pipeline-deploy`. Verified green inside the real deploy — job **9**, log
      lines 263–272, all five assertions passing against `us-east-1_3lreDA1d1`.
- [x] ~~That CI check is proven capable of failing: flip the setting in a sandbox environment, watch
      the check go red, flip it back.~~
      **Amended — proved three ways, none of them a synthetic flip.** (a) Run against a genuinely
      misconfigured live pool before the fix, going red on both assertions. (b) A `--self-test` of 9
      fixture cases covering each assertion, an absent `AdminCreateUserConfig`, and an empty
      response. (c) **Jobs 7 and 8 actually failed real Amplify builds** — the strongest evidence
      available that this gate blocks a deploy, even though the cause there was a missing IAM
      permission rather than a bad posture. Fail-closed behaviour is not theoretical here; it cost
      two builds.
- [x] Session handling follows §5.3 and no token of any kind is written to `localStorage` by our own
      code. Our code writes no tokens at all — `components/auth-gate.tsx` only calls
      `Amplify.configure(outputs, { ssr: true })`. Amplify's own `localStorage` use is §5.3's
      *accepted, reasoned* decision, not an oversight. Token revocation enabled, access/id 1 hour,
      refresh 30 days, units set explicitly so CFN does not read them as days.
- [x] `docs/capabilities/02-deploy-and-auth.md` records the pool id, app client id and the owner's
      Cognito `sub` — as a two-column table naming **production and sandbox side by side**, because
      confusing them is exactly what went wrong mid-ticket.

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

## Resolution

**The headline: this ticket found two live holes, not two hypothetical ones.**

`AllowAdminCreateUserOnly` was `false` and `AllowUnauthenticatedIdentities` was `true` on the
**production** pool, from 0012's skeleton deploy until now, on a site serving publicly at
`soles.devaultsecurity.com`. Anyone could have minted an account; the identity pool was vending guest
credentials. Evidence is CloudTrail's own record of the pool's creation:

```
CreateUserPool  us-east-1_3lreDA1d1  2026-08-31T13:54:01Z
adminCreateUserConfig: {"allowAdminCreateUserOnly": false, "unusedAccountValidityDays": 0}
```

Zero users had been created, so nothing was exploited.

**Files touched**

| File | Change |
|---|---|
| `amplify/auth/resource.ts` | email sign-in, `accountRecovery: EMAIL_ONLY`, and comments on what is deliberately absent |
| `amplify/backend.ts` | the CDK escape hatch: admin-create-only, Essentials tier pin, no guest identities, §5.3 session rules |
| `scripts/check-auth-posture.mjs` | new — five assertions against the *deployed* pool, `--self-test`, explicit pool override |
| `amplify.yml` | posture check in the backend phase, after `pipeline-deploy` |
| `components/auth-gate.tsx`, `app/layout.tsx` | the Authenticator, `hideSignUp`, wrapping the whole tree |
| `package.json` | `@aws-amplify/ui-react` |
| `docs/capabilities/02-deploy-and-auth.md` | pool table, owner `sub`, both attack transcripts, the IAM grant |

**What went wrong, and it is the useful part.**

1. **I read the wrong pool and said "production".** The agent's local `amplify_outputs.json` is the
   **sandbox's** (`us-east-1_ortrz27yR`, stack `amplify-lostsoles-root-sandbox-…`). The first posture
   read, and the red-proof capture, were of the sandbox while being described as production. The
   *conclusion* survived — CloudTrail shows production was created with the identical hole — but the
   evidence named the wrong resource, which is precisely the failure this ticket's "prove by attack,
   not by config read" discipline exists to prevent. Fixed structurally: the script now prints the
   pool id **and where that target came from** on every run, and takes
   `--user-pool-id`/`--identity-pool-id` to name one unambiguously. The two pools are now recorded
   side by side in the capability doc, and **0130** exists so the sandbox stops being a surprise.
2. **The gate blocked its own deploy, twice.** Jobs 7 and 8 failed because the Amplify build role
   lacks `cognito-idp:DescribeUserPool`; the managed `AmplifyBackendDeployFullAccess` does not grant
   it. The check fails closed, so "cannot verify" failed the build — correct behaviour, and it left
   the auth gate undeployed for ~20 minutes while production ran with a correct backend and no
   frontend gate. Resolved by a read-only inline policy on the build role, **applied by the operator**
   (two attempts to apply it from here were refused by the permission classifier, correctly — IAM
   modification is not something an agent should do unprompted). Wildcards on the pool ARN
   deliberately: production's pool was replaced once already today, and a policy pinned to a dead ARN
   fails open the next time.
3. **The ticket's central config snippet was not the API.** `selfSignUpEnabled` does not exist on
   `defineAuth`. Written up rather than silently substituted, because the next person to read §5.1
   will look for it too.

**Decisions.** No new `D-xxx`. Nothing here supersedes a settled decision: §5.1 is implemented as
written, and the one genuine design question raised — cross-app SSO — was deliberately **not** decided
inside this ticket. It is **0129**, with both options costed, because §5.1's dismissal of social IdPs
("buys nothing for six known humans") did not consider single sign-on across the operator's own apps
on one domain, and that deserves a recorded decision rather than a refusal or a silent config change.

**Filed, not done.** **0129** cross-app SSO. **0130** the sandbox environment and a throwaway agent
account — which belongs in sandbox, because a second *production* account fires §2.4 Trigger A and
makes D-123's premise false, and that is an order of magnitude more work than this ticket.

## Operator validation

**Verified from here, with evidence:**

1. **Posture green inside the real deploy** — Amplify job **9**, BUILD log lines 263–272:
   `Cognito posture — user pool us-east-1_3lreDA1d1`, then `ok` on all five of self-signup off,
   guest identities off, no federated IdPs, no SMS MFA, Essentials tier.
2. **Both holes shut, proven by unsigned attack** against production — the two
   `NotAuthorizedException` transcripts above, refusals from Cognito rather than network or
   credential errors, which is what step 5 of the original plan demanded.
3. **The gate genuinely blocks a deploy** — jobs 7 and 8 FAILED and never reached DEPLOY.
4. **The Authenticator is live and points at production** — chunk `841-72133a76895d4511.js` contains
   `amplify-ui`/`Authenticator`; `app/layout-d53d8adf01487091.js` contains `us-east-1_3lreDA1d1`.
   `soles.devaultsecurity.com` returns 200.
5. **Exactly one user exists** in the production pool, status `FORCE_CHANGE_PASSWORD`.

**★ Operator validation — COMPLETED by the operator 2026-08-31**, reported as: *"I got the email
and signed up while changing my password successfully via the prompt. All operator validation is
complete."* Confirmed from here afterwards: the production pool's single user is now
`UserStatus: CONFIRMED` (was `FORCE_CHANGE_PASSWORD`), which is the state transition a successful
first sign-in and password change produces. The items validated were:

6. **Check your email** (`amazingbrandon@gmail.com`) for the Cognito invite with the temporary
   password. **On the Android phone, in Chrome**, open `https://soles.devaultsecurity.com/` while
   signed out: you must land on a sign-in form, not the app. Sign in, set a real password, and
   confirm you reach the page.
7. **On that same sign-in screen, confirm there is NO "Create account" or "Sign up" link.** Its
   absence is the visible face of admin-create-only. If one is present, `hideSignUp` regressed —
   though the pool would still refuse, as proven in 2.
8. **Be aware the gate is client-side today.** Viewing source on a signed-out load will show the
   static markup before hydration replaces it. That is expected at this milestone and is 0016's to
   tighten; it is recorded here so it is not later filed as a bug.
9. **Register a second passkey or note the recovery path** once you have signed in — §5.2 warns that
   a single-device credential plus a lost phone is a lockout, and the break-glass path is the AWS
   console.
