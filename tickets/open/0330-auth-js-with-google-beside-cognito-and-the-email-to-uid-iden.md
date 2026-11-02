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
started: 2026-11-02T18:42:31Z
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

- [x] `lib/auth/config.ts` is byte-identical to `school-hub`'s, apart from a header comment naming the
      source commit. A test or script asserts the diff is header-only.
- [ ] `GET /api/authjs/providers` on production returns exactly one provider, `google`.
      *(Post-deploy: the orchestrator's smoke test. Proved locally against `next build` + `next start`:
      200, exactly `{"google":…}`, `Cache-Control: no-store, private`.)*
- [x] `currentUserId()` unit tests: a mapped allowlisted email → owner uid; an allowlisted unmapped
      email → `undefined`; a mapped email removed from the allowlist → `undefined`; an empty allowlist
      → `undefined`; no Auth.js session → today's Cognito path, unchanged.
- [x] No server module other than `lib/auth/owner.ts` and `middleware.ts` reads a session
      (`fetchAuthSession`/`auth()`). A grep-based test pins it.
- [x] A POST with a foreign `Origin` to `/api/tickets/capture` and to the source `disconnect` route
      gets 403, with a test for each.
- [x] The secret grep over `.next/static` covers `AUTH_SECRET` and `GOOGLE_CLIENT_SECRET` and fails
      on a planted value (self-test).
- [x] `08` §3 gains rows S10 and S11, and §5.3's CSRF row is rewritten, citing D-471.
- [ ] The stale `AGENT_SANDBOX_PASSWORD` parameter is deleted.
      *(Not done by the build agent: AWS is read-only in a wave (WAVES §3). The orchestrator deletes
      it before close.)*

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

## Resolution

Auth.js with Google now runs beside Cognito. `currentUserId()` and `middleware.ts` accept either
session. No UI changed: the Authenticator still renders, and no sign-in button exists until `0332`.

**Files touched**

- `package.json`, `package-lock.json`: `next-auth` pinned to exactly `5.0.0-beta.32` (see D-474
  below). I merged only the seven next-auth-tree lock entries by hand (`@auth/core`, `@panva/hkdf`,
  `jose`, `next-auth`, `oauth4webapi`, `preact`, `preact-render-to-string`).
  `npm install --package-lock-only` also added eight bundled-tree entries under
  `@aws-amplify/{data,graphql-api}-construct`. They were dropped (D-162).
- `lib/auth/config.ts`: `school-hub`'s file at `099f1ad`, byte for byte, below a header comment. The
  header names the source commit and records the version divergence with its GHSA ids.
- `lib/auth/config.test.ts`: pins the body below the end-of-header line to the source's sha256
  (`bfa68105…`). It also asserts the header is only a comment naming the commit, and it fires on a
  one-character change. When `../school-hub` is checked out beside the repo, it compares the live
  file too.
- `lib/auth/index.ts`: the NextAuth instance, `{ ...authConfig, basePath: "/api/authjs", pages:
  { signIn: "/", error: "/" } }`. It is edge-safe and exports only `handlers` and `auth`.
- `lib/auth/identity.ts` (new): `authjsUid(email)`. It requires `isAllowedEmail` (school-hub's
  function, fail-closed on an empty list) **and** an `IDENTITIES` entry. This is one function, shared
  by middleware and `currentUserId()`.
- `lib/auth/owner-ids.ts`: `IDENTITIES = { "amazingbrandon@gmail.com": "5488e4b8-…" }` (the
  operator named this address, 2026-11-02), plus `uidForEmail` (lower-cased, `Object.hasOwn`, so
  `__proto__` cannot match). It stays framework-free, because the Lambdas import this module.
- `lib/auth/owner.ts`: `currentUserId()` reads `auth()` first. A mapped, allowlisted email returns
  its uid. Anything else, including a throw, falls through to the Cognito cookie and then the
  bearer token, unchanged.
- `lib/auth/owner.test.ts` (new): the five criterion-3 cases, plus these: case-insensitivity, no
  email, `auth()` throwing (fails closed to Cognito), the cookie winning over bearer, an unmapped
  Auth.js session falling through to Cognito, and `IDENTITIES` holding the owner only.
- `lib/auth/session-readers.test.ts` (new): criterion 4. It scans every non-test source file for an
  import of `aws-amplify/auth/server` or `next-auth/jwt`, an `auth` import from `@/lib/auth`, or
  `next-auth` itself outside `lib/auth/{index,config}.ts`. Only `lib/auth/owner.ts` and
  `middleware.ts` may do any of these. It self-tests every pattern, and asserts that both allowed
  files really do read a session, so the test cannot pass vacuously.
- `lib/map-home.ts`, `lib/map-home.test.ts`: `homeCameraForSession()` now asks `currentUserId()`.
  Its own `fetchAuthSession` is gone.
- `middleware.ts`: `export const middleware = auth((req) => gate(req, req.auth?.user?.email))`. The
  gate admits on `authjsUid`, then the Cognito cookie, then the bearer token. The decision is made
  explicitly, as school-hub does: with a handler, the `authorized` callback's `false` refuses
  nothing. The matcher exempts `api/authjs/`.
- `middleware.test.ts`: next-auth's wrapper is stubbed to hand in `req.auth`. Added the Auth.js
  admit/refuse cases (both gates, empty or unset allowlist, Cognito still admitting) and the matcher
  pins: the five Auth.js routes are exempt, while `/api/authjs`, `/api/authjsx/…`,
  `/api/auth/strava/*` and `/api/fog/authjs/x` stay gated.
