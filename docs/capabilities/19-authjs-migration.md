# 19-authjs-migration

> Status: tickets-generated
> Started: 2026-11-02 (design, ticket `0138`)
> Slot: **after the MVP ship** (D-425). It follows `0117`; nothing in `00`–`18` waits on it.

## What and why

Lost Soles signs in with a Cognito user pool. `school-hub`, on the same domain, signs in with
Auth.js and Google. D-175 chose to move Lost Soles onto the same Auth.js setup, so that one Google
sign-in covers every app on `*.devaultsecurity.com`. Adding Google as an IdP on the Cognito pool was
rejected permanently: it still needs two sign-ins. D-425 moved the work to after the MVP, because
re-running the handful of checks it invalidates costs less than holding the MVP for it.

This capability carries that out. It changes **who signs in and how the server learns it**. It does
not change whose data is whose. **The internal `uid` never changes** (D-471): every DynamoDB
partition key and every `users/<uid>/` and `raw/<uid>/` S3 key stays keyed by the operator's existing
Cognito `sub`, which becomes an opaque internal id. Re-keying a map that can never re-fog (D-020) to
save a lookup table would be the worst trade in the project.

## What the design work found

The ticket listed four hard items. Two were already settled before this design started, and one
problem the ticket never mentioned decides the rest.

| Ticket item | Answer | Where |
|---|---|---|
| 1. AppSync `defaultAuthorizationMode: "userPool"` | `iam`, and no browser calls AppSync at all | D-472 |
| 2. `allow.owner()` on every model | Rules drop to IAM-only; owner scoping is done in the route handlers, as for the CDK tables today | D-472 |
| 3. Browser access to `explored-r10.bin` | **Already none.** The browser reads the explored set from `/api/fog` and `/api/fog/blob/[gen]` as the SSR compute role. The `entity('identity')` rule has never covered an object. | D-228, D-456 |
| 4. AppSync subscriptions | **Never built, and dropped.** A run reaches an open tab on visibility/focus revalidation, which is a same-origin fetch the session cookie already authorizes. | D-364 |
| *(not in the ticket)* Identity | Google sign-in yields an **email**, and every key in the store is a **Cognito `sub`**. A committed email → uid map bridges them. | D-471 |

### Did D-175's three interim constraints hold?

| Constraint | Held? | Consequence here |
|---|---|---|
| The session is read in the `(app)/layout.tsx` gate and nowhere else | **No, but it held in spirit.** There is no `(app)/layout.tsx` (D-245). The session is read in three places: `middleware.ts`, `currentUserId()` in `lib/auth/owner.ts` (17 callers), and a second `fetchAuthSession` in `lib/map-home.ts`. | `0330` replaces `currentUserId()`'s body and folds `map-home.ts` into it. That covers every server-side reader. |
| Model authorization is uniform `allow.owner()` | **Yes**, with two `allow.authenticated()` custom mutations (`logWorkout`, `setActivityKind`). Their handlers take `identity.sub` and check the owner list (§5.5, D-456). | The mutations are the only identity-bearing AppSync path. `0331` moves them. |
| The S3 and subscription costs are flagged on the tickets that created them | Superseded before they came due: D-228 removed browser S3, D-364 removed subscriptions. | Nothing left to pay. |

**The real browser → AppSync surface is four transports**, all via `generateClient`:
`lib/skills/transport.ts` (ledger by seq, `Profile.get`, ledger by skill, `Landmark.list`),
`lib/runs/ledger-transport.ts` (ledger by activity), `lib/log/transport.ts` (`logWorkout`) and
`lib/run-kind/transport.ts` (`setActivityKind`). No browser code writes a model.

## Architectural impact

