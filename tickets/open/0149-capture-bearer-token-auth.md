---
id: 149
slug: capture-bearer-token-auth
title: Bearer-token auth so a non-browser client can reach the capture endpoint
type: feature
priority: high
status: open
size: m
capability: 03-ticket-capture-endpoint
depends_on: [19]
blocked_by: []
source: agent
created: 2026-09-02T15:26:07Z
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

- [ ] `middleware.ts` admits a request carrying a valid `Authorization: Bearer <IdToken>` with no
      session cookie, and continues to 404 one carrying neither.
- [ ] The token is verified against the **production** pool's JWKS — signature, `iss`, `aud` or
      `client_id`, `token_use: id`, and `exp`. A token failing any of these is treated as
      signed out, not as an error.
- [ ] JWKS is fetched once and cached in module scope; a fetch failure is **not** cached, matching
      the SSM-token reasoning in `lib/tickets/github.ts`.
- [ ] `sub` is read from the verified payload only. There is no code path that reads an identity
      from an unverified token, a body field, a query string or any other header.
- [ ] A token issued by the **sandbox** pool is rejected, and there is a test asserting it — the
      two pools are distinguishable only by tags, and `0019`'s capability-doc section explains why
      this is the realistic mistake.
- [ ] A non-owner's valid token gets the same byte-identical 404 as a signed-out request.
- [ ] An expired token gets that same 404, so a stale device credential is indistinguishable from
      no credential.
- [ ] The refresh-token exchange is documented in the capability doc with the exact request shape,
      so `0020`'s task can be built from it without re-deriving it from AWS documentation.
- [ ] Smoke test: a `curl` with a bearer IdToken obtained via `REFRESH_TOKEN_AUTH` commits a file
      to `tickets/inbox/`, and the same `curl` with the token's last character altered returns 404.
- [ ] A `D-xxx` records that non-browser clients authenticate by verified bearer IdToken, and that
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

## Operator validation

> **D-181 — most of this is the AGENT's to run.** The JWKS verification, the pool-mismatch
> rejection, the 404 equivalence and the `curl` round trip are all reachable with AWS credentials
> and a shell, and belong here as smoke tests at close.

**Operator, once:** sign in on the phone's browser and hand the refresh token to the capture task,
then confirm a capture posted from the device lands in `tickets/inbox/`. This is the only step
needing a human, because the agent must not hold a production browser session
(`08-security-privacy.md` §2.4 Trigger A, and the `0130` throwaway exists precisely so it never
needs one).
