---
id: 94
slug: token-refresh-scheduled-lambda
title: token-refresh scheduled Lambda — refresh before expiry, every 4 hours, never on failure
type: feature
priority: high
status: open
size: s
capability: 14-webhook-and-automatic-sync
depends_on: [33]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
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

- [ ] An EventBridge rule invokes the function every 4 hours.
- [ ] A token with `expires_at` inside the next window plus 300 s margin is refreshed; one further
      out is left untouched.
- [ ] The rotated refresh token returned by Strava is written back; a test with a changed refresh
      token in the response asserts the stored value updates.
- [ ] After refresh, `expires_at` reflects the new expiry and a subsequent API call succeeds.
- [ ] No token or refresh token appears in any log line at any level.
- [ ] No token value is reachable from AppSync or any client-exposed field; a `grep` over the built
      client bundle finds no Strava token or client secret.
- [ ] An auth-error refresh marks the account as needing reconnection and does not retry within the
      same invocation.
- [ ] A transient failure leaves state unchanged and is retried by the next scheduled run.
- [ ] A test that lets a token pass its expiry with the scheduler disabled, then runs
      `process-activity`, documents the reactive failure this ticket prevents — and passes with the
      scheduler enabled.

## Notes

Depends on 0033 (token storage in `LostSolesSourceAccount` and the refresh call itself). This ticket
is the schedule and the write-back discipline, not the HTTP exchange.

The refresh-token rotation write-back is the failure this ticket exists to prevent, and it fails
*later*, not immediately — a missed write-back works fine until the current access token expires, at
which point ingest stops silently. The nightly reconcile (0095) is what would eventually surface it,
which is another reason that sweep is mandatory rather than optional.

Per D-081 this Lambda is not VPC-attached; it needs only outbound HTTPS to Strava.

## Operator validation

From the AWS console, invoke the function manually and confirm the stored `expires_at` moves forward.
Then check CloudWatch logs and confirm no token material is present in them.

The real validation takes a day: note the time, then leave the app entirely alone for 24 hours with no
manual Sync. **Go for a run** in that window. When you open the app, the run must be there — meaning
the webhook fired against a token that was refreshed while you were not looking. Then check the
function's invocation count in CloudWatch: six invocations for the day, no errors.

Finally, revoke access from Strava's website and wait for the next scheduled run. `/settings` should
show disconnected and the plinth should carry the quiet reconnect line — no red, no modal.
