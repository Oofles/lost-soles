---
id: 235
slug: a-replay-that-completes-inside-one-ingest-invocation-leaves
title: A replay that completes inside one ingest invocation leaves that activity on the pre-replay ruleset
type: bug
priority: low
status: open
size: s
capability: 09-xp-engine-and-ledger
depends_on: []
blocked_by: []
source: agent
created: 2026-10-02T02:55:51Z
started: 2026-10-02T04:25:25Z
---

## Description

Found while building `0234` (D-274's "Known residual"). `processActivity` resolves the user's
ruleset version from T2 just before the score gate, then writes cells, blobs and traces, then
commits. D-273's freeze refuses a commit only while `replayInProgress` is up. If a whole replay
(freeze, 60 s drain, replay, thaw) runs between the version read and the commit, the commit
arrives after the thaw. It is accepted and writes ledger rows under the pre-replay version into a
ledger that is now on the new one.

This needs one invocation to stall for more than `REPLAY_DRAIN_MS`, with a replay started by
hand in exactly that window. The next replay re-prices the activity, so nothing is lost, but the
ledger is mixed until then.

## Acceptance criteria

- [ ] An ingest commit whose ruleset version is no longer the user's ledger version is refused
      atomically and redelivered, rather than committed. For example, condition the transaction's
      T2 items on `rulesVersionLastComputed`, or carry the version on `Profile` beside
      `replayInProgress`.
- [ ] A test interleaves a full replay between the worker's version read and its commit, and
      shows the redelivery scores under the new version.

## Steps to reproduce

1. Start an ingest and hold it after `worker-rules.ts` resolves v1 (in a test, a deferred
   `persist`).
2. Run `replayUser` to v2 to completion.
3. Release the ingest.

## Expected vs actual

**Expected:** the commit is refused and the redelivery writes `xpRulesVersion: 2`.

**Actual:** the commit succeeds with `xpRulesVersion: 1`.

## Notes

Low priority. It needs a stall longer than the drain, during a replay the operator runs by hand,
on a single-user system. The T2 items' existing `xpLedgerSum = :prev` condition does NOT cover
it. `persistWithLedger` pre-reads T2 at commit time, after the thaw, so `:prev` is already the
post-replay sum.

## Operator validation

None needed. This is a race reachable only in a test.
