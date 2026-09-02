---
id: 19
slug: capture-endpoint-hardening
title: Harden the capture endpoint - owner auth, server-derived path, size and rate limits, idempotency
type: feature
priority: high
status: closed
size: m
capability: 03-ticket-capture-endpoint
depends_on: [18]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
started: 2026-09-02T03:50:40Z
closed: 2026-09-02T13:56:13Z
---

## Description

The capture endpoint is a **write primitive pointed at the source repository**. This ticket
applies `07-ticketsmith.md` §6.4 and §6.5 in full. Nothing on the phone may point at the
endpoint until this closes.

**The client never supplies the file path.** The server derives it:

```
path = "tickets/inbox/" + utcNow("YYYY-MM-DDTHHmm") + "-" + slugify(title).slice(0, 60) + ".md"
```

`slugify` lowercases, replaces every non-`[a-z0-9]` run with `-`, and trims leading and trailing
`-`. The result is then **re-validated** against
`^tickets/inbox/\d{4}-\d{2}-\d{2}T\d{4}-[a-z0-9-]+\.md$`, and anything failing that regex is a
**500, not a fallback**. A client-supplied path is a path-traversal bug that writes arbitrary
files into the repository — including `.github/workflows/` and `.claude/`, either of which is
remote code execution against the operator's machine or CI.

A second, independent prefix check runs immediately before the API call (§6.4/3): reject any
computed path not beginning `tickets/inbox/`, and reject any path containing `..`, a leading `.`,
a backslash, a null byte, or a `/` beyond the two in the prefix. Belt and braces — check 2 makes
traversal impossible, check 3 makes a future refactor of check 2 fail closed.

Also in scope:

- **Owner-only auth.** A valid Lost Soles session **and** the user id against a hard-coded
  allowlist. Not "is logged in" — "is the owner." The route returns **404, not 403**, to a
  non-owner (§6.5) so it does not confirm it exists. This stays owner-only even after D-014 adds
  friends.
- **Reject-unknown-keys**, not strip-unknown-keys, so a future client bug surfaces as a 400
  instead of silently dropping data.
- **Create-only.** Contents API called **without a `sha`**, so an existing path returns 422
  rather than overwriting. On a 422 from a same-minute collision, retry once with a `-2` suffix,
  then fail.
- **Size and rate limits.** Title 200 chars, body 8 KB, total request 16 KB. 30 creates/hour and
  200/day per user, enforced server-side with a DynamoDB counter carrying a TTL.
- **Idempotency.** Store `idempotencyKey` with a 24-hour TTL; a repeat key returns the original
  result without a second commit. This is what makes the 0022 retry queue safe.
- **CORS locked** to the app's own origin.

## Acceptance criteria

- [x] A request body containing a `path` key is rejected **400 unknown key**; the path is never
      read from input under any key name.
- [x] A title of `../../.github/workflows/pwn.yml` produces a path of the form
      `tickets/inbox/<ts>-github-workflows-pwn-yml.md` and nothing outside `tickets/inbox/`.
- [x] A unit test calls the prefix guard directly with `tickets/open/x.md`, `../x.md`,
      `tickets/inbox/../../x.md`, `tickets/inbox/a/b.md`, a leading-dot name, a backslash and an
      embedded null byte — every one is rejected.
- [x] A title that slugifies to the empty string (e.g. all emoji) fails the regex and returns
      500, not a file at a fallback path.
- [x] A signed-in **non-owner** receives **404**, not 403, and no commit is made.
- [x] An unauthenticated request receives 404 and no commit is made.
- [x] A 201-byte title, an 8.1 KB body, and a 17 KB request each return 400 and make no commit.
- [x] The 31st create within one hour returns 429; the counter row carries a TTL.
- [x] Replaying an identical request with the same `idempotencyKey` returns the **original**
      path and commit sha and creates **no second commit**.
- [x] Two captures with the same title in the same minute produce two files, the second with a
      `-2` suffix; a third in the same minute fails cleanly rather than overwriting.
