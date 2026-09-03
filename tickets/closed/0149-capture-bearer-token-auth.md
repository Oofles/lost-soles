---
id: 149
slug: capture-bearer-token-auth
title: Bearer-token auth so a non-browser client can reach the capture endpoint
type: feature
priority: high
status: closed
size: m
capability: 03-ticket-capture-endpoint
depends_on: [19]
blocked_by: []
source: agent
created: 2026-09-02T15:26:07Z
closed: 2026-09-03T01:18:27Z
---

## Description

**`0019` accepts no auth header, and `0020` assumes one exists.** The capture endpoint
authenticates by reading a **Cognito session cookie**: `route.ts` calls `currentUserId()`, which
runs `fetchAuthSession` over `cookies()`, and `middleware.ts` 404s any request without a session
before the route is reached. A Tasker HTTP task is not a browser and cannot hold that cookie, so
the endpoint is presently **unreachable from the phone it exists for** — which is the whole of
capability `03`'s value (roadmap §4.1).

This is a gap in the design, not a defect in `0019`. §6.4/1 says "require a valid Lost Soles
session"; `08-security-privacy.md` §5.3 says every route re-derives `sub` from the verified JWT and
**never** takes a uid from a body, query string or header. Both are satisfied by what `0019` built.
Neither document says what a non-browser client does, and no `D-xxx` covers it.

**The chosen mechanism (operator decision, 2026-09-02): a Cognito-issued bearer token.**

1. The device holds a **Cognito refresh token**, obtained once by the operator signing in.
2. The capture task POSTs `REFRESH_TOKEN_AUTH` to `cognito-idp.us-east-1.amazonaws.com` and
   receives a 1-hour `IdToken`. Plain JSON over HTTPS — no SRP, which is why this flow and not
   `USER_PASSWORD_AUTH` or a hand-rolled SRP implementation.
3. The task sends `Authorization: Bearer <IdToken>` to `/api/tickets/capture`.
4. `middleware.ts` and the route verify the JWT **against the production pool's JWKS** —
   signature, `iss`, `aud`/`client_id`, `token_use: id`, `exp` — and take `sub` from the
   **verified** payload, then check it against `OWNER_USER_IDS`.

Identity therefore still comes from a Cognito-signed token the server verifies, which is what
§5.3 actually requires. A shared-secret header was considered and rejected: it would be a second
auth path to a repository write primitive, it takes identity from a header value the server simply
trusts, and it cannot be revoked per-device without rotating the secret for every client.

**Rejection is per-device and real:** a refresh token is revocable with `AdminUserGlobalSignOut`
or by revoking that token, which is a materially better story than a static secret.

## Acceptance criteria

- [x] `middleware.ts` admits a request carrying a valid `Authorization: Bearer <IdToken>` with no
      session cookie, and continues to 404 one carrying neither.
- [x] The token is verified against the **production** pool's JWKS — signature, `iss`, `aud` or
      `client_id`, `token_use: id`, and `exp`. A token failing any of these is treated as
      signed out, not as an error.
- [x] JWKS is fetched once and cached in module scope; a fetch failure is **not** cached, matching
      the SSM-token reasoning in `lib/tickets/github.ts`.
- [x] `sub` is read from the verified payload only. There is no code path that reads an identity
      from an unverified token, a body field, a query string or any other header.
- [x] A token issued by the **sandbox** pool is rejected, and there is a test asserting it — the
      two pools are distinguishable only by tags, and `0019`'s capability-doc section explains why
      this is the realistic mistake.
- [x] A non-owner's valid token gets the same byte-identical 404 as a signed-out request.
- [x] An expired token gets that same 404, so a stale device credential is indistinguishable from
      no credential.
- [x] The refresh-token exchange is documented in the capability doc with the exact request shape,
      so `0020`'s task can be built from it without re-deriving it from AWS documentation.
