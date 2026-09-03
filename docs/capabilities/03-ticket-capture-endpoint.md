# 03-ticket-capture-endpoint

> **Stub, generated during backlog validation.** The authoritative design is the
> `#### \`03-ticket-capture-endpoint\`` section of [`../09-roadmap.md`](../09-roadmap.md). This file is where the
> DESIGN step's output belongs, and where [`AUDIT.md`](AUDIT.md) results are appended at close.

## Tickets (7)

- `0018` — POST /api/tickets/capture commits a new file to tickets/inbox/
- `0019` — Harden the capture endpoint - owner auth, server-derived path, size and rate limits, idempotency
- ~~`0020` — Android quick-capture - Tasker/MacroDroid HTTP task on a quick-settings tile~~ **DECLINED, D-184**
- ~~`0021` — Google Assistant routine as a second capture path~~ **DECLINED, D-184**
- ~~`0022` — Capture-queue semantics for offline - retry lives in the Android task~~ **DECLINED, D-184**
- `0023` — /tickets triage handles inbox files end to end
- `0024` — Runbook - rotating and revoking the GitHub PAT

## Runbooks

- **[Rotating and revoking the GitHub PAT](../runbooks/github-pat-rotation.md)** — ticket `0024`.
  Scheduled 90-day rotation and the S5 leak response. **Read §0 first**: it carries the SSM
  parameter path, the exact PAT settings, and the current token's issue and expiry dates, which are
  updated on every rotation.

## Design notes

### How the PAT reaches the handler, and why it is not `secret()`  (ticket 0018, 2026-08-31)

Every other secret in this project arrives through Amplify's `secret()`. This one cannot, and the
reason is structural rather than incidental: **`secret()` resolves only into a `defineFunction`
Lambda's environment at deploy time.** `/api/tickets/capture` is a **Next.js route handler running
on Amplify's SSR compute**, which is not a `defineFunction` Lambda. And it must not be an Amplify
environment variable, because 0017 established the standing rule that those are rendered in
plaintext into build artifacts.

So it is read from SSM at cold start through the AWS SDK, cached in module scope for the life of the
execution environment. The cached value is a **promise, not a string** — two concurrent cold requests
would otherwise each fire their own SSM call — and a rejection is explicitly *not* cached, because a
transient SSM error would otherwise disable capture for the entire life of a warm environment, which
can be hours.

### The compute role, and the guard that was not available

**`computeRoleArn` was `null`.** Amplify SSR was running under an AWS-managed execution role that
cannot be given policies, so there was nothing to attach a grant to. This is a create-a-role-and-
change-app-configuration change, not a policy edit, and it was confirmed with the operator before
being applied.

`LostSolesAmplifyComputeRole` has exactly one permission — one action, one resource, no wildcard:

```
ssm:GetParameter  on  arn:aws:ssm:us-east-1:286588821906:parameter/amplify/shared/d14fhvl4rp79nn/GITHUB_TICKETS_PAT
```

**Amplify rejects any `Condition` on a compute role's trust policy.** An `aws:SourceArn` lock was
tried and refused with *"The compute role provided cannot be assumed by Amplify"*; an
`aws:SourceAccount` lock alone was refused the same way. AWS's own generated `AmplifySSRLoggingRole-*`
roles carry the identical bare `amplify.amazonaws.com` principal, which is how the shape was
confirmed rather than guessed. **The usual confused-deputy guard is therefore unavailable here**, and
the actual containment is the permission scope: the worst this role can do is read one GitHub PAT.
Written down because a future reader comparing this to the `check-auth-posture.mjs` grant will notice
the missing condition and should not have to re-derive why it is missing.

### The contract nobody had written down: capture writes, triage reads

The endpoint writes a file that `tickets.mjs triage-move` reads later, possibly days later. Two
components, one file format, and nothing asserted they agreed.

