---
id: 103
slug: rebuild-drill-fold-replay-verify
title: Rebuild drill steps 4-8 — re-project cells, fold, replay XP, verify, cut over never
type: feature
priority: high
status: closed
size: m
capability: 16-rebuild-drill
depends_on: [102, 51, 67]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
started: 2026-10-21T03:32:09Z
closed: 2026-10-21T04:11:15Z
---

## Description

The order-dependent half of the §8.3 drill. Everything here writes into **new, empty tables via a
parallel CDK stack** — never into live tables, never truncating anything. Cutover happens by
pointing the app at the new stack, and only after step 8 passes. **Nothing destructive happens
until then.**

**Step 4 — persist facts and per-activity derivations.** In sorted order per activity: `PutItem`
the `Activity` row (T3); write `traces/<activityId>.polyline.gz`; sanitise the trace and project
to H3 res 10 (D-115) at the **current** `fogAlgoVersion`; write
`cells/<uid>/<activityId>.cells.bin`. **No XP and no `ExploredCell` writes yet.**

**Step 5 — the fold. This is the heart of the drill.** Walk activities in sorted order
maintaining `cellId → {firstRunAt, firstRunId, lastRunAt, lastRunId, visitCount, discoveryCount}`;
credit is `1.0` for an unseen cell, else `0.5` if `activity.startedAt - prev.lastRunAt >
SIX_MONTHS`, else `0.0` (D-022/D-120). Record per-activity `{newCellCount, rearmedCellCount,
cooledCellCount}` — step 6 consumes those, **not** T6. Bulk-write the map to T6 with `lastRunDay`
as u16 days since 2020-01-01 and derive the `AGG#{6,7,8}` items by counting children per parent.
**This fold reproduces every `ExploredCell` attribute exactly, from facts, in history order —
which is what makes that table honestly a cache.**

**Step 6 — replay XP** at the target `xpRulesVersion`, using the step-0 / precondition-4
`snapshots/skillstate/` snapshot as the **D-135 waterline** rather than a live `SkillState` read
(there is none — the tables are new). D-143 is the reason that snapshot exists: it is the one
derived fact that is not re-derivable, and without it a rebuild silently loses the monotonicity
waterline. Write `SkillState`, `Profile.totalXp`/`totalLevel`, and any `retained_floor` rows.

**Step 7 — regenerate the delivery layer.** Encode `explored-r10.bin`, `explored-agg.json` and
`explored-lastrun-r10.bin` from the step-5 map; PUT them; PUT `manifest.json` **last**. Set
`generation = <step-0 generation> + 1`, **never 1** — a generation that goes backwards leaves
every cached client convinced it is already up to date, and the fog is the one thing that must
never appear to regress.

**Step 8 — verify before cutting over. All six must pass:**

| # | Assertion | Failure means |
|---|---|---|
| 1 | `normalize()` failures == 0 | adapter regression or corrupt raw object |
| 2 | rebuilt activity count == raw object count − known `dedupeKey` collisions | lost or duplicated history |
| 3 | rebuilt `cellCount` == step-0 `cellCount` (== if `fogAlgoVersion` unchanged, ≥ if changed) | a cell was lost — **stop, do not cut over** (D-020) |
| 4 | every skill's rebuilt `displayedXp` ≥ the snapshot's | a D-135 violation; step 6's floors did not apply |
| 5 | `SUM(XpLedgerEntry.xpAwarded)` per skill == `SkillState.xpLedgerSum` | the §4.1 invariant is broken |
| 6 | a spot-check activity's XP itemisation matches its pre-drill values under the same rules version | a scoring regression |

**Step 9 — reconnect sources.** T7 is **not** rebuilt: OAuth tokens are not derivable and must not
be. Re-authorise each adapter, then set `listSinceWatermark` to the drill's start time **minus 7
days** so the mandatory reconciliation sweep picks up anything that landed during the rebuild.
Re-ingest of a rebuilt activity is a `dedupeKey` no-op. T8 is not rebuilt — an empty receipt table
is a correct starting state.

## Acceptance criteria

