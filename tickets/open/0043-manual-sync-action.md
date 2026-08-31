---
id: 43
slug: manual-sync-action
title: Manual Sync action — listSince, then enqueue
type: feature
priority: high
status: open
size: m
capability: 06-ingest-pipeline
depends_on: [34, 42]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
---

## Description

A server action, reachable from one button in the app shell, that calls the adapter's
`listSince(since)` and enqueues an `IngestJob` per activity it finds. This is the entire ingest
trigger at the first-usable milestone: no webhook, no subscription management, no `hub.challenge`.

This is a **deliberate, scheduled violation of D-013** (`09-roadmap.md` §4.5). There is one thing
to do after a run, it is one tap, and it is paid off by capability `14`. Recorded here so it reads
as debt with a named payoff, not as drift. If the gap between this milestone and `14` grows past a
few weeks, `14` gets promoted ahead of `15`–`17`.

`listSince` is mandatory anyway (D-140) because the nightly reconcile needs it to cover silently
dropped webhooks, so building the manual path first costs nothing that would otherwise be skipped.

`since` comes from the user's last successful ingest watermark, with a generous overlap — the
receipt table makes over-enqueueing free (one conditional write and nothing else), whereas
under-enqueueing silently loses a run.

## Acceptance criteria

- [ ] A `syncNow()` server action calls `listSince(watermark)` and enqueues one `IngestJob` per
      returned activity.
- [ ] The action is authenticated; it acts on the signed-in user only and cannot be given another
      user id.
- [ ] Strava credentials never reach the client — the action reads `SourceAccount` server-side
      (`01-architecture.md` §7).
- [ ] The watermark advances only on successful enqueue, and overlaps the previous window by at
      least one hour.
- [ ] Pressing Sync twice in a row produces one `Activity` row, one raw object and one receipt per
      activity.
- [ ] The button shows a pending state and a plain result line ("3 activities queued" /
      "nothing new"). No styling work beyond the design tokens from 0016.
- [ ] Nothing is enqueued when the source account is disconnected; the action returns a
      "reconnect" result instead of failing.

## Notes

Deliberately ugly: no notification, no progress bar, no toast choreography. The post-run moment is
capability `12`. The map simply *is* revealed the next time you look at it (`09-roadmap.md` §2.3).

Rate-limit budget lives in the adapter (0038), not here. This action must not batch-fetch details;
it enqueues ids and lets `process-activity` do the fetching, so a large backfill spreads across
invocations instead of blowing the 2-second-ish action budget.

## Operator validation

1. Go for a real run and upload it to Strava as normal.
2. Open `soles.devaultsecurity.com` on your Android phone, sign in, tap **Sync**. The button shows
   a pending state and then a count.
3. Tap **Sync** again immediately. The count is zero and DynamoDB gains no rows.
4. Do this once on the phone over mobile data, not only on desktop wifi — the whole point is that
   this is the post-run gesture.