It matters more than it looks, because **`tickets.mjs`'s frontmatter parser is deliberately NOT a
YAML parser.** Its own comment explains why: *"a real YAML parser would happily accept nested
structures the format does not allow, then silently reformat them on write."* It is line-based — one
flat `key: value` per line, surrounding quotes stripped naively, and any line failing that regex is a
hard parse error.

**So "valid YAML" was never the bar. Valid YAML that *this* parser accepts is.** A block scalar
(`key: |`), a folded line, or any multi-line value would all be perfectly legal YAML and would all
produce a captured note that the tool meant to triage it cannot read — surfacing days later, on a
note dictated once at mile six with no second copy.

Two serializer options carry that guarantee: `blockQuote: false` and `lineWidth: 0`. Quoting itself
is left to the serializer rather than forced, and that was decided by measurement, not taste: forcing
`QUOTE_DOUBLE` made a title containing a double quote come back through the naive quote-strip as
literal backslashes (`he said \"run\" loudly`), where the default round-trips clean.

`lib/tickets/capture-triage-contract.test.ts` imports the **real** parser — not a reimplementation,
which would drift — and asserts the contract across twelve hostile titles: a YAML tag, a document
break, a leading dash, a hash, embedded quotes, unicode, a trailing colon.

### Absence as a control

There is no update path and no delete path — **not disabled, absent** (criterion 6). `github.ts`
contains no function that passes a `sha` to the Contents API, because a `sha` turns create into
overwrite, and an endpoint reachable from a phone that can overwrite arbitrary repository files is a
different thing entirely from one that can only add. `route.ts` exports only `POST`, so every other
method is a 405 by construction. Both are asserted by tests rather than promised in a comment.

### Proof the deployed compute role works

Every check the agent could run proved the GitHub half and the format half from a laptop. None of
them touched the deployed handler, because reaching it requires a Cognito session.

The operator ran the browser POST on 2026-09-01 and it returned `{ path, commitSha }`. Verified
against the repository afterwards: commit `4670092`, **one file changed**, and `tickets.mjs`'s own
parser reads the result with `error: null`.

That is the only evidence that `LostSolesAmplifyComputeRole` actually took effect — that the SSR
compute can assume it, and read the one SSM parameter it is permitted, in production. A 502 would
have meant the IAM change had not applied.

### What is deliberately NOT here

*(Written at 0018's close; **superseded by the 0019 sections below**, which is where each of these
landed. Left in place because the reasoning for splitting the ticket is still worth reading.)*

Owner-only auth, server-side rate limits, idempotency, reject-unknown-keys, CORS, and the second and
third path-validation layers are all **ticket 0019**, which is a hard prerequisite before anything on
the phone points at this URL. What exists today: `middleware.ts` gates every non-static route so the
handler is unreachable signed-out, and the path is derived entirely server-side so no key of the
request body can influence where the write lands.

The PAT expires in 90 days (~2026-11-29). **Ticket 0024** owns the rotation runbook; nothing new was
filed for it.


### The hardening, and the order the checks run in  (ticket 0019, 2026-09-02)

`07-ticketsmith.md` §6.4 lists nine requirements and §6.5 an abuse table. Both are now
implemented, and the one thing worth writing down that neither document states is **the order**.

Owner authorization runs FIRST, before the body is read, parsed or validated. Validating first
makes the endpoint an oracle: a stranger who can tell a 400 `unknown key: path` from a 400
`title must be 1..200 characters` has learned the schema, and one who can tell any 400 from a
404 has learned the route exists — which is exactly what §6.5 spends a 404-instead-of-403 to
deny them. The 404 a non-owner gets is byte-identical to the one `middleware.ts` returns to a
signed-out request, and there is a test asserting that equality rather than a comment promising
it.

Idempotency is claimed BEFORE the rate budget is spent, for a different reason: a replayed key
must not consume quota. Otherwise `0022`'s retry queue doing its job — resending after a timeout
it never saw answered — burns the operator's hourly allowance on captures that already committed.

### The bug criterion 4 found in `0018`

