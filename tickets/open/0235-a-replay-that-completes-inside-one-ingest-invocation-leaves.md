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

- [x] An ingest commit whose ruleset version is no longer the user's ledger version is refused
      atomically and redelivered, rather than committed. For example, condition the transaction's
      T2 items on `rulesVersionLastComputed`, or carry the version on `Profile` beside
      `replayInProgress`.
- [x] A test interleaves a full replay between the worker's version read and its commit, and
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

## Resolution

Took the ticket's second option, a version carried on `Profile`, and recorded it as **D-275**.
It supersedes D-274's "a user with no T2 rows → newest bundled" bullet, and the decision says so.

**What changed**

- `src/pipeline/xp-replay.ts`, `xp-replay-store.ts`: `ReplayStore.thaw` takes
  `ledgerRulesVersion`. `replayUser` passes `toVersion`. The thaw's single `UpdateItem` sets
  `ledgerRulesVersion = :ver` together with `replayInProgress = false`, so no commit can see the
  flag down and the old version.
- `src/pipeline/xp-ledger.ts`: `profileTotalsItem` takes `rulesVersion`. Its condition is now
  `(attribute_not_exists(replayInProgress) OR replayInProgress = :thawed) AND
  (attribute_not_exists(ledgerRulesVersion) OR ledgerRulesVersion = :ver)`. The ingest never
  writes the attribute, only conditions on it. A mismatch fails the same Profile item, so
  `isReplayRefusal` already classes it as a refusal and `ReplayInProgressError` triggers a
  redelivery. The redelivery runs `rulesForUser` again. The error message now names both causes
  and the version, because the Profile item cannot say which of the two it was.
- `src/pipeline/worker-rules.ts`: `rulesForUser` takes `profileTable`. When T2 yields no
  version, it does one consistent `GetItem` of `Profile.ledgerRulesVersion` before falling back
  to the newest bundled version (the edge agreed with the operator before starting). Without
  this, a user whose replay produced no XP would be scored under a newer bundled version and
  refused on every redelivery.
- `amplify/data/resource.ts`: new owner-read-only field `Profile.ledgerRulesVersion`.
  `amplify/backend.ts`: the worker gets `dynamodb:GetItem` on T1 alongside `UpdateItem`.
  `handler.ts` passes `PROFILE_TABLE`.
- Docs: `02` T1 table and auth line, §4.4 rebalance step 2, step 1 FREEZE, step 6 THAW.
  `docs/INDEX.md` regenerated.

**Why not condition the T2 items** (the ticket's first suggestion). A skill the activity trains
for the first time has no T2 row for the replay to have moved, so it would still commit under the
old version. Also, a T2 condition failure is classed as `isLostLedgerRace` and retried *with the
same stale version*, so it never converges.

**Tests**

- `xp-ledger.test.ts`, the criterion's test. Real `rulesForUser` reads v1. Then the real
  `dynamoReplayStore` freeze, SkillState thaw and Profile thaw run through the
  condition-evaluating fake. The stalled commit is refused and changes no state. The redelivery
  resolves v2 and commits rows, T3 and T2 at v2. A second test covers a never-replayed user: no
  stamp, so the commit proceeds and the ingest does not create a stamp. The fake learned
  `(A) AND (B)`, `attribute_exists`, `a <= :v` and lone `UpdateCommand`s to support this.
- `xp-replay.test.ts`: the same race with the real `replayUser` run to completion inside the
  window. `MemoryStore.ingest` models the new condition.
- `worker-rules.test.ts`: the fallback order (T2 wins and Profile is not read; then the stamp;
  then newest bundled for no stamp or no row; an unbundled stamp is refused).
- Updated `xp-replay-store.test.ts` (thaw writes `:ver` in the same expression as the flag),
  `profile-model.test.ts`, `xp-ledger-tables.test.ts` (T1 is now GetItem + UpdateItem) and
  `process-activity.test.ts`.
- **Mutation check:** pointing the version clause at a nonexistent attribute (which disables
  the check) fails the interleave test, so the test proves the fix. My first attempt at this
  mutation only broke the fake's parser and proved nothing, so I redid it.
- Full suite: 136 files, 2556 passed, 1 skipped. `tsc` clean. `eslint` reports 2 errors, both in
  the gitignored `tmp/0198/verify.ts` (pre-existing scratch, not in CI).

## Operator validation

No perceptual check. Nothing here is visible, and the race only shows up in a test. The agent ran
these smoke tests on 2026-10-02 (UTC), account 286588821906, us-east-1:

- **The condition against real DynamoDB** (`tmp/0235/smoke.ts`, on a throwaway on-demand table
  that was created and then deleted). It sent the real `profileTotalsItem` and the real
  `dynamoReplayStore` freeze and thaw. Results: a never-replayed row with v1 committed. A frozen
  row was refused (`ConditionalCheckFailed`). After a thaw to v2, the row holds
  `ledgerRulesVersion: 2, replayInProgress: false`. A stale v1 commit was then refused
  (`ConditionalCheckFailed`), and a v2 redelivery committed. This shows DynamoDB accepts the
  parenthesised `AND` expression and evaluates it as the fake does.
- **Deploy.** Amplify job 291 (commit `d2fb3cf`) succeeded. The worker role's inline policy on
  `Profile-nog4xy2l7baqlhghpndh2565qe-NONE` is now `UpdateItem` and `GetItem`. Invoking the
  worker directly with `{"Records":[]}` returned StatusCode 200, no `FunctionError`, with
  `Init Duration: 473.66 ms`.
- **Resolver against the real T1 and T2** (read-only, `tmp/0235/resolve.ts`). The operator's
  Profile row has `replayInProgress: false` and **no** `ledgerRulesVersion`, because the earlier
  replay ran before this field existed. The new condition therefore accepts the next real ingest
  (`attribute_not_exists`), and the field appears after the next replay's thaw. The operator
  resolves to **v1** from T2. An unknown user resolves to **v1**, the newest bundled version,
  having fallen through T2 and then the absent Profile row.