- [x] The `Access-Control-Allow-Origin` header names the app origin only.
- [x] **Added by 0019.** The endpoint scans `title` and `body` for the five `08-security-privacy.md`
      §7.3 patterns and rejects with a clear message naming the SHAPE, never the value — the
      requirement this ticket's own Notes carry from `0004`, which had no criterion.
- [x] **AMENDED 2026-09-02, from two `(operator)` criteria** (D-181). The operator directed that
      backend behaviour the agent can smoke test must not be routed to a human. Both are now
      agent-verified against live infrastructure; what each originally asked for, and what was
      actually run instead, is recorded in the operator-validation section below.
      - Signed out, `POST /api/tickets/capture` on the deployed app returns **404** with no
        `location` header — run against `soles.devaultsecurity.com` on 2026-09-02.
      - The guard store works against the **real** `LostSolesCaptureGuard`: claim, in-flight
        refusal, replay, stale-claim takeover, and a conditional counter that reaches exactly 30
        and then refuses, with a TTL stamped two hours out.
      - GitHub answers a `sha`-less PUT to an existing path with **422** rather than overwriting —
        the assumption the whole `-2` retry rests on.

## Notes

### Added by 0004 (2026-08-30): this endpoint must scan its own payload

**GitHub push protection is unavailable on this repo** — it needs Advanced Security, which a
private personal repo does not have. That matters *here specifically* rather than generally:

This endpoint commits dictated prose from a phone straight into `tickets/inbox/` **through the
GitHub API**, so it bypasses the `.githooks/pre-commit` scanner completely — that hook only runs
on `git commit` from the laptop. Push protection was the layer that would have caught a secret
arriving this way. It does not exist.

**Requirement:** before committing a capture, the endpoint scans `title` and `body` for the same
five patterns the pre-commit hook uses (`08-security-privacy.md` §7.3) and **rejects with a clear
message** rather than committing and cleaning up afterwards — a secret committed and later removed
is still in history, and history is what an attacker clones.

Realistic threat, not a theoretical one: voice dictation of something read off a screen, or a
pasted error message containing a token. The operator will not re-read what they dictated at mile
six.


The §6.5 abuse table is the test plan; each row above maps to one row of it. The one abuse case
**not** covered here is the forged webhook against the browse cache (§6.4/7, HMAC over the raw
body with constant-time comparison) — that belongs with the cache in capability `17`, because
the cache does not exist yet. Do not build a webhook route here that nothing reads.

§6.6 offers a more paranoid variant — commit to a `tickets-inbox` branch rather than `main` and
let `/tickets sync` merge it. Deliberately **not** taken: checks 2-4 already confine writes to
`tickets/inbox/` and make them create-only, which makes direct-to-`main` defensible for a
single-operator project. Revisit if the credential ever broadens or if branch protection lands
on `main` for another reason.

## Resolution

**Status: the code is complete, deployed and partly verified against live AWS; the ticket stays
OPEN** on two `(operator)` criteria that need a real browser session. The blocker this Resolution
originally described — an empty owner allowlist — is resolved; see *The blocker, and the trap in it*.

**Added:** `lib/tickets/capture-guard.ts` (the pure guards), `lib/tickets/capture-store.ts` (the
DynamoDB rate-limit and idempotency store), `lib/auth/owner.ts`, `lib/amplify-server.ts`, and four
test files including `middleware.test.ts`.
**Changed:** `app/api/tickets/capture/route.ts` (rewritten around the check order),
`middleware.ts`, `lib/tickets/github.ts` (a typed `GithubApiError`), `lib/tickets/capture-format.ts`
(the fallback removed — see below), `amplify/backend.ts` (the table and its grant),
`package.json` (`@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb`), `docs/01-architecture.md`
(resource row 21), `docs/decisions/DECISIONS.md` (D-179, D-180), the capability doc, `docs/INDEX.md`.

243 tests pass (up from 176), typecheck and lint clean, `npm run build` succeeds, and
`check-boundaries`, `check-design-tokens` and `check-bundle-leak --self-test` are green.

### The defect criterion 4 found in already-closed work

`derivePath` shipped in `0018` as `${slug || "untitled"}`. It reads as a sensible guard and is the
precise failure §6.4/2 forbids: **"untitled" is a legal slug**, so the re-validation regex this
ticket adds would have *passed* it and a file would have landed at a name derived from nothing. The
triggering input is not adversarial — an all-emoji title is one tap on a phone keyboard.

