---
id: 165
slug: the-post-exchange-scope-re-check-refuses-every-good-grant-th
title: The post-exchange scope re-check refuses every good grant — the token response carries no scope
type: bug
priority: high
status: closed
size: s
capability: 05-strava-adapter
depends_on: []
blocked_by: []
source: agent
created: 2026-09-04T18:21:25Z
started: 2026-09-04T18:21:55Z
closed: 2026-09-04T18:25:26Z
---

## Description

`0032` shipped and its operator validation caught a defect on the first real connect: **a grant
with every permission ticked is refused, and the token is revoked.** The connect flow cannot
succeed at all.

`0032` runs the scope check twice — once on the callback query string before the exchange, once on
the exchanged grant. The second one was defence in depth, not something the ticket asked for. It
was written against `03-integrations.md` §2.2 step 3, whose example token response carries
`"scope": "activity:read_all"`. **The live response does not**, so `grantFromTokenResponse` sets
`scopes: []`, `checkGrant` finds the required scope missing, and the route revokes the credential
it just minted.

The operator's four attempts, from `/aws/amplify/d14fhvl4rp79nn`:

```
oauth callback refused: required scope missing         <- the deliberate untick. CORRECT.
oauth grant refused after exchange: required scope missing
oauth grant refused after exchange: required scope missing
oauth grant refused after exchange: required scope missing
```

The pre-check passing and the post-check failing **on the same connection, seconds apart**, is the
whole diagnosis: the callback carried `activity:read_all` and the token response did not carry it.

**What was NOT damaged, and it is worth being precise.** `LostSolesSourceAccount` and
`LostSolesOAuthState` both scan to 0 rows. The refusal path stored nothing, exactly as criterion 3
requires, and every nonce was consumed. The cost is that each attempt revoked a freshly minted
token, so the app is likely deauthorized at Strava and the next connect will show a fresh consent
screen.

**The fix must be safe without knowing which of two things is true**, because confirming it needs
a fresh authorization code and only the operator can produce one:

- **(A)** the token response omits `scope` entirely, or
- **(B)** it carries a `scope` that genuinely falls short.

So: judge the response's `scope` when it is present, and fall back to the **callback-verified**
scopes when it is absent. Under (A) the connect succeeds; under (B) it still refuses, correctly.
The grant records WHICH branch was taken so the next successful connect settles it as a fact
rather than leaving the design doc corrected on an inference.

## Steps to reproduce

1. `/settings` → Connect Strava.
2. Approve with **every permission ticked**.
3. The settings screen shows *"Not connected — a permission is missing."*

## Expected vs actual

**Expected:** a fully-ticked grant connects, and the screen shows the athlete id with
`activity:read_all` named beneath it.

**Actual:** the grant is refused and revoked. Only a grant that would be refused anyway behaves
correctly, which is why the suite is green — every test feeds `checkGrant` a response containing a
`scope` field, because the fixtures were built from the design doc's example rather than from a
real response.

## Acceptance criteria

- [x] A token response with **no** `scope` field yields a grant carrying the scopes verified on the
      callback, and the connect succeeds.
- [x] A token response **with** a `scope` field is still judged on it, and one that falls short is
      still refused and revoked — the (B) case must not become fail-open.
- [x] The grant records which of the two supplied its scopes, and the route logs it, so the next
      real connect settles (A) vs (B) as evidence.
- [x] The pre-exchange callback check is unchanged: a callback lacking the required scope is still
      refused before any exchange, and `0032`'s tests for it still pass.
- [x] A test feeds a token response shaped like the LIVE one — no `scope` key — rather than like
      the design doc's example. The fixture that hid this bug is the one being replaced.
- [x] `03-integrations.md` §2.2 step 3's example response is corrected once the branch is
      confirmed, or annotated as unverified if it is not.

## Notes

**The real lesson is the fixture, not the check.** Every test in `0032` built its token response
from the design doc's example, so the suite proved the code matched the document and the document
was wrong about the third party. `0038` exists to fix this class — *checked-in real-response
fixtures, the fidelity floor* — and it is now the most valuable remaining ticket in the capability
rather than the tidiest. This bug is the argument for it.

The second check is worth keeping rather than deleting. It costs nothing when the field is absent
and it is the only thing that would catch a provider that downgrades a grant between the callback
and the token — which is precisely the failure mode `0032` exists to prevent, just one step later
than expected.

