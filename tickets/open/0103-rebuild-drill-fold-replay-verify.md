---
id: 103
slug: rebuild-drill-fold-replay-verify
title: Rebuild drill steps 4-8 — re-project cells, fold, replay XP, verify, cut over never
type: feature
priority: high
status: open
size: m
capability: 16-rebuild-drill
depends_on: [102, 51, 67]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
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

- [ ] The drill targets a parallel stack: the script refuses to run against a table name that
      matches the live stack's, and this refusal has a test.
- [ ] Step 5's fold is single-threaded per user and asserted deterministic: two runs over the same
      sorted input produce byte-identical T6 item sets including `visitCount` and
      `discoveryCount`.
- [ ] Step 6 reads its waterline from the snapshot file, not from any `SkillState` read — asserted
      with the T2 client stubbed to throw.
- [ ] A replay against a **lower** ruleset produces `retained_floor` rows and no visible decrease
      (D-135, §9.2 box).
- [ ] Step 7 sets `generation = step0 + 1`; a test asserts a run that would emit `generation <=
      step0` aborts before any PUT, and that `manifest.json` is the last object written.
- [ ] All six step-8 assertions are implemented as code that exits non-zero on failure, each with
      its own exit reason string; assertion 3 aborts the run rather than warning.
- [ ] The script never calls `DeleteObject`, `DeleteItem`, or `DeleteTable` — asserted by a grep
      over the drill package that fails the build.
- [ ] Wall-clock for a full live-volume run is recorded in the summary; the §8.3 budget is under
      30 minutes including verification.

## Notes

Assertion 3 is the one that must never be softened into a warning. D-020 promises the map never
re-fogs; a rebuild that loses a cell and cuts over anyway is the only way in this system to break
that promise permanently, because after cutover the old table is what gets deleted.

The `fogAlgoVersion` bump path is this ticket's steps 4, 5 and 7 only — no `normalize()`, no XP
replay. Building the drill properly means that path is already built and already exercised.

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
re-run — assertion 3 must fail and the run must stop before step 7 writes `manifest.json`. On the
phone, open `/` during and after the run: the live map must be completely unaffected, and the fog
`generation` served to the phone must be unchanged, because nothing was cut over.
