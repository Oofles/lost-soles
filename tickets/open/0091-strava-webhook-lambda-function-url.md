---
id: 91
slug: strava-webhook-lambda-function-url
title: strava-webhook Lambda behind a Function URL, added via the CDK escape hatch, acking in 2 s
type: feature
priority: high
status: open
size: m
capability: 14-webhook-and-automatic-sync
depends_on: [42]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
---

## Description

The endpoint that finally satisfies D-013. Until this capability ships, ingest is the manual **Sync**
button (0043) and the app has upkeep — a deliberate, scheduled violation of D-013 with this ticket as
its named payoff (roadmap §4.5).

**The hard constraint that shapes every decision here: Strava requires a 200 within 2 seconds**, or
it retries and eventually disables the subscription — of which there is exactly one, per application,
ever.

**The deployment shape is prescribed, and each alternative is ruled out for a reason:**

- A dedicated **128 MB Lambda** behind a **Function URL with `authType: NONE`**, 3 s timeout, added
  through the **Amplify Gen 2 CDK escape hatch** (`01-architecture.md` §2).
- **Not API Gateway** — its cost and its extra hop buy nothing here, and the whole reason for
  choosing a Function URL was to avoid both (`08-security-privacy.md` §4.4).
- **Not a Next.js route handler** — the SSR bundle's cold start risks the 2 s deadline, and it
  redeploys on every frontend change, which means a UI tweak could silently drop webhooks
  (§4.5). This is the single most important "do not" in the ticket.
- **Not VPC-attached** (D-081) — it needs internet, and a VPC would force a NAT Gateway at ~$33/mo,
  about ten times the entire D-083 budget.

**Ack first, process asynchronously.** The handler does exactly this, in order (`03-integrations.md`
§2.3):

1. Parse the body; validate `subscription_id` matches ours and `object_type` is one we handle.
2. Conditional-put the `IngestReceipt`, then `SendMessage` to the existing `ActivityIngestQueue`.
3. Return `200` with an empty body.

**What it must never do** (§4.5): no network calls, no Strava API call, no token refresh, no S3, no
AppSync, no `h3` import. **No credential access** — its only secret is
`STRAVA_WEBHOOK_VERIFY_TOKEN`, and it holds **no IAM grant on `LostSolesSourceAccount`**, so the
public endpoint can never read a token *by policy, not by discipline*. No writes outside
`IngestReceipt` and SQS: two grants, both narrow. No logging of full payloads at INFO — log
`ingestKey`, `aspect_type` and a decision, never a body, because webhook payloads are the thin end of
the GPS-data wedge ending up in CloudWatch.

At ~1 event/day this function is **always cold**. That is not hypothetical; keep the bundle tiny (no
AWS SDK v2, no ORM, no heavy validation library) and measure the cold start.

The callback URL is **permanent infrastructure** — one subscription per app, `callback_url` fixed at
creation. Pick the stable path behind the stable custom domain now:
`https://soles.devaultsecurity.com/api/webhooks/strava`. Changing it later means delete + recreate,
with a window in which reconciliation (0095) is the only ingestion path.

## Acceptance criteria

- [ ] The function is defined in CDK via the Amplify Gen 2 escape hatch with 128 MB, a 3 s timeout,
      and a Function URL with `authType: NONE`. No API Gateway resource is created.
- [ ] No Next.js route handler serves the webhook path; a test asserts the app router has no
      `/api/webhooks/strava` handler.
- [ ] The function has no VPC configuration (D-081).
- [ ] The handler returns 200 **before** any queueing side effect is observable to the caller —
      measured p99 well under 500 ms, cold start included, against the deployed URL.
- [ ] A cold invocation completes inside 2 s, measured 10 times after forced cold starts.
- [ ] The bundle contains no AWS SDK v2, no `h3`, and no ORM; bundle size is asserted in CI under a
      fixed ceiling.
- [ ] Its IAM role grants exactly two things: conditional write on the `IngestReceipt` table and
      `sqs:SendMessage` on `ActivityIngestQueue`. A policy assertion proves no grant on
      `LostSolesSourceAccount`.
- [ ] A valid `create` event for a known subscription enqueues exactly one SQS message and returns
      200 with an empty body.
- [ ] CloudWatch logs at INFO contain `ingestKey` and `aspect_type` and contain no request body, no
      coordinates, and no `owner_id`.
- [ ] The Function URL is reachable over HTTPS with a valid full certificate chain at the fixed
      callback path.

## Notes

Depends on 0042 (the `process-activity` Lambda, SQS queue and DLQ), which already exists and is
already fed by the manual Sync path. This ticket adds a second producer to that queue and nothing
else — all the real work stays downstream, where it has 2048 MB and 900 s instead of 128 MB and 3 s.

The 2-second budget is a **security control as much as a performance one** (§4.5): the smaller this
function is, the less there is to attack. If p99 creeps toward a second, something was added that
belongs in `process-activity`.

Consider provisioned concurrency of 1 only if measured cold starts prove marginal — it costs money
every month to fix a problem that may not exist, so measure first.

## Operator validation

Deploy, then on the desktop `curl -i` the Function URL with a well-formed POST body and confirm a 200
with an empty body in well under a second. Run it again after leaving the function idle for an hour —
that is the cold path and it is the one that matters.

Then the real one, on the Android phone: **go for an actual run**, finish it in Strava, and put the
phone in your pocket. Do not press Sync. Open the app some minutes later and confirm the run is
there. Check CloudWatch for the invocation and read the log line: it must tell you what happened and
must not contain a single coordinate.