`01-architecture.md` changes shape in one respect, recorded as **D-472**: **AppSync stops being a
client-facing API.** The browser talks only to its own origin. `defineData` stays, as the owner of
the five model tables, because deleting it would delete the tables, and the activity and ledger
history in them is not rebuildable without a drill. Its default mode becomes `iam`. Amplify Gen 2
always adds IAM auth, and `defineData` needs no `defineAuth` in that mode (checked in
`@aws-amplify/backend-data`'s `convert_authorization_modes.js`). No principal is granted
`appsync:GraphQL`, so the API has no caller.

Concretely:

| Today | After |
|---|---|
| `defineAuth`: user pool + identity pool | **Deleted** at cutover (D-473). No Cognito resource remains in this app. |
| `defineData`, `defaultAuthorizationMode: "userPool"`, `allow.owner()` | `defaultAuthorizationMode: "iam"`, no owner rules, no caller |
| `defineStorage` `users/{entity_id}/*` → `entity('identity')` | The `access` rule is removed. It has never matched an object (D-228). The bucket, `versioned` and `keepOnDelete` are unchanged. |
| Browser → AppSync for skills, ledger, log, kind | Browser → same-origin route handlers. The SSR compute role reads the tables directly, as `/api/runs/*` already does, and invokes the two mutation Lambdas. |
| `logWorkout` / `setActivityKind` take `event.identity.sub` | They take `event.userId`, set by the route handler from `currentUserId()`. IAM on `lambda:InvokeFunction` (the SSR compute role only) is the trust anchor. The handlers still check `OWNER_USER_IDS`. |
| `currentUserId()` reads the Amplify cookie, then a Cognito bearer token | Reads the Auth.js session → checks the email against `AUTH_ALLOWED_EMAILS` → maps the email through `IDENTITIES` → returns the uid. Anything else returns `undefined`. |
| `<Authenticator>` in `components/auth-gate.tsx`, `AuthRefresh` (D-331) | `/` signed out shows one "Sign in with Google" action. Sign-in is a full-page OAuth redirect, so the server renders fresh after it and D-331's held-children dance has nothing to guard. |
| `Authorization: Bearer <Cognito ID token>` (D-183) | **Removed** (D-473). `/api/tickets/capture` is session-only. `tools/capture/capture.sh` is deleted. |

The Lambdas that authenticate as themselves (`process-activity`, `token-refresh`, `reconcile-sweep`,
`ingest-webhook`) are untouched. None of them reads a user session.

## The identity model (D-471)

- **Auth.js config is `school-hub`'s `lib/auth/config.ts`, copied verbatim** into
  `lib/auth/config.ts`, with `next-auth` pinned to the version `school-hub` runs. Lost Soles'
  additions live outside it, in `lib/auth/index.ts` and `lib/auth/owner-ids.ts`, so the shared
  module stays diffable against its source.
- **`basePath: "/api/authjs"`**, set in `lib/auth/index.ts`, not `config.ts`. `/api/auth/[source]/…`
  is the Strava OAuth route family (D-194), and Next refuses a `[...nextauth]` catch-all beside a
  `[source]` segment at the same level. The Google redirect URI is therefore
  `https://soles.devaultsecurity.com/api/authjs/callback/google`.
- **Two gates, in order.** `AUTH_ALLOWED_EMAILS` is the sign-in gate, in Auth.js's `signIn` and
  `authorized` callbacks, exactly as in `school-hub`. `selfSignUpEnabled: false` maps onto it (D-175),
  and an empty allowlist admits nobody. **`IDENTITIES`** in `lib/auth/owner-ids.ts` is the
  authorization: a committed `email → uid` table, hard-coded for D-183's reasons (identifiers, not
  credentials; a fail-closed control has no runtime dependency). An allowlisted email with no
  `IDENTITIES` entry is signed out.
- **Why email, not Google's `sub`** (operator, 2026-11-02): both of the operator's addresses are
  already in this public repository's commit history, so committing one in `IDENTITIES` publishes
  nothing new. The cost is that a change to the Google account's address unmaps it. That is a
  one-line commit, and it fails closed.
- **Why Lost Soles cannot lean on `school-hub`'s allowlist.** The session cookie is set on
  `.devaultsecurity.com` and signed with an `AUTH_SECRET` shared across the domain's apps, so every
  user `school-hub` admits holds a cookie Lost Soles can verify. Lost Soles' own `AUTH_ALLOWED_EMAILS`
  and `IDENTITIES` decide who is a Lost Soles user. **Holding a valid domain cookie is not being an
  account here, and is not Trigger A** (D-470).
