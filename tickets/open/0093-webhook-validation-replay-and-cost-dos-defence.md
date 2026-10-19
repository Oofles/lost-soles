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
started: 2026-10-18T01:23:55Z
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

- [x] An event whose `subscription_id` does not match ours is dropped with a 200 and no queue write.
- [x] `object_type` values other than `activity` and `athlete` are dropped with a 200.
- [x] No `owner_id` lookup against `LostSolesSourceAccount` occurs in this function — asserted by the
      absence of the IAM grant (0091) and by a code-level test.
- [x] The same event delivered three times produces exactly **one** SQS message and three 200s; the
      second and third cost one conditional write each.
- [x] `IngestReceipt` rows carry the T8 TTL (**90 days**). *(Amended 2026-10-17, operator Q2 = (a):
      this read "~30-day", which contradicted `02-data-model.md` T8 and the decisions citing the
      90-day receipt TTL. 90 days meets this ticket's own test — no retry outlives it, the table
      stays free — and expiry is safe because set semantics and the deterministic ledger `id` are
      the backstops. Already built as `RECEIPT_TTL_DAYS = 90`; `08` §4.3 corrected.)*
- [x] A downstream test proves a replayed event does not double-award XP, via the deterministic
      `activityId`.
- [x] Reserved concurrency on the function is set to 5 in CDK.
- [x] A request with `Content-Length` > 8 KB is rejected **before** the body is parsed.
- [x] Non-JSON `Content-Type`, unparseable bodies, and bodies with unknown fields are all rejected
      with a 200 and no detail; none reaches SQS.
- [x] `PUT`, `DELETE`, `PATCH` and `OPTIONS` return 405 with no body.
- [x] More than 50 events in an hour for one `owner_id` are dropped with a 200 and raise an alarm.
- [x] ~~AWS Budgets alarms exist at $10 and $25/month with an email destination, verified by a test
      notification actually arriving.~~ *Amended 2026-10-18 (operator, D-361): withdrawn. The
      account is shared with the operator's other apps, so the budget measured them, not Lost Soles
      ($16.53 by Oct 18, $50.08 in September). It deployed already in ALARM, and neither it nor
      the $0.01 test budget emailed in 25 hours, although SNS email reached the same inbox. The
      operator manages AWS cost outside this project. The cost-DoS bound is reserved concurrency,
      proven by the flood test. The test budget is deleted, and `0289` removes the `CfnBudget`.* *(Built and synth-tested; the budget does not exist until
      deploy, and "an email actually arrives" is a post-deploy smoke test — see Resolution.
      2026-10-18: the budget and both notifications exist. A throwaway $0.01 budget, "Lost Soles
      notification test", was created at 02:30Z with the same email destination; Budgets evaluates
      a few times a day. Tick this when its email arrives, then delete that budget.)*
- [x] A synthetic flood of 1,000 requests in 60 seconds produces zero queue growth beyond the unique
      events, no concurrency starvation of `process-activity`, and a measured cost delta under a cent.
      *(Post-deploy, against the real URL — the exact commands are in the Resolution. Run
      2026-10-18: see Operator validation.)*
- [x] An `athlete` deauthorization event issues the `disconnect` command; afterwards the app shows the
      source as disconnected and the map, ledger and history are unchanged. *(Code half done and
      tested: webhook → `DisconnectMessage` → worker confirms with Strava → `markDisconnected`,
      which leaves map/ledger/history untouched by construction (§6.5). The end-to-end half needs a
      real revocation at Strava and is the operator check.)*
      *Amended 2026-10-18 (orchestrator), under D-229: the end-to-end check is not asked of the
      operator. Revoking at Strava and then reconnecting is constructing a scenario, which D-229
      rules out. What is proven instead:*
      - *the webhook → queue → worker path, live, with a forged deauthorization. The worker
        confirmed with Strava, logged `forged-or-stale`, and left the connection ACTIVE;*
      - *the dead-credential branch to `markDisconnected` with map, ledger and history untouched,
        by `lib/sources/deauthorization.test.ts` and the process-activity handler tests;*
      - *the disconnected rendering, by `0089`.*

      *A real revocation will exercise the last link in ordinary use.*