The fallback is gone; an empty slug now yields `tickets/inbox/<stamp>-.md`, which fails the regex,
and the route answers 500. This meant amending a passing `0018` test that asserted every hostile
title produced a regex-valid path — it passed *because* of the fallback. It is now two tests, one
per outcome, with the amendment explained in place rather than quietly rewritten.

Worth naming the pattern: 0018 could not have caught this, because the guard that makes the
fallback wrong did not exist yet. Splitting plumbing from hardening has this cost, and the
hardening ticket re-reading the plumbing is what pays it.

### What went wrong while building it

1. **I wrote literal NUL bytes into source three times** — `capture-guard.ts`, its test, and
   `route.test.ts` — which is the exact mistake `0018`'s Resolution records, repeated in the very
   session that cites it. The first announced itself: `grep 'null byte' capture-guard.ts` returned
   nothing, because a single NUL makes GNU grep treat the whole file as binary. That is the same
   mechanism that silently disabled the pre-commit scanner in 0018. The third survived until the
   commit itself, and was only found by explicitly counting NULs across every staged file rather
   than by anything automatic.
   **All three are now `\u0000` escapes**, but the honest conclusion is that writing a comment
   saying "use an escape" does not prevent this — the byte is invisible at the point of writing.
   Detecting it does: `git show ":$f" | tr -dc '\000' | wc -c` over the staged set is two seconds
   and would have caught all three. Not built here, because it belongs in `.githooks/pre-commit`
   next to the layer whose sensitivity it protects, not in this ticket.
2. **The pre-commit hook blocked the commit** on a PEM private-key header sitting as a literal in
   a test fixture. It was right to. Resolved by assembling that string at runtime like
   the other fixtures rather than by adding a `gitleaks:allow` marker: a value the file only needs
   at runtime has no business existing in source, and a suppression would have been the weaker of
   the two answers.
3. **`check-design-tokens.mjs` failed the build on a DynamoDB key.** `RATE#<uid>#H#2026-09-02T14`
   contains `#2026`, which its `/#[0-9a-f]{3,8}\b/i` reads as a hex colour — correctly, by its own
   rule. I moved this ticket's separator to `#hour:` rather than edit a control mid-ticket, and
   filed **`0146`**, because the clash is structural rather than incidental: `01-architecture.md`
   §2 specifies `PK = U#<uid>#C#<res6parent>` and **an H3 cell id is a hex string**, so every
   realistic cell-key fixture in capability `07` will trip it. A guard that fires on ordinary
   correct code is a guard someone eventually deletes.
4. **The `no-explicit-any` rule caught a lazy test stub**, and the fix was an improvement rather
   than a concession: the stub now declares the command fields it asserts on, so a rename in
   `capture-store.ts` fails the typecheck instead of asserting `undefined` against `undefined`.

### Decisions, both recorded as `D-xxx`

- **D-179 — the guards fail closed.** DynamoDB unreachable means neither the rate limiter nor the
  idempotency check can report a verdict, so the endpoint answers **503, no commit**, rather than
  committing with the limits switched off. This was put to the operator with its cost stated — a
  capture is a note dictated once with no second copy, and this bounces it during an outage — and
  chosen deliberately. 503 is retryable; `0022`'s queue is what retries it. `releaseIdempotencyKey`
  is the one deliberate exception: it swallows its own errors, because it runs on a path already
  returning a failure and turning a useful 429 into an opaque 500 would be strictly worse.
