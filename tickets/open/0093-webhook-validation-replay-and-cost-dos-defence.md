---
id: 93
slug: webhook-validation-replay-and-cost-dos-defence
title: Event validation, replay idempotency, deauthorization, and cost-DoS defence
type: feature
priority: high
status: open
size: m
capability: 14-webhook-and-automatic-sync
depends_on: [91]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
---

## Description

This is the only unauthenticated, internet-facing surface in the system. `08-security-privacy.md`
§4.1, §4.3, §4.4.

**Start from the honest position: we cannot verify the events.** Strava sends **no signature, no
HMAC, no shared secret on the POST**, and publishes **no source IP range to allowlist**. Any claim to
"verify the webhook" would be false. What we have is a chain of cheap filters that make a forged
event **worthless rather than blocked**:

1. `subscription_id` must match ours — a guessable integer; it filters noise, not attackers.
2. `object_type` must be `activity` (or `athlete` for deauthorization). Everything else: `200`, drop.
3. `owner_id` must map to a known `SourceAccount` — and **that lookup happens downstream in
   `process-activity`, not here**, because the webhook deliberately has no IAM grant on that table
   (0091).
4. **The forged event is self-defeating.** The worst an attacker with a valid-shaped forgery achieves
   is making `process-activity` ask *Strava* for an activity id, using *our* token, for *our*
   athlete — and Strava returns 404 for an id that is not ours. **They cannot inject data; they can
   only ask us to re-fetch our own.**

**The rule that guarantees it: the webhook body is never trusted as data.** No coordinate, no
distance, no timestamp, no name from a payload ever reaches the domain model. The payload's only job
is to name an id we then fetch authoritatively.

**Replay (§4.3).** Strava retries up to three times and has no dead-letter mechanism, so duplicates
are **normal traffic, not an attack signature**:

```
ingestKey = sha256(`strava:${owner_id}:${object_id}:${aspect_type}`)
ConditionalPut IngestReceipt {ingestKey, status:"QUEUED"}  if attribute_not_exists
  → ConditionalCheckFailed → 200 immediately (already handled)
  → else SendMessage to ActivityIngestQueue → 200
```

`activityId = sha256(user, source, externalId)` (D-140) makes replay deterministic downstream so it
cannot double-award XP. Give receipts a **TTL of ~30 days**: long enough that no legitimate retry
outlives it, short enough that the table stays free.

**Cost-DoS (§4.4).** An attacker cannot read anything here — they can **spend our money**, which
against a $3–5/month budget (D-083) is a real if unexciting threat. Layered, cheapest first:

1. **Lambda reserved concurrency: 5.** *The single most important control in this section.* It bounds
   any flood to a small fixed number of 128 MB invocations and protects the rest of the account —
   without it a flood exhausts regional concurrency and starves `process-activity` and SSR. One CDK
   line.
2. **Hard payload cap: reject `Content-Length` > 8 KB before parsing.** Reject non-JSON
   `Content-Type`. Reject unparseable bodies with a **200 and no detail** — a 400 is a free oracle
   and Strava does not care either way.
3. **Reject unknown fields rather than ignore them.** A payload with 10,000 keys is a parser-cost
   attack.
4. **Method allowlist: GET and POST only.** Everything else 405, no body.
5. The `IngestReceipt` conditional write is itself a limiter.
6. **A per-`owner_id` counter** in the receipt table with a TTL: more than ~50 events/hour for one
   athlete is not a human running, it is a loop. Drop with a 200 and alarm.
7. **AWS Budgets alarms at $10 and $25/month by email.** The real backstop — cost-DoS is only
   dangerous when it is *silent*.
8. The SQS DLQ (0042) already stops a poison message spinning.

Explicitly **not** doing: WAF (~$15/month, ~5× the entire budget), API Gateway throttling, or
CAPTCHA-style challenges (Strava would fail them).