`derivePath` shipped as `${slug || "untitled"}`. That looked like a sensible guard and was in
fact the exact failure §6.4/2 forbids: **"untitled" is a legal slug**, so the re-validation regex
would have passed it and a file would have landed at a name derived from nothing. The realistic
input is not adversarial — it is an all-emoji title, one tap from a phone keyboard.

The fallback is gone. An empty slug now produces `tickets/inbox/<stamp>-.md`, which fails the
regex, and the route answers 500. §6.4/2 said this plainly — *"anything failing that regex is a
500, **not a fallback**"* — and the fallback existed anyway, because 0018 wrote it before there
was a regex to fail. A guard whose only job is to catch a bad name must not be handed a good one
first. `capture-format.test.ts` was amended and the amendment is explained in place.

### Three path layers, and how they are kept independent

`derivePath` (unreachable from input) → `isDerivedPath` (anchored regex) → `inboxPathViolation`
(character-by-character prefix check). Layer 3 deliberately does **not** reuse layer 2's regex: a
guard sharing an implementation with the guard it backs up is one guard written twice. There is a
test asserting the two disagree on `tickets/inbox/not-a-timestamp.md` — layer 2 rejects it, layer
3 accepts it — because agreement everywhere would be the observable signature of a single check
wearing two names.

The `-2` collision retry re-runs both layers on the new name. It is a path nothing has validated,
and inheriting trust from its parent is how a validated system acquires an unvalidated corner.
There is no `-3`: a third identical title inside one minute is a stuck client, and §6.5's answer
to a stuck client is the rate limiter.

### The guard table, and what it cost to reach

Rate-limit counters and idempotency records live in `LostSolesCaptureGuard`, the first
machine-only DynamoDB table, added through the CDK escape hatch (`01-architecture.md` §2, row 21).
Module memory was the tempting alternative and is wrong: a Lambda scales out, so an in-memory
counter is per-container and *"30 per hour"* silently becomes *"30 per hour per warm container"*
under precisely the burst it exists to stop.

Two decisions came out of it, both recorded:

- **D-179 — the guards fail closed.** DynamoDB unreachable means neither control can report a
  verdict, and the endpoint answers **503 with no commit** rather than committing with the limits
  off. The cost is real: a capture is a note dictated once with no second copy, and this bounces
  it during an outage. The operator was asked and chose this. 503 is retryable and `0022` is what
  retries it.
