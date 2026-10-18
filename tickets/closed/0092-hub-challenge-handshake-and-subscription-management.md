---
id: 92
slug: hub-challenge-handshake-and-subscription-management
title: The hub.challenge handshake (the key has a dot) and subscription lifecycle management
type: feature
priority: high
status: closed
size: m
capability: 14-webhook-and-automatic-sync
depends_on: [91]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
started: 2026-10-18T01:23:55Z
closed: 2026-10-18T02:51:03Z
---

## Description

Creating the subscription is a synchronous three-way handshake, and there is **exactly one
subscription per application, ever**.

Creation (`03-integrations.md` §2.3):

```
POST https://www.strava.com/api/v3/push_subscriptions
  client_id, client_secret,
  callback_url=https://soles.devaultsecurity.com/api/webhooks/strava,
  verify_token=<long random string we generate and store>
```

**Before that POST returns**, Strava synchronously issues a GET to `callback_url`:

```
GET ?hub.mode=subscribe&hub.challenge=X&hub.verify_token=T
  → constant-time compare T against secret("STRAVA_WEBHOOK_VERIFY_TOKEN")
  → mismatch: 400, no body detail, no log of T
  → match:    200, Content-Type: application/json, body exactly {"hub.challenge": X}
```

> **TRAP — the JSON key is literally `hub.challenge`, with a dot.** Not `hub_challenge`, not
> `hubChallenge`. **Every serialization framework that maps struct fields to camelCase will get this
> wrong**, and it fails *silently*: the handshake just does not complete and the POST never returns a
> subscription id. `08-security-privacy.md` §4.2 calls it the one that costs an hour. **Emit the
> string by hand** rather than trusting a serializer, and pin it with a test that asserts the exact
> bytes.

Three more rules from §4.2:

- **Constant-time comparison**, not `===`. Cheap, and the alternative is a timing oracle on a public
  endpoint.
- **`hub.challenge` is echoed, never interpreted.** Cap it at 256 bytes, reject anything non
  `[A-Za-z0-9]`, and emit it as a JSON string value. It is attacker-controlled input being reflected,
  which is the classic shape of an injection bug even when the sink looks inert.
- This route is live only during subscription creation. It stays deployed because Strava may
  re-validate, but a GET at any other time is a scanner.

**Subscription management**, as an operator script, not a UI: `GET /push_subscriptions` to inspect,
`DELETE /push_subscriptions/{id}` to remove, and create as above. Store the returned `{"id": 120475}`
so the webhook can filter on `subscription_id` (0093). Because the callback URL is fixed at creation,
**it is permanent infrastructure** — changing it means delete + recreate, and during that window
reconciliation (0095) is the only ingestion path. Note that in the script's output so the operator
knows what they are accepting before they press the key.

## Acceptance criteria

- [x] A GET with `hub.mode=subscribe` and the correct `hub.verify_token` returns 200,
      `Content-Type: application/json`, and a body whose **exact bytes** are
      `{"hub.challenge":"<X>"}` — asserted on the raw response string, not on a parsed object.
- [x] A test asserts the response body contains the substring `"hub.challenge"` and does **not**
      contain `hub_challenge` or `hubChallenge`.
- [x] A wrong `hub.verify_token` returns 400 with no body detail, and the supplied token appears
      nowhere in the logs at any level.
- [x] The token comparison is constant-time; a test asserts the comparison function is the
      constant-time one and not `===`.
- [x] A `hub.challenge` longer than 256 bytes or containing any character outside `[A-Za-z0-9]` is
      rejected; a challenge of `"><script>` never reaches the response body.
- [x] The subscription script can create, inspect and delete the subscription, and stores the
      returned subscription id where the webhook handler reads it.
      *Amended (operator, wave 1):* the id lives in a committed constant,
      `STRAVA_SUBSCRIPTION_ID` in `src/adapters/strava/subscription.ts` (created by 0093). The
      script does not edit source: `create` prints the id and the exact line to set and commit.
- [x] The script prints the permanence warning about `callback_url` before performing a create or
      delete, and requires an explicit confirmation.
- [x] After a real create against Strava, `GET /push_subscriptions` shows exactly one subscription
      pointing at the production callback URL.
      *Not yet:* the real create is the orchestrator's, after deploy, with the operator's
      agreement. The agent was forbidden to call `push_subscriptions` at all. *Done 2026-10-18:*
      `inspect` shows exactly one, id `377486`, marked "← the production callback".
- [x] `STRAVA_WEBHOOK_VERIFY_TOKEN` is generated with a CSPRNG, stored as an SSM `SecureString`, and
      appears in no repository file — asserted by the secret scan (0002's `.gitignore` and the §7.3
      scanning setup).
      *Partly:* the SSM `SecureString` exists (`/amplify/shared/d14fhvl4rp79nn/…`, set in 0017) and
      is in no file (965 worktree files scanned for the value: 0 hits; `check-bundle-leak
      --require-literals` green). Whether that value came from a CSPRNG is not recorded. The
      script's `rotate-token` generates `randomBytes(32)` hex straight into the SecureString,
      without printing it. Running it before `create` closes this criterion. AWS was read-only
      here, so that run is the orchestrator's.

