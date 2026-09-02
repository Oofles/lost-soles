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

- [ ] A 6-hourly EventBridge rule runs the sweep with a `watermark - 48h` window and pages to
      exhaustion at `per_page=200`.
- [ ] A nightly rule runs the same sweep with a 14-day window.
- [ ] Both call the adapter's `listSince` — a grep proves there is exactly one implementation and the
      sweep does not have its own Strava listing code.
- [ ] An activity already in the ledger is not re-enqueued past the conditional write, and produces
      no duplicate `Activity` row, no duplicate raw object, and no XP change.
- [ ] An activity present at Strava but absent locally is enqueued and fully ingested.
- [ ] The watermark advances only after a complete sweep; a sweep interrupted mid-paging leaves it
      unchanged, verified by a test that throws on page 2.
- [ ] Each sweep emits metrics for activities seen, enqueued and already-present.
- [ ] A CloudWatch alarm fires when enqueued-by-sweep exceeds a small threshold in a day.
- [ ] **The drop-recovery drill passes:** disable the webhook for 24 hours, complete activities in
      that window, re-enable, and run the sweep — every missed activity is recovered with correct XP
      and correct territory, and nothing is double-counted.
- [ ] Rate-limit backoff (0038) is honoured; a sweep during a 429 backs off rather than burning the
      budget.

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
concurrency to 0 — record which you did). Go about a normal day: **go for a run**, log a workout.
Confirm on the Android phone that nothing has appeared in the app — the map is unchanged and the
plinth still shows the older run. That absence is the failure mode this ticket exists for, and it is
worth seeing once with your own eyes so you know what a silent drop looks like.

Now re-enable and trigger the sweep manually from the console. Within a minute or two the missed run
must appear on the map with the correct new territory, and the tally on `/run/:id` must show the same
XP it would have shown had it arrived live. Check `/skills` and confirm Total Level moved by the
right amount exactly once — not twice.

Then leave it alone for a week and check the sweep's metrics: enqueued-by-sweep should be at or near
zero on a healthy system. If it is routinely non-zero, the webhook is quietly broken and the alarm
threshold is doing its job.