- [x] The drill targets a parallel stack: the script refuses to run against a table name that
      matches the live stack's, and this refusal has a test.
- [x] Step 5's fold is single-threaded per user and asserted deterministic: two runs over the same
      sorted input produce byte-identical T6 item sets including `visitCount` and
      `discoveryCount`.
- [x] Step 6 reads its waterline from the snapshot file, not from any `SkillState` read — asserted
      with the T2 client stubbed to throw.
- [x] A replay against a **lower** ruleset produces `retained_floor` rows and no visible decrease
      (D-135, §9.2 box).
- [x] Step 7 sets `generation = step0 + 1`; a test asserts a run that would emit `generation <=
      step0` aborts before any PUT, and that `manifest.json` is the last object written.
- [x] All six step-8 assertions are implemented as code that exits non-zero on failure, each with
      its own exit reason string; assertion 3 aborts the run rather than warning.
- [x] The script never calls `DeleteObject`, `DeleteItem`, or `DeleteTable` — asserted by a grep
      over the drill package that fails the build.
- [x] ~~Wall-clock for a full live-volume run is recorded in the summary; the §8.3 budget is under
      30 minutes including verification.~~ **Amended 2026-10-20 (operator decision, wave 16.2):
      moved to `0105`.** `0103` defines no CDK stack and creates no AWS resources, so there is no
      live-volume target to time here. The summary carries `wallClockMs` for the whole run (front
      half included); `0105` creates the parallel stack, runs the drill into it, and records that
      figure against the 30-minute budget. For scale only: the read-only rehearsal below (live front
      half, steps 4–8 into memory) took 7.2 s.

## Notes

Assertion 3 is the one that must never be softened into a warning. D-020 promises the map never
re-fogs; a rebuild that loses a cell and cuts over anyway is the only way in this system to break
that promise permanently, because after cutover the old table is what gets deleted.

The `fogAlgoVersion` bump path is this ticket's steps 4, 5 and 7 only — no `normalize()`, no XP
replay. Building the drill properly means that path is already built and already exercised.

- **2026-10-20, from `0102` (orchestrator, wave 16.1):** build on `runDrillFrontHalf()` in
  `src/pipeline/rebuild-drill.ts`, which returns `{summary, sorted: DrillEntry[], duplicatePointers}`.
  Step 0 writes **no** snapshot (D-399). An activity with several payloads emits only the newest, and
  step 8 check 2 reconciles against `payloadCount − supersededObjects − duplicate pointers` (D-396).
  **Open for this ticket:** D-263 duplicate losers are returned in `duplicatePointers` but are *not*
  removed from `sorted` — decide whether to drop them before step 4 or subtract them at step 8
  (there are none in the live bucket today). Verification target from the live run: generation
  269, cellCount 5,211, 116 activities.

## Operator validation

> **D-181 — most of what follows is the AGENT's to run, not the operator's.**
> Swept 2026-09-02 (ticket `0147`). This ticket's capability has no screen of its own. Before asking
> the operator for any step below, check whether AWS credentials (`AWS_PROFILE=devault`), `curl`, or
> a script can answer it — if so it is a **smoke test**, and what it proved is recorded here at
> close *instead of* the instruction. Keep only what genuinely needs a human eye, a phone, or a real
> run. The text below is the original author's intent, kept as context for **what** to verify — not
> as a list of chores for the operator.

From the laptop, run the full drill against the CI fixture into a scratch stack and read the
printed step-8 table: six rows, all PASS. Then deliberately corrupt one fixture cells file and
re-run — assertion 3 must fail and the run must stop before step 7 writes `manifest.json`. In the
desktop browser, open `/` during and after the run: the live map must be completely unaffected, and the fog
`generation` served to the app must be unchanged, because nothing was cut over.

**Done 2026-10-21, orchestrator, from the laptop. No perceptual check:** nothing is cut over, so
there is nothing on `/` to look at. The live generation is read directly instead.

- **Live-target refusal.** `npm run drill -- --phase=rebuild --uid=<owner> --target=<json>
  --dry-run` with the `activity` table set to `Activity-nog4xy2l7baqlhghpndh2565qe-NONE` exited 4,
  printing `REFUSED — TARGET_IS_LIVE … is a live table`. Run again with the live user-data bucket
  and an empty prefix, it exited 4: `… is the live bucket and no prefix separates the rebuild from it`.
