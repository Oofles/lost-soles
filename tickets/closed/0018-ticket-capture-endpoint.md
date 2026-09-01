---
id: 18
slug: ticket-capture-endpoint
title: POST /api/tickets/capture commits a new file to tickets/inbox/
type: feature
priority: high
status: closed
size: m
capability: 03-ticket-capture-endpoint
depends_on: [12, 14, 17]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
closed: 2026-09-01T01:46:53Z
---

## Description

The happy path of the capture endpoint: an authenticated POST creates one new markdown file in
`tickets/inbox/` on `main` via the GitHub Contents API, server-side, and returns the committed
path.

**D-092 is not satisfied until this ships** (roadmap §4.1). Until then, post-run ideas go to a
notes app and get hand-carried into the repo. That is the gap this closes; the in-app ticket UI
(capability `17`) is a later convenience, not the fix.

Credential is a **fine-grained PAT** per `07-ticketsmith.md` §6.2: scoped to the single
`lost-soles` repository, permission **Contents: read and write and nothing else**, 90-day
expiry, stored in **SSM Parameter Store as a `SecureString`**, fetched at cold start and held in
memory for the life of the execution environment. Per §6.1 no GitHub credential ever reaches the
browser — there is no client-side GitHub SDK and no token in a client-exposed env var.

Accepted body, verbatim from §6.4:

```json
{ "title": "string, 1..200",
  "body":  "string, 0..8192, optional",
  "type":  "feature|bug|design|chore",
  "priority": "low|med|high",
  "idempotencyKey": "uuid" }
```

The file written is the §3.4 inbox capture format — `status: inbox`, `title`, `type`,
`priority`, `source: ui`, `created`, then a `## Description` holding the body. No `id`, no
`slug`, no `size`, no `capability`, no acceptance criteria: **triage supplies those** (0023).

Frontmatter is emitted with a **real YAML serializer, never string concatenation** (§6.4/6):
a title containing `\n---\n` or a leading `!!python/object` must not be able to forge or break
frontmatter. Control characters are stripped and newlines in the title normalized to spaces
before serializing; null bytes are stripped from the body.

Per D-081 this Lambda is **not** VPC-attached — it only needs outbound HTTPS to
`api.github.com`, so no NAT Gateway is involved.

## Acceptance criteria

- [x] `POST /api/tickets/capture` with a valid body commits exactly one file under
      `tickets/inbox/` on `main` and returns 201 with the committed path and commit sha.
- [x] The committed file parses as valid frontmatter + markdown and matches the §3.4 inbox shape:
      `status: inbox`, `source: ui`, `created` set to the server's UTC now, no `id`/`slug`/`size`.
- [x] Frontmatter is produced by a YAML serializer; a title containing `\n---\nstatus: closed\n---\n`
      round-trips as a single scalar string and does not create a second document.
- [x] The PAT is read from SSM at cold start; `grep -r` over the built client bundle finds no
      `ghp_` or `github_pat_` string, and no GitHub token appears in any client-exposed env var.
- [x] The logger has a redaction rule for `ghp_` / `github_pat_` prefixes; a deliberately logged
      token is masked in CloudWatch.
- [x] The endpoint has **no update path and no delete path** — not disabled, absent. There is no
      handler that passes a `sha` to the Contents API.
- [x] Unit tests cover: valid capture, empty optional body, and a title at exactly 200 chars.

## Notes

Hardening (auth, size caps, rate limits, path derivation, idempotency) is 0019 and is a hard
prerequisite for exposing this to the phone — do not point a Tasker tile at this until 0019 is
closed. This ticket is deliberately the plumbing only.

Note the acknowledged drawback of the PAT (§6.2): it acts **as the user**, so commits are
attributed to the operator. That is why the repo scoping and the Contents-only permission are
load-bearing rather than cosmetic. The GitHub App variant (§6.3, separate `lost-soles-bot`
identity, 1-hour installation tokens) is the v2 fix and is out of scope here.

Path derivation is deliberately in 0019 rather than here, because it is the security-critical
part and deserves its own review and its own test file.

