---
id: 192
slug: nine-ingested-runs-produced-zero-exploredcells-the-receipts
title: Nine ingested runs produced zero ExploredCells — the receipts are DONE so a re-sync cannot re-score them
type: bug
priority: high
status: open
size: m
capability: 07-fog-projection-and-cells
depends_on: []
blocked_by: []
source: agent
created: 2026-09-10T13:06:45Z
---

## Description

**Found while validating `0055`.** The mask pass rendered nothing, and the reason was not the
renderer: `LostSolesExploredCell` is **empty**, there is no `manifest.json` and no
`explored-r10.*.bin` in S3, and the account therefore has no territory at all. `0055` is drawing an
empty set correctly.

**This blocks more than one map.** Nothing downstream of scoring has ever run against real data —
no XP, no Cartography feed, no % explored. Capability `08` also cannot pass its drift audit, because
D-229's USE step requires the capability to be *"exercised with real data through the real path and
looked at"*, and there is no real data to exercise it with.

### What is actually wrong

Ten activities were ingested on **2026-09-06/07**. The explored-cell writer and the blob publisher
landed with `0049`, `0050` and `0051`, all closed **2026-09-08** — *after*. So the pipeline that ran
over these runs had no cell-writing step, completed successfully, and wrote a `DONE` receipt.

Every receipt now reads `status=DONE, newCellCount=0, xpAwarded=0`. `process-activity.ts` claims for
scoring through `claimForScoring`, and a `DONE` receipt returns `outcome: "already-done"` — so
**re-syncing does nothing**. The activities are permanently marked as processed by a version of the
pipeline that could not do the work.

### The data is good and the domain code is correct

Both were checked rather than assumed, by running the shipped `normalizeStrava` and `traceToCells`
over the ten archived envelopes in S3:

| | |
|---|---|
| Archived envelopes | 10, `schemaVersion`/`source`/`detail`/`streams` |
| `streams.latlng` | full point streams, 4,036 points on the largest — D-121 honoured, no `summary_polyline` |
| `normalizeStrava` | 10/10 succeed, all `kind=run`, distances 1.0–8.6 km |
| `traceToCells` | **9–78 cells each, ~231 in total**; rejects are `duplicate` only, `accuracy=0`, `nonFinite=0` |

So the trace survives normalization, the sanitizer is not eating it, and the res-10 projection
produces cells. The break is entirely that these runs were scored before scoring existed and can no
longer be re-scored through the normal path.

### What this ticket has to decide, not just do

**Clearing a `DONE` receipt is not obviously safe and D-020 is the reason.** The map never re-fogs
and `firstRunAt` writes with `min` — so a replay that re-scores must be idempotent in the direction
that matters, and it must score on `activity.startedAt` rather than `now()`. `0050` already owns
same-run and out-of-order idempotency and `explored-generation.ts` already has `markReplayPending`,
so the machinery may largely exist; what does not exist is a way to *ask* for a replay.

Deleting the nine receipt rows and re-enqueueing is the cheap version and is probably right for a
one-off backfill of a single account. It should still be a deliberate, recorded decision rather than
an improvised `aws dynamodb delete-item` loop, because the same situation recurs every time the
scoring rules change (`09-roadmap.md`'s replay story) and an operator-facing replay path is a thing
this project will want anyway.

## Acceptance criteria

- [ ] The root cause is confirmed rather than assumed: check the receipt rows' write timestamps
      against `0049`/`0050`/`0051`'s close times, and confirm no code path other than the ordering
      explains `newCellCount=0` on a trace that yields cells offline.
- [ ] A replay path exists that can re-score an already-`DONE` activity, by explicit request. Whether
      that is a receipt reset plus re-enqueue, a `replay: true` flag on the job, or a small script is
      this ticket's call — but it is **named, tested and written down**, not typed once into a shell.
- [ ] Replay is idempotent under D-020: running it twice does not double-count XP, does not move
      `firstRunAt` later, and scores on `activity.startedAt` and never on `now()`. A test asserts it.
- [ ] The ten archived activities are replayed. `LostSolesExploredCell` is non-empty, `manifest.json`
      exists, and `explored-r10.<gen>.bin` is published.
- [ ] The cell count on the store matches what `traceToCells` produces offline for the same ten
      envelopes, to within the overlap between runs. (~231 cells before dedupe; the stored set is
      smaller because runs share ground, and that difference is worth reporting rather than glossing.)
- [ ] `/api/fog` returns a blob for the account and `/?fog=mask,debug` shows a non-zero `instances`
      count in the HUD `0055` added.
- [ ] XP is awarded for the replayed runs, or a note records why it deliberately is not — a replay
      that reveals ground without awarding XP is a defensible choice, but it must be a choice.

## Steps to reproduce

1. `aws dynamodb scan --table-name LostSolesExploredCell --select COUNT` → `0`.
2. `aws dynamodb scan --table-name LostSolesIngestReceipt` → nine rows, all
   `status=DONE, newCellCount=0, xpAwarded=0`.
3. `aws s3 ls s3://<user-data-bucket>/users/` → empty: no manifest, no blob.
4. `aws s3 ls s3://<user-data-bucket>/raw/<uid>/strava/ --recursive` → ten archived envelopes.
5. Run `normalizeStrava` + `traceToCells` over those envelopes offline → 9–78 cells each.
6. Open `/?fog=mask` signed in → nothing renders, because there is nothing to render.

## Expected vs actual

**Expected:** ten ingested runs leave ~150–200 unique res-10 cells in `LostSolesExploredCell`, a
published blob, and XP on the ledger.

**Actual:** zero cells, no blob, no XP, and nine receipts that report success — so the normal
re-sync path will never revisit them.

## Notes

- **Do the work against the archive, not against Strava.** `D-101`/`D-121` archived the raw
  envelopes immutably for exactly this, and re-fetching would burn rate limit to obtain bytes already
  in the bucket.
- **Do not ask the operator to go for a run** (D-229). The input for this ticket already exists in S3.
- The offline check above was run from the scratchpad and the downloaded envelopes were deleted
  afterwards; they carry the operator's real coordinates and must never enter the repo (D-199,
  `08-security-privacy.md` §7.2).
- The one-off nature is a trap worth naming: a script that fixes this account and is then deleted
  leaves the project with the same gap the next time scoring rules change. `09-roadmap.md`'s replay
  story is the wider version of this ticket.

## Operator validation

Nothing to construct and nothing to run. Once the replay has happened, on the **desktop browser**:
open `/?fog=mask,debug` and confirm the HUD shows a non-zero `instances` count and the mask draws a
corridor over ground you recognise as somewhere you have run. That is also `0055`'s outstanding
perceptual check, which this ticket unblocks.
