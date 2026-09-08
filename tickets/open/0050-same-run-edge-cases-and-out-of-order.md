---
id: 50
slug: same-run-edge-cases-and-out-of-order
title: Same-run edge cases, out-of-order and backfilled activities, score-time idempotency
type: feature
priority: high
status: open
size: m
capability: 07-fog-projection-and-cells
depends_on: [40, 48]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
started: 2026-09-08T14:42:09Z
---

## Description

The three families of correctness case in `05-fog-of-war.md` §3.3–3.5, made explicit as tests and
as the score-time idempotency gate.

**Same-run cases (§3.3)** are all solved by `traceToCells` returning a `Set` (0045), but each needs
a named test so nobody optimises the `Set` away:

- A cell crossed twice in one activity scores once; `visitCount` +1, not +2 (visits are per
  activity, not per traversal).
- An out-and-back scores exactly what its one-way version scores.
- A figure-eight's crossing cell is one cell.
- Two activities on the same day are *different* activities and score independently — the second
  finds `lastRunAt` a few hours old and scores zero. Correct per D-120; the cooldown does not care
  that it is the same day.
- A paused-and-resumed recording emitted as one trace is one activity. Segment splitting keeps its
  geometry honest but does not split the scoring.

**Out-of-order (§3.4).** The canonical score of a history is a deterministic fold over the user's
activities sorted ascending by `startedAt`, ties broken by `activityId`, single-threaded per user
(I-14). Normal case — the incoming `startedAt` is later than everything scored — scores
incrementally. Otherwise, **enqueue a replay** from that timestamp forward: re-fold the already-
stored activities in date order, rewrite affected cell records and ledger entries. Never on the
request path. Replay is bounded — five years is ~1,000 activities × ~110 cells ≈ 110k in-memory
operations, one invocation.

**Replay must never un-reveal a cell.** It rewrites `lastRunAt`, `firstRunAt` and `discoveryCount`;
it never deletes one. D-020 forbids it outright, and a replay over a superset of activities can
only produce a superset of cells anyway.

**Score-time idempotency (§3.5).** Two layers in one key:

```
key = source#externalId # sha256(canonicalJson({points, startedAt})).slice(0,16) # v<FOG_ALGO_VERSION>
```

Layer 1 catches webhook redelivery. Layer 2 catches the same source id now carrying *different*
geometry — the user cropped the activity or corrected its start time. Same id + same content → key
hits, nothing is written, the stored award is returned. Same id + different content is a
**revision**: look up the prior ledger entry by source id, un-award it (subtract XP, decrement
`visitCount`/`discoveryCount`, restore `lastRunAt`/`lastRunId` by replay), then score the new
version. **Do not remove cells** — ground that was revealed stays revealed even if the activity
that revealed it was edited to exclude it.

`store.appendCellsToRun(activityId, cells)` exists precisely so un-award is possible without
re-deriving geometry. `FOG_ALGO_VERSION` is in the key so a deliberate algorithm change invalidates
every key and forces a full auditable rescore rather than a silent mix of old and new scoring.

## Acceptance criteria

- [x] Named tests exist for all five same-run cases above, each asserting cell count, credit and
      `visitCount`. *`src/pipeline/same-run-cases.test.ts`, driven end to end through
      `traceToCells` → `classifyCells` → `writeCells` so the `Set` guarantee is asserted at its
      observable consequences rather than at the type.*
- [x] Score-time `ingestKey` is built exactly as specified, including `FOG_ALGO_VERSION`.
- [ ] Ledger `putLedgerEntry` is a conditional put on `attribute_not_exists`; a concurrent duplicate
      loses the race and returns the winner's award.
      **NOT DONE — BLOCKED, and handed on rather than faked.** T4 `XpLedgerEntry` is ticket
      `0062`, capability 09; there is no ledger to put into. The property it protects at the
      CELL level is covered — a concurrent duplicate loses the score gate's conditional claim
      (`0044`) and every cell write is idempotent by construction — but the ledger row itself
      belongs to `0062`, whose own criteria already carry this. Filed as a note on `0062`
      rather than a new ticket, since it is that ticket's criterion 3 word for word.
