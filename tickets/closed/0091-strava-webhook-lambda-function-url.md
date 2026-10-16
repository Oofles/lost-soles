---
id: 91
slug: strava-webhook-lambda-function-url
title: strava-webhook Lambda behind a Function URL, added via the CDK escape hatch, acking in 2 s
type: feature
priority: high
status: closed
size: m
capability: 14-webhook-and-automatic-sync
depends_on: [42]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
started: 2026-10-16T13:42:37Z
closed: 2026-10-16T15:42:18Z
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
   *(Amended 2026-10-16, operator answer Q3: the `subscription_id` check is left to **0093**, which
   lists it. "Ours" does not exist until 0092 creates the subscription. This ticket validates
   `object_type`, `aspect_type`, the id shapes and the owner.)*
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
creation. ~~Pick the stable path behind the stable custom domain now:
`https://soles.devaultsecurity.com/api/webhooks/strava`.~~ Changing it later means delete + recreate,
with a window in which reconciliation (0095) is the only ingestion path.

> **Amended 2026-10-16 (operator answer Q2, option A).** The callback is the **raw Function URL plus
> `api/webhooks/strava`**, not a path on `soles.devaultsecurity.com`. That hostname is Amplify
> Hosting's, and every way of putting this path on it either routes through the SSR compute — the
> one thing this ticket forbids — or puts our own CloudFront in front of the whole app. The URL is
> exposed as the `IngestWebhookUrl` CloudFormation output (and `custom.ingestWebhookUrl` in
> `amplify_outputs.json`); it is stable for the life of the function's logical id, and **0092** owns
> registering it and re-registering it if it ever changes.

## Acceptance criteria

- [x] The function is defined in CDK via the Amplify Gen 2 escape hatch with 128 MB, a 3 s timeout,
      and a Function URL with `authType: NONE`. No API Gateway resource is created.
- [x] No Next.js route handler serves the webhook path; a test asserts the app router has no
      `/api/webhooks/strava` handler.
- [x] The function has no VPC configuration (D-081).
- [x] The handler returns 200 **before** any queueing side effect is observable to the caller —
      ~~measured p99 well under 500 ms, cold start included, against the deployed URL.~~
      **Amended 2026-10-16 (orchestrator, D-346):** the handler's own `Duration` (REPORT line) is
      under 500 ms on every invocation, including the first in a fresh environment; the
      client-measured cold call is under 1 s, keeping at least 1 s of margin to Strava's 2 s; the warm
      client-measured p99 is under 500 ms. *Why:* a client-measured cold call cannot go below the
      sandbox-plus-init floor (~0.6–0.7 s even with no AWS call at all) at 128 MB without provisioned
      concurrency. — verified 2026-10-16: cold handler Duration 105–137 ms with a known owner and
      22–28 ms with an unknown one; cold client 0.62–0.90 s; warm client p50 0.17 s, max 0.21 s
      (n=20), after `7773a93`.
- [x] A cold invocation completes inside 2 s, measured 10 times after forced cold starts.
      — verified 2026-10-16: 10 forced cold starts after `7773a93` (7 known owner, 3 unknown),
      0.62–0.90 s client-side. Before the fix, a cold known-owner call measured 1.56–1.59 s.
      *(Post-deploy, same reason; forced cold start = an environment-variable bump between calls.)*
- [x] The bundle contains no AWS SDK v2, no `h3`, and no ORM; bundle size is asserted in CI under a
      fixed ceiling.
- [x] Its IAM role grants exactly two things: conditional write on the `IngestReceipt` table and
      `sqs:SendMessage` on `ActivityIngestQueue`. A policy assertion proves no grant on
      `LostSolesSourceAccount`.
- [x] A valid `create` event for a known subscription enqueues exactly one SQS message and returns
      200 with an empty body. *(Proven in the unit suite through the real adapter; the live
      repeat against the deployed URL is in the smoke test.)*
- [x] CloudWatch logs at INFO contain `ingestKey` and `aspect_type` and contain no request body, no
      coordinates, and no `owner_id`. *(The log lines are asserted in the unit suite; reading the
      real CloudWatch line is in the smoke test.)*
- [x] The Function URL is reachable over HTTPS with a valid full certificate chain at the fixed
      callback path. *(Amended per Q2: the fixed path is `<Function URL>api/webhooks/strava`.
      Post-deploy: `curl` verifies the chain by default.)* — verified 2026-10-16: `200`,
      `ssl_verify_result=0` at `<Function URL>api/webhooks/strava`.

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

