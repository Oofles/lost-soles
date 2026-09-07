---
id: 177
slug: historical-backfill-import-beyond-the-first-30-days-paced-ag
title: Historical backfill — import beyond the first 30 days, paced against the read budget
type: feature
priority: med
status: open
size: m
capability: 14-webhook-and-automatic-sync
depends_on: []
blocked_by: []
source: agent
created: 2026-09-07T04:57:15Z
---

## Description

`0043` decided that a first Sync on a never-swept connection looks back **30 days**, and recorded
why in `FIRST_SYNC_LOOKBACK_DAYS`. The constraint is the provider's read budget, not taste: the
connected account has years of history, listing it costs one cheap call per page, but *enqueueing*
it costs two provider requests per activity in `process-activity` against a limit of 100 reads per
15 minutes (`03-integrations.md` §2.5). An unbounded first sweep is roughly 3,200 requests — about
eight hours of quota — and `0042`'s 429 handling would return each message to the queue with a
delay until its three receives ran out and it landed in the DLQ. It would look like a broken
import rather than a paced one.

So everything older than 30 days is currently **unreachable**, and on a map that by D-020 never
re-fogs that is years of ground the product exists to show.

This ticket is the paced version. It is not "raise the constant" — it is the three things a
long-running import needs that a button press does not:

- **Budget pacing.** `src/adapters/strava/rate-limit.ts`'s `budgetCheck` already exists and is
  built for exactly this: `interactive: false` holds back the last 10% of the window as the
  reserve a Sync press is allowed into. Nothing calls it yet. A backfill is the caller it was
  written for.
- **Resume.** A backfill spans hours and therefore many invocations. It needs its own progress
  marker — **not** `listSinceWatermark`, which `lib/sources/list-since-watermark.ts` is emphatic
  is a COMPLETION marker and not a progress marker. Reusing it would be the exact confusion that
  module's header warns about, and the cost is a permanently skipped run.
- **A surface.** "Importing 2019…" is the only thing that makes a multi-hour import
  distinguishable from a broken one, and there is nothing to show it on today.

## Acceptance criteria

- [ ] A backfill can import activities older than `FIRST_SYNC_LOOKBACK_DAYS` without a manual
      press per window.
- [ ] It calls `budgetCheck` with `interactive: false` before each enqueue batch and stops when
      the window is exhausted, rather than discovering the limit by being refused.
- [ ] Progress is recorded somewhere that is NOT `listSinceWatermark`, and the two cannot be
      confused by a later reader.
- [ ] It resumes correctly after being interrupted: no activity is enqueued twice and none is
      skipped.
- [ ] A backfill running concurrently with a manual Sync does not corrupt either one's watermark.
- [ ] The operator can see that a backfill is in progress and roughly how far it has got.

## Notes

Filed by ticket `0043`, 2026-09-07, at the point the 30-day boundary was chosen with the operator.
The boundary is a real decision and not a placeholder — a first Sync SHOULD be fast and bounded —
so this ticket is additive rather than a correction.

**Do not resolve this by raising `FIRST_SYNC_LOOKBACK_DAYS`.** That would move the same problem to
a bigger number and hit the same budget wall further out, with the failure appearing as DLQ
messages rather than as an error anyone can read.

The receipt table makes over-enqueueing free, so a backfill overlapping ground the manual Sync has
already covered costs one conditional write per activity and nothing else. That is what makes the
"resume" criterion cheap to satisfy safely.

## Operator validation

> Most of this is the agent's to run — AWS credentials, `curl` and CloudWatch answer everything
> except the last item. The one genuinely human question is whether a multi-hour import is
> legible while it is happening, which is a judgement about the screen and not a status code.

1. (agent) Run a backfill over a window known to contain activities and confirm the read budget is
   never exhausted — the rate-limit headers, sampled across the run, never reach the limit.
2. (agent) Kill it mid-run and restart. No duplicate `Activity` rows, no gap in the imported set.
3. (operator) Watch it run on the phone. Is it obvious that something is happening, and roughly
   how far along it is? A progress surface nobody can interpret is the failure this asks about.
