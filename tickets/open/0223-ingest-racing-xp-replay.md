---
id: 223
slug: ingest-racing-xp-replay
title: An ingest that lands during an XP replay can lose or double one activity's XP
type: bug
priority: low
status: open
size: s
capability: 09-xp-engine-and-ledger
depends_on: [66]
blocked_by: []
source: agent
created: 2026-09-29T13:55:21Z
started: 2026-10-02T01:51:51Z
---

## Description

Found while building `0066`. The XP replay freezes the UI with `Profile.replayInProgress`, but
**ingest does not read that flag** — `02` §4.4 step 1 says *"Ingest continues (it is idempotent
and the activity is picked up in step 3 or by the reconciliation sweep)"*, and neither half of
that holds exactly. An activity committed by the worker while `src/pipeline/xp-replay.ts` runs can
fall into one of three windows:

1. **Before step 3's `listActivities`**: its rows are cleared in step 2 and re-scored in step 3.
   Correct.
2. **Between step 0's waterline read and step 2's `listLedger`**, but after `listActivities`:
   step 2 deletes its rows, step 3 does not re-score it (it was not listed), and the waterline
   predates its `SkillState` ADD — so its XP is neither re-derived nor floored. **Lost.**
3. **After step 2**: its rows survive under the deployed ruleset's version while step 3 may
   also have scored the same activity under the new one if it was listed — two sets of rows with
   different ids. **Doubled.**

Step 6 recomputes `SkillState` from the ledger `SUM`, so I-15 holds in every case; the numbers
are internally consistent and wrong. The window is seconds, replays happen ~3 times in five
years, and there is one user — which is why this is `low`. It is recorded because D-135 is
unconditional and "rare" is not an exception it allows.

## Acceptance criteria

- [x] An activity whose ledger commit lands at any point during a replay ends with exactly one
      set of rows, under the replay's target version, and its XP counted once.
      *Amended reading (see Resolution): "under the version the worker scores with". That equals
      the target only once `0234` lands.*
- [x] A test drives each of the three windows above against `MemoryStore` in
      `src/pipeline/xp-replay.test.ts`.
- [x] The fix is recorded against `02` §4.4 step 1's sentence, which is amended to say what
      actually happens.

## Steps to reproduce

1. Start `tools/xp-replay/replay-xp.ts --confirm` for a user.
2. While it runs, have the worker commit an activity for the same user.

## Expected vs actual

**Expected:** the new activity's XP is counted once, under the replay's ruleset.

**Actual:** depending on the window, counted zero times or twice (see Description).

## Notes

Candidate fixes, not decided: the worker defers (visibility timeout) any job for a user whose
`Profile.replayInProgress` is true — one `GetItem` on the hot path; or step 6 re-lists
activities and re-scores any not seen in step 3 before THAW. The first is simpler and moves the
race to the flag's own write; the second keeps ingest untouched.

## Resolution

**The fix is a gate plus a drain, not the settle loop first proposed** (D-273). Ingest's §4.3
transaction already carried an `Update Profile` item (`0219`). Conditioning that item on
`attribute_not_exists(replayInProgress) OR replayInProgress = false` makes the flag check atomic
with the XP write. While a replay is frozen, no worker can commit XP, including one that was
already in flight when the flag went up. The proposal agreed at the start of the session (a
`GetItem` at the top of the worker plus a 16-minute drain) was replaced by this, with the
operator's approval, once it was clear that the flag write would otherwise be its own race.

- `src/pipeline/xp-ledger.ts` — `profileTotalsItem` carries the condition. New `isReplayRefusal`
  and `ReplayInProgressError`. `persistWithLedger` checks for a refusal **before**
  `isLostLedgerRace`, which would otherwise read the failed Profile item as a lost race and retry
  twice into the same refusal.
- `src/pipeline/xp-replay.ts` — after FREEZE, waits `REPLAY_DRAIN_MS` (60 s) before step 2. This
  covers a commit that landed just before the freeze but is not yet visible to step 2's GSI reads
  (eventually consistent). `ReplayDeps.sleep` is injectable.
- **No handler change.** A refusal writes nothing and throws. The receipt stays `PROCESSING`, and
  the queue's 16-minute visibility timeout outlasts `PROCESSING_STALE_MS`, so the redelivery
  reclaims it. Three receives allow about 48 minutes. A replay that stays frozen longer sends the
  message to the DLQ, recorded as a terminal failure on the last receive like any other, to be
  redriven after the thaw.
- **Not gated:** an activity that earns no XP. It has no Profile item and nothing for the replay
  to miss.
- Docs: `02` §4.4 step 1 now says what actually happens; D-273 records why.

**Tests.** `xp-replay.test.ts`: `MemoryStore.ingest` models the worker's atomic commit. A new
`it.each` drives a commit at five points: before the freeze, windows 1–3 of the Description, and
inside THAW before the flag clears. Each ends with exactly one set of rows under v2, and
SkillState equals the ledger SUM. A further test pins `drain` immediately after `freeze`. I
checked that the tests can fail: with the model's gate disabled, all four in-replay cases fail.
`xp-ledger.test.ts`: the condition expression, `isReplayRefusal`, and a refused commit (one
transaction, nothing written, commits after thaw). The zero-XP case is ungated. The fake gained
the `attribute_not_exists(x) OR x = :v` shape. Full suite: 2,539 passed. Typecheck clean.

**Amended criterion 1.** "Under the replay's target version" holds in the tests, which redeliver
with the target ruleset. In production the redelivery is scored by the worker, which is pinned to
v1 by an import (`handler.ts`). That is true of every activity after a rebalance, not only a
raced one. It is filed as `0234` rather than widened into this ticket.

## Operator validation

No perceptual check. This is a race with nothing visible to look at. Smoke test run by the agent
on 2026-10-01 against a **throwaway DynamoDB table** (`LostSoles-smoke-0223-*`, account
286588821906, us-east-1, deleted afterwards). It used the real `profileTotalsItem` and
`isReplayRefusal` in a two-item `TransactWriteItems`:
- Profile row absent → committed (`totalXp` 10).
- `replayInProgress: true` → `TransactionCanceledException`, `isReplayRefusal(e, 1) = true`,
  `totalXp` unchanged at 999.
- `replayInProgress: false` → committed (`totalXp` 10).

This proves the real service evaluates the condition as the fake does, and that the cancellation
index lands where `persistWithLedger` looks for it.
