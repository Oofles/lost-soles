---
id: 234
slug: the-ingest-worker-scores-under-v1-for-ever-a-rebalance-to-vn
title: The ingest worker scores under v1 for ever — a rebalance to vN leaves new activities on the old ruleset
type: bug
priority: med
status: open
size: m
capability: 09-xp-engine-and-ledger
depends_on: []
blocked_by: []
source: agent
created: 2026-10-02T02:20:55Z
started: 2026-10-02T02:50:40Z
---

## Description

Found while building `0223`. `amplify/functions/process-activity/handler.ts` imports
`rules/xp-rules-v1.json` and scores every activity under it. Its own comment says so: *"PINNED TO
v1 by the import path… replay against an older `rulesVersion` (04 §7.6) needs T5 and belongs to
capability 09."* `02` §4.4 defines a rebalance as *"write `rules/xp-rules-v2.yaml`, seed T5
partition 2, run the replay job"*. Nothing in that procedure moves the worker. After a replay to
v2, every new activity is still scored under v1. The user's ledger then mixes versions with
no record of why, and the next replay silently re-prices everything ingest wrote in between.

`0223` made this more visible. A commit refused during a replay is redelivered after the thaw and
scored under the worker's version, which is not necessarily the replay's target.

## Acceptance criteria

- [ ] The worker scores under the ruleset version the user was last replayed to (or the current
      deployed version, whichever the design settles), never a version pinned by an import path.
- [ ] A rebalance's documented procedure (`02` §4.4) says how the worker comes to use v*N*, and
      in what order relative to the replay.
- [ ] A test proves an activity ingested after a replay to v2 is scored under v2.

## Steps to reproduce

1. Write `rules/xp-rules-v2.yaml` and run `tools/xp-replay/replay-xp.ts --confirm` to v2.
2. Ingest any activity.

## Expected vs actual

**Expected:** its ledger rows carry `xpRulesVersion: 2`.

**Actual:** they carry `xpRulesVersion: 1`.

## Notes

Design question to settle before building: where the worker learns the current version (T5,
`Profile`, or a deploy-time constant bumped as step one of a rebalance). D-189 and D-217 explain
why the worker reads a JSON import and not `loadRuleSet()`. No rebalance has happened yet, so
nothing is wrong today.

## Operator validation

None needed. This is invisible until a rebalance, and a test against `MemoryStore`/the fake tables
plus a smoke ingest after a throwaway v1 → v1 replay is the check.
