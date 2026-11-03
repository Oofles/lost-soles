---
id: 339
slug: join-core-sso
title: Join core's SSO: shared secret and cookie name, signed-out visitors go to core
type: feature
priority: med
status: open
size: m
capability: 19-authjs-migration
depends_on: []
blocked_by: []
source: agent
created: 2026-11-03T18:33:38Z
started: 2026-11-03T18:50:51Z
---

## Description

Capability `19-authjs-migration`. Decision: **D-478** (amends D-471). The plan on core's side is `../core/SSO-PLAN.md`; read its "Progress" and "Target design" sections, not the whole file.

`core.devaultsecurity.com` is now the SSO sign-in point for every devaultsecurity.com app (operator, 2026-11-03). school-hub and eve-ops joined on 2026-11-02 (school-hub `7ba7d2e`): a shared `AUTH_SECRET` (sha256 prefix `a744072a9a`), the cookie `__Secure-devault.session-token` on `.devaultsecurity.com`, and `AUTH_SSO_URL=https://core.devaultsecurity.com`. A signed-out visitor is sent to core's `/login?next=<full public URL>`. A signed-in account that is not on the app's **own** allowlist gets a 403.

Lost Soles has not joined. Its `AUTH_SECRET` in SSM hashes to `d0b3a01de5`, and its cookie is Auth.js's default `__Secure-authjs.session-token` with `Domain=.devaultsecurity.com`. So SSO from the other apps no longer reaches it. `lib/auth/config.test.ts`'s `../school-hub` comparison fails locally, and `0332`'s operator SSO check most likely passed on a leftover old-name cookie. Lost Soles' own Google sign-in still works.

The work:
- Re-copy school-hub's current `lib/auth/config.ts` below the header (D-474's verbatim rule), and update the sha256 pin.
- Add `AUTH_SESSION_COOKIE` and `AUTH_SSO_URL` to the SSM set `scripts/write-authjs-env.mjs` reads, under `/amplify/shared/d14fhvl4rp79nn/`, with self-tests.
- Set `AUTH_SECRET` to the shared value. That is an SSM write by the orchestrator, never by an agent, and it ends every current Lost Soles session once.
- The middleware does what school-hub's does: signed out, a page goes to `ssoLoginUrl()` and an API still 404s. A session whose email is not on Lost Soles' allowlist gets a 403. `ls-uid` (D-476) behaves as before.
- `/`'s "Sign in with Google" landing gives way to the redirect to core.

## Acceptance criteria

- [x] `lib/auth/config.ts` below its header is byte-identical to `../school-hub/lib/auth/config.ts`.
      `lib/auth/config.test.ts` passes locally with `../school-hub` checked out, and the sha256 pin
      is updated.
- [x] `scripts/write-authjs-env.mjs` reads `AUTH_SESSION_COOKIE` (`devault.session-token`) and
      `AUTH_SSO_URL` (`https://core.devaultsecurity.com`) from SSM. Its self-test covers both, and
      `amplify.yml`'s comment lists them.
- [x] Middleware tests stub `AUTH_SSO_URL` and do not read the build env (eve-ops `5a63a1d` failed
      a deploy on exactly this). With no session, a page redirects to
      `https://core.devaultsecurity.com/login?next=https%3A%2F%2Fsoles.devaultsecurity.com%2F…` and
      an API returns 404. With a session for an email not on Lost Soles' allowlist, a page returns 403
      and an API returns 404. A mapped email gets through. A forged `ls-uid` with no session is still
      signed out.
- [ ] The deployed signed-out `/` redirects to core. Curl shows the `Location`. No response sets a
      `__Secure-authjs.session-token` cookie.
      *(Open until deploy: the build agent cannot deploy. Proven against a local `next start` of
      this build with production's SSO env, see Resolution; the deployed curl is the orchestrator's
      post-deploy smoke test.)*
- [ ] SSM `AUTH_SECRET` hashes to the shared prefix `a744072a9a` (orchestrator writes it, agent
      verifies the hash only).
      *(Open until the orchestrator's SSM write. At build time, 2026-11-03, `AUTH_SESSION_COOKIE`
      and `AUTH_SSO_URL` did not exist yet under `/amplify/shared/d14fhvl4rp79nn/`, which is
      expected; the hash check is in the post-deploy smoke test.)*
