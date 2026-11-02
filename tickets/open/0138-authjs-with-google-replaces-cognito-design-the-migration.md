---
id: 138
slug: authjs-with-google-replaces-cognito-design-the-migration
title: Auth.js with Google replaces Cognito — design the migration capability
type: design
priority: med
status: open
size: m
capability: null
depends_on: [100, 101, 197, 210, 211, 117]
blocked_by: []
source: agent
created: 2026-09-01T21:31:18Z
started: 2026-11-02T17:07:43Z
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

- [x] A capability doc exists at `docs/capabilities/NN-authjs-migration.md` with no open questions,
      and it is added to `docs/capabilities/ROADMAP.md` and `docs/09-roadmap.md` §3 in its decided
      slot ~~(after `15`, before `16`)~~ **after the MVP ship (D-425)**. *(Amended 2026-11-02 at
      close: D-425 moved the slot on 2026-10-22, after this criterion was written. The old slot had
      already passed when capability `16` closed.)*
- [x] It answers item 4 above — how the browser's real-time path is authorized without a Cognito
      principal — or records explicitly that the subscription mechanism is being replaced, and with
      what. This is the open question the whole capability turns on.
- [x] It answers item 3 — how the map renderer fetches `explored-r10.bin` without identity-pool
      credentials.
- [x] `selfSignUpEnabled: false` → `AUTH_ALLOWED_EMAILS` is carried through as a named requirement,
      not an implementation detail. Google sign-in with no allowlist is a public registration
      endpoint (D-175, `08` §5.1).
- [x] It says what happens to `scripts/check-auth-posture.mjs` — rewritten against the new posture,
      never deleted — and to `0014`'s criterion 3, annotated as superseded in the migration commit.
- [x] It says what happens to `0130`'s throwaway agent account in the sandbox pool, which is a
      Cognito account.
- [x] `01-architecture.md` §1 table rows 2 and 3 (Cognito user pool, Cognito identity pool) and §5's
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

**2026-10-19, capability `14` audit (D-364):** the browser's AppSync subscriptions (item 4, open
question 1) were never built, and D-364 drops them. A run reaches an open tab when it becomes visible or
gains focus (`05` §7.4 trigger 2, a same-origin fetch), and the plinth shows it (D-185). There is no
real-time path to authorize, so the answer this ticket's criterion asks for is now "replaced by
visibility/focus revalidation, which a session cookie already authorizes". Re-read item 4 and open question 1 in
that light before writing the capability doc.

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

**2026-09-29 — held out of the ready set until capability `15` is built.** `next` offered this
ticket twice ahead of the `09` burn-down, because it has no capability number and so is never
gated. The operator asked for it to wait for the capabilities before it. Its slot is decided (after
`15`, before `16`), so that is now expressed as `depends_on` on every open `15` ticket — 0100 and
0101 (the ends of the planned 0097→0098→0099 chain) plus 0197, 0210 and 0211. Not `deferred`
(D-174 — the wait is on us) and not a priority change (the work is not less important, only later).
If `15` generates more tickets before it closes, add them here too.

**2026-10-22 — D-425: moved to after the MVP ship.** Capability `16` closed before this ticket started, so
D-175's slot passed. It now depends on `0117`, the MVP definition-of-done sweep. When it builds,
re-run `0114`'s Trigger A and A-6 checks and `0115`'s Cognito posture checks against the new auth.

## Resolution

**Deliverable:** `docs/capabilities/19-authjs-migration.md`, six tickets `0330`–`0335`, and decisions
D-470–D-473. No code changed.

**What the design found, in order of consequence:**

1. **The identity problem the ticket never named.** Every DynamoDB partition key and every
   `users/<uid>/`/`raw/<uid>/` S3 key is the Cognito `sub`, and Auth.js's session carries an email.
   Resolved by keeping the `sub` as the permanent internal uid and mapping email → uid in a committed
   `IDENTITIES` table (D-471). No data moves. Re-keying would have meant rewriting a map that cannot
   re-fog.
2. **Two of the four "hard" items were already settled.** Item 3 (browser S3) by D-228: the explored
   set has been served from `/api/fog` since `0054`, and `entity('identity')` never covered an
   object. Item 4 (subscriptions) by D-364: never built, then dropped. The ticket's Notes flagged
   item 4. Item 3 was not flagged, and reading D-228 is what settled it.
3. **The real AppSync surface is four browser transports**, two of them mutations
   (`logWorkout`/`setActivityKind`). D-472 moves them to same-origin routes and keeps `defineData`
   as the table owner under IAM-only auth. Checked in `@aws-amplify/backend-data`
   (`convert_authorization_modes.js`) that Gen 2 always adds IAM auth and needs no `defineAuth` for
   it. A Lambda authorizer was rejected, because an `httpOnly` encrypted cookie on our origin cannot
   reach AppSync's origin.
