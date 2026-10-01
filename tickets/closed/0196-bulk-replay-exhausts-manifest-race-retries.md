---
id: 196
slug: bulk-replay-exhausts-manifest-race-retries
title: A bulk replay exhausts regenerateExplored's manifest-race retries
type: bug
priority: med
status: closed
size: s
capability: 07-fog-projection-and-cells
depends_on: []
blocked_by: []
source: agent
created: 2026-09-10T23:08:17Z
started: 2026-10-01T16:00:32Z
closed: 2026-10-01T16:16:18Z
---

## Description

Observed while smoke-testing `0195`. Ten `reingest` jobs were enqueued at once through
`tools/replay/replay-activities.ts`; nine succeeded and one threw
`ConditionalRequestConflict` — an S3 409, *"the conditional request cannot succeed due to a
conflicting operation against this resource"* — out of the `blobs` phase.

`regenerateExplored` reads `manifest.json`, merges, and writes it back under a conditional PUT.
Ten workers processing one user's activities concurrently all race on that one object.
`explored-blob-store.ts` already anticipates this — `BlobStoreDeps.maxAttempts` exists precisely
to *"re-merge after losing the manifest race"*, and its comment argues three is generous because
*"losing twice in a row needs three workers for one user interleaving inside one S3 round trip"*.
A bulk replay is exactly that condition, at ten.

**Nothing was lost and nothing needs repairing.** The failure is above the transaction, so no
`Activity` row was written and the receipt stayed `PROCESSING`; SQS redelivered the message after
the queue's 960 s visibility timeout and it succeeded on the second attempt. Queue drained to
`0/0`, DLQ `0`, all ten objects written, cell counts unchanged. The self-healing worked as
designed — this ticket is about the sixteen-minute stall, not about correctness.

**Why it is worth fixing rather than tolerating.** `0192` replayed nine at once and drained
clean, so this is intermittent and will not reproduce on demand. The rebuild drill (`0102`/`0103`)
replays *thousands* of activities, and `02` §8.3 step 5 is explicit that the fold must run
single-threaded per user — but steps before it are described as *"embarrassingly parallel"*. At
2,000–5,000 activities a retry budget of three, tuned for an interleaving of three, is the wrong
number by two orders of magnitude, and every exhaustion costs a visibility timeout.

Also worth deciding: whether a `maxReceiveCount` of 3 against a 960 s timeout is the right
envelope. Two unlucky manifest races on one message would put a perfectly good activity in the
DLQ 32 minutes later, which reads to `0044`'s alarm as an ingest failure.

## Steps to reproduce

1. Have an account with ten or more archived activities that reveal ground.
2. `npx vite-node tools/replay/replay-activities.ts -- --user <sub> --confirm` — all ten at once.
3. Watch the worker's log group for `ConditionalRequestConflict`, and the queue for a message
   sitting at `ApproximateNumberOfMessagesNotVisible: 1`.

**Intermittent.** `0192` replayed nine and drained clean; `0195` replayed ten and lost one. It
depends on how the Lambda's concurrency happens to interleave, so a single clean run does not
disprove it.

## Expected vs actual

**Expected:** ten concurrent publishes for one user resolve through `maxAttempts`, and the queue
drains in one pass.

