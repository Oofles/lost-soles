---
id: 335
slug: re-run-the-d-123-and-auth-posture-checks-against-the-new-aut
title: Re-run the D-123 and auth posture checks against the new auth (D-425)
type: chore
priority: med
status: open
size: s
capability: 19-authjs-migration
depends_on: [334]
blocked_by: []
source: agent
created: 2026-11-02T17:18:06Z
started: 2026-11-04T03:02:06Z
---


## Description

Capability `19-authjs-migration`, the last step. **D-425** names exactly what the migration
invalidates in capability `18`, and this ticket re-runs it against the new auth. **D-470** is the
re-affirmed D-123 it checks against.

- `0114`'s Trigger A check, live: one identity, the owner, in both `AUTH_ALLOWED_EMAILS` and
  `IDENTITIES`.
- `0114`'s **A-6** (D-428): `POST /api/tickets/capture` refuses a non-owner. Prove it on production
  with a session for an allowlisted-but-unmapped email if one can be minted without touching the
  shared `AUTH_SECRET`. Otherwise prove it with the route's test plus a signed-out curl, and say which.
- `0115`'s posture checks, re-pointed: the old "self-signup off" and "no unauthenticated identities"
  become "a Google account outside the allowlist cannot sign in" and "no unauthenticated principal
  reaches any data". Both are proven by attack, as `0014` proved self-signup off.
- `0117`'s §9 rows that name Cognito are re-read, with a dated note on each.

## Acceptance criteria

- [x] Each check above has a pasted command and output in the Resolution.
- [x] A sign-in attempt with a Google account outside `AUTH_ALLOWED_EMAILS` is refused. The agent
      observes the refusal in the Auth.js logs or the callback response, not on trust.
      *(Amended 2026-11-03, agent, per the operator's decision of the same day: since D-478 the
      Google sign-in happens at core, not in Lost Soles' Auth.js callback, so there is no Lost Soles
      callback for an outside account to be refused in. What an outside account can hold is a valid
      shared-domain session, and the refusal that matters is Lost Soles' answer to it. Proven on
      production with a session minted for `refused-0335@example.invalid` with the production
      `AUTH_SECRET` and cookie salt: 403 on pages, 404 on every `/api/*` family. The owner-uid
      positive control (200) proves the minted cookie decrypts, so the refusal is the allowlist
      deciding, not a malformed token. No second Google account was needed.)*
- [x] `09-roadmap.md` §9 rows that mention Cognito carry a dated note pointing at this ticket.
- [x] The capability `19` drift audit is unblocked: no capability ticket is left open.
      *(Agent, 2026-11-03: true once the orchestrator closes this ticket. It is the only
      `19-authjs-migration` ticket in `tickets/open/` or `tickets/blocked/`; nine are closed.)* — verified 2026-11-03 by the orchestrator: `tickets.mjs list --capability 19-authjs-migration --status open` lists only 0335.

## Notes

The refused-account attempt needs a Google account that is not the operator's. If none is at hand,
ask the operator once whether to run it with one of theirs that is not on the allowlist. That is a
single sign-in attempt, not a scenario to build.

## Resolution

*(Agent, 2026-11-03, wave 19.)* Verification against production. `0334` (Amplify job 449) had already
deployed the Cognito-free state, so **no code changed**. The only edits are this ticket and one dated
note in `09-roadmap.md` §9.4.

**Files touched**

- `docs/09-roadmap.md`: §9.4's "Cognito self-signup is OFF…" row gets a dated note. It points here and
  names the two re-pointed checks and their evidence. It is the only §9 row that names Cognito. §9.3's
  account-deletion row ("against a throwaway account") does not name Cognito, so it is left as is.
- `tickets/open/0335-…md`: criteria ticked or amended, plus this Resolution.

**Decisions made:** none new. Criterion 2 is amended in place under the operator's 2026-11-03 decision
(minted test sessions), with D-478 as the reason: core performs the Google sign-in.

### 1. `0115`'s posture, re-pointed: no Cognito pool, IAM-only data (live)

```
$ AWS_PROFILE=devault node scripts/check-auth-posture.mjs
Auth posture — app d14fhvl4rp79nn, branch 'main'
               data API nog4xy2l7baqlhghpndh2565qe (selected by its amplify:* tags)
               2 user pool(s) and 2 identity pool(s) in the account read
               AUTH_ALLOWED_EMAILS: 2 address(es)
  ok    no Cognito user pool tagged with this app
  ok    no Cognito identity pool tagged with this app
  ok    the data API's auth modes are exactly AWS_IAM
  ok    AUTH_ALLOWED_EMAILS is non-empty
  ok    Google is the only Auth.js provider

All posture assertions passed.
exit=0

$ aws appsync get-graphql-api --api-id nog4xy2l7baqlhghpndh2565qe --query 'graphqlApi.{auth:authenticationType,extra:additionalAuthenticationProviders}'
{ "auth": "AWS_IAM", "extra": null }
```