- `app/api/authjs/[...nextauth]/route.ts` (new): `GET`/`POST` = `withNoStore(handlers.X)`.
  `check-route-cache-control.mjs` cannot follow a destructured `export const { GET, POST }`, so the
  wrap is spelled out.
- `lib/http/origin.ts` (new): the shared file, byte-identical to `0331`'s.
- `app/api/tickets/capture/route.ts`: a foreign `Origin` → 403 `{"error":"forbidden"}`, after the
  owner check and before the body is read. A non-owner still gets §6.5's 404. No quota is spent and
  nothing is committed.
- `app/api/auth/[source]/disconnect/route.ts`: a foreign `Origin` → 403, after `resolveRoute`. The
  existing stricter refusal of a *missing* `Origin` (404, 0032) is kept, because nothing but the
  settings form ever disconnects a source.
- `app/api/tickets/capture/route.test.ts`, `app/api/auth/[source]/oauth-routes.test.ts`: 403 tests
  for each route, covering a sibling subdomain, the apex, `http://` and `null`. Each asserts no
  commit or revoke happened and that `no-store` is set. `disconnect/retains-everything.test.ts`
  adds `@/lib/http/origin` to its pinned import list.
- `scripts/write-authjs-env.mjs` (new), `amplify.yml`, `.github/workflows/gate.yml`: SSM →
  `.env.production` for the six values under `/amplify/shared/d14fhvl4rp79nn/`, right before
  `npm run build` and after `npm test`.
  - **Fails closed.** The step fails on a missing, unreadable or empty value, a SecureString stored
    as a String, a character that `.env` parsing would change (`$`, `#`, a quote or a space), an
    `AUTH_URL` with a path, or a key already set in the file.
  - Values are never printed. `--self-test` runs in both pipelines.
- `scripts/check-bundle-leak.mjs`: `AUTH_SECRET` and `GOOGLE_CLIENT_SECRET` join the registry. This
  also extends `check-secret-storage.mjs`, which must now find both as SecureStrings and in no app or
  Lambda env. The self-test plants each one, in `.next/static` and `.next/server`, and asserts the
  check fires under its own key.
- `docs/08-security-privacy.md`: §3 gains S10, S11 and the config row, and §3.1's enforcement line
  names S10 and S11. In §5.3, the CSRF row is rewritten (D-471) and the server-side-session row is
  amended.

**Decisions and why**

- **D-474 (operator chose option a, 2026-11-02; recorded at merge as D-NEW-a): next-auth `5.0.0-beta.32`, not
  school-hub's beta.25.** beta.25 fails `amplify.yml`'s no-exceptions `npm audit --omit=dev
  --audit-level=high`, with critical advisories: GHSA-8fpg-xm3f-6cx3, GHSA-7rqj-j65f-68wh,
  GHSA-x445-f3h2-j279, GHSA-xmf8-cvqr-rfgj and GHSA-5jpx-9hw9-2fx4. beta.32 audits clean, and
  config.ts compiles against it unchanged. This amends D-471's "pinned to school-hub's version".
- **`pages` → `/` and the `api/authjs/` matcher exemption** (orchestrator, Q2). Lost Soles has no
  `/login`. The exemption is safe because:
  - Auth.js's routes authenticate themselves: a CSRF token on every POST, OAuth state, PKCE and
    nonce on the callback, and an encrypted JWT for the session.
  - None of them touches Lost Soles data.
  - Only the prefix *with its slash* is exempt, so every other `/api/*` path stays gated, as the
    matcher tests pin.
- **Origin check placement.** It runs after the owner check in both routes, so a 403 reaches only a
  request that already proved it is the owner, and §6.5's 404 still hides the route from everyone
  else.
- **`AUTH_URL` must be the bare origin.** next-auth turns a pathful `AUTH_URL` into a basePath. The
  explicit `/api/authjs` wins anyway, but the env writer refuses a path so the two cannot disagree.
- **No IAM change is needed for the env step.** The build role
  (`AmplifySSRLoggingRole-bcad2fbf-…`) already holds the AWS-managed
  `AmplifyBackendDeployFullAccess`, whose `AmplifySSM` statement grants
  `ssm:GetParameter{,s,sByPath}` on `arn:aws:ssm:*:*:parameter/amplify/*` in-account.
  SecureString decryption goes through the AWS-managed `aws/ssm` key, as the existing literal scan
  of the shared path already does.

**Runtime environment, partly proved.** I built locally with planted values in `.env.production`.
The planted values appear **nowhere** in `.next` (`.next/static`, `.next/server`, the middleware
bundle or `middleware-manifest.json`): next-auth reads `process.env` at request time, and nothing is
inlined. Under `next start`, a JWE minted with `@auth/core/jwt` `encode` and the planted secret
gave these results:

| Request | Result |
|---|---|
| Owner email, page | 200 |
| Wrong secret, a stranger's email, or signed out | 307 |
| Owner, POST from `https://school-hub.devaultsecurity.com` to capture or disconnect | 403 |
| Owner, same-origin capture with a bad body | 400 |

So locally the edge middleware and the Node route handlers both see `.env.production` at runtime.
**Whether Amplify's SSR compute does too is the deploy's question.** The 0053 comment says plain env
vars did not reach it, and school-hub, which works this way, uses `output: "standalone"`. The
post-deploy smoke test below answers it.
