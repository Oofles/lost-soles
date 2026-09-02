---
id: 34
slug: strava-list-since
title: strava listSince(since) - the mandatory reconciliation sweep and the manual-sync producer
type: feature
priority: high
status: open
size: m
capability: 05-strava-adapter
depends_on: [33]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
---

## Description

`listSince(userId, watermark, creds): AsyncIterable<IngestJob>` — **mandatory, not optional**
(D-140, contract §3). It is the reconciliation sweep that covers **silently dropped webhooks**:
Strava retries a webhook three times, then drops it with **no DLQ and no replay**. Without
`listSince` there is no way to notice.

It is also the producer the **manual Sync** button runs on (roadmap §4.5). Building it before the
webhook costs nothing, because it is required either way, and it reaches the first-usable
milestone roughly one capability sooner.

Implementation:

- `GET /api/v3/athlete/activities?after=<epoch seconds>&per_page=200`, paged until a short page.
  200 per page is the maximum and the whole 8-year backfill is only ~8 list calls.
- Yield one `IngestJob` per activity as an **async iterable**, so the consumer can stop early and
  so a backfill never materialises 1,600 jobs in memory.
- **Parse ids as strings.** `activity.id` is an int64 and is **silently corrupted by
  `JSON.parse`** past 2^53 — no error, just a wrong number. Use a reviver or a bigint/string-mode
  parser so ids stay strings from the wire onward. `upload_id_str` is used where Strava provides
  it.
- Read the **list-endpoint GPS signal** before deciding anything downstream: `manual === true`, or
  an empty/absent `map.summary_polyline`, means "no GPS" and means 0035 must skip the stream call
  entirely. `summary_polyline` has exactly two legitimate uses — a cheap bounding-box prefilter
  and this has-GPS-at-all signal — and this is one of them. **Rendering it or projecting it to H3
  is not.**
- Advance `listSinceWatermark` on T7 **only after** the consumer confirms the page was fully
  enqueued, and advance it to the **oldest** unprocessed boundary rather than the newest seen, so
  a crash mid-page re-lists rather than skipping.
- Overlap the watermark by a margin (the nightly sweep covers 14 days per §2.7) so a
  clock-skewed or late-arriving activity is not stranded on the wrong side of the boundary.

## Acceptance criteria

- [ ] `listSince` is implemented on the Strava adapter and satisfies the `SourceAdapter` type from
      0026 without a cast.
- [ ] It returns an `AsyncIterable<IngestJob>` and pages with `per_page=200` until a short page.
- [ ] A consumer that breaks after the first item stops the iteration and issues no further HTTP
      calls.
- [ ] `activity.id` values above 2^53 survive as **exact strings** — a fixture with a large id
      asserts the emitted `externalId` matches the wire bytes character for character.
- [ ] A plain `JSON.parse` of the same fixture is shown, in the test, to produce a **different**
      value — so the reviver is demonstrably doing work.
- [ ] Each `IngestJob` carries a `hasGpsHint` derived from `manual` and `map.summary_polyline`,
      and 0035 consumes it.
- [ ] The polyline is used **only** as that hint and as a bbox prefilter — a grep asserts
      `summary_polyline` is never passed to any projection, decode or render path.
- [ ] `listSinceWatermark` advances only after successful enqueue and never skips an unprocessed
      activity; a test kills the iteration mid-page and asserts the next run re-lists it.
- [ ] The watermark carries a documented overlap margin, with the margin as a named constant.
- [ ] Re-running `listSince` over the same window twice yields the same job set (the jobs
      themselves are idempotent downstream via the deterministic `activityId`).
- [ ] Everything is under `src/adapters/strava/`; the 0027 T1 grep stays green.

## Notes

`listSince` is what makes the honest debt in roadmap §4.5 payable: between the first-usable
milestone and capability `14`, the app has upkeep (a Sync button) and **D-013 is not satisfied**.
That is a scheduled debt with a named payoff ticket, not a drift. If the gap between `08` and `14`
grows past a few weeks, `14` gets promoted ahead of `15`-`17`.

Rate-limit budget for this path (`03-integrations.md` §2.5): steady state is 4 reconciliation
sweeps/day at ~1 page each — 4 calls against a 1,000/day read quota. The list endpoint is
effectively free; the stream calls in 0035 are the entire cost. Backoff is 0038.

Backfill is a **checkpointed background job**, never a synchronous "connect your account" flow —
state `{ cursor, lastActivityId, completed, failedIds[] }` in DynamoDB, resumable after being
killed at any point. That job is out of scope here; this ticket must not make it harder to build.

## Operator validation

> **D-181 — most of what follows is the AGENT's to run, not the operator's.**
> Swept 2026-09-02 (ticket `0147`). This ticket's capability has no screen of its own. Before asking
> the operator for any step below, check whether AWS credentials (`AWS_PROFILE=devault`), `curl`, or
> a script can answer it — if so it is a **smoke test**, and what it proved is recorded here at
> close *instead of* the instruction. Keep only what genuinely needs a human eye, a phone, or a real
> run. The text below is the original author's intent, kept as context for **what** to verify — not
> as a list of chores for the operator.

None directly — `listSince` has no screen of its own; it is exercised through the Sync button in
capability `06`. Its behaviour is verified here by tests against checked-in fixtures. The operator
sees it at the milestone: pressing Sync and having a run that Strava's webhook would have dropped
still appear.
