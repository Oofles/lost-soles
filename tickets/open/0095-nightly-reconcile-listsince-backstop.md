---
id: 95
slug: nightly-reconcile-listsince-backstop
title: The reconciliation sweep — listSince backstop for silently dropped webhooks
type: feature
priority: high
status: open
size: m
capability: 14-webhook-and-automatic-sync
depends_on: [34, 42, 91]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
started: 2026-10-18T01:23:55Z
---

## Description

**Strava's delivery guarantees are weak and this ticket is why `listSince` is mandatory rather than
optional** (D-140, `03-integrations.md` §2.3):

- 200 within 2 s or the delivery is failed.
- Strava retries **up to three times total**, then drops the event **permanently and silently**.
- **No replay mechanism. No dead-letter queue on Strava's side.**

There is no API to ask "what did I miss". Therefore **webhooks are a latency optimisation, never the
ingestion path of record.** A run can vanish between Strava and this app with no error anywhere, and
the only thing that will ever notice is a sweep that asks Strava what exists and compares.

Two schedules on EventBridge, both calling the adapter's `listSince` (0034) — the same code path the
manual Sync uses, not a parallel one:

- **Every 6 hours:** `GET /athlete/activities?after=<watermark - 48h>&per_page=200`, page through,
  and enqueue an `ingest` for any id not already in the activity ledger. The **48-hour overlap
  absorbs clock skew and late edits.**
- **Nightly:** the same sweep with a **14-day window**, as a slower net.

Cost is 1–2 calls per sweep — negligible against the §2.5 budget, and the worker paces at ≤180 calls
per 15 minutes, leaving headroom for webhooks and interactive use.

Enqueueing goes through the **same `IngestReceipt` conditional write** (0093), so a sweep that finds
an activity the webhook already handled costs one conditional write and terminates. The sweep and the
webhook cannot double-award, by construction, and a sweep must be safe to run at any time for any
reason.

**Make the misses visible.** Per `08-security-privacy.md` §7-adjacent operational guidance, a
CloudWatch alarm fires when a sweep finds activities the webhooks missed more than occasionally.
Silent recovery is good; *invisible* recovery means a broken webhook can go unnoticed for months and
D-013 quietly stops being satisfied. Emit a metric per sweep: activities seen, activities enqueued,
activities already present.

The watermark advances only on a fully successful, fully paged sweep. A partial sweep leaves the
watermark where it was — re-scanning a window is free; skipping one loses a run.

## Acceptance criteria

