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

- [ ] An activity whose ledger commit lands at any point during a replay ends with exactly one
      set of rows, under the replay's target version, and its XP counted once.
- [ ] A test drives each of the three windows above against `MemoryStore` in
      `src/pipeline/xp-replay.test.ts`.
- [ ] The fix is recorded against `02` §4.4 step 1's sentence, which is amended to say what
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

## Operator validation

None needed — a race, faked in a test and against throwaway AWS resources.