> **D-181 — most of what follows is the AGENT's to run, not the operator's.**
> Swept 2026-09-02 (ticket `0147`). This ticket's capability has no screen of its own. Before asking
> the operator for any step below, check whether AWS credentials (`AWS_PROFILE=devault`), `curl`, or
> a script can answer it — if so it is a **smoke test**, and what it proved is recorded here at
> close *instead of* the instruction. Keep only what genuinely needs a human eye, a phone, or a real
> run. The text below is the original author's intent, kept as context for **what** to verify — not
> as a list of chores for the operator.

Deploy, then on the desktop `curl -i` the Function URL with a well-formed POST body and confirm a 200
with an empty body in well under a second. Run it again after leaving the function idle for an hour —
that is the cold path and it is the one that matters.

Then the real one, after the next ordinary run recorded on the phone/watch (D-229 — never run for
this): do not press Sync; open the app in the desktop browser some minutes later and confirm the run is
there. Check CloudWatch for the invocation and read the log line: it must tell you what happened and
must not contain a single coordinate.

## Resolution

**What shipped.** A source-agnostic public webhook Lambda, `ingest-webhook` (128 MB, 3 s, no VPC),
behind a Function URL with `authType: NONE`. It takes `POST /api/webhooks/<source>`, resolves
`<source>` through a new webhook allowlist in `registry.ts`, hands the raw bytes to that adapter's
`accept()`, and for each `ingest` command it runs the **existing** `acceptIngest` gate. If the gate
accepts, it sends one SQS message, in the same JSON shape the Sync action sends. It answers 200
with an empty body. The Strava `accept()` (formerly a stub that threw) is now built.

