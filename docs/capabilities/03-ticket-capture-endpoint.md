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

### What is deliberately NOT here

Owner-only auth, server-side rate limits, idempotency, reject-unknown-keys, CORS, and the second and
third path-validation layers are all **ticket 0019**, which is a hard prerequisite before anything on
the phone points at this URL. What exists today: `middleware.ts` gates every non-static route so the
handler is unreachable signed-out, and the path is derived entirely server-side so no key of the
request body can influence where the write lands.

The PAT expires in 90 days (~2026-11-29). **Ticket 0024** owns the rotation runbook; nothing new was
filed for it.


## Audit

_Appended by `/tickets audit` at close. See [`AUDIT.md`](AUDIT.md)._

## Reflection

_Filled in at the REFLECT step, after USE._