- [x] A grep proves no field of a webhook payload other than ids and `aspect_type` is read anywhere
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

Finally, in the desktop browser: revoke the app from Strava's own website, then open Lost Soles. The
source must show as disconnected in `/settings`, and your map and Total Level must be **completely
unchanged**. Reconnect and confirm ingest resumes.

**Result, 2026-10-18 (orchestrator, deployed stack, Amplify jobs 410 and 411; smoke tests).**
- **(a) Reserved concurrency** on the deployed webhook function: `5`.
- **(b) Methods.** PUT, DELETE, PATCH and OPTIONS each returned `405` with 0 bytes.
- **(c) Size cap.** A 20 KB body got `200` with 0 bytes; the log reads `decision: oversize`.
- **(d) Content type and shape.** `text/plain` → `not-json`, and an extra field →
  `unknown-fields`. Both got `200` with 0 bytes, and the queue stayed at 0/0.
- **(e) Before the id was committed:** a valid event → `no-subscription`.
- **(f) Replay, once id `377486` was live (job 411).** Three deliveries of activity `20576149694`
  each got `200`. All three were `duplicate`, and the queue stayed at 0/0.
- **(g) Flood: 1,000 requests in 9 s, 20 at a time.**
  - 545 got `200`; 455 got `429`, refused by the reserved concurrency itself.
  - Webhook ConcurrentExecutions peaked at 5. process-activity Throttles: none. Queue growth: 0.
  - The flood counter passed 47 (all `duplicate` at the receipt gate) and dropped 498 as
    `owner-flood` with `webhook-flood` logged. Its `rate#…#2026-10-18T02` row counted 548.
  - "Lost Soles — the webhook is being flooded" went to ALARM.
  - Cost: 545 invocations, 27.3 s of 128 MB compute and about 1,100 DynamoDB writes, about
    $0.002 in all, under a cent.
  - My first flood attempt was invalid: `xargs -I{}` replaced the payload's `"updates":{}`, so
    every request dropped as `unknown-fields`. Rerun with `-I@`.
- **(h) Forged deauthorization** at 03:00Z, a fresh counter hour.
  - The webhook got `200`. process-activity logged `event: deauthorization, outcome:
    forged-or-stale`. SourceAccount stayed `ACTIVE`, and the DLQ stayed at 0.
  - `expiresAt` did not change. That is expected: Strava hands back the same access token while
    it still has life, so the confirmation refresh rotated nothing. D-348 holds either way.
- **(i) Budgets.** "Lost Soles monthly cost", with ACTUAL ABSOLUTE_VALUE notifications at 10 and
  25. The test email is pending; see the criterion.
- **(j) Budgets, 2026-10-19 03:30Z.** Both notifications on "Lost Soles monthly cost" and the
  test budget were in ALARM, and the account had spent $16.53, but no Budgets email reached
  Gmail, spam included. A CloudWatch SNS alarm email from 02:49Z did arrive. The operator chose
  to take cost alerting off the project (D-361). The test budget is deleted.
- **Perceptual:** none.

## Resolution

**What shipped.** This builds on 0091's `ingest-webhook` and adds the rest of §4.1/§4.4: the
cheap filters, a per-athlete flood counter, reserved concurrency, a flood alarm, the Budgets
backstop, and deauthorization. A deauthorization is **confirmed with Strava before it is
believed**.

**The order, per request.**
1. Handler, method allowlist: GET/POST only; anything else is a 405 with no body.
2. Handler, 8 KB cap on the declared `Content-Length` and on the bytes received. It runs before
   any decode or parse, and an oversize body gets a 200 with no body.