- **Scratch target dry run.** It exited 0 with `--expect-objects=123`. The front half completed
  and nothing was written.
- **Live rehearsal.** The real front half ran against the live `raw/` archive, then steps 4–8 ran
  into an in-memory target; no AWS writes. Results: 118 payloads − 2 superseded − 0 duplicate
  pointers = 116 activities; 5,211 cells rebuilt against step 0's 5,211; generation 270, which is
  step 0's 269 + 1. All six step-8 checks passed: 0 normalize failures; 10 skills at or above the
  2026-10-18 snapshot; 363 ledger rows sum-matched over 6 skills; the spot check matched 5 rows of
  `d4e7ac35…`. Wall-clock was 6.9 s.
- **Corrupted cells file.** Not run by hand. Unit tests in `rebuild-drill-back.test.ts` cover it:
  "a cells file that lost a cell between write and fold", "3: a lost cell ABORTS — no T6, no XP,
  no manifest", and "manifest.json is the last object written". These are green in the full suite.
- **Live map unaffected.** After all of the above, `users/<owner>/manifest.json` still reads
  `generation 269`, `cellCount 5211`.

## Resolution

Steps 4–8 of §8.3, on top of `0102`'s `runDrillFrontHalf()`. The drill now runs end to end as
`npm run drill -- --phase=rebuild --uid=<sub> --target=<target.json>` into a parallel target whose
names the caller supplies. It creates nothing in AWS itself. `0105` creates the stack.

**Files**

- `src/pipeline/rebuild-drill-back.ts` (new). The orchestration and its pure parts:
  `targetCollisions` / `liveNamesFromOutputs` (criterion 1), `persistFacts` (step 4), `foldCells` +
  `t6Items` + `cellCountCheck` (step 5), `replayXp` (step 6), `assertGenerationAdvances` +
  `publishDelivery` (step 7), `verify` (step 8), and `runDrillBackHalf`. `DrillAbort` carries one of
  six abort reasons. `CHECK_REASONS` gives each step-8 check its own `ASSERT_<n>_…` string, and the
  exit code is `10 + n`.
- `src/pipeline/rebuild-drill-store.ts` (new). The DynamoDB/S3 `DrillStore`. Every create is
  conditioned on absence (`attribute_not_exists`, S3 `IfNoneMatch: "*"`), so a non-empty target
  refuses at its first colliding write. The prefix goes on every key. Step 8 reads back with
  `BatchGetItem` by key, strongly consistent.
- `src/pipeline/rebuild-drill-back.test.ts` (new, 33 tests). One or more per criterion, the
  wire shapes, and the corrupted-cells-file scenario faked.
- `src/pipeline/xp-replay.ts`. Lifted the step-3 fold/score and step-6 thaw out of `replayUser`
  into exported `foldHistory`, `scoreHistory`, `thawWrites` and `profileTotals`. `replayUser` calls
  them and behaves as before (its 67 tests are unchanged and pass). The drill scores with exactly
  the code a rebalance uses. A second copy of "the canonical score" is the failure §2.9 cannot
  survive.
- `src/pipeline/rebuild-drill.ts`. `FrontHalf.snapshot` is precondition 4's snapshot, parsed: the
  same bytes `saveSnapshot` writes, so the downloaded file is the waterline (D-399).
- `tools/drill/rebuild-drill.ts`. Adds `--phase=rebuild`, `--target`, `--rules` (defaults to the
  snapshot's version), `--spot-check` (defaults to the newest rebuilt activity that has live
  ledger rows; read-only `existingEntries`) and `--fog-algo-changed`. It refuses a live target
  before the front half runs (exit 4). It prints the step-8 table to stderr, and stdout includes
  `rebuild` and `wallClockMs`.
- `scripts/check-drill-no-delete.mjs` (new) and its `--self-test`, wired into `amplify.yml`'s build
  phase and `.github/workflows/gate.yml` (criterion 7). It scans `tools/drill/**` and
  `src/pipeline/rebuild-drill*` (code only, tests excluded) for any S3/DynamoDB removal command,
  `DeleteRequest`, or removal IAM action.