**Actual:** one worker exhausts its retries and throws out of the `blobs` phase. The message is
redelivered 960 s later (the queue's visibility timeout) and succeeds. Correctness is preserved —
the throw is above the transaction, so no row was written and nothing needed repair — but the
activity is sixteen minutes late, and two such losses on one message would DLQ it.

## Acceptance criteria

- [x] A test drives `regenerateExplored` with N concurrent publishes against one user and asserts
      the outcome for N well past three — the current `maxAttempts` default is asserted by nothing
      at the concurrency that actually breaks it.
- [x] `maxAttempts` is either raised with the reasoning recorded, or the retry is given backoff so
      a loser does not immediately re-collide, or the ticket records why three is correct and the
      queue is the right place to absorb it.
- [x] The decision accounts for the rebuild drill's volume, not just a ten-activity replay.
- [x] `explored-blob-store.ts`'s comment about "three workers interleaving" is corrected if the
      number changes, so the next reader is not calibrated to a superseded figure.
- [x] Whatever changes, a bulk replay of the account's real archive still drains to `0/0` with an
      empty DLQ and unchanged cell counts.

## Notes

**Not a `0195` regression.** The `traces` phase is a separate S3 PUT under a deterministic
per-activity key with no conditional and no shared object; it cannot race. The conflict is in the
`blobs` phase, which predates it (`0049`).

Evidence, from the `0195` smoke test on 2026-09-10:

```
2026-09-10T22:45:50.475Z ERROR {"at":"process-activity","externalId":"19984269402", …}
2026-09-10T22:45:50.478Z ERROR Invoke Error {"errorType":"ConditionalRequestConflict",
  "errorMessage":"The conditional request cannot succeed due to a conflicting operation
  against this resource.","$fault":"client","$metadata":{"httpStatusCode":409, …
```

Queue observed at `0/1` from 22:45 to 23:02 UTC, then `0/0` with the tenth object written.

- **2026-09-11 — third occurrence, during `0194`'s res-11 migration.** Ten `reingest` jobs
  enqueued at once; nine drained promptly and one sat at
  `ApproximateNumberOfMessagesNotVisible: 1` with `ApproximateNumberOfMessages: 0` and the DLQ
  at 0. Same signature as the `0195` observation.
  **Running tally: `0192` nine, clean · `0195` ten, one lost · `0194` ten, one lost.** So it is
  not as intermittent as `0195` guessed — two of the three bulk replays hit it, and both of the
  ones at ten did. That is worth having before the rebuild drill, which replays thousands.
  **Correctness held again, and visibly:** the published blob contained all 590 cells from all
  ten activities and matched a local derivation through the shipped `traceToCells` exactly
  (0 missing, 0 extra), so the stalled message is an idempotent re-merge that will bump the
  generation and change no cell.

## Resolution

**The ticket's diagnosis was wrong, and that was the finding.** The retry budget was never
exhausted. It was never *entered*. The logged error is a raw `ConditionalRequestConflict`
(**409**), not the wrapped *"lost the manifest race N times"* error that exhaustion throws.
`isPreconditionFailed` matched only **412**. S3 returns 409 when a rival's conditional PUT to the
same key is still *in flight*, and 412 only once the rival has landed. So in a bulk replay, a 409
loser threw on its first loss and waited out a 960 s visibility timeout with all three retries
unused. Raising `maxAttempts`, the fix the ticket proposed, would have changed nothing.

**The rebuild-drill premise was also wrong.** `02` §8.3 publishes the manifest once, at step 7,
after a single-threaded fold, so thousands of activities never race this object. What does reach
this path is a bulk `reingest`, or a Strava history backfill through the queue. Those are what the
fix is sized for.

**Changes (D-266):**
- `src/pipeline/explored-blob-store.ts`: `isManifestRaceLost` (exported) treats 409 and 412
  alike. Re-merges wait `backoffDelayMs`, full jitter over `[0, min(2 s, 50 ms·2^attempt))`,
  injectable as `deps.backoff`. The `maxAttempts` default goes 3 → **10**. The "three workers
  interleaving" comment is replaced with the real reasoning, and the old figure is quoted as
  superseded.
- `amplify/backend.ts`: the SQS event source gets `maxConcurrency: 5`. In a single-user app every
  worker races the same manifest, so an unbounded poller on a large backfill would outrun any
  retry budget. The cap sits on the event source, not reserved concurrency, so a waiting message
  burns no `maxReceiveCount`. Asked and agreed with the operator mid-session; this was not in the
  approach first proposed.
- `maxReceiveCount: 3` × 960 s is unchanged. With retries actually running, the queue is the
  backstop again rather than the mechanism.
- Docs: `02` §6.4 names the 409, and `01` "Failure handling" records the five-worker cap.

**Tests:**
- `explored-blob-store.test.ts`: the fake S3 can now refuse **overlapping** conditional PUTs with a
  409 (`overlapConflicts`). New cases: a 409 is retried; backoff runs between re-merges and not
  before the first attempt; a 403 is thrown without retrying; **10 and 20 concurrent publishes**
  for one user all commit with every cell present and a linear generation chain; ten concurrent
  publishes fit the *default* budget; and `backoffDelayMs` bounds.
- `process-activity-stack.test.ts` asserts `ScalingConfig.MaximumConcurrency: 5`.
- **Mutation-checked:** with 409 removed from `isManifestRaceLost`, five of the new tests fail,
  including both concurrency cases. So the fake reproduces the production bug rather than passing
  around it.
- Full suite 2472 passed, plus `tsc` and `eslint --max-warnings 0`, all clean.

## Operator validation

**Agent-side smoke test against the deployed stack** (D-181/D-229). Nothing here is perceptual,
and there is nothing for the operator to do.

- **Deployed:** Amplify job 270 (`41530b3`) succeeded. The live event-source mapping reads
  `BatchSize: 1, ScalingConfig.MaximumConcurrency: 5, Enabled`.
- **Bulk replay of the whole real archive:** `replay-activities.ts --user <sub> --confirm`
  enqueued **18** `reingest` jobs at once, nearly twice the replays that failed in `0194`/`0195`.
- **Drained in one pass:** queue `10/0` at 16:15:26Z, `0/0` at 16:15:42Z, about 30 s after
  enqueue. No message waited out a visibility timeout. **DLQ `0/0`.**
- **The race really happened, and was absorbed:** the worker logs since enqueue show `conflicts`
  of 0×10, 1×4, 2×2 and 3×2. So 8 of 18 workers lost at least once and all committed. There were
  **zero** `ERROR`/`Invoke Error` lines.
- **Cells unchanged:** manifest `cellCount` 1141 → **1141**. Generation 67 → **99**: 18 commits
  plus 14 orphaned allocations from lost races (4·1 + 2·2 + 2·3), which is the arithmetic of a
  linear chain.