- [x] `08` §5.3 and `01` §5 name core as the sign-in point and the shared cookie, citing D-478.
      `SSO-PLAN.md` in `../core` is not edited from here: the orchestrator reports the join to the
      operator.
- [ ] (operator) Signed in on core (or school-hub) in the desktop browser, opening
      `soles.devaultsecurity.com` lands on the map signed in, with no second sign-in.
- [ ] (operator) Signed out, opening `soles.devaultsecurity.com` lands on core's sign-in. After
      signing in there, you come back to Lost Soles' map, unchanged.

## Notes

- **Order.** `0334` is blocked on this ticket, because both touch `middleware.ts` and the auth
  posture. `0335` re-runs the posture checks against what this ticket leaves.
- **Secret rotation** signs the operator out of Lost Soles once. That is expected, not a regression.
  Before and after deploy, record Σ `XpLedgerEntry.xpAwarded` (73,002 at `0333`) and
  `Profile.exploredGeneration` (270) for the owner uid. Nothing may move.
- **What Lost Soles keeps.** Its own allowlist (`AUTH_ALLOWED_EMAILS`, owner only) and `IDENTITIES`
  stay authoritative (D-471's two gates). Core decides who can sign in to the domain. Lost Soles
  still decides who gets in here.
- The Google OAuth client's Lost Soles redirect URI becomes unused once sign-in moves to core. The
  operator can remove it from the Google console. It is not a blocker, and nothing breaks if it stays.
- If school-hub's `config.ts` cannot compile unchanged here (for example, a `redirect` callback
  conflicting with the `pages: "/"` setting from D-474), stop and ask (D-152). Do not fork the file.

## Resolution

Lost Soles now joins core's SSO in code. The code does nothing different until the orchestrator
writes the two new SSM parameters and the shared `AUTH_SECRET`. Until then the build fails closed
on the missing parameters, by design.

**Files touched**
- `lib/auth/config.ts`: re-copied `school-hub`'s file at `7ba7d2e` below the header. The header now
  names that commit and 0339/D-478. The body is byte-identical to `/home/vivicat/school-hub/lib/auth/config.ts`
  (compared directly; sha256 `421fc934…9ee21`, which is the same as `git show 7ba7d2e:lib/auth/config.ts`).
- `lib/auth/config.test.ts`: `SOURCE_COMMIT` and `SOURCE_SHA256` updated together.
- `scripts/write-authjs-env.mjs`: two more SSM **String** parameters, `AUTH_SESSION_COOKIE` and
  `AUTH_SSO_URL`, which fail closed like the other six. Shape checks: the cookie name must not
  carry its `__Secure-`/`__Host-` prefix, because config.ts adds it and a doubled prefix is a
  different JWE salt. `AUTH_SSO_URL` must be a bare `https` origin on `devaultsecurity.com` and
  not this app's own `AUTH_URL`, which would loop. There are 12 new self-test cases, and
  "all missing" now expects 8.
- `amplify.yml`: the env step's comment lists all eight parameters and names the IAM grant.
- `middleware.ts`: `refuse()` follows `school-hub`'s middleware. With `ssoLoginUrl()` non-null, a
  page with no session gets a 307 to `core/login?next=<full public URL, path and query>`. A page
  whose session Lost Soles does not admit (fails the allowlist or `IDENTITIES`) gets a static 403
  that names no email. An API still answers 404 in both cases, where school-hub answers 401:
  Lost Soles keeps its §6.5/0019 404. Every middleware-built response carries `no-store`, and
  `ls-uid` is expired on all of them, as before. With `AUTH_SSO_URL` or `AUTH_URL` unset (local),
  behaviour is exactly what it was before 0339.
- `middleware.test.ts`: every test stubs `AUTH_SSO_URL` and `AUTH_URL` with `vi.stubEnv` and
  unstubs after, so the build container's env is never read. The block for the local mode stubs
  them empty. Added: redirects to core for `/`, deep paths and query strings, with the
  criterion's exact `Location` for `/`. `next` is built from `AUTH_URL`, not the request host.
  The redirect has no body and sets no session cookie. Pages get a 403 for a non-allowlisted
  email and for an allowlisted but unmapped one, the API 404 is byte-identical to signed-out,
  the 403 names no email and expires `ls-uid`, and the owner gets through. A local-fallback
  block covers the case with no SSO URL. Existing tests that expected `/?next=` now expect core.
