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
- [ ] Smoke test: a `curl` with a bearer IdToken obtained via `REFRESH_TOKEN_AUTH` commits a file
      to `tickets/inbox/`, and the same `curl` with ~~the token's last character~~ **a character in
      the middle of the signature** altered returns 404.
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

## Operator validation

> **D-181 — most of this is the AGENT's to run.** The JWKS verification, the pool-mismatch
> rejection, the 404 equivalence and the `curl` round trip are all reachable with AWS credentials
> and a shell, and belong here as smoke tests at close.

**Operator, once:** sign in on the phone's browser and hand the refresh token to the capture task,
then confirm a capture posted from the device lands in `tickets/inbox/`. This is the only step
needing a human, because the agent must not hold a production browser session
(`08-security-privacy.md` §2.4 Trigger A, and the `0130` throwaway exists precisely so it never
needs one).

---

## Progress — 2026-09-02 (not closed)

Nine of ten criteria are met and the code is deployed (Amplify build **58**, commit `4247cd3`).
**Criterion 9 is outstanding and only the operator can finish it**, so the ticket stays open per
the close rule: committing the work and closing it later is correct; ticking the box is not.

### What was verified, and how

`lib/auth/bearer.ts` verifies against real RSA signatures in test — a keypair is generated, tokens
are signed with it, and the JWKS endpoint is stubbed to serve the matching public key, so "a
tampered token is rejected" is asserted by the actual signature check. 20 tests cover acceptance,
expiry, wrong pool, wrong client, access-vs-ID token, unknown `kid`, a swapped payload, `alg:none`,
JWKS caching, and that a failed JWKS fetch is not cached. 6 more in `middleware.test.ts` cover the
routing decision. Full suite: **270 pass**, typecheck and lint clean.

**Criterion 5 was proven with a real token, not a synthetic one.** A valid, unexpired, correctly
signed ID token was minted for `agent@lost-soles.invalid` in the sandbox pool (SRP, via the `0130`
throwaway) and fed to the production verifier: rejected, `issuer not configured`. The sandbox
verifier accepted the same token, so the rejection is about the pool rather than a broken token.

**Criterion 8 was proven by running the exchange.** `REFRESH_TOKEN_AUTH` over plain `curl` — no
SigV4, no SDK, no client secret — returned a fresh ID token, `ExpiresIn: 3600`, `TokenType: Bearer`.
The request shape is in the capability doc verbatim.

### Deployed smoke test — the rejection half of criterion 9

Against `https://soles.devaultsecurity.com/api/tickets/capture` on build 58, every one returned a
byte-identical `404 {"error":"not found"}` and committed nothing:

| Sent | Result |
|---|---|
| no credential at all | 404 |
| `Bearer not-a-jwt` | 404 |
| `Bearer ` (empty) | 404 |
| a **real, valid** sandbox-pool ID token | 404 |
| that token with a middle signature character altered | 404 |

**An honest limit on what that proves.** By design these are indistinguishable from what a
deployment *without* the bearer branch would return — §6.5 spends a 404-instead-of-403 precisely so
no probe can tell the cases apart, and that denies it to the agent too. A timing probe (a token with
correct production claims and an unknown `kid`, which can only be rejected after a JWKS fetch) was
inconclusive: the first request was slower, later ones were not. So the branch's *presence* rests on
the unit tests plus inspection of the built edge bundle — six `crypto.subtle` references and zero
Node `crypto`, from the same commit build 58 deployed — not on the deployed probe.

### ★ What the operator needs to do, once ★

This finishes criterion 9's positive half and the ticket. The agent must not hold a production
browser session (`08-security-privacy.md` §2.4 Trigger A), which is why this step exists.

1. Sign in to `https://soles.devaultsecurity.com` in a browser as the owner.
2. In DevTools → Application → Local Storage, find the key ending
   `...5vc5e8t2ljv1hg3doau5mp0m00.<sub>.refreshToken` and copy its value.
3. Exchange it for an ID token — nothing here is secret except the refresh token itself:

   ```sh
   RT='<the refresh token>'
   ID=$(curl -s -X POST https://cognito-idp.us-east-1.amazonaws.com/ \
     -H 'Content-Type: application/x-amz-json-1.1' \
     -H 'X-Amz-Target: AWSCognitoIdentityProviderService.InitiateAuth' \
     -d "{\"AuthFlow\":\"REFRESH_TOKEN_AUTH\",\"ClientId\":\"5vc5e8t2ljv1hg3doau5mp0m00\",\"AuthParameters\":{\"REFRESH_TOKEN\":\"$RT\"}}" \
     | sed -n 's/.*"IdToken":"\([^"]*\)".*/\1/p')
   echo "got a token of ${#ID} chars"
   ```

4. Capture with it, and confirm a **201** with a `path` and `commitSha`:

   ```sh
   curl -i -X POST https://soles.devaultsecurity.com/api/tickets/capture \
     -H "Authorization: Bearer $ID" -H 'Content-Type: application/json' \
     -d '{"title":"bearer auth works","type":"chore","priority":"low",
          "idempotencyKey":"'"$(uuidgen)"'"}'
   ```

5. Then confirm the rejection half with the *same* token, one character of the signature altered
   **in the middle, not at the end** — the last character carries only padding bits and altering it
   changes nothing:

   ```sh
   BAD="${ID:0:${#ID}-40}$([ "${ID: -40:1}" = A ] && echo B || echo A)${ID: -39}"
   curl -s -o /dev/null -w '%{http_code}\n' -X POST \
     https://soles.devaultsecurity.com/api/tickets/capture \
     -H "Authorization: Bearer $BAD" -H 'Content-Type: application/json' \
     -d '{"title":"should not appear","type":"chore","priority":"low",
          "idempotencyKey":"'"$(uuidgen)"'"}'
   ```

   Expect `404`, and confirm no second file appeared in `tickets/inbox/`.

Report the two results and the ticket closes. The `tickets/inbox/` file from step 4 is a real
capture — decline it at the next triage rather than deleting it.