## Notes

Depends on 0091 (the function that serves the GET).

Do the handshake against Strava **once, deliberately, from a machine you are watching**, because a
failed create leaves no subscription and a successful one cannot be re-pointed. Test the exact
response bytes locally first; the handshake is not the place to discover a serializer's opinion about
dots in key names.

The GET route being public and unauthenticated is unavoidable: Strava sends no credentials. That is
why `verify_token` plus payload shape is the entire authentication story for this route, and why the
echo is treated as untrusted reflection.

## Operator validation

> **D-181 — most of what follows is the AGENT's to run, not the operator's.**
> Swept 2026-09-02 (ticket `0147`). This ticket's capability has no screen of its own. Before asking
> the operator for any step below, check whether AWS credentials (`AWS_PROFILE=devault`), `curl`, or
> a script can answer it — if so it is a **smoke test**, and what it proved is recorded here at
> close *instead of* the instruction. Keep only what genuinely needs a human eye, a phone, or a real
> run. The text below is the original author's intent, kept as context for **what** to verify — not
> as a list of chores for the operator.

From the desktop, run the subscription script's **inspect** command first and read the output — it
should show either nothing (before creation) or exactly one subscription. Then run create, and watch
the CloudWatch log stream for the incoming GET in real time: you should see the handshake arrive and
be answered within milliseconds, and the POST should return a subscription id.

Before that, prove the trap is closed by hand: `curl -s '<function-url>?hub.mode=subscribe&hub.
challenge=abc123&hub.verify_token=<token>'` and look at the **raw** output with your own eyes. If you
see `hubChallenge` or `hub_challenge` anywhere, stop — that is the hour this note exists to save.

Finally, `curl` the same URL with a deliberately wrong token and confirm you get a bare 400, then
check the logs and confirm the token you sent is not in them.

**Result, 2026-10-18 (orchestrator, deployed stack, Amplify jobs 410 and 411; smoke tests, no operator step).**
- **Token rotated first.** `rotate-token` wrote a fresh `randomBytes(32)` hex token (length 64) to
  the shared SecureString. The value was never printed. A forced cold start then picked it up.
- **Raw bytes, live.** A correct token returned `HTTP/1.1 200`, `Content-Type: application/json`,
  and the body exactly `{"hub.challenge":"abc123"}`. No `hub_challenge` and no `hubChallenge`.
- **Refusals.** A wrong token, a hostile challenge (`">`+`<script>`) and a bare GET each got a bare
  400 with an empty body. PUT, DELETE, PATCH and OPTIONS got 405.
- **Logs.** Over the 5-minute window, a filter search for the wrong token and for the real token
  found 0 events each. Only the decision words `handshake-ok`, `-bad-token`, `-bad-challenge` and
  `-not-subscribe` appear.
- **Real create.**
  - `inspect` → 0 subscriptions.
  - `create` passed its own handshake self-check against the deployed URL, printed the permanence
    warning, and on the typed confirmation printed `Created. Subscription id: 377486`.
  - `inspect` → exactly 1, created 2026-10-18T02:34:22Z, pointing at the production callback.
  - The id was committed in `59d196e`, `subscription.ts` (Amplify job 411).