## Operator validation

On the desktop browser at `soles.devaultsecurity.com`, signed in as the owner, POST a capture
from the browser devtools console (or `curl` with the session cookie). Then open
`github.com/<user>/lost-soles/tree/main/tickets/inbox` and confirm a new file appeared with the
title you sent, within a few seconds, and that the commit shows one file changed and nothing else.
Open the file in GitHub's markdown view and confirm the frontmatter renders as a table, not as
stray `---` text — that is the visible symptom of a broken serializer.

## Resolution

**Proven end to end against real GitHub, not only against mocks.** Commit `f80a997` on `main`:

```
capture: 2026-09-01T0144-capture-endpoint-smoke-test-safe-to-discard.md
 1 file changed, 12 insertions(+)
```

One file, in `tickets/inbox/`, written by the real `renderCaptureFile` → `derivePath` →
`createFile` path with the real PAT from SSM. `tickets.mjs`'s own parser then read it back with
`error: null`, keys `status, title, type, priority, source, created`, and no `id`/`slug`/`size`.
That file is left in the inbox on purpose — it says "safe to discard", and it gives 0023 a real
specimen to triage rather than a synthetic one.

**Files added:** `app/api/tickets/capture/route.ts`, `lib/tickets/capture-format.ts`,
`lib/tickets/github.ts`, `lib/log.ts`, `types/tickets-script.d.ts`, and four test files.
**Changed:** `scripts/check-bundle-leak.mjs`, `docs/capabilities/02` and `03`, `package.json`
(`yaml`, `@aws-sdk/client-ssm`).

### The thing the ticket assumed would be simple, and was not

`secret()` resolves **only** into a `defineFunction` Lambda's environment. This endpoint is a Next
route handler on Amplify's **SSR compute**, which is not one — and an Amplify environment variable is
forbidden by 0017's standing rule. So the PAT is read from SSM at runtime, which needs an IAM grant,
which needs a role, and **there was no role**: `computeRoleArn` was `null`, meaning SSR ran under an
AWS-managed role that cannot be given policies.

`LostSolesAmplifyComputeRole` was created and assigned — confirmed with the operator first, because
it changes the live app's configuration rather than editing a policy. One permission:
`ssm:GetParameter` on one parameter ARN.

**Amplify rejects any `Condition` on a compute role's trust policy.** An `aws:SourceArn` lock was
refused; `aws:SourceAccount` alone was refused too. AWS's own `AmplifySSRLoggingRole-*` roles carry
the identical bare principal, which is how the required shape was confirmed rather than guessed. The
confused-deputy guard is simply not available, and the containment is the permission scope. Recorded
in the capability doc rather than quietly dropped.

### The find that justified the whole exercise

**`tickets.mjs`'s frontmatter parser is deliberately NOT a YAML parser** — it is line-based, one flat
`key: value` per line, quotes stripped naively, any other line a hard error. So "valid YAML" was
never the bar: **valid YAML that *that* parser accepts** is. A block scalar or a folded line is
perfectly legal YAML and would produce a captured note the triage tool cannot read — surfacing days
later, on a note dictated once with no second copy.

`blockQuote: false` and `lineWidth: 0` carry that guarantee. Quoting is left to the serializer, and
that was decided by measurement: forcing `QUOTE_DOUBLE` made a title containing a double quote come
back through the naive quote-strip as literal backslashes, where the default round-trips clean.
`capture-triage-contract.test.ts` imports the **real** parser — a reimplementation would drift — and
runs twelve hostile titles through it.

### What went wrong

1. **I raised a false alarm about the PAT's scope.** `/user/repos` enumerated 15 repositories and I
   read that as "All repositories" selected. The operator pushed back, and they were right: that
   endpoint lists public repos regardless of fine-grained scoping. The discriminating test is
   `collaborators`, which needs push access — `lost-soles` 200, every other repo 403. **The token was
   correctly scoped all along.** I should have found a control before reporting.