- **D-180 — the guard table is named by a literal on both sides, asserted equal by a test.** The
  SSR compute is not a `defineFunction` Lambda, so it has no CloudFormation output, no `secret()`
  and no permitted env var (0017's standing rule) — the same structural gap that sent 0018's PAT to
  SSM. The cost is stated rather than hidden: an explicit table name is account-and-region unique,
  so **`ampx sandbox` cannot coexist with `main`'s stack**.

### Two criteria added, and why that is not scope creep

- The **secret-scan criterion** implements a requirement this ticket's own Notes carry from `0004`
  and that the criteria list simply never encoded. Without it the endpoint has **no** secret
  scanner: it commits through the GitHub API, so `.githooks/pre-commit` never runs, and push
  protection needs Advanced Security a private repo does not have.
- The two **`(operator)` criteria** formalise the `## Operator validation` prose this ticket
  already carried, so the close gate enforces it (`0124`).

### The blocker, and the trap in it

The first pass shipped `OWNER_USER_IDS` **empty**, because this session had no AWS credentials and
the Cognito `sub` is hard-coded per §6.4/1. The operator supplied them (`--profile devault`, now
recorded in `CLAUDE.md`), and the allowlist is filled.

**The lookup had a trap in it, and it is the interesting part of this ticket.** The obvious move is
to read the pool id out of `amplify_outputs.json` and list its users. Doing exactly that returned
**one** user — `agent@lost-soles.invalid`, the throwaway from `0130` whose password lives in SSM.
Allowlisting it would have handed a write primitive aimed at the repository to a disposable account.

`amplify_outputs.json` is generated per-environment and is rewritten by `ampx sandbox`, so on this
laptop it names the **sandbox** pool. The pools are only distinguishable by their tags:

| pool | `amplify:deployment-type` | sole user |
|---|---|---|
| `us-east-1_3lreDA1d1` | `branch` (branch-name `main`) | `amazingbrandon@gmail.com` ← the owner |
| `us-east-1_RV7QIiViX` | `sandbox` | `agent@lost-soles.invalid` ← never |

`0130`'s Resolution is correct that the agent account is in the sandbox — the confusion is entirely
that the local outputs file points there too. The reasoning is now in a comment on
`OWNER_USER_IDS` itself, including the consequence nobody would guess from a 404: **a sub is
pool-scoped, so recreating the production pool silently 404s the owner** with no error mentioning
auth. `0131` recreated the sandbox pool once already, so that is a real sequence.

### Verified against live AWS, not only against mocks

Amplify build **49** (commit `90714af`) **SUCCEEDED**, so the CDK stack deployed. The step flagged
as most likely to fail was the IAM grant, because CDK attaches a policy to a role CloudFormation
does not own. It worked:

```
LostSolesCaptureGuard   TableStatus ACTIVE   PK pk (HASH)   PAY_PER_REQUEST
TimeToLive              ENABLED    AttributeName: ttl
LostSolesAmplifyComputeRole  inline policies:
  AmplifyComputeRolePolicy4423B23B   ← CDK, this ticket
  ReadTicketsCapturePat              ← 0018
```

The policy resolves to **one table ARN, no wildcard**, which is the containment D-180 claims:
`arn:aws:dynamodb:us-east-1:286588821906:table/LostSolesCaptureGuard`. The role's total reach is now
one SSM parameter and one DynamoDB table.

**The allowlist change is NOT in build 49** — it needs the next deploy. Until that build goes green
the deployed endpoint still 404s everyone, which is the fail-closed default doing its job.

### Verified against the DEPLOYED endpoint (build 50, `4cc01cb`)

Two things that were previously only unit-tested are now observed in production:

```
POST /api/tickets/capture  (no session)  ->  404  {"error":"not found"}   no `location` header
OPTIONS /api/tickets/capture             ->  404  {"error":"not found"}
```

The first is **criterion 6 proven on the deployed app**, and the absent `location` header is the
part that matters: the old 307 would have been followed by a client into a 200 and the HTML of `/`.

The second is a finding rather than a pass. **`middleware.ts` 404s every CORS preflight before the
route's `OPTIONS` handler runs**, because a preflight never carries credentials — that is the CORS
spec, not a quirk — so the gate always sees it signed out. Consequences, stated plainly:

- **Nothing legitimate breaks.** The app's own POST is same-origin and so is never preflighted, and
  the Android capture task (`0020`) is not a browser and does not implement CORS.
- The behaviour is **stricter** than the policy it implements: a cross-origin caller is refused at
  the gate rather than by a header.
- It is **left alone deliberately.** Excluding `OPTIONS` from the middleware matcher would make the
  preflight "work" at the cost of a new unauthenticated path through the gate — a real widening
  bought for no functional gain.
- The `OPTIONS` handler is kept, and both it and its test now say in place that they assert
  correctness for a future gate change and are **not** evidence of production behaviour. A test
  asserting something that cannot occur is worse than no test, and this one would have read as
  proof of criterion 11 to anyone who did not check.

Criterion 11 itself stands: `Access-Control-Allow-Origin` names the app origin on every response
the route itself produces, and no wildcard is emitted anywhere.

### What the agent still cannot do

The three remaining operator steps need a signed-in browser session against the **production** pool.
The agent account is sandbox-only and deliberately stays that way: a second production account fires
`08-security-privacy.md` §2.4 Trigger A, a seven-item gate of which four are build items, and `0130`
exists precisely so troubleshooting does not require it. So this is not a gap to be engineered
around — it is the design working.


## Operator validation

**None required. Rewritten at close on 2026-09-02, on the operator's explicit direction**, which is
worth recording because it changes how every later ticket is validated: *"If you can do a smoke
test, I'm willing to accept the risk that the production system will work. Operator validation
should encompass design functions and things that you legitimately need my manual effort on."*
Recorded as **D-181**; the methodology change is ticket `0147`.

The four manual steps this ticket previously demanded were not a considered judgement about risk —
they were a workaround for the agent having no AWS credentials. Once the operator supplied them
(`--profile devault`), every one became something the agent could run directly.

### What the agent actually ran, and what it proves

**1. Against the deployed app** (`soles.devaultsecurity.com`, build 50 / `4cc01cb`):

```
POST /api/tickets/capture  (no session)  ->  404 {"error":"not found"}   no `location` header
```

The absent `location` is the point. The pre-0019 middleware answered 307, which a client follows
into a 200 and the HTML of `/` — `0022`'s retry queue would have read that as success and dropped
the note it was holding.

**2. Against the real `LostSolesCaptureGuard` table** — the part unit tests genuinely cannot reach,
because a stubbed client asserts that the right `ConditionExpression` *string* was sent, not that
DynamoDB accepts it. A reserved word without an `ExpressionAttributeName`, or an `ADD` on a
non-numeric attribute, passes a stub and fails in production on a note dictated once.

```
claim on an unseen key        -> claimed
second claim while fresh      -> in-flight        (not silently allowed)
after recordIdempotentResult  -> replay, original path and sha
claim 10 minutes stale        -> claimed          (takeover works)
30 consecutive consumeRate    -> ok:true x30
the 31st                      -> ok:false, window: hour
row: {"count":30,"pk":"RATE#...#hour:2026-09-02T13","ttl":1788364319}
```

The counter reached **exactly** the cap and then refused — it did not climb past and get compared
afterwards — and the TTL is two hours in the future. That is criterion 8 proven rather than
asserted.

**3. Against the real GitHub Contents API** — the assumption the entire `-2` collision retry rests
on, and one no unit test can reach, since the unit test asserts our handling of a 422 we invented
ourselves:

```
first  create -> 201, commit 6584278
second create -> 422, GitHub's own message: "sha" wasn't supplied.
```

Create-only holds: the overwrite was refused by GitHub, not by us. The probe file was removed in
commit `1153a92`.

**4. Infrastructure**, after build 49: table `ACTIVE`, `PK = pk`, on-demand, TTL enabled on `ttl`;
CDK attached `AmplifyComputeRolePolicy4423B23B` to the hand-made compute role, resolving to **one
table ARN with no wildcard**.

### The one residual risk, stated rather than hidden

**Nothing here proves the owner allowlist holds the right `sub`.** It was taken from the pool tagged
`amplify:deployment-type = branch` / `branch-name = main`, which is the correct source, but no
signed-in request has been made. If it were wrong the symptom is a **404 for the owner** — an
endpoint that looks dead, with nothing anywhere mentioning auth.

Accepted knowingly, not overlooked. It is also cheap to disprove whenever the operator next opens
the app, with no ceremony: send one capture; a `{ path, commitSha }` back means the allowlist is
right. **This does not block the close.** If it turns out wrong it is a one-line fix and a new
ticket, not a reason to hold a finished ticket open.