- [x] Smoke test: a `curl` with a bearer IdToken obtained via `REFRESH_TOKEN_AUTH` commits a file
      to `tickets/inbox/`, and the same `curl` with ~~the token's last character~~ **a character in
      the middle of the signature** altered returns 404.
      — verified 2026-09-03: the capture committed `tickets/inbox/2026-09-03T0114-bearer-auth-works.md`
      in commit `1927a7e`, 1 file changed, 12 insertions; the tampered token returned **404** and
      committed nothing — the repository holds exactly one capture commit for the pair.
      **Amended 2026-09-02 — the check as written can pass a forged token.** An RSA-2048 signature
      is 2048 bits, which base64url encodes in 342 characters carrying 2052 bits; the final
      character therefore contributes 2 significant bits and 4 bits of padding, so `A` and `B`
      decode to byte-identical signatures. Found by the test suite, which failed on exactly this.
      A test now pins the property so the trap is not re-laid.
      **The positive half is the operator's, and the negative half is the agent's.** Committing a
      file needs a *production* ID token, which needs a production sign-in the agent must not have
      (`08-security-privacy.md` §2.4 Trigger A). The rejection half needs no credential at all.
- [x] A `D-xxx` records that non-browser clients authenticate by verified bearer IdToken, and that
      a shared-secret header was rejected and why.

## Notes

Filed by the agent while working `0020`, which is blocked on this. `0020`'s step 3 ("the shared
auth header 0019 accepts") describes a mechanism that was never built and that §5.3 forbids in the
form it implies; that step should be read as "whatever auth the endpoint accepts" and will be
correct once this lands.

**Do not read the pool id from `amplify_outputs.json`** — on a development machine it names the
sandbox pool. `lib/auth/owner.ts` carries the full explanation and the tag-based lookup. The
production pool is `us-east-1_3lreDA1d1` (`amplify:deployment-type = branch`).

`0021` (Google Assistant) and `0022` (offline retry) both point at this endpoint too, so they
inherit this dependency through `0020`.

The 1-hour IdToken lifetime interacts with `0022`: a capture queued offline for longer than an
hour must re-run the refresh exchange before resending, not replay a stale token. Worth stating in
`0022` rather than assuming the retry is a plain resend.
## Resolution

**What was wrong, and what was built.** `0019` shipped an endpoint only a browser could reach:
`currentUserId()` read the identity from a Cognito session cookie and `middleware.ts` 404'd
anything without one. A Tasker task cannot hold that cookie, so the capture endpoint was
unreachable from the phone that is the whole of capability `03`'s value. `0020` had assumed "the
shared auth header `0019` accepts", which was never built and which `08-security-privacy.md` §5.3
forbids in the form it implies.

`lib/auth/bearer.ts` now verifies an `Authorization: Bearer <Cognito ID token>` against the
production pool's JWKS and returns the `sub` from the verified payload; `middleware.ts` and
`lib/auth/owner.ts` both consult it. **D-183** records why that satisfies §5.3 rather than bending
it — a signature checked against a key fetched from the issuer is not an asserted identity — and
why a shared-secret header was rejected: a second auth path to a repository write primitive, a
header trusted outright, and no per-device revocation.

**Files touched:** `lib/auth/bearer.ts` (new), `lib/auth/bearer.test.ts` (new, 20 tests),
`middleware.ts`, `middleware.test.ts` (+6), `lib/auth/owner.ts`, `vitest.config.ts`,
`docs/decisions/DECISIONS.md` (D-183), `docs/capabilities/03-ticket-capture-endpoint.md`,
`package.json` (`aws-jwt-verify@5.2.1`).

**Verification runs twice, deliberately.** The middleware verifies and the route verifies again —
a JWKS cache hit — because the route must be correct on its own terms: one more exclusion in the
middleware matcher regex would otherwise switch the endpoint's authorization off silently. The two
run on different runtimes: the edge bundle resolves `aws-jwt-verify`'s `browser` build
(`crypto.subtle`, confirmed by inspecting the built output) and the route gets the Node build.

**Three things went wrong, all now pinned by tests or corrected in place.**

