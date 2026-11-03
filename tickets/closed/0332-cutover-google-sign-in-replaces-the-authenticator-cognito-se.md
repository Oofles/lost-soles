---
id: 332
slug: cutover-google-sign-in-replaces-the-authenticator-cognito-se
title: Cutover: Google sign-in replaces the Authenticator, Cognito session and bearer path
type: feature
priority: med
status: closed
size: m
capability: 19-authjs-migration
depends_on: [330, 331, 336]
blocked_by: []
source: agent
created: 2026-11-02T17:18:05Z
started: 2026-11-03T02:07:06Z
closed: 2026-11-03T18:14:18Z
---


## Description

Capability `19-authjs-migration`, **the flag day** (design §Cutover step 4). Decisions: **D-473**
(cutover, bearer path dropped, D-183 and D-331 superseded), **D-471**, **D-470**.

After this ticket the only way into Lost Soles is Google, through Auth.js. The Cognito pool still
exists, but nothing reads it. `0334` deletes it.

- `components/auth-gate.tsx`: the Amplify `<Authenticator>` is replaced by the signed-out landing at
  `/`, which shows the app name and one **Sign in with Google** action (Auth.js `signIn("google")`).
  `@aws-amplify/ui-react` and its stylesheet go. `Amplify.configure` goes too: no client code needs
  it after `0331`.
- `components/auth-refresh.tsx` (D-331) is deleted. Sign-in is a full-page OAuth redirect, so the
  server renders fresh and no stale `uid` can reach `MapShell`.
- `/settings` → Sign out calls Auth.js `signOut`. **It signs out of every app on the domain**, because
  they share one cookie (D-471). The settings copy says so in one line.
- `currentUserId()` and `middleware.ts` lose the Cognito cookie path and the bearer path.
  `lib/auth/bearer.ts`, its tests and `tools/capture/capture.sh` (+ test) are deleted.
  `/api/tickets/capture` is session-only.
- `lib/security-headers.ts`: the two Cognito hosts leave `connect-src`. `aws-amplify`'s auth
  modules leave the client bundle.

## Acceptance criteria

- [x] No file under `app/`, `components/`, `lib/` or `middleware.ts` imports `aws-amplify/auth`,
      `@aws-amplify/ui-react` or `@aws-amplify/adapter-nextjs`.
- [x] Middleware tests: no session → page 307 to `/` and API 404, as today; an Auth.js session for a
      mapped email → through; an `Authorization: Bearer …` header alone → treated as signed out.
- [x] `/api/tickets/capture` tests are rewritten on the session path. A-6's non-owner test (D-428)
      still fails a non-owner, now an allowlisted-but-unmapped email.
- [x] The deployed CSP names no `cognito-idp` or `cognito-identity` host (curl the headers).
      — verified 2026-11-03: deployed `connect-src 'self' https://d1wk224yi6fnfe.cloudfront.net`, 0 matches for `cognito`.
      *(Not tickable before deploy. The built CSP in `.next/routes-manifest.json` is `connect-src 'self' https://d1wk224yi6fnfe.cloudfront.net`, and `lib/security-headers.test.ts` pins that no Cognito host appears. The orchestrator curls the deployed headers.)*
- [x] `08` §5.3 is rewritten for Auth.js: token storage (httpOnly cookie, not `localStorage`), TTL
      (Auth.js's 30-day JWT), revocation (rotate `AUTH_SECRET`, all apps), and the non-browser row
      removed. `01` §5's auth-gate note is amended. Both cite D-473.
- [x] (operator) Signed in to `school-hub` in the desktop browser, opening
      `soles.devaultsecurity.com` lands on the map signed in, with no second sign-in.
      — verified 2026-11-03: pass (operator, desktop browser).
- [x] (operator) Signed out, `/` reads clearly as "sign in with Google", and the map, plinth and run
      log after sign-in are the operator's own, unchanged.
      — verified 2026-11-03: pass (operator, desktop browser); landing reads as sign-in, map/plinth/log unchanged.

## Notes

Before deploying, record Σ `XpLedgerEntry.amount` and `Profile.exploredGeneration` for the owner uid.
Compare them after the operator signs in. The capability-level check is that nothing moved.

If the operator's first Google sign-in is refused, the cause is config (allowlist, `IDENTITIES`
email, redirect URI, cookie domain). Fix forward. There is no Cognito to fall back to after `0334`,
and this ticket should not need one.