- **Accepted, and stated:** any app holding the shared `AUTH_SECRET` can mint a session Lost Soles
  will accept, so the trust boundary is now every app on the domain that holds it. Signing out of
  one app signs out of all of them, because they share one cookie. Both are inherent to the SSO
  D-175 chose. The mitigation is that `AUTH_SECRET` is treated as a credential (S10 below), and
  `IDENTITIES` still limits a forged session to an email Lost Soles maps.
- **CSRF now applies.** A cookie on `.devaultsecurity.com` is sent by every sibling subdomain, and
  `SameSite=Lax` does not separate same-site origins. Every state-changing route handler refuses a
  request whose `Origin` is not `https://soles.devaultsecurity.com`. Server actions already get this
  check from Next. `08` §5.3's CSRF row ("bearer-token APIs … not CSRF-reachable") is rewritten.
- **No second factor of our own.** Google's account carries it, which is D-466's stated end state.

### Secrets (new `08` §3 rows)

| # | Credential | Lives in | Notes |
|---|---|---|---|
| S10 | `AUTH_SECRET` | SSM SecureString, the **same value** `school-hub` holds | Signs and encrypts the session JWT. **High:** anyone holding it can mint a session for any email. Rotating it signs out every app on the domain and must be done in all of them together. |
| S11 | `GOOGLE_CLIENT_SECRET` (+ `GOOGLE_CLIENT_ID`) | SSM SecureString | **`school-hub`'s OAuth client, reused** (operator, 2026-11-02). Lost Soles adds its redirect URI to that client. |
| — | `AUTH_ALLOWED_EMAILS`, `AUTH_COOKIE_DOMAIN`, `AUTH_URL` | SSM String | Config, not secrets. `AUTH_ALLOWED_EMAILS` is kept out of the repo for the same reason the code does not print emails (D-426), and the identity check below reads it. |

**Delivery:** `amplify.yml`'s build phase reads these from SSM into `.env.production`, server-only
names, never `NEXT_PUBLIC_`. That is `school-hub`'s mechanism, sourced from SSM rather than Amplify
console variables, matching `08` §3's single store. The build-output secret grep (§3.1) gains the S10
and S11 values. The stale `/amplify/lostsoles/root-sandbox-bcc61467ba/AGENT_SANDBOX_PASSWORD`
parameter is deleted. Its pool and account went with the torn-down sandbox stack.

## D-123 (D-470)

Replacing the account system changes what Trigger A means, so D-123 is reopened at proposal time and
**re-affirmed by D-470**. Its premise is unchanged: one person, a private map, full-fidelity traces.

- **Trigger A, restated:** it fires when Lost Soles' production `AUTH_ALLOWED_EMAILS`, or its
  committed `IDENTITIES`, holds any identity other than the owner's. A domain cookie held by a
  `school-hub` user does not fire it (above).