The account's two user pools and two identity pools belong to other apps. None carries this app's
tags, and that is what the script asserts.

### 2. `0114`'s Trigger A, live: one identity, the owner's

```
$ AWS_PROFILE=devault node scripts/check-d123-trigger-a.mjs
D-123 Trigger A — AUTH_ALLOWED_EMAILS (SSM /amplify/shared/d14fhvl4rp79nn/AUTH_ALLOWED_EMAILS) and IDENTITIES (lib/auth/owner-ids.ts)
                  2 allowlisted emails, 2 IDENTITIES entries
                  mapped uid(s): 5488e4b8-d081-7014-748e-edd1937f8083; owner uid(s): 5488e4b8-d081-7014-748e-edd1937f8083

Trigger A has not fired: every mapped identity is the owner's, and the allowlist and the map agree.
exit=0
```

Two emails, one uid. Per D-479 that is one account with two ways in, not a second account.

### 3. "No unauthenticated principal reaches any data", by attack (live)

Unsigned requests to the live AppSync endpoint (`hopa22ito5foleo6o727cezz3u`, the `GRAPHQL` uri of
`nog4xy2l7baqlhghpndh2565qe`) and to the live user-data bucket. The S3 key is a real cell object, found
with `aws s3 ls`.

```
$ curl -s -X POST https://hopa22ito5foleo6o727cezz3u.appsync-api.us-east-1.amazonaws.com/graphql \
    -H 'content-type: application/json' -d '{"query":"{ __typename }"}'
{"errors":[{"errorType":"UnauthorizedException","message":"You are not authorized to make this call."}]}
HTTP 401
$ (same, with -H 'x-api-key: da2-fakefakefakefakefakefakefa')
{"errors":[{"errorType":"UnauthorizedException","message":"You are not authorized to make this call."}]}
HTTP 401
$ (same, with -H 'Authorization: <alg-none JWT>', i.e. what a Cognito-token caller would send)
{"errors":[{"errorType":"IncompleteSignatureException","message":"Authorization header requires 'Credential' parameter. ..."}]}
HTTP 403
$ curl -s https://amplify-d14fhvl4rp79nn-ma-lostsolesuserdatabucket5-mpiyvettxgde.s3.amazonaws.com/users/5488e4b8-…/cells/0232ac74…cec6e.bin
<Error><Code>AccessDenied</Code><Message>Access Denied</Message>…</Error>
HTTP 403
$ curl -s 'https://amplify-d14fhvl4rp79nn-ma-lostsolesuserdatabucket5-mpiyvettxgde.s3.amazonaws.com/?list-type=2'
<Error><Code>AccessDenied</Code><Message>Access Denied</Message>…</Error>
HTTP 403
```

No IAM-signed call is counted here: an admin-signed call is not unauthenticated. The app-level half,
signed-out requests to every page and `/api/*` family, is the first block of §4.

### 4. "A Google account outside the allowlist cannot sign in", and A-6, by minted session (live)

**Method (operator decision, 2026-11-03).** A scratchpad Node script read `AUTH_SECRET`,
`AUTH_SESSION_COOKIE` and `AUTH_ALLOWED_EMAILS` from SSM (`/amplify/shared/d14fhvl4rp79nn/`,
`GetParameter` with decryption) **into memory only**. It minted Auth.js JWEs with `@auth/core/jwt`
`encode({ token: { email, … }, secret, salt: "__Secure-devault.session-token", maxAge: 600 })`, and
fetched production (`https://soles.devaultsecurity.com`, `redirect: "manual"`,
`Origin: https://soles.devaultsecurity.com` on every request). It printed only statuses, headers and
bodies, with every secret, token and allowlisted email redacted. Each body was scanned for any
email-shaped string. The script was deleted after the run. Nothing secret touched disk.

Each request was the equivalent of `curl -s -X <m> https://soles.devaultsecurity.com<path> -H 'Origin:
https://soles.devaultsecurity.com' [-H 'Cookie: __Secure-devault.session-token=<redacted>']`. The
output below is verbatim except for one change. On `/api/*` lines the identical
`body: {"error":"not found"}` line is folded into the status line, and `cache-control:` is
shortened to its value.

