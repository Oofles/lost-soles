---
id: 138
slug: authjs-with-google-replaces-cognito-design-the-migration
title: Auth.js with Google replaces Cognito — design the migration capability
type: design
priority: med
status: open
size: m
capability: null
depends_on: []
blocked_by: []
source: agent
created: 2026-09-01T21:31:18Z
---

## Description

**The decision is already made — this ticket designs how, not whether.** D-175 (2026-09-01, ticket
`0129`) commits Lost Soles to **Auth.js with Google sign-in, displacing Cognito**, for real
cross-subdomain SSO across `devaultsecurity.com`. `school-hub`'s `lib/auth/config.ts` is written to
be copied verbatim into the other apps on the domain, with
`AUTH_COOKIE_DOMAIN=".devaultsecurity.com"` covering `soles.devaultsecurity.com`.

**Do not re-open the question.** `08-security-privacy.md` §5.1 carries an annotation pointing here;
adding Google as a federated IdP on the existing Cognito pool is rejected permanently (it buys the
external trust dependency and still needs two sign-ins). D-175 has the reasoning.

**Scheduling is also decided: after `15-two-map-modes-and-cold-territory`, before
`16-rebuild-drill`.** Those two capabilities plus `18-mvp-hardening` are what a later swap would
invalidate — hardening and drilling an auth stack about to be deleted is work done twice.

`0129`'s Resolution costs the path concretely. In short, four things move, and the last two are the
hard ones:

1. `amplify/data/resource.ts` — `defaultAuthorizationMode: "userPool"` must go. An Auth.js session
   is a signed cookie, not a Cognito JWT. Candidates: `iam` with all access through server
   components and route handlers, or a Lambda authorizer validating the Auth.js JWT. Not `apiKey`.
2. Every model's `allow.owner()` — it derives ownership from the Cognito `sub` claim, which will not
   exist. Owner becomes an explicit server-set field, or a custom identity claim.
3. `amplify/storage/resource.ts` — `allow.entity("identity")` cannot survive without an identity
   pool. Browser access to `explored-r10.bin` and the raw-trace archive moves to presigned URLs
   minted by a route handler that checks the session.
4. The browser's AppSync subscriptions (`01-architecture.md` §4 step 17). They exist because Amplify
   has no on-demand ISR — a Strava webhook cannot call `revalidatePath` — and a cookie does not sign
   an AppSync WebSocket handshake. This is the piece with no obvious answer yet.

## Acceptance criteria

- [ ] A capability doc exists at `docs/capabilities/NN-authjs-migration.md` with no open questions,
      and it is added to `docs/capabilities/ROADMAP.md` and `docs/09-roadmap.md` §3 in its decided
      slot (after `15`, before `16`).
- [ ] It answers item 4 above — how the browser's real-time path is authorized without a Cognito
      principal — or records explicitly that the subscription mechanism is being replaced, and with
      what. This is the open question the whole capability turns on.
- [ ] It answers item 3 — how the map renderer fetches `explored-r10.bin` without identity-pool
      credentials.
- [ ] `selfSignUpEnabled: false` → `AUTH_ALLOWED_EMAILS` is carried through as a named requirement,
      not an implementation detail. Google sign-in with no allowlist is a public registration
      endpoint (D-175, `08` §5.1).
- [ ] It says what happens to `scripts/check-auth-posture.mjs` — rewritten against the new posture,
      never deleted — and to `0014`'s criterion 3, annotated as superseded in the migration commit.
- [ ] It says what happens to `0130`'s throwaway agent account in the sandbox pool, which is a
      Cognito account.
- [ ] `01-architecture.md` §1 table rows 2 and 3 (Cognito user pool, Cognito identity pool) and §5's
      auth gate are amended or annotated, with a `D-xxx` if the architecture changes shape.

## Options considered

**The auth choice itself is settled — D-175 — and is not reopened here.** For the record, so this
ticket is self-contained:

| Option | Verdict |
|---|---|
| Keep Cognito, no IdP | The interim state, not the end state. No SSO; the operator signs in to each app separately. |
| Google as a federated IdP **on the Cognito pool** | **Rejected permanently.** Takes the external trust dependency `08` §5.1 warned about and still needs two sign-ins, because `school-hub` uses Auth.js cookies rather than Cognito. Worst of the three. |
| **Auth.js with Google, displacing Cognito** | **Chosen (D-175).** The only path to a session cookie valid across `*.devaultsecurity.com`. |

What this capability must choose between is narrower — how the client is authorized once the
Cognito principal is gone:

| For AppSync | Trade |
|---|---|
| `iam`, all access via server components and route handlers | Simplest to reason about; the browser stops talking to AppSync directly, which collides with the subscription path in item 4. |
| Lambda authorizer validating the Auth.js JWT | Keeps the browser as a first-class AppSync client, subscriptions included; more moving parts, and a Lambda on the auth path. |
| `apiKey` | Not an option. A public endpoint. |

## Open questions

1. **How is the browser's real-time path authorized?** This is the one the capability turns on.
   A cookie does not sign an AppSync WebSocket handshake. Either the Lambda authorizer above, or the
   subscription mechanism is replaced — and if replaced, by what? The constraint that produced it
   has not gone away: Amplify has no on-demand ISR, so a Strava webhook cannot invalidate a page
   (`01-architecture.md` §4 step 17, §6).
2. **How does the map renderer fetch `explored-r10.bin`** without identity-pool credentials?
   Presigned URLs from a route handler is the obvious answer; whether that is acceptable for a blob
   the renderer may re-fetch often is a real question, not a rhetorical one.
3. **Does `01-architecture.md` change shape, or only its auth rows?** If AppSync stops being a
   client-facing API, that is an architecture change and needs its own `D-xxx`.
4. **Is the Cognito user pool deleted or left dormant?** `0131` is a live reminder that a pool which
   cannot be updated in place is expensive to be wrong about.
5. **What is the cutover?** Single user, so a flag day is plausible — but the answer should be
   written down rather than assumed.

## Notes

**Three constraints D-175 puts on every capability built before this one.** If they have held, this
migration is mechanical in items 1 and 2; if they have drifted, it is not. Check them first:

1. The session is read in the `(app)/layout.tsx` gate and nowhere else.
2. Model authorization is uniform `allow.owner()`, with no bespoke per-model rules.
3. The S3-access and subscription costs are flagged on the tickets that created them (`07`/`08`
   and `14`).

**This is not `deferred` (D-174).** It waits on us and on a schedule we chose, which is what a
capability slot expresses. `deferred` is for waiting on the world.

Related: `0129` (the decision and its costing), `0014` (the posture this must preserve), `0130`
(the sandbox account), D-175, D-083.

## Operator validation

None yet — the deliverable is a capability doc. Operator validation belongs on the implementation
tickets that doc produces, and will centre on one thing: signing in to Lost Soles at
`soles.devaultsecurity.com` and to `school-hub` on the same domain, in one browser, with **one**
sign-in.