3. Adapter, JSON `Content-Type`.
4. Adapter, the body must parse to an object.
5. Adapter, exactly the documented top-level and `updates` keys, with their types.
6. Adapter, the `subscription_id` must equal `STRAVA_SUBSCRIPTION_ID`. While that is `null`,
   every event drops as `no-subscription`.
7. Adapter, `object_type` must be `activity` or `athlete`.
8. Adapter, the static owner map (0091).
9. Handler, the per-user flood counter.
10. Handler, the receipt gate (0091), then the SQS send.

Every POST rejection is a 200 with an empty body. Each one logs a distinct `decision`.

**Files touched**
- `src/adapters/strava/subscription.ts`: new. `STRAVA_SUBSCRIPTION_ID: number | null = null`. 0092's id gets committed here.
- `src/adapters/strava/accept.ts`: the filter chain above. It adds a deauthorization branch: `athlete`, `update`, `updates` exactly `{authorized:"false"}`, and `object_id === owner_id`. That branch returns `{kind:"disconnect", source, userId}`. `acceptStravaEvent(req, {now, subscriptionId})` lets tests inject the id.
- `src/adapters/strava/accept.test.ts`: new. Covers the subscription (null, mismatch, missing), `object_type`, the deauth shape, content type, unknown fields (including a 10,000-key body) and the documented fields.
- `src/adapters/strava/webhook-replay.test.ts`: new, for criterion 6. Three deliveries at three clocks go through the real `accept` and `normalize`. They give one `activityId` (= `computeActivityId`), so one `ledgerId`, which is written `attribute_not_exists(id)`. It also proves `event_time` never becomes `startedAt`. The pipeline half is the existing "a second delivery keeps the first award (0220)" test.
- `amplify/functions/ingest-webhook/handler.ts`: the method allowlist, `MAX_BODY_BYTES` / `bodyTooLarge`, the flood counter in front of the receipt gate, the `webhook-flood` log line, and `forwardDisconnect`. A disconnect writes no receipt, is counted in two buckets, and is sent as a `DisconnectMessage`.
- `amplify/functions/ingest-webhook/owner-rate.ts`: new. Atomic `ADD` on `rate#<source>#<userId>#<UTC hour>` (deauths use `…#deauth#<hour>`) in `LostSolesIngestReceipt`, with a 2 h TTL. The limits are 50 events per hour and 4 deauths per hour.
- `amplify/functions/ingest-webhook/handler.test.ts`:
  - The subscription is mocked to the fixture id, and the receipt fake is now stateful.
  - New tests cover:
    - replay (3 × 200, 1 message, 3 conditional puts);
    - 405s for PUT/DELETE/PATCH/OPTIONS/HEAD, all decided before the adapter runs;
    - oversize (declared, actual, base64, non-numeric length);
    - not-json, unparseable and unknown-fields;
    - the flood (the 51st event drops with no receipt write);
    - a stranger's flood, which costs no writes;
    - deauth forwarding and the deauth flood.
  - It also adds criterion 15's grep and criterion 3's bundle test (no SourceAccount store, table name or `byExternalOwner` in the bundle).
- `src/pipeline/disconnect-message.ts`: new. `DisconnectMessage {command:"disconnect", source, userId, enqueuedAt}`, with a builder and `isDisconnectMessage`. It is not an `IngestJob`, so D-343's key set is untouched.
- `lib/sources/deauthorization.ts` (+ test): new. `handleDeauthorization` forces a refresh through `accessTokenFor`, which is the existing lease plus conditional rotation, with `refreshWithinSeconds` larger than any token's life. It can end four ways:
  - `SourceNeedsReauthError`: Strava rejected the credential (`credentialIsDead`), so the row is marked `markDisconnected`.
  - Success: the event was forged or stale. The rotated tokens are already persisted, nothing is disconnected, and the outcome is logged as `forged-or-stale`.
  - `SourceNotConnectedError`: the row is already disconnected, so nothing happens.
  - Anything else: it throws, so SQS redelivers.
