---
id: 192
slug: nine-ingested-runs-produced-zero-exploredcells-the-receipts
title: Nine ingested runs produced zero ExploredCells — the receipts are DONE so a re-sync cannot re-score them
type: bug
priority: high
status: closed
size: m
capability: 07-fog-projection-and-cells
depends_on: []
blocked_by: []
source: agent
created: 2026-09-10T13:06:45Z
started: 2026-09-10T13:24:10Z
closed: 2026-09-10T15:08:50Z
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

- [x] The root cause is confirmed rather than assumed: check the receipt rows' write timestamps
      against `0049`/`0050`/`0051`'s close times, and confirm no code path other than the ordering
      explains `newCellCount=0` on a trace that yields cells offline.
      — receipts `acceptedAt` **2026-09-07T05:11Z**; the `ExploredCell` write entered
      `process-activity.ts` in commit `3bb1fcf`, **2026-09-08T04:37Z**. 23 hours apart, and the
      ticket-close times were the weaker evidence — the commit is the code that actually ran.
- [x] A replay path exists that can re-score an already-`DONE` activity, by explicit request. Whether
      that is a receipt reset plus re-enqueue, a `replay: true` flag on the job, or a small script is
      this ticket's call — but it is **named, tested and written down**, not typed once into a shell.
      — `command: "reingest"`, which `IngestCommandKind` has declared since `0026` and nothing read.
      `src/pipeline/replay.ts`, `ClaimOptions.replay`, `tools/replay/replay-activities.ts`.
- [x] Replay is idempotent under D-020: running it twice does not double-count XP, does not move
      `firstRunAt` later, and scores on `activity.startedAt` and never on `now()`. A test asserts it.
      — asserted in `process-activity.test.ts`, and then **observed in production**: the first
      replayed activity wrote its cells on attempt 1, and attempt 3 re-ran the whole pipeline and
      recorded `newCellCount: 0`. That is layer 4 doing its job on real data.
- [x] ~~The ten archived activities are replayed.~~ **Amended: NINE were.** `LostSolesExploredCell` is
      non-empty (103 rows), `manifest.json` exists, and `explored-r10.25.bin` is published.
      — the tenth (`15336494333`, a 2025-08-04 run archived 2026-09-06) **has no ingest receipt** —
      it predates the receipt gate. `recordDelivery` is conditional on the row existing, so a
      reingest for it is rejected having written nothing, and the tool reports it as `NO RECEIPT —
      skipped` rather than enqueueing it. Minting a receipt would forge the accept gate's own
      record, which is not a thing this ticket should do quietly. It is worth **13 more cells**
      (measured) and is filed as `0193`.
- [x] The cell count on the store matches what `traceToCells` produces offline for the same ten
      envelopes, to within the overlap between runs.
      — **exactly**, not approximately: the union of the nine replayed archives is **85 unique
      cells** offline and the published blob holds **85**, with **0 missing and 0 extra**. The
      ~231-before-dedupe figure in the description was right and the overlap is heavy — these are
      the same few routes run repeatedly.
- [x] `/api/fog` returns a blob for the account and `/?fog=mask,debug` shows a non-zero `instances`
      count in the HUD `0055` added.
      — the server half is proven agent-side against the real deployed objects, through the shipped
      `lib/fog/server.ts`: cold start → `plan: "full"`, gen 25, 85 cells, and the blob decodes to 85
      at res 10; already-current → `up-to-date` (the 304 path); one behind → `delta`. All three
      branches of `02` §6.4. The browser half is the operator's and is `0055`'s outstanding check.
- [x] XP is awarded for the replayed runs, or a note records why it deliberately is not — a replay
      that reveals ground without awarding XP is a defensible choice, but it must be a choice.
      — **it deliberately is not, because there is no XP engine yet.** Capability `09` is entirely
      open (`0060`–`0064`); `xpAwarded` has always been 0 on every receipt for that reason, which is
      why it was *not* evidence of the bug. This has a real consequence worth stating: these runs are
      now `DONE` again, so when `09` lands they will need re-scoring — which is exactly what the
      replay path built here is for, and why it is a tool rather than a one-off script.

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

## Resolution

**The map has territory for the first time.** 85 res-10 cells, generation 25, published and readable
through the shipped server path. Nine of ten archived runs replayed; the tenth is `0193`.

### The root cause, confirmed rather than assumed

Receipts were written **2026-09-07T05:11Z**. The `ExploredCell` write entered `process-activity.ts`
in commit `3bb1fcf`, **2026-09-08T04:37Z**. The runs were processed 23 hours before the code that
reveals ground existed, completed successfully, and wrote `DONE` receipts — after which
`claimForScoring` returns `already-done` and no re-sync ever revisits them.

`xpAwarded: 0` on every receipt was **not** part of the evidence: capability `09` does not exist, so
that field has always been 0. Reading it as a symptom would have sent this ticket after the wrong bug.

The data and the domain code were both checked before any of this was built, by running the shipped
`normalizeStrava` and `traceToCells` over the archived envelopes: 10/10 normalize, full `latlng`
streams (4,036 points on the largest), 9–78 cells each, rejects `duplicate` only.

### `reingest` — the verb was already in the contract

`IngestCommandKind` has declared `"ingest" | "reingest"` since `0026` and `process-activity.ts` never
read `job.command`. This implements it rather than inventing a mechanism.

| | |
|---|---|
| `src/pipeline/replay.ts` | `fetchRaw`, pointed at the S3 archive. A decorator replacing the byte source and **nothing else**. |
| `ClaimOptions.replay` | lets a `DONE` receipt be re-claimed. Only reachable from `command: "reingest"`. |
| `tools/replay/replay-activities.ts` | the operator tool. Dry run by default. |

