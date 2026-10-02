---
id: 234
slug: the-ingest-worker-scores-under-v1-for-ever-a-rebalance-to-vn
title: The ingest worker scores under v1 for ever — a rebalance to vN leaves new activities on the old ruleset
type: bug
priority: med
status: closed
size: m
capability: 09-xp-engine-and-ledger
depends_on: []
blocked_by: []
source: agent
created: 2026-10-02T02:20:55Z
started: 2026-10-02T02:50:40Z
closed: 2026-10-02T03:07:23Z
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

- [x] The worker scores under the ruleset version the user was last replayed to (or the current
      deployed version, whichever the design settles), never a version pinned by an import path.
- [x] A rebalance's documented procedure (`02` §4.4) says how the worker comes to use v*N*, and
      in what order relative to the replay.
- [x] A test proves an activity ingested after a replay to v2 is scored under v2.

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

## Resolution

**The worker scores each activity under the version the user's ledger is on** (D-274): the
highest `SkillState.rulesVersionLastComputed`, read once per activity, picked from every bundled
ruleset. The design question in Notes was settled with the operator at the start of the session.
The answer is T2, not a `Profile` field and not a deploy-time constant. Both writers already
maintain `rulesVersionLastComputed`, and `replayUser` already derived its own `fromVersion` from
it.

- `src/pipeline/worker-rules.ts` (new) — `ledgerRulesVersion` (the max over T2 rows),
  `pickBundledRules` (the ledger's version, or the newest bundled version for a user with no
  rows; `RulesVersionNotBundledError` rather than a fallback), and `rulesForUser` (one consistent
  T2 query through the existing `readShownRows`).
- `src/pipeline/xp-replay.ts` — `fromVersionOf` now calls `ledgerRulesVersion`, so the replay and
  the worker share one definition of "the user's version".
- `src/pipeline/process-activity.ts` — `ProcessDeps.registry` accepts a ruleset **or** a
  `(userId) => Promise<ruleset>` resolver. It is resolved once, after dedupe and **before the
  score gate**, so a version the worker does not bundle throws while nothing is claimed or
  written. The cells phase, scoring, the ledger commit and the skill-state snapshot all read the
  resolved one.
- `scripts/build-rules-json.mjs` — also generates `rules/xp-rules.bundled.ts` (an import of every
  `xp-rules-v*.json`, keyed by number), covered by the existing `--check` gate in CI and in
  `amplify.yml`. Adding v2 is: write the YAML, run the script.
- `amplify/functions/process-activity/handler.ts` — the `xp-rules-v1.json` import is gone. Every
  bundled version is validated at cold start, and a file whose `version` disagrees with its name
  fails the cold start. `registry` is `rulesForUser` against `SKILL_STATE_TABLE`, which the worker
  could already `Query` for its snapshot (`0067`), so there is no IAM change.
- Docs: `02` §4.4 now gives the rebalance order. Generate → **deploy** (the worker carries v2
  but stays on v1) → seed T5 → replay (the thaw moves the worker). D-274 records why the deploy
  must come first, and that rollback needs no deploy. D-273's "Not solved here" note points at
  this ticket; it is left as written and resolved by D-274, not edited.

**Tests.** `worker-rules.test.ts` (6): the max rule, the no-rows fallback, a deploy of v2 not
moving a user still on v1, refusal of an unbundled version, and paginated consistent reads.
`process-activity.test.ts`: **an activity ingested with T2 at v2 writes ledger rows
`…#v2` with `xpRulesVersion: 2`, half the v1 XP (14, not 28), and `:ver = 2` on T2.** That proves
the v2 rules ran, not just the v2 label. An unbundled version is refused before `gate`, with no
cells and no transaction. `xp-replay.test.ts`: against `MemoryStore`, the worker resolves v1
before a real `replayUser` to v2 and v2 after it, with v2 bundled throughout, and v1 again after a
rollback. Full suite 2,549 passed. Lint, typecheck and every CI check script are clean.

**What did not go perfectly.** While filing `0235` I first wrote that T2's existing
`xpLedgerSum = :prev` condition catches most of the residual race. It does not:
`persistWithLedger` pre-reads T2 at commit time, after the thaw. I corrected that before filing.

**Filed:** `0235` (low). A replay that runs entirely between the worker's version read and its
commit leaves that one activity on the pre-replay version until the next replay. It needs a
stall longer than the 60 s drain during a hand-run replay.

## Operator validation

No perceptual check. Nothing here is visible until a rebalance happens. Smoke tests were run by
the agent on 2026-10-02 (UTC), account 286588821906, us-east-1:

- **Resolver against the real T2** (read-only; `rulesForUser` run locally against
  `SkillState-nog4xy2l7baqlhghpndh2565qe-NONE`). The table has 3 rows, all
  `rulesVersionLastComputed: 1`. The operator's user resolved to **v1**, and a user id with no
  rows resolved to **v1** (the newest bundled version). Real DynamoDB numbers arrive in the shape
  the resolver expects.
- **Deployed worker cold start.** Amplify job 288 (commit `5905632`) succeeded.
  `amplify-d14fhvl4rp79nn-ma-processactivitylambda939-…` was updated at 02:59Z and invoked
  directly with `{"Records":[]}`. Result: StatusCode 200, no `FunctionError`, `Init Duration:
  414.61 ms`, and no error in the log tail. So the generated `rules/xp-rules.bundled.ts` survived
  esbuild, and every bundled version passed `assertValidRuleSet` and the name/version check at
  module load. An empty batch touches no data.
- **Not done:** the throwaway v1 → v1 replay followed by a real ingest that the original
  Operator-validation note suggested. Sending a job to the production ingest queue needs the
  operator's OK, and only v1 exists, so it would show the same v1 the resolver run already
  showed. The v2 path is proven by the pipeline and replay tests in the Resolution, and the first
  real ingest after this deploy exercises the resolver end to end.
