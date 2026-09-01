---
id: 129
slug: cross-app-sso-on-devaultsecurity-com-evaluate-google-sign-in
title: Cross-app SSO on devaultsecurity.com — evaluate Google sign-in against 08 section 5.1
type: chore
priority: med
status: closed
size: m
capability: 02-deploy-and-auth
depends_on: []
blocked_by: []
source: agent
created: 2026-08-31T15:31:42Z
closed: 2026-09-01T21:32:40Z
---

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

- [x] The two options above are costed concretely: what changes in `amplify/data`, `amplify/storage`,
      and any code reading the Cognito session, for the Auth.js path.
- [x] A decision is recorded as a new `D-xxx` in `docs/decisions/DECISIONS.md`, explicitly superseding
      or re-affirming `08-security-privacy.md` §5.1, with the SSO benefit named rather than dismissed.
- [x] If the decision keeps Cognito with no IdP, §5.1 is annotated with the reasoning so this is not
      re-litigated a third time.
- [x] If the decision adds any provider, the `no federated identity providers` assertion in
      `scripts/check-auth-posture.mjs` is amended in the same commit, and 0014's criterion 3 is
      annotated as superseded.
- [x] Whichever way it goes, `selfSignUpEnabled` stays OFF. Federation is about *how* a known account
      authenticates, never about *whether an unknown person can create one* — an IdP that lets any
      Google account sign in is a public registration endpoint wearing a different hat.

## Notes

Do not treat this as a config toggle. The last line of the acceptance criteria is the one that
matters: the security posture 0014 established is about who may hold an account, and no SSO
convenience is allowed to quietly reopen that.

## Operator validation

None — nothing deployed or configured changed. `amplify/auth/resource.ts` is untouched,
`scripts/check-auth-posture.mjs` still asserts `no federated identity providers` and still passes,
and `selfSignUpEnabled: false` is exactly where it was. The deliverable of this ticket is a decision
and its record.

The check that matters is the one only the operator can make, and it was made in session on
2026-09-01: **Auth.js with Google is the committed final state; Cognito continues until the game is
complete.** That is D-175.

## Resolution