**Why the archive and not a re-fetch — the one real decision here.** A source can return different
bytes for the same activity: a new privacy zone, a re-uploaded FIT, an edited segment. Ground revealed
from bytes the original ingest never saw is **permanent** on a map that never re-fogs. The archive
exists for exactly this, and the contract already calls `normalize` *"the function that outlives the
client code to replay the S3 archive"*. It also means replay works with a revoked token or an activity
deleted upstream — which is when someone most wants their map back.

**Idempotence is layer 4, not the receipt.** `ingest-receipt.ts` already says it: *"`delta = newCells
\ explored` is empty on a replay, so a re-run awards nothing even if layers 1–3 all failed"* — the
same sentence that makes the 90-day receipt TTL safe. This flag is the path the TTL already takes
every quarter, on request. **And it was observed, not just asserted**: the first activity wrote its
cells on attempt 1, failed downstream, and attempt 3 re-ran the entire pipeline and recorded
`newCellCount: 0`.

### A second bug, found by the first replay, and it was never about replay

The first replay wrote 12 cells and then failed at `phase: "blobs"` with `errorClass: "AccessDenied"`
on `s3:ListBucket` — from a code path that does not list anything. The tell:

> **S3 answers `GetObject` on an ABSENT key with `403` rather than `404` when the caller has no
> `s3:ListBucket` on the bucket** — deliberately, so a probe cannot learn whether an object exists.

`explored-blob-store.ts`'s `getBytes` catches `NoSuchKey` and returns `undefined`; that **is** how
*"there is no previous generation"* is expressed. It received an `AccessDenied` it could not recognise
and threw.

**This would have hit the operator's first real run instead**, and looked like a permissions problem
with the delivery layer rather than a 404 that never arrived. It fires only when the object is
genuinely absent, which is only true on the *first* publish — so no test, review or ordinary deploy
could have surfaced it. It took an account with cells and no manifest, a state that had never existed.
Fixed by extending the `s3:prefix` condition to `users/*`.

### What went wrong while doing it

- **`check-boundaries.mjs` failed Amplify job 172**: `src/pipeline/replay.test.ts` used `"strava"` as
  its source id, which D-100 forbids anywhere outside the adapter. The guard was right. **I had run
  it locally and misread it** — its failure output ends with the D-121.1 rationale paragraph, so
  `... | tail -1` prints a confident-looking sentence on both paths. That is ticket `0190`'s finding
  almost verbatim, and I had quoted `0190` in a commit message an hour earlier. Every check afterwards
  was re-run **by exit code**, with `public/maplibre` moved aside.
- **The tool's first draft was muddled** — dead code, a half-thought receipt lookup, unused variables.
  Deleted and rewritten once the actual linking problem (archived object → receipt row, via
  `computeActivityId`) was clear. It is TypeScript under `tools/` rather than `scripts/*.mjs`
  precisely so it can use that derivation instead of restating I-5's hash.
- **Two 15-minute waits** that looked like failures and were not: a failed delivery leaves the receipt
  `PROCESSING`, and `claimForScoring`'s stale window is the Lambda timeout, so redelivery inside that
  window correctly refuses to claim. The retry that eventually succeeded was attempt 3.

### Verification

- **Exact, not approximate**: the union of the nine replayed archives is **85 unique cells** computed
  offline from the archived bytes; the published blob holds **85**, with **0 missing and 0 extra**.
- **The real server path**, through the shipped `lib/fog/server.ts` against the deployed objects:
  cold start → `plan: "full"`, gen 25, 85 cells, blob decodes to 85 at res 10 · already current →
  `up-to-date` (the 304 path) · one behind → `delta`. All three branches of `02` §6.4.
- **The aggregate is real data**, which matters because it is `0058`'s `a_fraction` input: 1 res-6
  parent at 3.5%, 4 res-7, 12 res-8 from 2.0% to 26.5%.
- Queue drained, **DLQ empty**, all nine receipts `DONE`.

### Tickets filed

- **`0193`** — the tenth activity has archived bytes and no receipt, so it cannot be replayed. 13
  further cells. Needs a decision about whether a reconstructed receipt is a thing that may exist.

## Operator validation

**Agent-side, and deliberately so** (D-181/D-229): every claim in this ticket is a machine's to
settle, and none of it required the operator to construct a scenario or go for a run. The input was
already in S3 under D-101, which is what that archive is for.

- **Root cause** — receipt `acceptedAt` 2026-09-07T05:11Z against commit `3bb1fcf` at
  2026-09-08T04:37Z.
- **Replay, through the real path** — nine `reingest` jobs through the deployed SQS queue and the
  deployed worker. Queue drained to `0/0`, DLQ `0`, nine receipts `DONE`.
- **The result is correct, not merely present** — 85 cells offline, 85 published, 0 missing, 0 extra.
- **The app can read it** — `resolveFogUpdate` returns `full` / `up-to-date` / `delta` correctly
  against the live bucket, and the blob decodes to 85 cells at res 10.
- **The whole CI set, by exit code**, with the generated `public/maplibre` moved aside: eight guard
  scripts, typecheck, lint, **1,758 tests** (35 new), `npm run build`. Amplify job **174** `SUCCEED`.

**Nothing here is routed to the operator.** What remains for them is `0055`'s perceptual check —
does the mask read as a continuous corridor over ground they recognise — which this ticket exists to
unblock and which was impossible before it.