- **D-180 — the table is named by a literal on both sides.** The SSR compute is not a
  `defineFunction` Lambda, so it has no CloudFormation output, no `secret()` and no permitted env
  var (0017's standing rule) — the same structural gap that sent 0018's PAT to SSM. `backend.ts`
  and `capture-store.ts` state the same literal and a test asserts they agree. **The cost: an
  explicit table name is account-and-region unique, so `ampx sandbox` cannot coexist with `main`'s
  stack.** Recorded here so the next person to run a sandbox does not have to diagnose a
  `CREATE_FAILED` from first principles.

The IAM grant is `grantReadWriteData` on that one table, attached to `LostSolesAmplifyComputeRole`
imported by ARN with `mutable: true` — CDK attaching a policy to a role it does not own, because
that role was created by hand in 0018 and is in no stack. The role's total reach is now: read one
SSM parameter, read and write one table.

### The scanner that fired on a database key

`scripts/check-design-tokens.mjs` failed the build on `RATE#<uid>#H#2026-09-02T14`: its
`/#[0-9a-f]{3,8}\b/i` reads `#2026` as a hex colour, correctly by its own rule. 0019 moved its
separator (`#hour:` rather than `#H#`) rather than touch a control mid-ticket.

**That is a workaround, and the clash is structural.** `01-architecture.md` §2 specifies
`PK = U#<uid>#C#<res6parent>` and an H3 cell id *is* a hex string, so every realistic cell-key
fixture in capability `07` will trip this. Filed as **`0146`**, with the three candidate fixes and
the reason the cheapest one (exclude test files) is wrong.

### Two things §6.4 asks for that are deliberately NOT here

- **§6.4/7, the webhook HMAC.** It protects the browse cache, and the cache does not exist. It
  belongs with it in capability `17`. Building a webhook route here that nothing reads would be a
  security control guarding nothing, which ages into a security control nobody remembers the
  purpose of.
- **§6.6, the `tickets-inbox` branch variant.** Checks 2–4 already confine writes to
  `tickets/inbox/` and make them create-only, which makes direct-to-`main` defensible for one
  operator. Revisit if the credential ever broadens, or if branch protection lands on `main`.

### The payload secret scan (ticket 0004's requirement)

Worth restating because it is easy to read as redundant and is not. Every other write to this
repository passes `.githooks/pre-commit`. **This one does not** — it commits through the GitHub
API from a Lambda, so the hook never runs — and GitHub push protection needs Advanced Security,
which a private personal repo does not have. Without `secretInPayload` there is **no** scanner on
this path at all. The five patterns are kept in step across three surfaces now: the hook, the
logger's redactions, and this.


### `amplify_outputs.json` names the SANDBOX pool on a laptop  (ticket 0019, 2026-09-02)

Filing this where the next person hard-codes a pool-scoped identifier will look for it.

The owner allowlist (§6.4/1) needs the operator's Cognito `sub`. The obvious lookup — read
`auth.user_pool_id` out of `amplify_outputs.json`, list its users — is **wrong on a development
machine**, and it fails in the worst possible way: it succeeds, and returns exactly one user.

That user is `agent@lost-soles.invalid`, the throwaway from `0130`. `amplify_outputs.json` is
generated per-environment (`.gitignore` says so explicitly, and says it is ignored because it is
environment-specific rather than because it is sensitive), and `ampx sandbox` rewrites it — `0131`
did, on 2026-09-01. So it names the sandbox. Allowlisting what it returns would have granted a
repository write primitive to a disposable account whose password sits in SSM.

**The pools are distinguishable only by their tags**, never by their ids or their names:

| pool | `amplify:deployment-type` | sole user |
|---|---|---|
| `us-east-1_3lreDA1d1` | `branch`, branch-name `main` | `amazingbrandon@gmail.com` — the owner |
| `us-east-1_RV7QIiViX` | `sandbox` | `agent@lost-soles.invalid` — never allowlist |

```
aws cognito-idp describe-user-pool --user-pool-id <id> --query 'UserPool.UserPoolTags'
```

Two consequences that outlive this ticket:

1. **A `sub` is pool-scoped.** Recreating the production pool changes every sub in it and silently
   404s the owner, with no error anywhere that mentions authentication. `0131` has already
   recreated a pool once. Anything hard-coding a sub inherits this.
2. **The agent cannot hold a production browser session, and must not get one.** A second
   production account fires `08-security-privacy.md` §2.4 Trigger A — a seven-item gate, four of
   them build items. `0130` exists so troubleshooting never needs it. Operator validation steps
   that require a signed-in production session are therefore genuinely operator-only, not a gap to
   be engineered around later.

### What the deploy actually produced  (ticket 0019)

Amplify build 49 (`90714af`) succeeded. The part worth recording is the IAM grant, because CDK is
attaching a policy to a role CloudFormation **does not own** — `LostSolesAmplifyComputeRole` was
created by hand in `0018` and lives in no stack. `Role.fromRoleArn(..., { mutable: true })` handled
it, and the role now carries two inline policies:

```
AmplifyComputeRolePolicy4423B23B   ← 0019, DynamoDB, one table ARN, no wildcard
ReadTicketsCapturePat              ← 0018, ssm:GetParameter, one parameter ARN
```

`LostSolesCaptureGuard` is ACTIVE, `PK = pk`, on-demand, TTL enabled on `ttl`. The role's total
reach is one SSM parameter and one DynamoDB table — which is the whole of the containment, since
the trust-policy condition that would normally provide it is refused by Amplify (see above).


### How a phone authenticates, and why it is not a shared secret  (ticket 0149, 2026-09-02)

`0019` shipped an endpoint that only a browser can reach. `route.ts` reads the identity from a
**Cognito session cookie** and `middleware.ts` 404s anything without one, which is correct for the
app and useless for the thing capability `03` exists to serve. `0020` assumed "the shared auth
header 0019 accepts"; no such header was ever built, and `08-security-privacy.md` §5.3 forbids the
shape it implies — *never take a uid from a request body, query string or header.*

**The resolution is that the header carries a Cognito-signed ID token, not an identity.** §5.3's
rule is about trusting an *assertion*. A signature this server checked against a public key it
fetched from the issuer is not an assertion; the `sub` still comes from Cognito. See **D-183**.

#### The exchange, verified end to end on 2026-09-02

`USER_PASSWORD_AUTH` and `ADMIN_USER_PASSWORD_AUTH` are **both disabled** on both app clients —
only `ALLOW_CUSTOM_AUTH`, `ALLOW_REFRESH_TOKEN_AUTH` and `ALLOW_USER_SRP_AUTH` are enabled. So the
device cannot exchange a password for a token, and SRP is not something to implement in Tasker.
The split is therefore:

1. **Once, by the operator, in a browser.** Sign in normally; Amplify does SRP. Take the
   **refresh token** out of the Cognito storage and paste it into the Tasker task's variable.
2. **Per capture, by the task.** One plain POST — no SigV4, no client secret, no SDK:

```http
POST https://cognito-idp.us-east-1.amazonaws.com/
Content-Type: application/x-amz-json-1.1
X-Amz-Target: AWSCognitoIdentityProviderService.InitiateAuth

{"AuthFlow":"REFRESH_TOKEN_AUTH",
 "ClientId":"5vc5e8t2ljv1hg3doau5mp0m00",
 "AuthParameters":{"REFRESH_TOKEN":"<the pasted token>"}}
```

   → `{"AuthenticationResult":{"IdToken":"…","ExpiresIn":3600,"TokenType":"Bearer"}}`

3. **Then the capture**, with `Authorization: Bearer <IdToken>`.

The production app client has **no client secret** (`ClientSecret: null`), which is what makes step
2 a bare POST rather than something needing `SECRET_HASH`. Verified with `curl` against the sandbox
client, which has the identical flow configuration.

#### The trust anchor is hard-coded, for the same reason the owner allowlist is

`lib/auth/bearer.ts` states `us-east-1_3lreDA1d1` and `5vc5e8t2ljv1hg3doau5mp0m00` as literals.
They are identifiers rather than credentials, and a control whose failure must be closed should not
have a runtime dependency that can be unavailable. **Do not replace them with
`amplify_outputs.json`** — on a laptop that file names the sandbox pool, and a verifier pointed at
the sandbox pool trusts the `0130` throwaway account, whose password is in SSM. This is the same
trap `0019` documented for `OWNER_USER_IDS`, one layer down.

Proven rather than asserted: a **real, unexpired, correctly-signed** ID token minted for
`agent@lost-soles.invalid` in the sandbox pool was fed to the production verifier and rejected
(`issuer not configured`), while the sandbox verifier accepted the same token — so the rejection is
about the pool, not a broken token.

#### Verification runs twice, and that is deliberate

`middleware.ts` verifies, and `lib/auth/owner.ts` verifies again. The second is a JWKS cache hit and
it exists because the route must be correct on its own terms: one more exclusion in the middleware
matcher regex would otherwise silently switch the endpoint's authorization off. §6.4/1's check runs
in the handler, so its input has to be established in the handler.

Note the two run on **different runtimes**. `middleware.ts` is Next's edge runtime, where
`aws-jwt-verify` resolves its `browser` condition and verifies with `crypto.subtle`; the route is
Amplify's Node SSR compute, which gets the Node build and `https.request`. The built edge bundle was
checked for this — six `crypto.subtle` references, zero Node `crypto` — because picking the wrong
one is a runtime failure that builds cleanly.

**This also bit the tests.** Vitest's default node resolution loaded the Node build, so a suite that
stubbed global `fetch` stubbed nothing, the verifier reached the *real* Cognito JWKS over the
network, and fourteen rejection assertions passed for the wrong reason while the two acceptance
tests failed. `vitest.config.ts` now runs `lib/auth/bearer.test.ts` as a separate project with
`browser` conditions and `aws-jwt-verify` inlined — externalised dependencies are resolved by Node,
which ignores Vite's conditions.

#### A tamper test that does not tamper

`0149`'s criterion 9 proposed proving rejection by altering **the token's last character**. That
check can pass a forged token. An RSA-2048 signature is 2048 bits, which base64url encodes in 342
characters carrying 2052 bits — so the final character contributes 2 significant bits and 4 bits of
padding, and `A` and `B` decode to byte-identical signatures. The criterion was amended to alter a
character in the middle, and a test pins the property so the trap is not re-laid.

#### The refresh token expires in a year

`RefreshTokenValidity` was 43200 minutes (30 days) when this was written; **ticket `0151` raised it
to 525600 minutes — one year**, and the section below records that change. After it expires the
task's `REFRESH_TOKEN_AUTH` returns `NotAuthorizedException`, it gets no ID token, and **capture
dies silently until the operator re-pairs the phone**. `0022`'s retry queue must therefore treat a
failed refresh as fatal-until-re-paired rather than retrying a dead credential forever.

### The refresh token is a year, and the deploy gate needed a grant  (ticket 0151, 2026-09-02)

`refreshTokenValidity` was 43200 minutes — 30 days — and that number was reasoned for a **browser**
("long enough a phone stays signed in between runs, short enough a stolen device goes stale"). D-183
changed what it governs: the capture task holds a refresh token, so at 30 days the tile stops
working monthly, and it stops **silently** — the tile still takes the dictation and the note is
simply never committed, which is the failure capability `03` exists to prevent. Now 525600 minutes.

The ID token is deliberately **unchanged at 60 minutes**. That short half is where the protection
lives; lengthening both would be a different and much worse change. Revocation was already on, and
is what makes a year defensible rather than lazy.

**Verified on the sandbox before touching production.** Raising `RefreshTokenValidity` on the
sandbox client left the client id byte-identical and a **pre-existing refresh token still
exchanged successfully** — so the operator's current session survives the change and no immediate
re-pairing is needed. The sandbox client was restored afterwards. On production, exactly one field
differs from the pre-change capture: `43200 → 525600`. Units, flows, revocation and the owner's
`sub` are all unchanged, so `OWNER_USER_IDS` and `lib/auth/bearer.ts` keep working untouched.

#### The build failed first, and the failure was the check working

`check-auth-posture.mjs` gained three token-lifetime assertions, because raising the lifetime is
what creates the need for them: a year-long credential whose duration nothing verifies is weaker
than a 30-day one. The unit is asserted **separately from the value**, since CloudFormation reads a
missing `TokenValidityUnits` as **days** — dropping it turns 525600 minutes into 525600 days
without changing a digit anyone would notice in review.

Build **60** then failed with `AccessDeniedException ... cognito-idp:ListUserPoolClients`. The check
had failed closed exactly as designed; what was missing was a permission. The build role
`AmplifySSRLoggingRole-bcad2fbf-…` carries a hand-made inline policy,
**`LostSolesAuthPostureCheckReadOnly`**, which already granted `DescribeUserPool` and
`ListIdentityProviders`; it now also grants `ListUserPoolClients` and `DescribeUserPoolClient`, both
read-only, on `userpool/*` in this account — the resource shape the existing statement already used.

**Note the ordering this exposed.** The backend deploy runs BEFORE the posture check in the same
build phase, so build 60 applied the Cognito change and then failed the gate. The gate is a
post-deploy assertion, not a pre-deploy one: it can fail a build *after* the configuration it is
checking has already landed. Worth knowing before reading a red build as "nothing happened".

Like `LostSolesAmplifyComputeRole` (ticket `0018`), this role is not in any CloudFormation stack, so
the policy is applied by hand and recorded here rather than in `backend.ts`.

### The capture tile is specified, not exported  (ticket 0020, 2026-09-02)

The phone build lives in **[`03-capture-tile.md`](03-capture-tile.md)** — trigger, dictation,
idempotency key, the two HTTP calls, and the vibration table that makes success and failure
distinguishable on a locked screen. **MacroDroid** is the recommended app (a first-class Quick
Settings Tile trigger and a Voice Input action, where Tasker needs extra plumbing for the same
thing); Tasker equivalents are given per step.

**No `.macro` / `.tsk.xml` is committed yet, deliberately.** Those formats encode actions as numeric
codes, and an export hand-written by an agent with no device to import it on imports cleanly and
then misbehaves — a failure that surfaces at mile six on the one note that mattered. The export is
produced by the phone once the macro works, and `0020`'s criterion 7 is amended to say so.

What exists instead is **[`tools/capture/capture.sh`](../../tools/capture/capture.sh)**, a runnable
reference implementation doing exactly what the macro must, in the same order. It is the definition
the macro transcribes, and the diagnostic to reach for when the tile misbehaves: run it from a
laptop with the same refresh token and it says whether the problem is the phone or the endpoint.
`tools/capture/capture.test.mjs` covers the three things that can silently corrupt a note — the
200-character split, the JSON escaping, and the single generation of the idempotency key.

Both failure paths were exercised against the live services: a dead refresh token exits 3 with
"re-pair the phone" and never attempts a capture, and a **real** refresh token from the wrong pool
gets a successful token exchange followed by a 404 from the endpoint — which also re-proves `0149`'s
rejection through a second, independent client.

## Audit

_Appended by `/tickets audit` at close. See [`AUDIT.md`](AUDIT.md)._

## Reflection

_Filled in at the REFLECT step, after USE._


### The PAT rotation runbook, and what writing it found  (ticket 0024, 2026-09-03)

The runbook lives at [`docs/runbooks/github-pat-rotation.md`](../runbooks/github-pat-rotation.md) —
a new `docs/runbooks/` directory rather than an inline section here, because two more runbooks are
already scheduled (`0106` account deletion, `0115` incident playbook dry-read) and they should share
a home the operator can find under pressure.

**The step the runbook exists to stop you skipping: the cold start.** `lib/tickets/github.ts` caches
the token in module scope for the life of the execution environment — deliberately, so only a cold
start pays the SSM call. An SSM write therefore does nothing to a warm environment; it keeps serving
the old token until it is recycled. A rotation that stops after `put-parameter` looks complete and
then 401s at an unpredictable time later, which is the worst possible failure shape for a credential
change: delayed, intermittent, and disconnected from the action that caused it.

**Ordering that is not arbitrary.** Verify the new token with a live capture *before* revoking the
old one. If verification fails you still have a working system on the old credential; revoke first
and you have an outage plus a debugging session.

**Two things writing it turned up.**

- The docs name the endpoint `/api/dev/tickets` in ten places across four files; the built route is
  `/api/tickets/capture`. Two of those are operational instructions — `08-security-privacy.md`
  §8.2's leak-response Verify step and checklist item A-6 — so a checklist could pass because the
  path 404s for the wrong reason. Filed as **`0154`** under D-152 rather than fixed inline.
- The token has **never been rotated** (SSM parameter version 1, written 2026-08-31). Its expiry has
  never been confirmed against GitHub, only derived from the 90-day policy. The runbook's §0 marks
  that derived figure as unconfirmed and gives the one-line command to check it, rather than
  presenting an inference as a fact.
