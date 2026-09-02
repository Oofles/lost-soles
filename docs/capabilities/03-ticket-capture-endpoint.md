# 03-ticket-capture-endpoint

> **Stub, generated during backlog validation.** The authoritative design is the
> `#### \`03-ticket-capture-endpoint\`` section of [`../09-roadmap.md`](../09-roadmap.md). This file is where the
> DESIGN step's output belongs, and where [`AUDIT.md`](AUDIT.md) results are appended at close.

## Tickets (7)

- `0018` — POST /api/tickets/capture commits a new file to tickets/inbox/
- `0019` — Harden the capture endpoint - owner auth, server-derived path, size and rate limits, idempotency
- `0020` — Android quick-capture - Tasker/MacroDroid HTTP task on a quick-settings tile
- `0021` — Google Assistant routine as a second capture path
- `0022` — Capture-queue semantics for offline - retry lives in the Android task, not the app
- `0023` — /tickets triage handles inbox files end to end
- `0024` — Runbook - rotating and revoking the GitHub PAT

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


## Audit

_Appended by `/tickets audit` at close. See [`AUDIT.md`](AUDIT.md)._

## Reflection

_Filled in at the REFLECT step, after USE._

