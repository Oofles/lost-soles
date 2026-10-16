---
id: 94
slug: token-refresh-scheduled-lambda
title: token-refresh scheduled Lambda — refresh before expiry, every 4 hours, never on failure
type: feature
priority: high
status: closed
size: s
capability: 14-webhook-and-automatic-sync
depends_on: [33]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
started: 2026-10-16T13:42:37Z
closed: 2026-10-16T15:11:08Z
---

## Description

A scheduled Lambda on an EventBridge rule, every **4 hours**, that refreshes any Strava access token
approaching expiry.

The rule that makes it worth its own function (`03-integrations.md` §2.5): **refresh proactively at
`expires_at - 300s`, not reactively on a 401.** Strava access tokens live six hours. A reactive
refresh means the *first* request after expiry fails, and the request most likely to be first is the
one inside `process-activity` — which is triggered by a webhook, which is on a clock, which is
exactly where a retry is most expensive. A 401 mid-webhook-consume is a failure mode the schedule
removes entirely rather than handles gracefully.

Scope, deliberately small:

- Read every `SourceAccount` whose `expires_at` falls inside the next window plus margin.
- Exchange the refresh token; write back the new access token, refresh token and `expires_at`.
  **Strava may rotate the refresh token** — write back whatever it returns, always, or the next
  refresh fails permanently.
- Tokens live in `LostSolesSourceAccount` (`02-data-model.md` T7), **not in AppSync**, and never
  reach the client (`08-security-privacy.md` §3.1).
- A refresh that fails with an auth error means the grant is gone: mark the account as needing
  reconnection so 0087's quiet ink-coloured `Strava needs reconnecting` line appears. Do not retry a
  revoked grant on a loop — that is a rate-limit spend against a token that will never work again.
- A refresh that fails for a transient reason is left alone; the next run in four hours is the retry.

Every 4 hours against a 6-hour token gives two chances before any token can expire, which is the
margin the schedule is chosen for. The function costs a handful of invocations a day and one API call
each — negligible against the §2.5 budget.

## Acceptance criteria

- [x] An EventBridge rule invokes the function every 4 hours.
      *(Amended at build: Amplify's native `schedule: "every 4h"` synthesizes an **EventBridge
      Scheduler** `AWS::Scheduler::Schedule`, `cron(0 */4 * * ? *)` UTC, not a classic
      `AWS::Events::Rule`. Same service family, same effect; asserted in
      `amplify/token-refresh-stack.test.ts`.)*
- [x] A token with `expires_at` inside the next window plus 300 s margin is refreshed; one further
      out is left untouched.
- [x] The rotated refresh token returned by Strava is written back; a test with a changed refresh
      token in the response asserts the stored value updates.
- [x] After refresh, `expires_at` reflects the new expiry and a subsequent API call succeeds.
- [x] No token or refresh token appears in any log line at any level.
- [x] No token value is reachable from AppSync or any client-exposed field; a `grep` over the built
      client bundle finds no Strava token or client secret.
- [x] An auth-error refresh marks the account as needing reconnection and does not retry within the
      same invocation.
- [x] A transient failure leaves state unchanged and is retried by the next scheduled run.
- [x] A test that lets a token pass its expiry with the scheduler disabled, then runs
      `process-activity`, documents the reactive failure this ticket prevents — and passes with the
      scheduler enabled.
      *(Amended at build: the test drives `accessTokenFor` exactly as `oauthCredentialsFor` calls it
      for `process-activity`'s first API request, not the whole worker handler. And "the reactive
      failure" is stated precisely: since 0033 the worker does not 401 on an expired token, it
      refreshes inline first — so the failure is that inline exchange landing on a token-endpoint
      outage at webhook time. Disabled: the ingest's token resolution throws. Enabled: same
      outage, zero exchanges from the worker, the API call succeeds.)*

## Notes

Depends on 0033 (token storage in `LostSolesSourceAccount` and the refresh call itself). This ticket
is the schedule and the write-back discipline, not the HTTP exchange.

The refresh-token rotation write-back is the failure this ticket exists to prevent, and it fails
*later*, not immediately — a missed write-back works fine until the current access token expires, at
which point ingest stops silently. The nightly reconcile (0095) is what would eventually surface it,
which is another reason that sweep is mandatory rather than optional.