- `app/sign-out-cookie.test.ts` (new): runs @auth/core's signout with production's cookie env. It
  is the same `Auth(req, {...config, raw, skipCSRFCheck})` call that next-auth's `signOut` server
  action makes. It asserts that the only session cookie written is
  `__Secure-devault.session-token`, empty, `maxAge 0`, `Domain=.devaultsecurity.com`, and that
  nothing is written under the old name. It also pins that `signOutEverywhere` is that `signOut`.
  next-auth itself cannot load under vitest because of its bare `next/server` ESM import, which
  is why the test calls @auth/core directly.
- `app/(home)/layout.tsx`, `app/auth-actions.ts`, `lib/auth/index.ts`: comments only. In
  production, a signed-out visitor never reaches the layout. `<SignInLanding>` is the local
  fallback, and the layout's uid check is the second gate.
- `docs/08-security-privacy.md` §3 (S10 row, config row) and §5.3 (intro, token storage): core is
  the sign-in point, plus the shared cookie name, the 403/404 split, the trust boundary, and
  sign-out on the domain. All cite D-478.
- `docs/01-architecture.md` §5: a paragraph on core as the sign-in point, and the landing as the
  local fallback.

**Decisions made**
- **The middleware does the signed-out `/` redirect, not the layout.** It already runs on every
  non-static route, so the redirect costs no route its static prerender (`/log` ○ and `/skills` ○
  in `next build`). It also sends no payload at all. The `(home)` layout keeps its `!uid` check as
  the second gate, rendering the landing only where `AUTH_SSO_URL` is unset.
- **403 for any session the gate does not admit**, so not only for a non-allowlisted email: an
  allowlisted email with no `IDENTITIES` entry gets it too. In SSO mode a redirect for either
  would loop through core.
- **The local fallback is kept**, as `school-hub` keeps its `/login` when `AUTH_SSO_URL` is unset.
  Cookies cannot span localhost and the domain, so without it local dev has no way in.
- **No IAM change.** `iam simulate-principal-policy` for the Amplify build role
  (`AmplifySSRLoggingRole-bcad2fbf-…`) on both new parameter ARNs returns `allowed`, through
  `AmplifyBackendDeployFullAccess` (`ssm:GetParameter` on `parameter/amplify/*`). That policy is
  AWS-managed and not in this repo.

**Verified locally**
- `npx vitest run`: 289 files, 4,696 passed, 2 skipped. The skipped one in `config.test.ts` is the
  live `../school-hub` comparison: from a worktree that path does not exist, so the same comparison
  was run directly (`identical: true`). It runs green from the main checkout.
- A local `next start` of this build, with production-shaped SSO env and a throwaway secret,
  against sessions minted with `@auth/core/jwt` under each cookie name:
  - signed-out `/` returned 307 to `https://core.devaultsecurity.com/login?next=https%3A%2F%2Fsoles.devaultsecurity.com%2F`;
  - signed-out `/log?x=1` returned 307 with `next=…%2Flog%3Fx%3D1`;
  - signed-out `/api/fog` returned 404;
  - an outsider's session returned 403 on `/` and 404 on `/api/fog`;
  - the owner's session returned 200 on `/log`;
  - the owner under the OLD cookie name returned 307 to core (no longer read);
  - a forged `ls-uid` alone returned 307 to core.
  - No response set `__Secure-authjs.session-token`. Auth.js's own host-only
    `__Host-authjs.csrf-token` and `__Secure-authjs.callback-url` are still set, as they were before.

## Operator validation

Agent: curl the signed-out `/` (a 307 to core), a protected API signed out (404), the absence of an
`authjs.session-token` Set-Cookie, the SSM hash prefix, and the Σ comparison. Operator, desktop
browser: the two `(operator)` criteria.

D-123 trigger checked? **A**: the sign-in mechanism and trust boundary change. **D-478 re-affirms D-123** with the new premise stated: core joins the apps holding `AUTH_SECRET`. No second account is added, and `IDENTITIES` and the allowlist hold the owner only.