## Operator validation

Agent: curl the CSP; curl a protected API signed out (404) and with a bearer header (404); the Σ
comparison above. Operator, desktop browser: the two `(operator)` criteria.

D-123 trigger checked? **A** — the sign-in mechanism changes. D-470 re-affirms D-123. `IDENTITIES`
holds the owner only.


Agent, local (worktree):
- `npm run typecheck`, `npm run lint`: clean.
- `npx vitest run`: 288 files, 4675 passed, 2 skipped.
- `npm run build`: passed. `/log` and `/skills` are still static.
- Every `amplify.yml` frontend guard passed: pre-build, `npm audit --omit=dev --audit-level=high`,
  and post-build (third-party origins, bundle leak, prerender, home-not-in-client).
- The built CSP names no Cognito host, and no client chunk contains `cognito-idp` or
  `getCurrentUser`.

Post-deploy, agent:
- curl the CSP (no `cognito`);
- a protected API signed out (404) and with a bearer header (404);
- a page signed out (307);
- the Σ `XpLedgerEntry.amount` / `Profile.exploredGeneration` comparison.

Operator, desktop browser: the two `(operator)` criteria.

Post-deploy, agent — run 2026-11-03 against Amplify job 445 (`b135bb8`, SUCCEED):
- `curl -I https://soles.devaultsecurity.com/`: 200, CSP `connect-src 'self' https://d1wk224yi6fnfe.cloudfront.net`,
  no `cognito` anywhere. The signed-out response sets `ls-uid=; Path=/; Max-Age=0; Secure; SameSite=lax`
  (D-476 expiry, with `Path`), and the body contains "Sign in with Google".
- `/api/skills/profile`, `/api/runs/latest`, `/api/fog`, `/api/log`: 404 signed out, and 404 with only
  `Authorization: Bearer <jwt-shaped>`. The bearer path is gone.
- `/settings` signed out: 307 → `/?next=%2Fsettings`.
- Data baseline for owner `5488e4b8-…8083`: 377 `XpLedgerEntry` rows, Σ `xpAwarded` = **73,002**;
  `Profile.exploredGeneration` = **270**. The latest write to either is 2026-11-02T20:18:28Z, before the
  deploy started (02:56Z on 11-03), so these are also the pre-cutover values. The comparison after the
  operator signs in is below.

Operator, desktop browser, 2026-11-03: both `(operator)` criteria pass. A `school-hub` session carried
straight onto the map. The signed-out `/` reads as "sign in with Google". After signing back in, the
map, plinth and run log were the operator's own and unchanged.

After the operator's sign-in (agent, 2026-11-03): still 377 ledger rows, Σ `xpAwarded` = 73,002, and
`exploredGeneration` = 270. Nothing moved across the cutover.

## Resolution

**What shipped.** This is the flag day (D-473). After it, the only way in is a Google sign-in through
Auth.js. The Cognito pool and `defineAuth` stay until `0334`, and nothing reads them.

- **Sign-in.** `components/sign-in-landing.tsx` (new) shows the app name, the tagline and one
  **Sign in with Google** form. It posts `signInWithGoogle` in `app/auth-actions.ts` (new), which is
  a server action calling Auth.js `signIn("google", { redirectTo: "/" })`. `lib/auth/index.ts` now
  also exports `signIn`/`signOut`.
- **No client gate.** `app/layout.tsx` no longer wraps everything in `AuthGate`, and reads no session,
  so `/log` and `/skills` stay static (build output: both `○`). `app/(home)/layout.tsx` renders
  `<SignInLanding/>` when `currentUserId()` is undefined, in place of the home screen, so a
  signed-out payload carries no map at all. `middleware.ts` stays the gate for every other route.
- **Deleted:** `components/auth-gate.tsx` (Authenticator, `Amplify.configure`, the ui-react
  stylesheet), `components/auth-refresh.tsx` + test (D-331), `lib/auth/bearer.ts` + test,
  `lib/amplify-server.ts`, `tools/capture/capture.sh` + `capture.test.mjs`.
- **Sessions.** `lib/auth/owner.ts`: `currentUserId()` is Auth.js only (the allowlist, then
  `IDENTITIES`), with no Cognito cookie and no bearer path. `middleware.ts`: the same, with no
  Amplify runner and no bearer branch. A bearer header alone is signed out.