Per D-081 this Lambda is not VPC-attached; it needs only outbound HTTPS to Strava.

## Operator validation

> **D-181 — most of what follows is the AGENT's to run, not the operator's.**
> Swept 2026-09-02 (ticket `0147`). This ticket's capability has no screen of its own. Before asking
> the operator for any step below, check whether AWS credentials (`AWS_PROFILE=devault`), `curl`, or
> a script can answer it — if so it is a **smoke test**, and what it proved is recorded here at
> close *instead of* the instruction. Keep only what genuinely needs a human eye, a phone, or a real
> run. The text below is the original author's intent, kept as context for **what** to verify — not
> as a list of chores for the operator.

From the AWS console, invoke the function manually and confirm the stored `expires_at` moves forward.
Then check CloudWatch logs and confirm no token material is present in them.

The real validation takes a day: note the time, then leave the app entirely alone for 24 hours with no
manual Sync. **Go for a run** in that window. When you open the app, the run must be there — meaning
the webhook fired against a token that was refreshed while you were not looking. Then check the
function's invocation count in CloudWatch: six invocations for the day, no errors.

Finally, revoke access from Strava's website and wait for the next scheduled run. `/settings` should
show disconnected and the plinth should carry the quiet reconnect line — no red, no modal.

## Resolution

**What was built.** A scheduled `token-refresh` Lambda that sweeps T7 every four hours and refreshes
any `ACTIVE` connection whose access token expires within the next run plus the 300 s skew. It is
the schedule and the "is this due" window only. The refresh exchange, the per-connection lease, the
conditional rotation write-back and the dead-grant marking all come from 0033's `accessTokenFor`.
There is no second HTTP exchange and no second write path.

**Files touched**
- `amplify/functions/token-refresh/resource.ts` (new): `defineFunction` with `schedule: "every 4h"`,
  60 s, 256 MB, no VPC, no environment, no `secret()`.
- `amplify/functions/token-refresh/handler.ts` (new): calls `sweepExpiringTokens()` and returns the
  counts.
- `lib/sources/token-refresh-sweep.ts` (new): the sweep. `SWEEP_INTERVAL_SECONDS` (4 h) and
  `SWEEP_HORIZON_SECONDS` (4 h + 300 s). Each connection's outcome is counted as one of
  refreshed, needsReauth, skipped or failed, and logged without credentials. It never throws for
  one connection; it throws only if the scan itself fails.
- `lib/sources/token-refresh.ts`: adds an optional `refreshWithinSeconds` to `AccessTokenRequest`,
  defaulting to `REFRESH_SKEW_SECONDS`, and passes it to every `isUsable` check. The inline
  callers are unchanged.
- `lib/sources/source-account-store.ts`: adds `listRefreshCandidates({ expiringBefore })`. It is a
  paginated `Scan` that filters on `status = ACTIVE AND expiresAt < cutoff`. It projects only
  `pk, sk, expiresAt`, so no token leaves DynamoDB on the sweep's own read.
- `amplify/backend.ts`: registers `tokenRefresh` and grants it T7 `Scan`/`GetItem`/`UpdateItem`, the
  CMK's encrypt and decrypt, and the two named OAuth client SSM parameters. The block sits after
  the worker's environment. The escape-hatch count in the header comment goes from five back to
  four, because the schedule is Amplify-native (D-226's "N must stay true").
- `amplify/token-refresh-stack.test.ts` (new): a synth test covering the schedule (expression, UTC,
  enabled, targets the function), no VPC, no credential in the environment, the T7 actions
  present, no `PutItem`/`DeleteItem`/`BatchWriteItem`/`dynamodb:*`, KMS encrypt and decrypt, and
  exactly two SSM parameter ARNs with no wildcard.
- `amplify/process-activity-stack.test.ts`: the worker's SSM-grant test now looks only at the
  worker's own role. The function stack now holds a second role with the same grant, and the
  unscoped count found two statements.
- `lib/sources/token-refresh-sweep.test.ts` (new): 16 tests. They run the real sweep and the real
  `accessTokenFor` against a fake rotating provider behind `fetch` and an in-memory T7 that
  enforces the lease and rotation conditions. An `afterEach` checks every console line at every
  level against every token issued and the client secret.
- `lib/sources/source-account-store.test.ts`: three tests for the scan's command shape (projection,
  filter, pagination, malformed keys).