- [x] Re-processing the same run changes **zero cells and zero timestamps** and writes nothing.
      *Asserted on a deep-cloned fake store, and again live: the T6 item came back byte-identical
      after a second pass.*
- [x] Editing a fixture's start time produces a key miss, ~~an un-award of the prior entry,~~ and a
      rescore — with the cell set unchanged in size (I-7).
      **Amended** — the un-award has two halves and only one exists. The XP half needs T4
      (`0062`/`0066`). The CELL half is the one D-020 turns on and it is done: a cropped
      revision was scored live and **every original cell was still present afterwards**. §3.5 is
      explicit that this is the half that matters: *"Do NOT remove cells — ground that was
      revealed stays revealed even if the activity that revealed it was edited to exclude it."*
- [x] An activity whose `startedAt` precedes an already-scored activity ~~enqueues a replay
      instead of scoring inline~~ **defers its undecidable cells, awards them zero, and marks
      the user for a fold**; a test asserts nothing was written on the request path.
      **Amended, operator-approved, recorded as D-221.** Two changes. (a) There is no queue to
      enqueue to — the consumer is `0103` (capability 16) and `0066` (capability 09) — so the
      obligation is recorded durably on the fog control item instead of sent to nothing.
      (b) *"nothing was written on the request path"* is inverted: the ground **is** written,
      which is the half `0048`'s throw was losing. Only the CREDIT is withheld, and the
      under-award is what makes deferring safe (D-135 permits only additions).
- [x] Replay folds ascending by `startedAt`, ties by `activityId`; the fixture replayed with its
      input list **shuffled** produces an identical ledger and identical cell attributes (I-14).
      *Three distinct shuffles, asserting the applied order, every cell attribute and every
      per-activity award. The "ledger" half is the awards map, which is what `02` §8.3 step 6
      consumes — and it consumes THOSE, explicitly not T6.*
- [x] Replay is idempotent: running it twice changes nothing the second time.
- [x] No code path anywhere calls `DeleteItem` on T6; a grep test enforces this.
      *`scripts/check-fog-hot-path.mjs` rule 2, on both CI surfaces (D-163). Scoped to files
      that name T6, because deletion is legitimate elsewhere and already shipping — `0051`
      expires deltas and `0066` step 2 clears non-floor ledger rows — and a blanket ban is a
      gate someone switches off. Test files are excluded: the test that asserts the IAM absence
      has to name the actions it forbids.*
- [x] `appendCellsToRun` is written on every scored activity and is ~~read by the un-award path~~
      **read by the fold**.
      **Amended** — the un-award path is `0066`'s. The consumer that exists is the fold, and it
      is the more important one: `02` §8.3 step 4 stores the projection so every later step
      folds the same FACTS rather than re-projecting traces under a `fogAlgoVersion` that has
      since moved. Proven live: three activities ingested, their cell records read back from S3,
      folded, and the result compared attribute-by-attribute against what T6 actually held.

## Notes

Replay can *lower* a previously displayed XP total (`05-fog-of-war.md` §9.3). That is D-135/D-142's
problem and is handled by the ledger's `retained_floor` mechanism in capability `09`; at this
milestone nothing displays XP, so the risk is deferred, not solved. Say so in the capability doc
rather than half-implementing a floor here.

Cell writes being idempotent by construction (min/max/set-insert) is what makes a partial retry
converge without a compensating transaction.

### What the ticket's author asked for (kept as context, answered in `## Operator validation` below)

> **D-181 — most of what follows is the AGENT's to run, not the operator's.**
> Swept 2026-09-02 (ticket `0147`). This ticket's capability has no screen of its own. Before asking
> the operator for any step below, check whether AWS credentials (`AWS_PROFILE=devault`), `curl`, or
> a script can answer it — if so it is a **smoke test**, and what it proved is recorded here at
> close *instead of* the instruction. Keep only what genuinely needs a human eye, a phone, or a real
> run. The text below is the original author's intent, kept as context for **what** to verify — not
> as a list of chores for the operator.