4. **A route collision:** Auth.js's default `/api/auth/[...nextauth]` cannot sit beside the Strava
   `/api/auth/[source]` family (D-194). `basePath: "/api/authjs"`.
5. **CSRF becomes real.** A `.devaultsecurity.com` cookie makes sibling subdomains same-site, so
   `SameSite=Lax` no longer separates them. `Origin` checks on every state-changing route (D-471).
   `08` §5.3's "not CSRF-reachable" row is rewritten in `0330`.
6. **`school-hub` has no `AUTH_COOKIE_DOMAIN` set** (checked: Amplify app `d1at27fw1o7tr4`, same
   account). SSO cannot work until it is set. It is cutover step 1, the operator's call.

**D-175's three interim constraints:** (2) held, and (3) was overtaken by D-228/D-364. (1) did not hold
literally: there is no `(app)/layout.tsx` (D-245), and the session is read in `middleware.ts`,
`currentUserId()` and a stray `fetchAuthSession` in `lib/map-home.ts`. It held in spirit, because
everything funnels through one function. `0330` folds `map-home.ts` in.

**Operator decisions, 2026-11-02, one batched round:** drop the bearer path (D-183 superseded,
`capture.sh` deleted); **delete the Cognito pool at cutover**, not dormant, so there is no rollback
to Cognito; reuse `school-hub`'s Google OAuth client; map by **email**. I recommended Google's `sub`
because the repo is public. Both of the operator's addresses are already in this repo's public
commit history, so email publishes nothing new, and D-471 records that.

**D-123:** reopened at proposal time and **re-affirmed by D-470**, with Trigger A restated against the
allowlist and identity map. A `school-hub` user holding a domain cookie is explicitly not an account
here.

**Criterion answers:** item 4 → D-364 + doc §"What the design work found"; item 3 → D-228; the
allowlist is a named requirement (D-471, design §"The identity model"); `check-auth-posture.mjs`
rewritten in `0334` with its new assertions listed, and `0014` c3 annotated there; `0130`'s account
is already gone with its pool, and its stale SSM parameter is deleted in `0330`; `01` §1, §2 rows
2–3 and §5 are annotated and point at D-472/D-473.

**Process deviations, stated:** I did not read `DECISIONS.md` (6,251 lines) in full at the
capability start. I read every headline, plus the auth-relevant decisions in full: D-123, D-175,
D-183, D-228, D-331, D-364, D-400, D-403, D-425, D-426, D-428, D-456 and D-466. `tickets.mjs create
--depends-on` was silently ignored (the flag is `--depends`). `0330`'s `depends_on` was fixed by
hand, before `index`. The `ROADMAP.md` status column is stale for `00`–`18` (it still says `01` is
next). Only row `19` was added. Correcting the table is outside this ticket.

**Files:** `docs/capabilities/19-authjs-migration.md` (new); `docs/decisions/DECISIONS.md` (D-470–473,
plus supersession pointers on D-183 and D-331); `docs/01-architecture.md` §1, §2, §5 notes;
`docs/08-security-privacy.md` §2.4 Trigger A and §5.1 notes; `docs/09-roadmap.md` §1, §3;
`docs/capabilities/ROADMAP.md`; `tickets/open/0330`–`0335`.

## Operator validation

None for the operator: the deliverable is a design. The perceptual check the original text named
(one sign-in across `school-hub` and Lost Soles) is an `(operator)` criterion on `0332`.

Agent checks, 2026-11-02, `AWS_PROFILE=devault`: `cognito-idp list-user-pools` shows the production
pool `us-east-1_3lreDA1d1` tagged `amplify:app-id = d14fhvl4rp79nn`; the other two pools are
house-hunt-dashboard's; `0130`'s sandbox pool `us-east-1_RV7QIiViX` is absent, and its SSM password
parameter still exists. `amplify get-app d1at27fw1o7tr4` (variable names only) shows `school-hub`
holds `AUTH_SECRET`, `AUTH_ALLOWED_EMAILS`, `AUTH_URL`, `GOOGLE_CLIENT_*` and no
`AUTH_COOKIE_DOMAIN`. `gh repo view` reports the repository `PUBLIC`. A 30-day CloudWatch search of
the SSR log group for `tickets/capture` returned nothing. `tickets.mjs validate` was run before
commit.

D-123 trigger checked? **A** — proposed (the account system changes), reopened and re-affirmed by
D-470.