- `docs/02-data-model.md` §8.3. Step 4 now states that D-263 losers are dropped, the cells-file key
  and the read-back. Step 5 says `PutItem`, not `BatchWriteItem` (see the decisions below). Step 7
  covers the target's GEN counter, `deltasFrom`, and check 3 asserted at the end of step 5. Check 6
  can be `n/a`. `docs/INDEX.md` line ranges need regenerating (orchestrator).

**Decisions (recorded at merge as D-405–D-413; see DECISIONS.md for the mapping)**

- D-263 losers are dropped from `sorted` before step 4 (operator, 2026-10-20). Check 2 compares
  against `payloadCount − supersededObjects − duplicatePointerCount`.
- No CDK stack in `0103`. The target is a parameter, refused when it matches any live name
  (operator, 2026-10-20). Live names come from `amplify_outputs.json`: every `defineData` model
  under the live apiId, the five literal CDK tables, and the bucket. A target table carrying the
  live apiId is also refused. The live bucket is allowed only behind a prefix outside `raw/`,
  `users/` and `snapshots/`. Stored references (`traceRef`, `cellsRef`, manifest keys) stay
  canonical.
- T6 is written with one conditional `PutItem` per item, not `BatchWriteItem`. The I-7 gate
  (`check-fog-hot-path.mjs`) forbids `BatchWriteCommand` in any file that knows T6. The write
  units are the same, and the condition doubles as the "new, empty table" check.
- Step 5 folds the cells files read back from the target, not step 4's memory. A lost or damaged
  file surfaces before step 7: `CELLS_FILE_UNREADABLE`, or check 3 if a file decodes but lost a
  cell.
- Check 3 is asserted at the end of step 5. It aborts before T6, XP, the blobs and the manifest.
  It is never a warning.
- Step 7 sets the target's `GEN` counter to `step0 + 1` on `attribute_not_exists`. A counter
  already present aborts (`TARGET_GENERATION_TAKEN`) before any step-7 PUT. No delta is written,
  and `deltasFrom = generation`. The manifest is written uncompressed, as `regenerateExplored`
  writes it. Only the Profile `exploredGeneration` mirror follows it.
- Step 6's floor run key is `DRILL-G<generation>`, so its floor ids are deterministic and cannot
  meet a replay's.
- Check 6 is `n/a` (a pass) when the target rules version differs from the pre-drill rows'
  version. The criterion says "under the same rules version", and a changed ruleset is exactly
  the case where the itemisation should move.
- Step 7 also rebuilds `users/<uid>/traces/web.json.gz` in-process from the routes step 4 wrote
  (D-299/D-307: an absent web fails silently). It gives the same runs as
  `tools/trace-web/rebuild-trace-web.ts`.

**Not done here, on purpose:** the D-307 landmark backfill after step 6.
`tools/landmarks/backfill-landmarks.ts` targets the live tables, and pointing it at a target is a
separate change. Proposed as a ticket. Tombstones: `raw/` holds no record of a D-355 retraction, so
the drill rebuilds a retracted activity as `ACTIVE`. Its XP was kept in the total anyway, so the
numbers agree, but the activity would reappear in the list. Proposed as a ticket (none are live
today).

**Live rehearsal (read-only, this session).** The real front half ran against the live bucket for
uid `5488e4b8-…`, then steps 4–8 ran into an in-memory `DrillStore`. Nothing was written to AWS.
Results: 116 activities (118 payloads − 2 superseded − 0 duplicates), 112 routes, 110 cells
files, **cellCount 5,211 == step 0's 5,211**, 5,349 T6 items, generation **270** (step 0: 269),
rules v3. Check 6 matched all 5 rows of `d4e7ac35…` exactly. All six checks PASS, in 7.2 s. The
three floors the rebuild derived from the snapshot (cartography 13,342, constitution 31,
wayfaring 98) equal the live ledger's three floor rows exactly. Total XP is 70,994, which is the
live ledger's sum.
