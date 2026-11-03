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

- [ ] `lib/auth/config.ts` below its header is byte-identical to `../school-hub/lib/auth/config.ts`.
      `lib/auth/config.test.ts` passes locally with `../school-hub` checked out, and the sha256 pin
      is updated.
- [ ] `scripts/write-authjs-env.mjs` reads `AUTH_SESSION_COOKIE` (`devault.session-token`) and
      `AUTH_SSO_URL` (`https://core.devaultsecurity.com`) from SSM. Its self-test covers both, and
      `amplify.yml`'s comment lists them.
- [ ] Middleware tests stub `AUTH_SSO_URL` and do not read the build env (eve-ops `5a63a1d` failed
      a deploy on exactly this). With no session, a page redirects to
      `https://core.devaultsecurity.com/login?next=https%3A%2F%2Fsoles.devaultsecurity.com%2F…` and
      an API returns 404. With a session for an email not on Lost Soles' allowlist, a page returns 403
      and an API returns 404. A mapped email gets through. A forged `ls-uid` with no session is still
      signed out.
- [ ] The deployed signed-out `/` redirects to core. Curl shows the `Location`. No response sets a
      `__Secure-authjs.session-token` cookie.
- [ ] SSM `AUTH_SECRET` hashes to the shared prefix `a744072a9a` (orchestrator writes it, agent
      verifies the hash only).
- [ ] `08` §5.3 and `01` §5 name core as the sign-in point and the shared cookie, citing D-478.
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

## Operator validation

Agent: curl the signed-out `/` (a 307 to core), a protected API signed out (404), the absence of an
`authjs.session-token` Set-Cookie, the SSM hash prefix, and the Σ comparison. Operator, desktop
browser: the two `(operator)` criteria.

D-123 trigger checked? **A**: the sign-in mechanism and trust boundary change. **D-478 re-affirms D-123** with the new premise stated: core joins the apps holding `AUTH_SECRET`. No second account is added, and `IDENTITIES` and the allowlist hold the owner only.