- **Cold path (D-347's open cost, measured).** Init rose from about 300 ms to 673–683 ms. That is
  `secret()`'s SSM fetch on every cold start.
  - A cold handshake measured 1.09 s client-side.
  - A cold known-owner POST (receipt duplicate) measured 1.27 s client-side, against 0091's
    0.71–0.90 s.
  - A cold `create` also pays the first SQS send. It is not measured, but it is the tightest
    against Strava's 2 s. Filed as `0286`, not fixed here.
- **Perceptual:** none. The bytes have one right answer.

## Resolution

**What shipped.** The handshake lives in the Strava adapter, inside 0091's design (D-345). The
`ingest-webhook` handler's code is unchanged. It already passed `method` and `query` to
`accept()` and emitted a string body verbatim with `content-type: application/json`.
`acceptStravaEvent` now hands any `GET` to `acceptHandshake`, which is one added line. Other
non-POST methods still get a 405. Alongside it is an operator script that inspects, creates and
deletes the one subscription and rotates the verify token.

**Files touched**
- `src/adapters/strava/handshake.ts`: new. `acceptHandshake(req, expected = env)`. The checks run in this order:
  - `hub.mode` must be `subscribe`.
  - The secret must be present. If it is not, the handshake fails closed.
  - The token is compared in constant time (`tokensMatch`: sha256 both sides, then `timingSafeEqual`, so lengths always match and nothing throws).
  - The challenge must match `^[A-Za-z0-9]{1,256}$`.
  - Every failure is a bare `{status: 400}` with no body.
  - On success the body is `'{"hub.challenge":"' + X + '"}'`, built by concatenation and never by a serializer.
  - Logging is one `webhook-handshake` line holding a fixed decision word. It never contains T or X.
- `src/adapters/strava/handshake.test.ts`: new, 25 tests. Covers:
  - the exact bytes;
  - the dotted key, and that neither `hub_challenge` nor `hubChallenge` appears;
  - wrong, prefix, extended, empty and missing tokens;
  - no T, X or the real token at any console level;
  - fail-closed when the secret is unset;
  - criterion 4: `timingSafeEqual` is spied through a wrapped `node:crypto` mock and must be called on both a match and a mismatch, and a source check finds no `===` against the token;
  - hostile challenges: `"><script>`, a quote, a backslash, a space, a dash, non-ASCII, empty and 257 chars, with 256 accepted;
  - the registered adapter's `accept()`.
- `src/adapters/strava/accept.ts`: GET goes to `acceptHandshake`; the header comment is updated. POST path untouched (0093).
- `amplify/functions/ingest-webhook/handshake.test.ts`: new. The GET through the real handler and adapter, asserted on `res.body` as a raw string, with `content-type` checked. Both AWS deps throw if touched, which proves a GET makes no DynamoDB or SQS call. A separate file keeps `handler.test.ts` clear for 0093.
- `amplify/functions/ingest-webhook/handler.test.ts`: the "GET → 405 until 0092" test is now "PUT → 405". One test changed.
- `amplify/functions/ingest-webhook/resource.ts`: `environment: { STRAVA_WEBHOOK_VERIFY_TOKEN: secret(...) }`, with the comment updated. This is an SSM parameter name, which D-166's SCREAMING_SNAKE redaction allows in `amplify/`.
- `amplify/ingest-webhook-stack.test.ts`:
  - The grant set is now exactly `PutItem` + `SendMessage` + `ssm:GetParameters`.
  - The SSM statement must reach exactly two paths (branch and shared), both ending in `/STRAVA_WEBHOOK_VERIFY_TOKEN`, so it cannot reach the client secret.
  - The environment must hold exactly one SSM-resolved key, as Amplify's placeholder.
  - The old "no `AMPLIFY_SSM_ENV_CONFIG`" clause is replaced by that positive assertion.
- `scripts/strava-subscription.mjs`: new. Plain node, like the check scripts. Commands:
  - `inspect` (read-only).
  - `create` (refuses if one already exists, then self-checks, prints the permanence warning, waits for the typed confirmation, POSTs, and prints the id plus the line to set in `subscription.ts`).
  - `delete <id>` (the id must be one of ours; warning, then the id typed back, then DELETE).
  - `rotate-token` (CSPRNG `randomBytes(32)` hex into a `SecureString`; prints only length and a sha256 prefix).

  Credentials come from the shared SSM path `lib/sources/oauth-credentials.ts` reads. The callback is the `main` stack's `IngestWebhookUrl` output plus `api/webhooks/strava`, verified read-only: `https://2fnck3lexwj2c4yu2ba3rtybum0bspla.lambda-url.us-east-1.on.aws/api/webhooks/strava`. No secret is printed, and a URL that carries one in its query is never echoed.
- `scripts/strava-subscription.test.mjs`: new, 12 tests, all I/O faked. Covers:
  - order: self-check, then warning, then prompt, then POST;
  - no mutating call without the exact word (`""`, `y`, `yes`, `CREATE` all refused);
  - refusal when a subscription already exists;
  - refusal when the callback answers `hubChallenge`;
  - delete's ordering and its unknown-id refusal;
  - rotate writes to the right SecureString path without printing the value;
  - no secret printed by any command;
  - exact-digit id parsing;
  - the SSM prefix agrees with the app's.

**Decisions**
- **The handshake is the adapter's, and the handler stays vendor-blind.** This follows the orchestrator note and D-345: `hub.challenge` is Strava vocabulary, and the handler only needed to keep emitting string bodies verbatim, which it already did.
- **Any non-subscribe GET gets a 400, not a 405.** GET is now a supported method on this route, and §4.2 calls every other GET a scanner. A scanner gets the same bare 400 as a wrong token, so it learns nothing about which check failed.
- **The check order is token first, then challenge.** Both fail identically from outside, so the order affects only the internal log word.
- **The token comes from Amplify `secret()`, as §4.2 specifies,** and not from a lazy in-handler SSM read. Cost: Amplify's init banner makes one `ssm:GetParameters` call on every cold start, POSTs included. The parameter exists only at the shared path, so it is really two calls: the branch path misses first. That cost lands in init, which D-346 measured as not throttled the way the handler is, but it should be measured (see the smoke test).
- **A self-check before `create`.** The ticket's Notes say to test the bytes before Strava does. The script sends its own handshake GET to the deployed callback, with the real token and a fresh challenge, and refuses to create unless the bytes are exact.
- **`rotate-token` exists** because criterion 9 asks for CSPRNG generation and the current value's origin (0017) is not recorded. It is 32 alphanumerics.

**Gate run in the worktree.**
- All of amplify.yml's build-phase guards pass, including `check-boundaries` and `check-adapter-deletion` (the seam holds).
- `typecheck`, `lint`, the full vitest suite (222 files, 3772 passed, 1 skipped) and `npm run build` all pass.
- `check-bundle-leak --self-test` and `check-bundle-leak --require-literals` both pass, with 3 literals checked.
- `check-home-not-in-client --self-test` passes.
