---
id: 332
slug: cutover-google-sign-in-replaces-the-authenticator-cognito-se
title: Cutover: Google sign-in replaces the Authenticator, Cognito session and bearer path
type: feature
priority: med
status: open
size: m
capability: 19-authjs-migration
depends_on: [330, 331, 336]
blocked_by: []
source: agent
created: 2026-11-02T17:18:05Z
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

- [ ] No file under `app/`, `components/`, `lib/` or `middleware.ts` imports `aws-amplify/auth`,
      `@aws-amplify/ui-react` or `@aws-amplify/adapter-nextjs`.
- [ ] Middleware tests: no session → page 307 to `/` and API 404, as today; an Auth.js session for a
      mapped email → through; an `Authorization: Bearer …` header alone → treated as signed out.
- [ ] `/api/tickets/capture` tests are rewritten on the session path. A-6's non-owner test (D-428)
      still fails a non-owner, now an allowlisted-but-unmapped email.
- [ ] The deployed CSP names no `cognito-idp` or `cognito-identity` host (curl the headers).
- [ ] `08` §5.3 is rewritten for Auth.js: token storage (httpOnly cookie, not `localStorage`), TTL
      (Auth.js's 30-day JWT), revocation (rotate `AUTH_SECRET`, all apps), and the non-browser row
      removed. `01` §5's auth-gate note is amended. Both cite D-473.
- [ ] (operator) Signed in to `school-hub` in the desktop browser, opening
      `soles.devaultsecurity.com` lands on the map signed in, with no second sign-in.
- [ ] (operator) Signed out, `/` reads clearly as "sign in with Google", and the map, plinth and run
      log after sign-in are the operator's own, unchanged.

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