**The decision, made by the operator on 2026-09-01: option 2 — Auth.js displacing Cognito, with
Google — is the committed final state, and Cognito is kept until the game is complete.** Recorded as
**D-175**, which supersedes `08-security-privacy.md` §5.1's social-IdP reasoning rather than
re-affirming it. Option 1 (Google as a federated IdP on Lost Soles' own Cognito pool) was rejected
outright: it takes on the external trust dependency §5.1 warned about and still leaves the operator
signing in twice, because `school-hub` authenticates with Auth.js cookies and not Cognito. It is the
worst of the three.

### Criterion 1 — the Auth.js path, costed

The costing changed the shape of the answer, so it is worth stating what it found. The Cognito
surface is **narrower than this ticket's Description assumed**, because `01-architecture.md` already
keeps most things off the client-authenticated API: its rejected-alternatives table records that the
client never queries cells (§5) and that OAuth tokens must not be reachable from a
client-authenticated API at all — both live in CDK DynamoDB tables with explicit IAM grants (§2).
So the migration is not "rewrite authorization everywhere". It is four specific things:

1. **`amplify/data/resource.ts` — `defaultAuthorizationMode: "userPool"` must go.** An Auth.js
   session is a signed cookie, not a Cognito JWT and not identity-pool credentials, so AppSync
   cannot authorize the caller as a user-pool principal. The replacement is either `iam` with all
   access through Next.js server components and route handlers (which already hold a role), or a
   Lambda authorizer that validates the Auth.js JWT. Not `apiKey` — that is a public endpoint.
2. **Every model's `allow.owner()` must become explicit.** `allow.owner()` derives ownership from
   the Cognito `sub` claim; under IAM or a Lambda authorizer there is no `sub`, so the owner field
   is set and checked server-side, or supplied as a custom identity claim. Today this is one
   placeholder model (`DeploySmokeTest`). It grows with the models capabilities `04`, `06`, `09`
   and `13` add — which is the main reason to keep the rule uniform in the meantime.
3. **`amplify/storage/resource.ts` — `allow.entity("identity")` cannot survive.** `{entity_id}`
   resolves to a Cognito identity-pool identity id, and there is no identity pool after the
   migration. Browser access to `explored-r10.bin` and the raw-trace archive moves to presigned
   URLs minted by a route handler that checks the Auth.js session. This also changes how the map
   renderer fetches the fog blob, which is capability `07`/`08` work.
4. **The browser's AppSync subscriptions are the genuinely awkward piece.** `01-architecture.md` §4
   step 17 has the browser holding `onCreateActivity` / `onUpdateProfile` over a WebSocket, and it
   exists specifically because Amplify has no on-demand ISR — a Strava webhook cannot call
   `revalidatePath`. A cookie does not sign an AppSync WebSocket handshake, so the real-time path
   needs re-authorizing under whichever mode replaces `userPool`. This is capability `14`.

Code reading the Cognito session is, by contrast, cheap and already concentrated: §5 puts the auth
gate in `(app)/layout.tsx` as a server component that reads the session once. Today only
`app/layout.tsx` and `app/page.tsx` touch it at all. The sign-in page swaps a Cognito
Authenticator/hosted UI for an Auth.js Google button. `0130`'s throwaway agent account in the
sandbox pool needs an Auth.js-side equivalent, and `scripts/check-auth-posture.mjs` gets rewritten
against the new posture rather than deleted.

**Verdict: capability-sized, not ticket-sized** — as the Description predicted — but for a different
reason than it gave. The volume is small. The difficulty is concentrated in items 3 and 4, and both
are decisions that cannot be made well today because the access patterns they would be designed
against do not exist yet: capability `04` is where `Activity`, `XpLedgerEntry` and `ExploredCell`
are defined at all. Doing the migration now means designing an authorization story for a data model
nobody has written.

### Why Cognito stays for now, and until when

Not "don't stop mid-flight". The sequencing argument is that `16-rebuild-drill` and
`18-mvp-hardening` are the two capabilities whose value a later auth swap destroys — hardening and
drilling an auth stack that is about to be deleted is work done twice. So the migration slots
**after `15-two-map-modes-and-cold-territory` and before `16-rebuild-drill`**: the game is complete,
SSO arrives while the operator starts actually using it daily, and the drill and the hardening pass
exercise the final auth rather than the interim one.

Filed as ticket **0138** (`type: design`, deliverable is the capability doc).

### Three constraints this decision puts on the capabilities in between

Named here because they are the difference between a cheap migration and an expensive one, and the
tickets that create the coupling are the ones that must honour them:

1. **The session is read in the `(app)/layout.tsx` gate and nowhere else.** §5 already specifies
   this; D-175 makes it load-bearing rather than stylistic.
2. **Model authorization stays uniform — `allow.owner()` on every model, no bespoke per-model
   rules.** Single-user means there is no reason to diverge, and a uniform rule is one mechanical
   pass to swap instead of N judgement calls.
3. **The two known migration costs are flagged on the tickets that create them** — S3 client access
   in `07`/`08`, subscriptions in `14` — so they are visible when the swap comes rather than
   discovered during it.

### Criterion 5 — the line that does not move

`selfSignUpEnabled: false` stays off, and D-175 records the mapping that makes it mean something
after Cognito is gone: **the Auth.js equivalent is `school-hub`'s `AUTH_ALLOWED_EMAILS` allowlist.**
Google sign-in with no allowlist is a public registration endpoint wearing a different hat, which is
precisely what §5.1 calls the single most important line in the auth config. Criterion 4 does not
fire — no provider was added, `amplify/auth/resource.ts` is untouched, and
`check-auth-posture.mjs`'s `no federated identity providers` assertion remains true and stays in
place until the migration commit rewrites it.

### One defect found while working this, filed separately

This ticket's body carried **two** sets of `## Description`, `## Acceptance criteria`, `## Notes`
and `## Operator validation` — a `TODO` stub block from `create`, followed by the real content.
`validate` passed it, because the section rules only check that a required heading *exists*, not
that there is exactly one of each. The practical harm is real: `acceptance()` collects checkboxes
from every `## Acceptance criteria` section, so this ticket had a phantom unchecked `- [ ] TODO`
that would have blocked its own close. The stub block was removed here; the validator gap is filed
as **0139**.