- **Sign out.** `app/settings/settings-controls.tsx`: Sign out is a form posting `signOutEverywhere`
  (Auth.js `signOut({ redirectTo: "/" })`). It carries one line of copy: "This signs you out of every
  devaultsecurity.com app, not only this one." (D-471, shared cookie).
- **The browser's uid (D-476, operator chose option a).** `lib/auth/uid-cookie.ts` (new) defines
  `ls-uid`. `middleware.ts` sets it on every admitted response (`Secure`, `SameSite=Lax`,
  host-only, `Path=/`, 30 days, **not** `httpOnly`). It expires it on every signed-out response,
  the landing included, with the same attributes and `Max-Age=0`. It does not use `cookies.delete`,
  which omits `Path` and would leave the `/` cookie standing on `/api/*` paths. `currentUid()` in
  `lib/log/transport.ts` reads it from `document.cookie`, with no network, so offline `/log` behaves
  as before (D-282). It replaced Amplify's `getCurrentUser()`. The server never reads `ls-uid`.
- **CSP.** `lib/security-headers.ts`: `connect-src` is `'self'` plus the tiles distribution. The
  two Cognito hosts are gone, and the CSP no longer needs `auth.aws_region`, so it survives `0334`
  deleting the `auth` block. `next.config.ts` comment updated.
- **Packages.** Removed `@aws-amplify/ui-react`, `@aws-amplify/adapter-nextjs`, `aws-amplify` and
  `aws-jwt-verify`, with `npm uninstall --package-lock-only`. Nothing outside `amplify/` (which
  uses `@aws-amplify/backend`) imports them. `vitest.config.ts`: the "edge" project existed only for
  `bearer.test.ts`, so it is gone and one `node` project remains.
- **Tests.**
  - `lib/auth/no-cognito-client.test.ts` (new) is the criterion-1 grep, with self-tests.
  - `lib/auth/uid-cookie.test.ts` (new) covers the parser, the cookie attributes and `currentUid()`.
  - `middleware.test.ts`, rewritten:
    - no session: a page 307s and an API 404s;
    - a mapped email gets through;
    - a bearer-only request 404s, byte-identical to no credential;
    - `ls-uid` is set when admitted and expired when signed out;
    - **a forged `ls-uid` with no session is signed out**;
    - the source names no Amplify or bearer import and no `ls-uid` read.
  - `lib/auth/owner.test.ts`: a forged `ls-uid` cookie plus a bearer header still gives `undefined`.
  - `app/api/tickets/capture/route.test.ts` now runs on the session path. Only `auth()` is stubbed;
    the allowlist and `IDENTITIES` are real. The A-6/D-428 non-owner is an allowlisted, unmapped
    email. Added: a de-allowlisted mapped email, and a bearer-only request.
  - Settings, `(home)` layout and new-workout-type tests updated for the new modules.
- **Docs.**
  - `08` §5.3 rewritten for Auth.js:
    - the httpOnly cookie, plus `ls-uid` and why it is not a credential;
    - the 30-day JWT;
    - revocation by rotating `AUTH_SECRET` in all apps, or by removing an email;
    - the server-only OAuth secret;
    - the non-browser row removed, and the Cognito hosts struck from the Headers row.
  - `01` §5's capability-19 note amended.
  - Both cite D-473.
- **Fix:** `lib/auth/config.ts` header says "D-474, amending D-471" (was "D-476"). The body is
  untouched, and the sha256 pin passes.

**Decisions.**
- **D-476 (proposed, operator chose option a): how the browser learns the uid after the cutover.**
  The `ls-uid` companion cookie, set and cleared by the middleware. It is a key for local stores,
  **not a credential**: the server authorizes from the Auth.js session alone.
- **Agent choices, accepted by the operator:**
  - The landing does not honour the middleware's `?next=` deep link. The Authenticator never did,
    and sign-in always returns to `/`.
  - Sign-in and sign-out are server actions, not `next-auth/react`. That keeps next-auth out of
    the client, and Next applies its own Origin check to server actions (`08` §5.3 CSRF row).
- Untouched, per D-475: the mutation Lambdas' AppSync event branch and AppSync's resolver
  permissions (`0334`'s).
