---
id: 196
slug: bulk-replay-exhausts-manifest-race-retries
title: A bulk replay exhausts regenerateExplored's manifest-race retries
type: bug
priority: med
status: open
size: s
capability: 07-fog-projection-and-cells
depends_on: []
blocked_by: []
source: agent
created: 2026-09-10T23:08:17Z
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

- [ ] A test drives `regenerateExplored` with N concurrent publishes against one user and asserts
      the outcome for N well past three — the current `maxAttempts` default is asserted by nothing
      at the concurrency that actually breaks it.
- [ ] `maxAttempts` is either raised with the reasoning recorded, or the retry is given backoff so
      a loser does not immediately re-collide, or the ticket records why three is correct and the
      queue is the right place to absorb it.
- [ ] The decision accounts for the rebuild drill's volume, not just a ten-activity replay.
- [ ] `explored-blob-store.ts`'s comment about "three workers interleaving" is corrected if the
      number changes, so the next reader is not calibrated to a superseded figure.
- [ ] Whatever changes, a bulk replay of the account's real archive still drains to `0/0` with an
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

## Operator validation

TODO — written at close. Nothing here is the operator's: it is a queue, a Lambda and an S3
conditional PUT, all reachable with AWS credentials.