**Files touched**
- `amplify/functions/ingest-webhook/resource.ts`: new. `defineFunction` with 128 MB, 3 s, no secret yet (the verify token is for 0092's GET).
- `amplify/functions/ingest-webhook/handler.ts`: new. Builds the `InboundRequest`, then accept → receipt → send. Strips the principal header. Logs one generic line.
- `amplify/functions/ingest-webhook/handler.test.ts`: new. End to end through the real adapter. Covers routing, drops, duplicates, a 500 on send failure, the log contents, the no-route test (criterion 2) and the esbuild bundle ceiling (criterion 6: 700 KB, measured ~575 KB, nearly all SDK v3; no `aws-sdk` v2, `h3-js`, ORM or fog modules).
- `amplify/ingest-webhook-stack.test.ts`: new synth test. Checks 128/3, no VPC, URL `NONE`, both public-invoke permissions, the output, no API Gateway in any stack, and exactly `dynamodb:PutItem` + `sqs:SendMessage` with nothing on SourceAccount or KMS.
- `amplify/backend.ts`: registers the function. Adds the Function URL (escape-hatch use 3 of 4, already counted, so the count stays four), two explicit-action grants, `INGEST_QUEUE_URL`, `custom.ingestWebhookUrl` and a `IngestWebhookUrl` CfnOutput. Additive and at the bottom of the file.
- `src/adapters/strava/accept.ts`: new. The event classifier. Moves `ingestKeyFor` here; `adapter.ts` re-exports it, so the sweep and the webhook share one formula.
- `src/adapters/strava/owner-map.ts` (+ test): new. Static `owner_id` → Cognito sub map, with no imports. It holds one row, read from the operator's SourceAccount row (`externalOwnerId`), and the test checks every sub against `OWNER_USER_IDS`.
- `src/adapters/strava/adapter.ts` (+ test): `accept` delegates to `accept.ts`. `hasGpsHint` is now optional, and when it is absent `fetchStreams` decides from the detail it already fetched (D-344). `listSince` yields `SweepJob`.
- `src/adapters/strava/json-ids.ts`: `parseWithExactIds` takes an optional id-key set, so the event's int64 `object_id` stays exact.
- `src/adapters/registry.ts`: adds `WEBHOOK_ADAPTERS` and `getWebhookAdapter`. `manual` is deliberately absent, because its `accept` trusts a principal header.
- `src/adapters/types.ts`, `adapter-interface.types.test.ts`: `IngestJob.startedAt` is now optional. New `SweepJob` type, which `listSince` returns. Type assertions added; the exact key set is unchanged (D-343).
- `src/adapters/manual/adapter.ts`, `src/adapters/__fixtures__/gpx-adapter.ts`, `src/adapters/normalize-purity.test.ts`, `lib/sources/backfill.test.ts`: retyped to `SweepJob`.
- `docs/contracts/ingestion-contract.md` §3: amended for D-343. `docs/03-integrations.md` §2.3: the stale `lostsoles.devaultsecurity.com` callback line now says the Function URL, with the reason.

**Decisions**
- **Q1 = A (operator).** A static owner map, so the webhook fills `userId` and `activityId` honestly with no SourceAccount grant. An unknown athlete gets a 200 and is dropped, logged as `unknown-owner`. A `create` mints the sweep's key, so the webhook and the sweep collide on one receipt.
- **D-343.** Push jobs omit `startedAt`, so `IngestJob.startedAt` is optional. `listSince` returns `SweepJob`, where it is required, which keeps D-208's guarantee as a type.
- **D-344.** A webhook job has no `hasGpsHint`, and absent means unknown, not false. Reading it as false would archive every webhook run without its trace. The detail decides, by the same `hasGps` rule; if the detail cannot be read, the streams are fetched.
- **D-345.** The function is `ingest-webhook`, not the design's `strava-webhook`. It routes on its own path segment through `getWebhookAdapter`, so no vendor name appears in `amplify/` (D-100) and deleting the adapter still breaks only `registry.ts` (D-121.1). D-194 applied this rule to routes; this applies it to a function.
- **Q2 = A (operator).** The callback is the raw Function URL plus `api/webhooks/strava`.
- **Q3 (operator).** The `subscription_id` check is left to 0093.
- **The gap between accept and send.** If the send fails, the handler returns 500 and Strava retries. The retry is a `duplicate`, so the activity sits as `QUEUED`/`attempts: 0` until the next sweep re-enqueues it (`sync.ts` `needsEnqueue`). Re-checking in the webhook would need `GetItem`, a third grant that criterion 7 refuses.
- **Out of scope here.** `update`/`delete` aspects and `athlete` events get a 200 and are dropped. GET returns 405 until 0092. Reserved concurrency, the size cap and unknown-field rejection belong to 0093.

**Gate run in the worktree.** All amplify.yml guards (including `check-boundaries` and
`check-adapter-deletion`), typecheck, lint, the full vitest suite (219 files, 3725 passed) and
`npm run build` are green.

**Follow-up: the cold path (after the job 408 smoke test).**
Measured live before this change:
- Init was 290–310 ms.
- An unknown-owner cold start then spent ~180 ms in the handler with no AWS call at all.
- A known-owner cold start (receipt duplicate) spent 976–1,106 ms in the handler, about 1.56 s client-side.
- Every cold `create` would also pay for a first SQS call, which no test event exercised.

The cost is per-client first-request CPU: client construction, endpoint-ruleset evaluation, the
middleware stack, signing and the TLS handshake. At 128 MB the invocation gets ~7 % of a vCPU.
Init is evidently not throttled the same way: the 700 KB bundle imports in ~800 ms locally under a
7 % cgroup quota, yet Lambda reports Init ≈ 300 ms for it.

Fix, in `amplify/functions/ingest-webhook/handler.ts`, with no new grants, no configuration change
and no provisioned concurrency:
- Both clients are constructed at module scope, inside Lambda only.
- A top-level-await `warmUp` sends one request through each client during init, and neither can have an effect:
  - `PutItem` on `warmup#never-exists`, conditional on `attribute_exists(ingestKey)`. It never writes, so the key never exists.
  - `SendMessage` with an empty body. SQS refuses it, so nothing is enqueued.
- The warm-up is bounded at 1 s and cannot throw. It logs `webhook-warmup` with the two error names it expects, and logs `WROTE-UNEXPECTEDLY` / `SENT-UNEXPECTEDLY` if either request ever succeeds.
- Tests pin both request shapes, the bound, and that nothing runs outside Lambda.

Local reproduction, with init unthrottled and the invoke under `CPUQuota=7%`: first DynamoDB call
plus first SQS call fell from ~570 ms to ~87 ms, of which ~80 ms is home→us-east-1 round trips. The
deployed numbers are the orchestrator's to measure.

**Result, 2026-10-16 (orchestrator, deployed stack; Amplify jobs 408 and 409):**

- **Shape.** 128 MB, 3 s, no VPC. Routing: unknown source `404`, root `404`, `GET` on the
  callback `405`. `/api/webhooks/manual` is refused (D-345).
- **Receipt gate, live.** A known owner with real activity `20576149694` gave `200` and an empty
  body. The log shows `decision: enqueue`, outcome `duplicate`, and the queue stayed at 0/0, so
  no second message reached the queue for an activity the sweep already holds.
- **Logs.** `webhook-event`, `webhook-ack` and `webhook-warmup` lines only. No `owner_id`, no
  athlete id and no body in 30 minutes of logs.
- **Cold path.** The first deploy measured a cold known-owner call at 1.56–1.59 s, and a real
  `create` (both clients) would have been worse. The init warm-up (`7773a93`, D-346) brought it to
  0.71–0.90 s. The warm-up line read `ConditionalCheckFailedException` / `MissingParameter` on
  every cold start, with no unexpected write or send, and the DLQ stayed at 0.
- **Not yet exercised:** a real run arriving without a Sync press. That needs the subscription,
  which is ticket `0092`, and the next real run will exercise it in ordinary use (D-229).