1. **The test suite was passing for the wrong reason.** Vitest's default node resolution loaded the
   Node build, whose HTTP client is `https.request` — so a suite stubbing global `fetch` stubbed
   nothing, the verifier reached the *real* Cognito JWKS over the network, and fourteen rejection
   assertions were green while the two acceptance tests failed. That shape — rejections passing,
   acceptances failing — is the signature of a suite proving nothing. `bearer.test.ts` now runs as
   its own vitest project with `browser` conditions and the package inlined, because externalised
   dependencies are resolved by Node and ignore Vite's conditions.
2. **This ticket's own criterion 9 proposed a tamper test that does not tamper.** Altering "the
   token's last character" cannot change an RSA-2048 signature: 2048 bits encode into 342 base64url
   characters carrying 2052 bits, so the final character contributes 2 significant bits and 4 bits
   of padding, and `A` and `B` decode identically. The criterion is amended and a test pins the
   arithmetic.
3. **The operator handoff sent them to the wrong storage.** It said Local Storage; the tokens are
   in cookies, because `components/auth-gate.tsx` configures Amplify with `ssr: true` so
   `middleware.ts` can read the session server-side. The root of the error is the §5.3 comment in
   `amplify/backend.ts` asserting localStorage — true of the plain browser SDK, not of this app
   under the Next.js adapter. Corrected in all three places rather than just in the handoff.

**Scope held.** The 30-day refresh token this exposed became `0151` rather than growing this
ticket; it is closed, and the lifetime is now a year.

## Operator validation

> **D-181.** Everything reachable from a shell was the agent's and was run. Exactly one step needed
> a human — a production ID token requires a production sign-in the agent must not hold
> (`08-security-privacy.md` §2.4 Trigger A) — and that step is recorded below with its result.

**Automated.** 270 tests pass (20 new in `bearer.test.ts`, 6 in `middleware.test.ts`), typecheck and
lint clean. The bearer suite generates an RSA keypair and signs real tokens, so "a tampered token is
rejected" is asserted by an actual signature check rather than a mock: acceptance, expiry, wrong
pool, wrong client, access-vs-ID token, unknown `kid`, a swapped payload, `alg:none`, JWKS caching,
and that a failed JWKS fetch is **not** cached.

**A real cross-pool token, not a synthetic one.** A valid, unexpired, correctly signed ID token was
minted for `agent@lost-soles.invalid` in the sandbox pool (SRP, via the `0130` throwaway) and fed to
the production verifier: rejected, `issuer not configured`. The sandbox verifier accepted the same
token, proving the rejection is about the pool rather than a broken token.

**The refresh exchange, run rather than described.** `REFRESH_TOKEN_AUTH` over plain `curl` — no
SigV4, no SDK, no client secret — returned a fresh ID token, `ExpiresIn: 3600`, `TokenType: Bearer`.
The request shape is in the capability doc verbatim, which is what let `0020`'s task be specified
without re-deriving it.

**Deployed rejection sweep** (build 58). Five shapes against
`https://soles.devaultsecurity.com/api/tickets/capture` — no credential, garbage bearer, empty
bearer, a real sandbox-pool token, and that token with a middle signature character altered — all
returned a byte-identical `404 {"error":"not found"}` and committed nothing. An honest limit was
recorded at the time: by design those are indistinguishable from a deployment without the bearer
branch, so the branch's *presence* rested on the unit tests and the built bundle. **The operator
step below is what removed that gap.**

**Operator, 2026-09-03 — the positive path, which only a production session could reach.**
Signed in, took the refresh token from cookies, exchanged it via `REFRESH_TOKEN_AUTH`, and captured.

- **201.** Committed `tickets/inbox/2026-09-03T0114-bearer-auth-works.md`, commit
  `1927a7e1eb29c664f7382d5901c1b74c9739bdcc`, **1 file changed, 12 insertions**. Frontmatter
  correct: `status: inbox`, `source: ui`, `created: 2026-09-03T01:14:48.907Z`. Authored as the
  operator's identity, which is expected — §6.2 states the v1 PAT acts as the user.
- **404** for the same token with a middle signature character altered, and **no second file**.
  Verified against the repository rather than taken on trust: it holds exactly one capture commit
  for the pair.

That closes the loop end to end — a bearer token minted on a device path, verified by the deployed
middleware and route, committing one file to the repository, with a forged variant of the same
token refused.