- `amplify/functions/process-activity/handler.ts` (+ test): `handleRecord` checks `isDisconnectMessage` before it reads the body as a job. No new grant: it already holds GetItem/UpdateItem on SourceAccount, KMS, and the client credentials.
- `amplify/backend.ts`:
  - `reservedConcurrentExecutions = 5`, set on the L1 `cfnFunction`;
  - a new statement `OwnerFloodCounter`: `dynamodb:UpdateItem` on the receipt table, conditioned on `ForAllValues:StringLike dynamodb:LeadingKeys ["rate#*"]`;
  - a `MetricFilter` on the webhook's log group (term `"webhook-flood"` → `LostSoles/WebhookOwnerFlood`) with a `WebhookOwnerFlood` alarm (Sum > 0 over 5 min, missing data = not breaching). It emails through the existing `IngestAlarms` topic. Both sit in the functions' stack, because putting them in `IngestPipeline` would create a stack cycle;
  - `CfnBudget` "Lost Soles monthly cost": COST, MONTHLY, ACTUAL > $10 and > $25, with a direct EMAIL subscriber.
- `amplify/ingest-webhook-stack.test.ts`: **0091's pinned-grant test is amended on purpose**. It now expects exactly three actions, and the `UpdateItem` must carry the `rate#*` condition on its own statement. New synth tests cover reserved concurrency, the filter and alarm, and the budget.
- `amplify/process-activity-stack.test.ts`: the "only alarm" test now allows exactly one other alarm in the functions' stack, the flood alarm. *(0095 edited the same assertion; the orchestrator resolves that at merge.)*
- `docs/01-architecture.md` §4: the "only alarm" line now names the flood alarm. *(It also conflicts with 0095; resolved at merge.)*
- `docs/08-security-privacy.md` §4.1: an as-built note covering the static owner map (0091's drift) and deauth confirmation.
- `docs/08-security-privacy.md` §4.3: the TTL is corrected to T8's 90 days, with the reason.
- `docs/08-security-privacy.md` §4.4 item 6: the counter's as-built shape.
- `docs/03-integrations.md` §2.3 "Deauthorization": "immediately" now means once confirmed.

**Decisions**
- **D-348 (operator Q1 = A′).** A deauthorization is forwarded as a `DisconnectMessage` on the ingest queue. `process-activity` disconnects only after a forced refresh through the refresh lease shows Strava rejecting the credential. A refresh that succeeds marks the event forged; the rotated tokens are kept. This keeps §4.1's guarantee that a forgery is worthless, for the one event that would otherwise delete tokens.
- **D-349.** The flood counter is keyed on the **user**, not on `owner_id`. The static map is one-to-one, the counter row stays vendor-neutral (D-100), and no athlete id lands in a table key. `UpdateItem` is held to `rate#` keys by `LeadingKeys`, so the accept gate stays `PutItem`-only. Deauths get their own budget of 4 per hour, because each one costs the worker a Strava call.
- **Q2 = (a) (operator).** The receipt TTL stays at T8's 90 days. Criterion 5 and `08` §4.3 are amended.
- **Oversize → 200 (operator confirmed).** Same as every other POST rejection; a 413 would be an oracle.
- **The design called the strict field set "reject unknown fields"; the cost is accepted.** If Strava adds a field, every event drops as `unknown-fields`. That is loud in the log and lossless, because the sweep (0095) is the path of record.

**Gate (worktree).**
- All `amplify.yml` guards passed, including `check-adapter-deletion` and the post-build `check-bundle-leak` and `check-home-not-in-client`.
- `npm run typecheck` and `npm run lint` are clean.
- `npx vitest run`: 222 files, 3,803 passed, 1 skipped.
- `npm run build` is green.

**Post-deploy.**
- The `MetricFilter` needs the webhook's log group to exist; it has existed since 0091.
- Until 0092's subscription id is committed, every POST drops as `no-subscription`. The replay, flood-counter and deauth smoke tests need that id; the method, size, content-type and field tests do not.
