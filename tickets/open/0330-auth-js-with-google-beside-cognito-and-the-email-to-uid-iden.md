---
id: 330
slug: auth-js-with-google-beside-cognito-and-the-email-to-uid-iden
title: Auth.js with Google beside Cognito, and the email to uid identity map
type: feature
priority: med
status: open
size: m
capability: 19-authjs-migration
depends_on: [117]
blocked_by: []
source: agent
created: 2026-11-02T17:17:55Z
---


## Description

Capability `19-authjs-migration`, step 2 of its cutover. Design: `docs/capabilities/19-authjs-migration.md`
§"The identity model" and §"Secrets". Decisions: **D-471** (identity, basePath, secrets, CSRF),
**D-470** (D-123 re-affirmed; Trigger A restated).

Auth.js with Google goes live **beside** Cognito. Nothing changes for the operator yet: the
Authenticator still renders and Cognito sessions still work. What lands is the second way in, and the
one function every server reader goes through learns to accept it.

- `lib/auth/config.ts` is `school-hub`'s `lib/auth/config.ts` **copied verbatim** (`../school-hub`),
  `next-auth` pinned to `school-hub`'s version. `lib/auth/index.ts` wraps it with
  `basePath: "/api/authjs"`, because `/api/auth/[source]` is the Strava route family (D-194).
  Route: `app/api/authjs/[...nextauth]/route.ts`.
- `lib/auth/owner-ids.ts` gains `IDENTITIES`, a committed `email → uid` table. The owner's email maps
  to `5488e4b8-d081-7014-748e-edd1937f8083`, the existing uid. **Ask the operator which Google
  address signs in**; do not guess between the two in the git history.
- `currentUserId()` tries the Auth.js session first: an email that passes `isAllowedEmail` **and** has
  an `IDENTITIES` entry → that uid. Otherwise it falls back to today's Cognito cookie, then bearer.
  `lib/map-home.ts`'s own `fetchAuthSession` is folded into `currentUserId()`, so one function reads
  the session server-side. `middleware.ts` admits either session.
- Secrets per the design's table: SSM parameters for `AUTH_SECRET` (school-hub's value),
  `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` (school-hub's client), `AUTH_ALLOWED_EMAILS`,
  `AUTH_COOKIE_DOMAIN`, `AUTH_URL`. `amplify.yml`'s build phase writes them into `.env.production`,
  server-only names. The §3.1 build-output grep gains the S10/S11 values.
- Every state-changing route handler refuses a non-matching `Origin` (D-471: the domain cookie makes
  sibling subdomains same-site).
- Delete the stale SSM parameter `/amplify/lostsoles/root-sandbox-bcc61467ba/AGENT_SANDBOX_PASSWORD`.
  Its pool no longer exists (`0130`'s account is gone).

## Acceptance criteria

- [ ] `lib/auth/config.ts` is byte-identical to `school-hub`'s, apart from a header comment naming the
      source commit. A test or script asserts the diff is header-only.
- [ ] `GET /api/authjs/providers` on production returns exactly one provider, `google`.
- [ ] `currentUserId()` unit tests: a mapped allowlisted email → owner uid; an allowlisted unmapped
      email → `undefined`; a mapped email removed from the allowlist → `undefined`; an empty allowlist
      → `undefined`; no Auth.js session → today's Cognito path, unchanged.
- [ ] No server module other than `lib/auth/owner.ts` and `middleware.ts` reads a session
      (`fetchAuthSession`/`auth()`). A grep-based test pins it.
- [ ] A POST with a foreign `Origin` to `/api/tickets/capture` and to the source `disconnect` route
      gets 403, with a test for each.
- [ ] The secret grep over `.next/static` covers `AUTH_SECRET` and `GOOGLE_CLIENT_SECRET` and fails
      on a planted value (self-test).
- [ ] `08` §3 gains rows S10 and S11, and §5.3's CSRF row is rewritten, citing D-471.
- [ ] The stale `AGENT_SANDBOX_PASSWORD` parameter is deleted.

## Notes

Cutover step 1 must be done first, outside this repo (design §Cutover): the redirect URI
`https://soles.devaultsecurity.com/api/authjs/callback/google` on `school-hub`'s OAuth client, and
`AUTH_COOKIE_DOMAIN` on `school-hub` (unset as of 2026-11-02; confirm with the operator before
changing another app's variables). `school-hub` is Amplify app `d1at27fw1o7tr4` in this account. Copy
its `AUTH_SECRET` and Google client values from `aws amplify get-app` into SSM without printing them.

Does Next's middleware runtime see `.env.production` values at runtime or only inlined at build?
Prove it on the deploy with the providers smoke test. Do not assume it.

## Operator validation

Agent smoke tests: `curl` the providers route; deploy log shows the secret grep ran with the new
values; `aws ssm get-parameter` on the deleted path returns ParameterNotFound. No operator step:
nothing visible changes in this ticket.

D-123 trigger checked? **A** — restated by D-470, which re-affirms D-123. `IDENTITIES` holds the
owner only.