```
cookie name (from SSM AUTH_SESSION_COOKIE): __Secure-devault.session-token; allowlist size: 2

== signed out (no cookie) ==
GET  /       -> 307  location: https://core.devaultsecurity.com/login?next=https%3A%2F%2Fsoles.devaultsecurity.com%2F  cache-control: no-store, private  ls-uid=(expired)  [no email in body]
GET  /skills -> 307  location: https://core.devaultsecurity.com/login?next=https%3A%2F%2Fsoles.devaultsecurity.com%2Fskills  cache-control: no-store, private  ls-uid=(expired)  [no email in body]
GET  /api/fog                    -> 404 {"error":"not found"}  no-store, private  ls-uid=(expired)  [no email]
GET  /api/fog/blob/1             -> 404 {"error":"not found"}  no-store, private  ls-uid=(expired)  [no email]
GET  /api/fog/lastrun/1          -> 404 {"error":"not found"}  no-store, private  ls-uid=(expired)  [no email]
POST /api/log                    -> 404 {"error":"not found"}  no-store, private  ls-uid=(expired)  [no email]
GET  /api/runs/latest            -> 404 {"error":"not found"}  no-store, private  ls-uid=(expired)  [no email]
GET  /api/runs/summary           -> 404 {"error":"not found"}  no-store, private  ls-uid=(expired)  [no email]
GET  /api/runs/chronicle         -> 404 {"error":"not found"}  no-store, private  ls-uid=(expired)  [no email]
GET  /api/runs/web               -> 404 {"error":"not found"}  no-store, private  ls-uid=(expired)  [no email]
GET  /api/runs/1/kind            -> 404 {"error":"not found"}  no-store, private  ls-uid=(expired)  [no email]
GET  /api/runs/1/ledger          -> 404 {"error":"not found"}  no-store, private  ls-uid=(expired)  [no email]
GET  /api/skills/landmarks       -> 404 {"error":"not found"}  no-store, private  ls-uid=(expired)  [no email]
GET  /api/skills/ledger          -> 404 {"error":"not found"}  no-store, private  ls-uid=(expired)  [no email]
GET  /api/skills/profile         -> 404 {"error":"not found"}  no-store, private  ls-uid=(expired)  [no email]
GET  /api/skills/state           -> 404 {"error":"not found"}  no-store, private  ls-uid=(expired)  [no email]
GET  /api/auth/strava/start      -> 404 {"error":"not found"}  no-store, private  ls-uid=(expired)  [no email]
GET  /api/auth/strava/callback   -> 404 {"error":"not found"}  no-store, private  ls-uid=(expired)  [no email]
POST /api/auth/strava/disconnect -> 404 {"error":"not found"}  no-store, private  ls-uid=(expired)  [no email]
POST /api/tickets/capture        -> 404 {"error":"not found"}  no-store, private  ls-uid=(expired)  [no email]

== minted session for refused-0335@example.invalid (not on the allowlist) ==
GET  /       -> 403  cache-control: no-store, private  ls-uid=(expired)  [no email in body]
     body: <!doctype html><meta charset=utf-8><title>Not permitted</title><p>You are signed in, but this account does not have access to Lost Soles.</p>
GET  /skills -> 403  cache-control: no-store, private  ls-uid=(expired)  [no email in body]
     body: <!doctype html><meta charset=utf-8><title>Not permitted</title><p>You are signed in, but this account does not have access to Lost Soles.</p>
GET  /api/fog                    -> 404 {"error":"not found"}  no-store, private  ls-uid=(expired)  [no email]
GET  /api/fog/blob/1             -> 404 {"error":"not found"}  no-store, private  ls-uid=(expired)  [no email]
GET  /api/fog/lastrun/1          -> 404 {"error":"not found"}  no-store, private  ls-uid=(expired)  [no email]
POST /api/log                    -> 404 {"error":"not found"}  no-store, private  ls-uid=(expired)  [no email]
GET  /api/runs/latest            -> 404 {"error":"not found"}  no-store, private  ls-uid=(expired)  [no email]
GET  /api/runs/summary           -> 404 {"error":"not found"}  no-store, private  ls-uid=(expired)  [no email]
GET  /api/runs/chronicle         -> 404 {"error":"not found"}  no-store, private  ls-uid=(expired)  [no email]
GET  /api/runs/web               -> 404 {"error":"not found"}  no-store, private  ls-uid=(expired)  [no email]
GET  /api/runs/1/kind            -> 404 {"error":"not found"}  no-store, private  ls-uid=(expired)  [no email]
GET  /api/runs/1/ledger          -> 404 {"error":"not found"}  no-store, private  ls-uid=(expired)  [no email]
GET  /api/skills/landmarks       -> 404 {"error":"not found"}  no-store, private  ls-uid=(expired)  [no email]
GET  /api/skills/ledger          -> 404 {"error":"not found"}  no-store, private  ls-uid=(expired)  [no email]
GET  /api/skills/profile         -> 404 {"error":"not found"}  no-store, private  ls-uid=(expired)  [no email]
GET  /api/skills/state           -> 404 {"error":"not found"}  no-store, private  ls-uid=(expired)  [no email]
GET  /api/auth/strava/start      -> 404 {"error":"not found"}  no-store, private  ls-uid=(expired)  [no email]
GET  /api/auth/strava/callback   -> 404 {"error":"not found"}  no-store, private  ls-uid=(expired)  [no email]
POST /api/auth/strava/disconnect -> 404 {"error":"not found"}  no-store, private  ls-uid=(expired)  [no email]
POST /api/tickets/capture        -> 404 {"error":"not found"}  no-store, private  ls-uid=(expired)  [no email]

== positive control: minted session for allowlist[0] (owner uid), ONE read-only GET ==
GET  /api/skills/profile -> 200  cache-control: no-store, private  ls-uid=(set, uid)  [no email in body]  body: 26 bytes (not printed)
```