- [x] A 6-hourly EventBridge rule runs the sweep with a `watermark - 48h` window and pages to
      exhaustion at `per_page=200`.
      *(The stored watermark already is `newest confirmed - 48h`, because `nextListSinceWatermark`
      subtracts the overlap on write, so the sweep lists from it unchanged. Paging is the adapter's.)*
- [x] A nightly rule runs the same sweep with a 14-day window.
      *(From `min(watermark, now - 14d)`, so a connection further behind is never narrowed.)*
- [x] Both call the adapter's `listSince` — a grep proves there is exactly one implementation and the
      sweep does not have its own Strava listing code.
- [x] An activity already in the ledger is not re-enqueued past the conditional write, and produces
      no duplicate `Activity` row, no duplicate raw object, and no XP change.
      *(Proven at the sweep: no message is sent, so no worker run follows. The worker's own score
      gate, D-209, is unchanged.)*
- [ ] An activity present at Strava but absent locally is enqueued and fully ingested.
      *(Amended: "enqueued" is proven by `reconcile-sweep.test.ts`. The job is the one the manual
      Sync sends, and the deployed worker already ingests that. "Fully ingested" needs the deploy:
      it is the first post-deploy smoke test.)*
- [x] The watermark advances only after a complete sweep; a sweep interrupted mid-paging leaves it
      unchanged, verified by a test that throws on page 2.
      *(The sweep's own rule. The manual Sync still advances on a partial listing, which was already
      safe. See Resolution.)*
- [x] Each sweep emits metrics for activities seen, enqueued and already-present.
- [x] A CloudWatch alarm fires when enqueued-by-sweep exceeds a small threshold in a day.
      *(Amended shape: the daily sum `> 0` on **2 of the last 3 days**. A threshold above 1 within one
      day could never fire at 3–5 runs a week. A threshold of 0 on one day would email on every single
      drop Strava makes, and absorbing those is what the sweep is for. See Resolution, D-351.)*
- [ ] **The drop-recovery drill passes:** disable the webhook for 24 hours, complete activities in
      that window, re-enable, and run the sweep — every missed activity is recovered with correct XP
      and correct territory, and nothing is double-counted.
      *(Not run: it needs the deploy. It is the post-deploy smoke test, with a receipt deleted to
      stand in for a dropped webhook. No real run is needed, D-229.)*
- [x] Rate-limit backoff (0038) is honoured; a sweep during a 429 backs off rather than burning the
      budget.
      *(A 429 on the list call ends that connection's sweep. No further page is requested and the
      watermark holds. The handler returns rather than throws, so the scheduler does not retry. The
      next scheduled run, six hours later, is the back-off. The worker's own 429 delay, 0042, is
      unchanged.)*

## Notes

Depends on 0034 (`listSince`), 0042 (the queue it enqueues to) and 0091 (the webhook it backstops).

`listSince` was built early precisely because it is required either way: it powers the manual Sync
that the first-usable milestone runs on (roadmap §4.5) *and* it is this backstop. Building it first
cost nothing.

There is a second, quieter reason this sweep matters: **trace corrections are invisible**
(`03-integrations.md` §2.6 / §6). Strava emits no event for "the user fixed the GPS trace" or
"distance changed" — `updates` is populated only for title, type and privacy. The 14-day nightly
window is the only thing that will ever notice such a correction, which is a second independent
justification for the slower net.

This ticket, together with 0091–0094, is what makes the roadmap's §4.5 debt payable: after it,
`06`/5's Sync button is a convenience rather than the ingestion path, and D-013 is satisfied for the
first time.

## Operator validation

> **D-181 — most of what follows is the AGENT's to run, not the operator's.**
> Swept 2026-09-02 (ticket `0147`). This ticket's capability has no screen of its own. Before asking
> the operator for any step below, check whether AWS credentials (`AWS_PROFILE=devault`), `curl`, or
> a script can answer it — if so it is a **smoke test**, and what it proved is recorded here at
> close *instead of* the instruction. Keep only what genuinely needs a human eye, a phone, or a real
> run. The text below is the original author's intent, kept as context for **what** to verify — not
> as a list of chores for the operator.

**The drill, performed for real.** Disable the webhook (delete the subscription, or point reserved
concurrency to 0 — record which you did). Go about a normal day: let the next ordinary run arrive (or send an imported/replayed or synthetic activity (manual adapter or through the queue, D-229)), log a workout.
Confirm in the desktop browser that nothing has appeared in the app — the map is unchanged and the
plinth still shows the older run. That absence is the failure mode this ticket exists for, and it is
worth seeing once with your own eyes so you know what a silent drop looks like.

Now re-enable and trigger the sweep manually from the console. Within a minute or two the missed run
must appear on the map with the correct new territory, and the tally on `/run/:id` must show the same
XP it would have shown had it arrived live. Check `/skills` and confirm Total Level moved by the
right amount exactly once — not twice.

Then leave it alone for a week and check the sweep's metrics: enqueued-by-sweep should be at or near
zero on a healthy system. If it is routinely non-zero, the webhook is quietly broken and the alarm
threshold is doing its job.

## Resolution

**The sweep is the manual Sync on a clock.** Every connection goes through `syncSource`
(`lib/sources/sync.ts`). That is the same listing (the adapter's `listSince`), the same receipt gate
(`needsEnqueue` → `acceptIngest`), the same enqueue and the same watermark rule that the Sync button
and the 0177 backfill use. The new code covers only what a schedule needs: which users, which window,
and a metric. The webhook handler was not touched.

Files:
- `lib/sources/sync.ts`: `SyncDeps.window` (optional, absent for Sync) adds the sweep's two
  differences. `minLookbackSeconds` opens the listing at `min(watermark, now - lookback)`.
  `holdWatermarkOnListFailure` stops the watermark moving when the listing throws mid-page. The
  `failed` outcome also carries `alreadyKnown` now, for the metrics. Sync's behaviour is unchanged.
- `lib/sources/reconcile-sweep.ts` (new): `runReconcileSweep(mode, deps)`. It iterates
  `OWNER_USER_IDS` × `connectableSources()`, skips any connection that is not `ACTIVE`, calls
  `syncSource` with the window, totals seen, enqueued and already-present, and writes one EMF line per
  sweep. It never throws for one connection.
- `amplify/functions/reconcile-sweep/{resource,handler}.ts` (new): `defineFunction` with
  `schedule: "every 6h"`, 60 s, 256 MB, no VPC. The handler reads `{mode:"nightly"}` from its event.
- `amplify/backend.ts`: registers the function. At the bottom of the file it adds the grants, the
  nightly CDK `Schedule` (08:00 UTC, input `{mode:"nightly"}`) and the alarm. The escape-hatch count
  in the header goes from four to five, and the DLQ alarm's comments are updated.
  - Grants: T7 `GetItem`/`UpdateItem`, with no `Scan` because users come from the allowlist and every
    read is by key. The T7 CMK. The two OAuth SSM params, named. Receipt table
    `PutItem`/`GetItem`. `sqs:SendMessage` on the ingest queue. No `PutMetricData`.
- `docs/01-architecture.md` §4: "the only alarm this app needs" now says one of two. The
  `nightly-reconcile` bullet names the second alarm. The line count is unchanged, so `INDEX.md` is
  still current.
- Tests: `lib/sources/reconcile-sweep.test.ts` (new) covers the windows, paging to exhaustion, the
  receipt gate, the page-2 throw, a 429, the metrics, and the one-listing grep.
  `amplify/reconcile-sweep-stack.test.ts` (new) covers the two schedules and their payloads, no VPC,
  the IAM reach and the alarm. `lib/sources/sync.test.ts` gains two tests for the opt-in rule.
  `amplify/process-activity-stack.test.ts` now picks out the DLQ alarm by namespace, and asserts
  exactly two alarms where it asserted exactly one.

Decisions taken here, proposed for the register:
- **Hold the watermark on a dead listing, for the sweep only.** Criterion 6 asks for it.
  `syncSource`'s partial advance stays the Sync's default. It was already safe, because listing is
  oldest-first and the watermark marks completion. Changing it there would widen this ticket.
- **The alarm fires on 2 of 3 days, not on a count within one day.** At 3–5 runs a week, a dead
  webhook loses at most about one run a day, so "more than N in a day" with N ≥ 1 never fires. A
  single-day `> 0` would email on every drop Strava makes, and those drops are what the sweep exists
  to absorb (§8.6). "The daily sum is above 0 on 2 of the last 3 days" separates the two cases.
- **The nightly schedule is a CDK escape hatch.** Every `defineFunction` schedule targets the
  function with the same empty input, so the handler could not tell the runs apart. The other option
  was inferring the mode from the clock, which is fragile and invisible.
- **EMF metrics, dimensionless.** EMF needs no IAM and no client. With no dimensions, both modes feed
  the one series the alarm reads.

Known limit, not fixed here (see the report): the nightly 14-day window does **not** catch trace
corrections, which the Notes cite as a second justification. `needsEnqueue` skips any activity that
already has a receipt, so a corrected activity is listed and then counted as already present.
Catching corrections needs a different gate, such as comparing a list-response field against the
stored activity. That is a new ticket, not a widening of this one.