## Operator validation

**Device: the Android phone, Chrome, at `/settings`.** Connect Strava with every permission
ticked. Expect *Connected as athlete `<id>`* with `activity:read_all` named beneath it. Because the
earlier attempts revoked the app's authorization, expect a full consent screen rather than a silent
re-approval.

Everything else is the agent's: the CloudWatch line naming the scope source settles (A) vs (B), and
the stored row can be read back with AWS credentials.

## Resolution

`OAuthConnector` changed in two places and the route in one.

**`checkCallbackScopes(raw): GrantCheck` became `readCallbackScopes(raw): { scopes, check }`.** The
route needed both halves — the verdict to decide whether to continue, and the parsed list to carry
into the exchange — and fetching them with two calls would be two chances for them to disagree.

**`exchangeCode` now takes `grantedScopes`,** and `grantFromTokenResponse` uses them when the
response does not state its own:

```ts
const statesItsOwnScope = typeof body.scope === "string" && body.scope.length > 0
scopes: statesItsOwnScope ? parseScopes(body.scope) : [...grantedScopes],
scopeSource: statesItsOwnScope ? "response" : "callback",
```

The old line was `typeof body.scope === "string" ? parseScopes(body.scope) : []`. **An absent field
became an empty grant**, which `checkGrant` read as "no permissions were granted" and the route
answered by revoking a perfectly good credential.

**The two absences mean opposite things, and that is the whole bug.** On the callback, nothing has
been said yet, so silence is a refusal — unchanged, and still refused before any exchange. In the
token response the callback has already spoken, so silence is the provider not repeating itself.
Both readings are now stated next to each other in the code with that reasoning, because the next
person to simplify one of them will otherwise make them consistent and reintroduce this.

**What was deliberately NOT done: deleting the second check.** It costs nothing when the field is
absent, and when present it is the only thing that could catch a provider downgrading a grant
between the callback and the token — which is exactly what `0032` exists to prevent, one step
later than expected. A test covers that case explicitly so the fallback cannot become fail-open.

**`scopeSource` is on the grant** so the ambiguity that forced a two-hypothesis fix gets settled by
evidence. `03-integrations.md` §2.2 step 3 is annotated as unverified with an instruction to
replace the annotation with the observed value, rather than corrected on an inference.

### The real finding, which is about fixtures rather than about scope

Every test in `0032` built its token response from the design doc's example. The suite was
therefore proof that **the code matched the document**, and the document was wrong about a third
party. 76 tests, all green, against a flow that could not complete once.

The default fixtures in `oauth.test.ts` and `oauth-routes.test.ts` are now the shape the
operator's own attempts produced — no `scope` key — and a response that restates its scope is a
separate, named fixture, because it should look like the exception it is. **`0038` (checked-in
real-response fixtures, the fidelity floor) is no longer the tidiest ticket left in this
capability; it is the most valuable, and this bug is the argument for it.** Its note now says so.

## Operator validation

**Smoke tests (agent), 2026-09-04.**

The diagnosis itself was a smoke test, and it is the reason no guessing was needed. From
`/aws/amplify/d14fhvl4rp79nn`, the operator's four attempts:

```
oauth callback refused: required scope missing            <- the deliberate untick. CORRECT.
oauth grant refused after exchange: required scope missing
oauth grant refused after exchange: required scope missing
oauth grant refused after exchange: required scope missing
```

Two differently-worded refusals were written into `0032` precisely so that this question — which
check fired — could be answered from a log rather than reproduced. That paid for itself.

State after the failures, both confirming the refusal path did what criterion 3 required:

```
LostSolesSourceAccount   0 rows    nothing was stored
LostSolesOAuthState      0 rows    every nonce consumed
```

Suite 526 green; lint, typecheck, `check-boundaries.mjs` and `check-design-tokens.mjs` all clean.

**★ Operator, on the phone ★** — `/settings` → **Connect Strava**, everything ticked. Expect
*Connected as athlete `<id>`* with `activity:read_all` beneath it. **Expect a full consent screen
rather than a silent re-approval**, because the four failed attempts each revoked the token they
had just been given. The agent then reads back the stored row and the `scopeSource` log line.
