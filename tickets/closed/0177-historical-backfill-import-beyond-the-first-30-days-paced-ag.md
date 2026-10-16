---
id: 177
slug: historical-backfill-import-beyond-the-first-30-days-paced-ag
title: Historical backfill — import beyond the first 30 days, paced against the read budget
type: feature
priority: med
status: closed
size: m
capability: 14-webhook-and-automatic-sync
depends_on: []
blocked_by: []
source: agent
created: 2026-09-07T04:57:15Z
started: 2026-10-16T13:42:37Z
closed: 2026-10-16T15:34:24Z
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

- [x] A backfill can import activities older than `FIRST_SYNC_LOOKBACK_DAYS` without a manual
      press per window.
      *Amended (operator, 2026-10-16):* one hand-started CLI invocation
      (`tools/backfill/backfill.ts --confirm`) covers every window, sleeping between them. It is
      not a scheduled job. The operator chose this because one user runs it once.
- [x] It calls `budgetCheck` with `interactive: false` before each enqueue batch and stops when
      the window is exhausted, rather than discovering the limit by being refused.
      (`backfillPace` calls it before every enqueue, then sizes the batch from the list call's
      headers. See the Resolution.)
- [x] Progress is recorded somewhere that is NOT `listSinceWatermark`, and the two cannot be
      confused by a later reader.
      *Amended (operator, 2026-10-16):* progress is not stored at all. The cursor lives in the
      CLI's memory for one run, and the backfill neither reads nor writes `listSinceWatermark`.
      At ~115 activities a stored checkpoint buys nothing.
- [x] It resumes correctly after being interrupted: no activity is enqueued twice and none is
      skipped.
      *Amended (operator, 2026-10-16):* resume = re-run from the beginning. It is satisfied by
      idempotency: the receipt gate (`needsEnqueue`) turns every already-accepted activity into a
      free duplicate, and the drain before each listing means a message from the killed run is
      delivered before it is re-listed. Proven in `lib/sources/backfill.test.ts`.