2. **Literal control characters in source, three times.** Written into regexes and fixtures where
   escapes belonged. The third instance mattered: 10,000 literal NUL bytes in a test fixture made
   that file read as **binary**, which meant the pre-commit hook's literal-pattern scan was silently
   skipping it. Once the NULs became escapes, the same scan immediately caught token-shaped fixtures
   inside that file which **gitleaks had passed**. Two layers, two sensitivities, and the dumber one
   was right.
3. **A double `res.json()`** — a `Response` body is single-use, so a test I had just written failed
   on its second read rather than on its assertion.

### Decisions

- **`capture-format.ts` is pure and takes the clock as an argument**, so every test is deterministic
  and the route is the only thing that knows the time.
- **The token cache holds a promise, not a string** — two concurrent cold requests would otherwise
  each fire their own SSM call — and **a rejection is never cached**, since a transient SSM error
  would otherwise disable capture for the whole life of a warm environment.
- **`GITHUB_TICKETS_PAT` added to the bundle-leak scanner's registry.** A new secret that is not
  scanned for is a silent loss of coverage. Proved by planting the real PAT in a client component:
  the check goes red naming the file and the key.
- **Length is checked before sanitising.** A 10,000-character title of control characters collapses
  to nothing; sanitising first would let it past the 200-char limit. Tested.

## Operator validation

**Done by the agent, against production infrastructure:**

- The full chain works: real token from SSM → real Contents API → real commit on `main` → read back
  by the real triage parser. Commit `f80a997`, one file changed.
- The PAT's scope was verified rather than assumed: push access on `lost-soles` only, every other
  repo 403, `actions/secrets` 403 even on `lost-soles`.
- No GitHub token in `.next/static`, by the leak scanner's literal scan and by hand; no
  `NEXT_PUBLIC_` variable mentions a token.
- 140 tests pass, plus every check script and its self-test.

**★ STILL REQUIRES THE OPERATOR ★**

On the **desktop browser at `soles.devaultsecurity.com`**, signed in as the owner, POST a capture
from devtools:

```js
await fetch("/api/tickets/capture", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ title: "Testing capture from the browser", body: "hello",
                         type: "chore", priority: "low",
                         idempotencyKey: crypto.randomUUID() }),
}).then(r => r.json())
```

Expect `{ path, commitSha }`. Then open
`github.com/Oofles/lost-soles/tree/main/tickets/inbox` and confirm the new file appeared within a few
seconds and the commit shows **one file changed and nothing else**. Open it in GitHub's markdown view
and confirm the frontmatter renders as a **table**, not as stray `---` text — that is the visible
symptom of a broken serializer.

**This is the one step the agent genuinely cannot do**, and it is not ceremony: it is the only path
that exercises Cognito auth and the deployed compute role together. Everything above proves the
GitHub half and the format half; only this proves the *deployed handler* can read SSM through the new
role. If it returns 502, the compute role did not take effect and the build log will say so.

## Operator validation performed — 2026-09-01

**The browser POST worked.** The operator ran it from devtools at
`soles.devaultsecurity.com`, signed in as the owner, and it returned `{ path, commitSha }`.

Verified independently against the repository afterwards:

```
4670092 capture: 2026-09-01T0316-testing-capture-from-the-browser.md
 1 file changed
```

and `tickets.mjs`'s own parser reads it with `error: null`:

```json
{"status":"inbox","title":"Testing capture from the browser","type":"chore",
 "priority":"low","source":"ui","created":"2026-09-01T03:16:19.053Z"}
```

**This is the criterion the agent could not check, and it is the one that mattered.** Everything
proven before it exercised the GitHub half and the format half from a laptop. Only this path runs
Cognito auth and the **deployed SSR compute role** together — so it is the sole evidence that
`LostSolesAmplifyComputeRole` actually took effect and that the handler can read SSM in production.
A 502 here would have meant the IAM change did not apply, and 0019 would have been building on
sand.

Two real captures now sit in `tickets/inbox/`: the agent's smoke test and the operator's browser
test. Both are genuine inbox items and both are for **0023** to triage — deliberately left rather
than cleaned up, so triage is developed against real specimens instead of synthetic ones.