- **`scripts/check-d123-trigger-a.mjs` is rewritten**, not deleted. It reads `IDENTITIES` from source
  and the live `AUTH_ALLOWED_EMAILS` from SSM in `amplify.yml`'s backend phase. It fails on any entry
  that is neither an owner nor in `APPROVED_ACCOUNTS`, and on an allowlist and map that disagree. It
  prints counts and uids, never emails (D-426's rule). The build role's `ListUsersForD123TriggerA`
  statement is replaced by `ssm:GetParameter` on that one parameter.
- **§5.4's provisioning runbook** becomes "add the email to `AUTH_ALLOWED_EMAILS` and `IDENTITIES`
  with a fresh uid". It is still blocked by A-1…A-7, unchanged.
- **Triggers B and C are unaffected.** C's wording "without a valid Cognito session" becomes
  "without a valid Lost Soles session" (an allowlisted, mapped Auth.js session).

## Cutover (D-473)

A flag day, because there is one user and no data moves. The Cognito pool is **deleted at cutover**
(operator, 2026-11-02), not left as a rollback path. **There is no rollback to Cognito.** A reverted
`defineAuth` would create a new pool with a new `sub`, so the way back is to fix forward on Auth.js,
whose failure modes are all config.

1. **Operator, outside this repo:** add the redirect URI above to `school-hub`'s Google OAuth client.
   Set `AUTH_COOKIE_DOMAIN=.devaultsecurity.com` on `school-hub` and redeploy it. **As of
   2026-11-02 it is unset** (Amplify app `d1at27fw1o7tr4`, app-level variables), so `school-hub`'s
   cookie is host-only and SSO cannot work until this is done. Its config comment says to set it
   "once a second app actually uses this module", and this is that app. `school-hub` is in account
   `286588821906`, so the agent copies its `AUTH_SECRET`, `GOOGLE_CLIENT_ID` and
   `GOOGLE_CLIENT_SECRET` into Lost Soles' SSM paths with `aws amplify get-app`, without printing
   them. Changing `school-hub`'s own variables is the operator's call, confirmed at the time.
2. **`0330` deploys:** Auth.js is live beside Cognito. `currentUserId()` accepts either session, so
   nothing changes for the operator yet.
3. **`0331` deploys** (independent of `0330`): AppSync leaves the browser.
4. **`0332` deploys — the flag day.** The Authenticator, `AuthRefresh`, the Cognito fallback in
   `currentUserId()` and the bearer path are removed. The operator signs in with Google once. **This
   is the capability's one perceptual check.**
5. **`0333`** rewrites account deletion for the new identity.
6. **`0334` deploys:** `defineAuth` is deleted, the data and storage rules change, and the posture
   and Trigger A checks are rewritten **in the same deploy**. The existing posture check fails closed
   on a missing pool, so it cannot lag. `0014`'s criterion 3 is annotated as superseded in that
   commit (D-175).
7. **`0335`** re-runs `0114`'s Trigger A and A-6 checks and `0115`'s posture checks against the new
   auth (D-425).

## What happens to the named artifacts

| Artifact | Fate |
|---|---|
| `scripts/check-auth-posture.mjs` | **Rewritten, never deleted** (D-175), in `0334`. New assertions: no Cognito user pool or identity pool tagged with this app's `amplify:app-id` exists; the data API's auth modes are exactly `AWS_IAM`; `AUTH_ALLOWED_EMAILS` in SSM is non-empty; the Google provider is the only Auth.js provider in the build. `--self-test` proves each one fires. Fails closed, as now. |
| `0014` criterion 3 ("No social IdP…") | Annotated `— superseded by D-175/D-473 at cutover (0334)` in `0334`'s commit, not before. |
| `0130`'s agent account | **Already gone**: the sandbox stack and pool `us-east-1_RV7QIiViX` no longer exist (checked 2026-11-02). Only its SSM password parameter remains, and `0330` deletes it. No replacement identity is made. Agent smoke tests run against AWS directly and through the test suite (D-229), and anything visual is the operator's perceptual check. |
| `lib/auth/bearer.ts`, `tools/capture/capture.sh` | Deleted in `0332` (D-473). D-183 is superseded. |
| `scripts/delete-account` path (D-400, D-403) | `0333`: "disable, global sign-out, delete the Cognito user last" becomes "remove the email from `AUTH_ALLOWED_EMAILS` first and from `IDENTITIES` last". `--delete-owner` stays. `08` §6.4 is amended. |
| `OWNER_USER_IDS` | Unchanged. It still holds the uid `5488e4b8-…`, and `IDENTITIES` maps the owner's email onto it. |

## User-facing changes

- Signed out, `/` shows the app name and one **Sign in with Google** button in place of the email
  and password form. It goes to Google's account chooser (`prompt: select_account`).
- Already signed in to `school-hub` in the same browser → Lost Soles opens signed in. **That is the
  point of the capability.**
- `/settings` → Sign out signs out of every app on the domain.
- Nothing else changes. The map, run log, skills and `/log` behave the same, now over same-origin
  routes.

## Data model changes

**None to stored data.** No table is replaced, re-keyed or migrated. `0334`'s gate is the synthesized
CloudFormation diff: **zero `Replacement: True` on any `AWS::DynamoDB::Table`, and the storage
bucket unchanged.** Removing `allow.owner()` drops the implicit `owner` field from the GraphQL schema.
The attribute stays on existing rows and nothing reads it.

## API surface changes

New same-origin routes, all through `withNoStore` (C-3) and keyed by `currentUserId()`:

- `GET /api/skills/ledger`, `GET /api/skills/profile`, `GET /api/skills/landmarks`. These replace
  `lib/skills/transport.ts`'s AppSync calls one for one. The route names are the ticket's to settle,
  but the shapes must match today's transport return types so the components do not change.
- `GET /api/runs/[activityId]/ledger`, replacing `lib/runs/ledger-transport.ts`.
- `POST /api/log`, which invokes `log-workout`, and `POST /api/runs/[activityId]/kind`, which invokes
  `set-activity-kind`. Both check `Origin`.
- `/api/authjs/*`, Auth.js's own routes.

Removed: the AppSync endpoint from the CSP's `connect-src`, the two Cognito endpoints from it
(`lib/security-headers.ts`), and the bearer branch from `middleware.ts`.

## Out of scope

- **`school-hub`'s code.** Only its OAuth client and environment are touched, by the operator.
- **A second user.** Trigger A is restated, not exercised.
- **Deleting `defineData`** or moving its tables to CDK. That means table replacement, for nothing.
- **Passkeys or TOTP.** Google carries the second factor (D-466).
- **A non-browser client.** If one is ever wanted, it gets its own decision. D-183's verified-token
  shape, against Google's JWKS, is the obvious start.

## Open questions

None. The ticket's five, answered:

1. *Real-time path* — none exists (D-364). Visibility/focus revalidation is same-origin and
   cookie-authorized.
2. *`explored-r10.bin`* — already served from our own origin (D-228). No presigned URL, no identity
   pool.
3. *Does `01` change shape?* — Yes. AppSync stops being client-facing (D-472).
4. *Pool deleted or dormant?* — Deleted at cutover (D-473, operator).
5. *Cutover?* — Flag day, sequenced above (D-473).

## Tickets

- `0330`: Auth.js with Google beside Cognito, and the email → uid identity map — config copied
  verbatim, `/api/authjs`, SSM delivery, `currentUserId()` accepts both sessions, `map-home.ts`
  folded in, `Origin` checks on POSTs.
- `0331`: AppSync leaves the browser — four transports become same-origin routes, the two mutations
  are invoked by the SSR role with a server-set `userId`.
- `0332`: Cutover — Google sign-in replaces the Authenticator, the Cognito session and the bearer
  path are removed, `capture.sh` is deleted. The operator signs in once.
- `0333`: Account deletion on the Auth.js identity — runbook, script, `08` §6.4.
- `0334`: Cognito removed — `defineAuth` deleted, `iam` data, storage rule dropped, posture and
  Trigger A checks rewritten in the same deploy, `0014` c3 annotated.
- `0335`: Re-run the D-123 and auth-posture checks against the new auth (D-425).

## Acceptance for the capability as a whole

- In one desktop browser, signing in to `school-hub` and then opening `soles.devaultsecurity.com`
  lands on the map **signed in, with no second sign-in**.
- A Google account not in `AUTH_ALLOWED_EMAILS` is refused at sign-in, and a hand-minted session for
  an allowlisted but unmapped email gets the signed-out response from every authed route. Both are
  proven by tests.
- No Cognito user pool or identity pool tagged with this app exists. The data API's only auth mode
  is IAM. The deployed CSP names no Cognito or AppSync host.
- The operator's map, Total XP and run log are identical before and after: Σ ledger and
  `Profile.exploredGeneration` are compared across the cutover.

## Dependencies

`0117` (MVP shipped, D-425). Outside the repo: `school-hub`'s Google OAuth client and its
`AUTH_SECRET` (cutover step 1).

## Audit

_Appended by `/tickets audit` at close. See [`AUDIT.md`](AUDIT.md)._

## Reflection

_Filled in at the REFLECT step, after USE._