**What this proves.**

- **The refusal is the allowlist deciding, not a bad token.** The owner token, minted the same way,
  is admitted (200, `ls-uid` set). The refused token gets **403** on pages, not the 307 a token that
  failed to decrypt would get. So the session decrypted, its email was read, and `authjsUid` refused
  it. The 403 body is static and names no email.
- **No capture was written.** The capture POST carried the correct `Origin`, and both the signed-out
  and the refused attempt got 404. The latest commit touching `tickets/inbox/` on
  `Oofles/lost-soles` was the same before and after the run:
  `gh api 'repos/Oofles/lost-soles/commits?path=tickets/inbox&per_page=1'` →
  `89e8534 2026-09-03T01:20:20Z tickets: triage inbox (1 item)`.
- **A-6's allowlisted-but-unmapped branch is proven by test, not on production.** It needs an
  allowlisted email with no `IDENTITIES` entry, and building one means writing to SSM. Production
  shows the not-on-allowlist branch (above). The unmapped branch is proven by these tests, all green
  in this worktree:
  - `middleware.test.ts`: "403s a page for an allowlisted email with no IDENTITIES entry (D-470)",
    and "404s an allowlisted email with no IDENTITIES entry, as signed out".
  - `app/api/tickets/capture/route.test.ts`: "404s a signed-in NON-OWNER (allowlisted, unmapped)
    and commits nothing", and "gives a non-owner a response INDISTINGUISHABLE from a signed-out one".

  `npx vitest run middleware.test.ts app/api/tickets/capture/route.test.ts lib/auth/` →
  7 files, 170 passed, 1 skipped.

### 5. `0117`'s §9 rows that name Cognito

Only one does: §9.4, "Cognito self-signup is OFF and unauthenticated identities are OFF". It now
carries a dated note pointing here. Its replacement checks are §1, §3 and §4 above, and
`check-auth-posture.mjs` asserts the resource half on every deploy.

## Operator validation

Agent, 2026-11-03, against production from the WSL desktop, with curl, Node `fetch` and the
`devault` AWS profile (read-only). Every check above is a script or a request. The operator was not
needed: minting a session for a non-allowlisted email replaced the one refused Google sign-in the
Notes anticipated. No perceptual check applies.

D-123 trigger checked? **A**, verified after the migration: one uid, the owner's (D-470, D-479).
**B** and **C** are not touched by this ticket.

**Orchestrator, at merge (wave 19).** I re-ran the unsigned AppSync attack myself, against the endpoint
`appsync get-graphql-api --api-id nog4xy2l7baqlhghpndh2565qe` reports as production's
(`uris.GRAPHQL` = `https://hopa22ito5foleo6o727cezz3u.appsync-api…/graphql`; the hostname is not the
API id, which is why I checked). The results were the same: no auth gave 401 `UnauthorizedException`, a
fake `x-api-key` gave 401, and an unsigned JWT in `Authorization` gave 403
`IncompleteSignatureException`. The account's other two `amplifyData` APIs use Cognito user pools and
belong to other apps; neither carries this app's tags (the posture check's assertion passes). The commit
has no code changes. Its only content outside the ticket is the §9.4 note in `09`, so I checked it for
secrets by grep as well as with the hook's gitleaks: it holds no token-shaped string.