1. Sync, then immediately Sync again. Cell count and every cell timestamp are unchanged; CloudWatch
   shows the second job exiting at the score gate.
2. In Strava, crop one of your imported runs (shorten it by a kilometre) and Sync. The map must
   **not** lose the cropped-off territory — that ground stays revealed forever.
3. Manually import an old activity from a year ago. Confirm a replay job runs, and that no cell
   disappeared from the map afterwards.

## Resolution

The three families of §3.3–3.5 correctness case, made explicit — and one of them changed the
design rather than merely testing it.

### `0048`'s throw was the wrong end of the trade

§3.4 says a negative `at − lastRunAt` *"should assert/log rather than pass silently"*. `0048`
read that as **throw**, on this section's own reasoning that the replay queue should have caught
it first. Building the replay path is what showed the cost: the activity went to the DLQ, the
redrive failed identically every time, and **a historical backfill — the case §3.4 names first —
was unusable** until a consumer shipped. Which it has not.

So the cell becomes a fourth `Discovery` class, `"deferred"`. The activity completes, its cells
are written, its receipt reaches `DONE`, and only the CREDIT is withheld. **The under-award is
the safety property, not a placeholder**: D-135 permits only additions, so a later fold can raise
the number and never lower one the user has seen. Guessing "cooled" — the failure §3.4 warns
about — looks identical today and is permanent.

**And detection turned out to be free.** §3.4 defines out-of-order as *"the incoming `startedAt`
precedes an already-scored activity"*, which needs a per-user high-water mark nothing stores. It
is also stricter than the truth: incremental scoring and the canonical fold differ **only when
the late activity shares a cell with a later one** — which is exactly when that cell's
`lastRunAt` is ahead of it, which is exactly what the classifier's existing `BatchGetItem`
already returns. A run that predates others but crosses none of their ground scores identically
either way and is correctly not deferred; that case is asserted live. **D-221**, with `05` §3.4
and `02` T3/T6 amended.

### The fold is the definition, and it lives in the domain

`05` §3.4: *"the canonical score of a user's history is a deterministic fold over their
activities sorted ascending by `startedAt`."* Everything the ingest path does incrementally is an
optimisation of that function, valid only while activities arrive in order.

`src/domain/fold.ts` is that function, pure. Three properties, each a test:

- **Deterministic** — sorted by `startedAt`, ties by `activityId` (I-14). Three shuffles produce
  byte-identical cells, awards and applied order. The tie-break is not decoration: two activities
  starting in the same second would otherwise give `firstRunId` different answers on different
  runs.
- **Idempotent** — a pure function of a set, so there is no accumulator to double.
- **Monotone in cells** — a fold over a superset produces a superset. **That is D-020 as
  arithmetic**: a replay can rewrite `lastRunAt`, `firstRunAt` and `discoveryCount` and cannot
  un-reveal ground, because the fold only ever inserts.