**Deauthorization.** `object_type: "athlete"` has exactly one meaningful form:
`updates: {"authorized": "false"}`. **Wire it up** — it is the §7.4 trigger and it issues the
`disconnect` IngestCommand. The app must then render the disconnected state (0089) without the user
having touched settings.

## Acceptance criteria

- [ ] An event whose `subscription_id` does not match ours is dropped with a 200 and no queue write.
- [ ] `object_type` values other than `activity` and `athlete` are dropped with a 200.
- [ ] No `owner_id` lookup against `LostSolesSourceAccount` occurs in this function — asserted by the
      absence of the IAM grant (0091) and by a code-level test.
- [ ] The same event delivered three times produces exactly **one** SQS message and three 200s; the
      second and third cost one conditional write each.
- [ ] `IngestReceipt` rows carry a ~30-day TTL.
- [ ] A downstream test proves a replayed event does not double-award XP, via the deterministic
      `activityId`.
- [ ] Reserved concurrency on the function is set to 5 in CDK.
- [ ] A request with `Content-Length` > 8 KB is rejected **before** the body is parsed.
- [ ] Non-JSON `Content-Type`, unparseable bodies, and bodies with unknown fields are all rejected
      with a 200 and no detail; none reaches SQS.
- [ ] `PUT`, `DELETE`, `PATCH` and `OPTIONS` return 405 with no body.
- [ ] More than 50 events in an hour for one `owner_id` are dropped with a 200 and raise an alarm.
- [ ] AWS Budgets alarms exist at $10 and $25/month with an email destination, verified by a test
      notification actually arriving.
- [ ] A synthetic flood of 1,000 requests in 60 seconds produces zero queue growth beyond the unique
      events, no concurrency starvation of `process-activity`, and a measured cost delta under a cent.
- [ ] An `athlete` deauthorization event issues the `disconnect` command; afterwards the app shows the
      source as disconnected and the map, ledger and history are unchanged.
- [ ] A grep proves no field of a webhook payload other than ids and `aspect_type` is read anywhere
      downstream — no coordinate, distance, timestamp or name from a payload reaches the domain model.

## Notes

Depends on 0091 (the function and its two IAM grants).

The forgery argument is worth restating whenever someone proposes adding "real" verification here:
the security property comes from the **architecture** — the payload is a *notification, never a data
carrier* — not from the endpoint's cleverness. Adding signature checking Strava does not provide is
not possible; adding trust in the payload to compensate would be actively harmful.

The flood test is the acceptance criterion most likely to be skipped and it is the one that proves
the reserved-concurrency line is actually deployed. Run it once, from the desktop, against the real
deployed URL.

## Operator validation

> **D-181 — most of what follows is the AGENT's to run, not the operator's.**
> Swept 2026-09-02 (ticket `0147`). This ticket's capability has no screen of its own. Before asking
> the operator for any step below, check whether AWS credentials (`AWS_PROFILE=devault`), `curl`, or
> a script can answer it — if so it is a **smoke test**, and what it proved is recorded here at
> close *instead of* the instruction. Keep only what genuinely needs a human eye, a phone, or a real
> run. The text below is the original author's intent, kept as context for **what** to verify — not
> as a list of chores for the operator.

From the desktop, against the deployed URL: `curl` the same well-formed event three times and confirm
three 200s and a single new activity in the app. Then `curl` with a 20 KB body, with
`Content-Type: text/plain`, with an extra unknown field, and with `-X DELETE`, and confirm the
responses match the rules above and that nothing appeared in the app.

Run a 1,000-request flood (`xargs -P`), then open the AWS console: check the function's concurrent
executions never exceeded 5, that `process-activity` was not throttled, and that Cost Explorer shows
essentially nothing. Confirm a Budgets email actually lands in the inbox — an alarm nobody receives is
not a backstop.

Finally, on the Android phone: revoke the app from Strava's own website, then open Lost Soles. The
source must show as disconnected in `/settings`, and your map and Total Level must be **completely
unchanged**. Reconnect and confirm ingest resumes.