- [x] A backfill running concurrently with a manual Sync does not corrupt either one's watermark.
      (The backfill has no watermark and never touches the Sync's. Their only shared state is the
      receipt table's conditional put, which lets exactly one of them enqueue a given activity.)
- [x] The operator can see that a backfill is in progress and roughly how far it has got.
      *Amended (operator, 2026-10-16):* the surface is the CLI's own output, one line per window
      giving the month reached, the counts and the read-budget headroom. There is no app UI;
      nothing touches the rail or `/settings`, and D-318 stands.

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
3. (orchestrator) *Amended (operator, 2026-10-16):* the import is run by the orchestrator, and the
   progress surface is the CLI's terminal output. Is each window's line enough to tell that it is
   working and how far it has got? No browser check.

## Resolution

**Shape (operator, 2026-10-16, through the orchestrator).** The backfill is a one-time CLI that the
orchestrator runs by hand under `AWS_PROFILE=devault`. There is no scheduled Lambda, no new queue,
no new AWS resource and no stored checkpoint. The account holds ~115 activities, which is ~230
worker reads and about three 15-minute windows, so ~45 minutes. The "~3,200 requests, eight hours"
in this ticket's Description, inherited from `0043`, was wrong. The comment on
`FIRST_SYNC_LOOKBACK_DAYS` is corrected.

**Files.**
- `lib/sources/backfill.ts` (new): `runBackfill`, `nextBackfillCursor`, `BACKFILL_ORIGIN`. A
  source-agnostic loop with injected seams, in the style of `sync.ts`. Each window waits for the
  queue to drain (`beginWindow`), lists from the in-memory cursor (oldest first), checks the pace
  before every enqueue, goes through `needsEnqueue` and then `enqueue`, and sleeps to the next window.
- `lib/sources/backfill.test.ts` (new): covers paced import across windows, same-second siblings,
  a 429 on the list call, refusal to pace blind, and resume after a failed enqueue and after a kill
  that came after the enqueues.
- `src/adapters/strava/rate-limit.ts`: `backfillPace`, `READS_PER_ENQUEUED_ACTIVITY`,
  `describeReadBudget`. Tests are in `rate-limit.test.ts`.
- `lib/sources/sync.ts`: `needsEnqueue` is exported, so the backfill shares the Sync's receipt
  gate, including its "accepted but never delivered" re-enqueue. The wrong estimate in the
  `FIRST_SYNC_LOOKBACK_DAYS` comment is corrected. `app/sync-action.ts` is not touched.
- `tools/backfill/backfill.ts` (new): the CLI. Without `--confirm` it reports the connection status
  and the queue depth and makes no provider call. With `--confirm` it runs the import, printing one
  line per window and then a summary. It wraps the Strava client's `fetch` to take the budget
  reading off each list response, and to tally 1° tiles of `start_latlng` for sizing a basemap
  follow-up. The tiles go to the terminal only.
- `docs/03-integrations.md` §2.5: an amendment note recording all of the above against the
  "checkpointed background job" text.

**Decisions.**
- **Pacing is sized from the headroom, not a fixed batch.** `budgetCheck` (`interactive: false`)
  runs first, then the allowance is `floor((0.9·limit − usage)/2) − enqueuedThisWindow`, taking the
  smaller of the 15-minute and daily buckets. The reason is timing: the worker spends its two reads
  per activity *after* the enqueue, so on its own the budget check would let a whole page onto the
  queue. This was about ten lines more than a fixed batch, and it adapts when a Sync or the webhook
  has already spent part of the window. A missing reading is a `fail`, not a proceed.
- **Oldest first.** Importing newest first would defer nearly every shared cell (D-221). Importing
  oldest first defers only the cells shared with the already-scored first-Sync month.
- **Resume = re-run.** The receipt gate is the checkpoint, and draining the queue before each
  listing closes the "killed between SendMessage and delivery" double-enqueue.
- **The XP replay is not here (operator).** The deferred credit is settled afterwards by
  `tools/xp-replay` (see the run order below).

**Run order (orchestrator, after deploy):**
1. `AWS_PROFILE=devault npx vite-node --config vitest.config.ts tools/backfill/backfill.ts -- --user <sub>`
   — status only. Expect `strava ACTIVE` and queue depth 0.
2. The same command with `--confirm`. Leave it running (about 45 minutes). It ends with
   `backfill complete`, the date range, this run's start → end instants and the tile summary.
3. Wait until the ingest queue and its DLQ are quiet, then run
   `AWS_PROFILE=devault npx vite-node --config vitest.config.ts tools/xp-replay/replay-xp.ts -- --user <sub> --to <N>`
   as a dry run. It prints each skill's `vN`. Re-run it with `--to <that N> --confirm`.

**For 0257.** Its reveal must play **after** the replay in step 3. The activities this backfill
imported are the T3 rows whose `ingestedAt` falls inside the run's start → end instants, which the
CLI prints at the end. A run recorded while the import was going could also be one of those rows,
so `startedAt` older than the first Sync's oldest import is the tighter filter. Nothing extra is
stored.

**Region.** The import takes every activity, wherever it is; cells are global. The basemap is a
Florida extract, so the tile summary at the end of the run is the input for a follow-up basemap
ticket. Nothing in this ticket handles regions.

**Result, 2026-10-16 (orchestrator, against the operator's real account, profile `devault`):**

1. **Budget.** Three windows, 15:10Z to 15:30Z. The 15-minute usage was 1/100 at the start of
   every window, and the day bucket read 1 → 46 → 91. 97 activities were queued and 20 already
   known, dating 2020-02-24 to 2026-08-05. The worker logged 97 `outcome: persisted`, with no
   refusals, and the queue and DLQ were 0/0 afterwards. The account spent about one read per
   activity, not the two the pacer reserves, so pacing was conservative by half.
2. **Resume.** A full re-run after completion: `+0 queued, 115 already known`, using 11 reads.
   T3 holds 116 rows and 116 distinct `externalId`s, so there are no duplicates. A kill
   mid-window takes the same path (the receipt gate plus the queue-drain wait), which the suite
   covers.
3. **Legibility.** Each window line names the window, the month reached, queued and known counts,
   both budget buckets and the next window. It was enough to follow the run without other
   tooling.
4. **Settling the credit.** The v3 → v3 XP replay ran afterwards (`REPLAY#…#0MVB4K8NXAXBD9N`):
   116 activities folded, 360 rows, T6 1,256 cells raised, generation 267, Total Level 100,
   70,994 XP. Two floor rows were written (Wayfaring 98, Constitution 31), where the fold priced
   ground slightly below its import-order scoring (D-142). `repair-t3` afterwards: 0 mismatches
   over 116 activities, 0 reveal-set mismatches. Landmark backfill: 0 place-bound crossings, since
   no skill has reached 50 yet.
5. **Regions** (1° tiles of activity starts): `30,-82` 107, `29,-82` 1, `26,-78` 1, `36,-94` 1,
   `34,-93` 1, `37,-86` 1. Four activities lie outside the Florida basemap: three in the
   Arkansas/Kentucky area and one in the Bahamas.