- `docs/01-architecture.md` §7: the sweep query read `expiresAt < now + 6h AND status = "active"`.
  That would refresh every six-hour token on every run, and the status casing was stale. Corrected
  to `now + 4h + 300s` and `"ACTIVE"`. Line numbers shift by two, so `docs/INDEX.md` needs a
  regeneration.

**Decisions made, and why**
- **Reuse the existing dead-grant state; add no new flag** (D-210). An auth-error refresh goes
  through `accessTokenFor`'s `classifyRefreshFailure`, which calls `markNeedsReauth`. That sets
  `status = NEEDS_REAUTH`, the state `lib/plinth/model.ts` turns into the `/settings` reconnect
  line (D-318, D-337). No UI change. A marked row is filtered out of the next scan, so a revoked
  grant costs exactly one exchange, ever.
- **No throw on a per-connection failure.** A throwing handler would let Lambda's async retries
  re-run a transient failure minutes later. The ticket says the next scheduled run is the retry.
- **A Scan, not a GSI on `expiresAt`.** T7 holds at most 24 rows. A GSI would add a projection
  that every rotation has to maintain, just to avoid reading two dozen items every four hours.
- **Native `schedule`, not the CDK escape hatch.** 01 §2 resource #14 already specified it.
- **The test uses a neutral provider, not the real Strava connector.** `check-boundaries.mjs` (D-100)
  forbids naming the vendor in `lib/`. The real connector's refresh parsing is covered by
  `src/adapters/strava/oauth.test.ts`.

**Finding: the "two chances" in the description is not quite true at this window.** With
horizon = interval + 300 s, a token is refreshed at the first run that finds it with less than
4 h 05 m left. If that run fails transiently, the next run is four hours later, when the token is
inside its last five minutes or already expired. Nothing is lost: the refresh token is still
good, so the next run recovers it, and in between the worker falls back to the inline refresh.
But one failed run reopens the hot-path window. Two real chances would need a horizon of at
least 2 × interval + skew (8 h 05 m), which is longer than the token's life and means refreshing
on every run. That costs about 6 exchanges a day instead of about 4. Criterion 2 as written was
followed. This is recorded in the code comment on `SWEEP_HORIZON_SECONDS`.

**Not done: `secret-smoke-test` was not deleted.** Its comment says to delete it "when
`token-refresh` (0094) ships, since that function reads the same secret in earnest." That premise
is wrong. The secret it proves is `STRAVA_WEBHOOK_VERIFY_TOKEN`, and `token-refresh` reads no
`secret()` at all, because its client credentials come from SSM through `oauth-credentials.ts`.
The real reader is the webhook Lambda (0091). It was also left alone to keep this change's
`defineBackend` edit additive while 0091 edits the same block.

**Result, 2026-10-16 (agent smoke test on the deployed stack; Amplify job 408, `6f3d2b8`):**

- Function `…tokenrefreshlambda476763…`: 256 MB, 60 s, no VPC, and one environment key
  (`AMPLIFY_SSM_ENV_CONFIG`), with no credential in the environment.
- Schedule `…tokenrefreshlambdaschedu…`: `cron(0 */4 * * ? *)` UTC, ENABLED.
- Real refresh: the stored token had expired two days earlier (`expiresAt` 1791964887, now
  1792163353). A manual invoke returned
  `{"examined":1,"refreshed":1,"needsReauth":0,"skipped":0,"failed":0}`. `expiresAt` moved to
  1792184964 (+6 h), status stayed `ACTIVE`, and the refresh-token hash prefix was unchanged
  (`4c7967…`). Strava did not rotate this time, and the write-back stored whatever came back.
- CloudWatch: one summary line and a REPORT line. The only 40+ hex string is the AWS runtime
  version ARN; there are no tokens.
- **Not performed, by D-229:** the 24-hour hands-off run and the revoke-from-Strava check. Both
  are scenarios the operator would have to construct. The auth-error path is covered by
  `token-refresh-sweep.test.ts` (16 tests, including `markNeedsReauth` and a single exchange per
  revoked grant). The scheduled runs prove themselves in CloudWatch from the next 4-hour boundary
  on.