It is deliberately not the replay *job*. `0103` (the drill's step 5) and `0066` (the XP half) both
need it and both need capabilities that do not exist; keeping the arithmetic here means they share
one definition of "correct" rather than writing a second. `02` §2.9's claim that T6 is *"honestly
a cache"* is only true because this function exists and is tested.

### The score-time key, and why there are two

The accept-time key (`sha256("<source>:<owner>:<object>:create")`) is computed before anything is
fetched — that is the point, it must fit inside the webhook's 2-second budget — and can only ask
*"have I seen this activity id?"*. The score-time key asks the question that one cannot:
*"…with this content?"*

`canonicalJson` sorts keys at every depth, because `JSON.stringify` preserves insertion order and
two normalizers emitting the same points in different key orders would make every re-import look
like a revision. Array order is kept: a trace reversed is a different trace.

### `appendCellsToRun`, and the reason that is larger than §3.5's

§3.5 gives one: *"so un-award is possible without re-deriving geometry."* The larger one is `02`
§8.3 step 4's — a replay that re-projected each trace would do it under **today's**
`fogAlgoVersion`, silently rewriting what history was. The object stores the projection, so every
later step folds the same facts. Same `LSFG` format as the published set, at `generation: 0` — a
sentinel, since `bumpGeneration` returns 1 on a user's first call and only increases, so a per-run
record can never be mistaken for a published one.

### Files

**New:** `src/domain/fold.ts` (+ 17 tests), `src/domain/score-key.ts` (+ 17),
`src/pipeline/same-run-cases.test.ts` (8).
**Modified:** `discovery.ts` — the `"deferred"` class, `CREDIT_DEFERRED`, `deferredCellCount`,
`needsReplay`, and `OutOfOrderScoringError` re-homed to the fold; `explored-generation.ts` —
`markReplayPending` and the `GenerationWriteDeps` split; `explored-blob-store.ts` —
`appendCellsToRun` / `readRunCells`; `process-activity.ts` — both new steps;
`persist.ts` — `deferredCellCount` and a real `cellsRef`; `check-fog-hot-path.mjs` — rule 2.

### Two things left undone, and they are handed on rather than faked

- **`putLedgerEntry` (criterion 3)** — T4 does not exist. It is `0062`'s criterion 3 verbatim.
- **The XP half of un-award (criterion 5)** — `0066`'s. The cell half, which is the one D-020
  turns on, is done and proven live: a cropped revision left **every original cell present**.

### One path correction

`02` §8.3 step 4 wrote the per-run record to `cells/<uid>/<activityId>.cells.bin` — a top-level
prefix no other per-user object uses, and outside the `users/<uid>/` prefix the worker's S3 grant
is scoped to. It would have needed a third grant for no reason. Corrected to
`users/<uid>/cells/<activityId>.bin`; `02` T3's `cellsRef` follows.

## Operator validation

**Nothing here needs the operator.** Everything was reachable with `AWS_PROFILE=devault` and was
run (D-181).

### Automated

- **1,513 tests, 76 files.** New: `fold.test.ts` (17), `score-key.test.ts` (17),
  `same-run-cases.test.ts` (8), plus 8 in `explored-generation.test.ts`, 7 in
  `explored-blob-store.test.ts`, 5 reworked in `discovery.test.ts` and 3 in
  `process-activity.test.ts`.
- `npm run typecheck`, `npm run lint` clean. All seven gate scripts pass, including
  `check-fog-hot-path.mjs`'s new I-7 rule (14/14 self-test).
- **`check-boundaries.mjs` caught a real slip while writing these** — a test in `src/domain`
  used a real source name as a fixture string. Fixed at the fixture, not the gate.

### Live smoke test — 7/7, real DynamoDB and real S3

Throwaway table and bucket, driving the **shipped** writers, both deleted afterwards.
`LostSolesExploredCell` confirmed still at 0 items.

| # | What it proved |
|---|---|
| 1 | A second identical pass returned the T6 item **byte-identical** — zero cells, zero timestamps, nothing written |
| 2 | A 2024 backfill over 2026 ground deferred every cell, awarded zero, wrote the ground, and left `lastRunAt` at 2026 while `firstRunAt` moved to 2024 |
| 3 | `replayFrom` landed on the control item, and a 2023 backfill moved it EARLIER |
| 4 | A later out-of-order mark was refused — the `min` holds |
| 5 | A run predating others but crossing none of their ground was **not** deferred (D-221's sharper rule, live) |
| 6 | Three activities' cell records read back from S3, folded, and compared attribute-by-attribute against T6 — `firstRunAt`, `lastRunAt`, `visitCount`, `discoveryCount` all equal |
| 7 | **A cropped revision left every original cell present.** I-7 and D-020, against the shipped writers |

### Carried forward

Unchanged from `0049`/`0051`. The three steps this ticket's author wrote are now smoke tests
above — sync-twice (1), the crop (7), and the year-old import (2, 3) — so what remains for a real
run is only what a human eye adds: that the map visibly does not change when a cropped activity
syncs.
