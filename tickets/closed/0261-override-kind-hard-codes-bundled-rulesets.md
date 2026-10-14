---
id: 261
slug: override-kind-hard-codes-bundled-rulesets
title: override-kind.ts hard-codes rulesets v1-v2 and refuses a ledger on v3
type: bug
priority: low
status: closed
size: s
capability: 09-xp-engine-and-ledger
depends_on: []
blocked_by: []
source: agent
created: 2026-10-14T14:41:02Z
started: 2026-10-14T19:39:01Z
closed: 2026-10-14T19:40:05Z
---

## Description

`tools/kind-override/override-kind.ts` builds its ruleset map as
`new Map([1, 2].map((v) => [v, loadRuleSet(v)]))`. The operator's ledger is on **v3**, so the tool
now refuses every user with `RulesVersionNotBundledError` before doing anything. Found in `0248`,
whose backfill tool copied the same line and hit it against prod. That copy was fixed to read
`BUNDLED_RULES`, which is what the worker does (`0234`). It fails closed, so nothing was mis-scored.

## Acceptance criteria

- [x] `override-kind.ts` builds `bundled` from `rules/xp-rules.bundled.ts` (every version), as the
      worker and `tools/landmarks/backfill-landmarks.ts` do.
- [x] No other tool under `tools/` hard-codes a version list (grep for `loadRuleSet(v)` over a literal array).

## Steps to reproduce

1. `npx vite-node --config vitest.config.ts tools/kind-override/override-kind.ts -- --user <sub> --activity <id> --kind walk`
   for a user whose ledger is on v3.

## Expected vs actual

**Expected:** a dry-run report of the correction.

**Actual:** `RulesVersionNotBundledError: … ledger is on xp-rules v3, and this worker bundles only v1, v2.`

## Notes

- Filed from `0248`, 2026-10-14.

## Resolution

**Files touched:** `tools/kind-override/override-kind.ts`. That's the only one.

- `bundled` is now `Object.entries(BUNDLED_RULES)`, mapped to `[Number(v), r as RuleSet]`.
  This is the line `tools/landmarks/backfill-landmarks.ts:66` uses, comment included. The
  `loadRuleSet` import is gone, replaced by `BUNDLED_RULES` and `type RuleSet`. The tool now
  carries the same versions as the worker, so it picks up v4 when v4 ships. No code change needed.
- **Second criterion: nothing else to fix.** `grep` for `loadRuleSet` across `tools/` turns up
  only `xp-replay/replay-xp.ts` and `xp-replay/repair-t3.ts`. Both pass `loadRuleSet` itself as a
  per-version loader (`rules: loadRuleSet`), and `replay-xp.ts` calls `loadRuleSet(to)` on the
  version it was asked for. Neither enumerates versions, so neither can fall behind the way this did.
  `src/pipeline/__fixtures__/process-rig.ts` pins `loadRuleSet(1)` on purpose. That's a test fixture
  outside `tools/`, so it's out of scope.
- No tests added. This is a CLI's composition root, and `rulesForUser`'s behaviour with a full
  bundle is already covered by `0234`. The smoke test below is the proof.
- `tsc --noEmit` is clean on tracked code. The only errors come from untracked leftovers in `tmp/0248/`.
  `eslint` is clean on the file.

## Operator validation

**Agent smoke test, 2026-10-14, against prod (`AWS_PROFILE=devault`), dry run with no `--confirm`:**
`--user 5488e4b8-… --activity 5b6273e9… --kind walk`. That's the operator's account, a 2026-08-30
Strava run.
- **Before the fix** (original file stashed), it fails as reported:
  `RulesVersionNotBundledError: …'s ledger is on xp-rules v3, and this worker bundles only v1, v2.`
- **After the fix**, it prints the report:
  `kind run, derived run, 1534 XP under v3` · `override on file: none` · `→ walk under ruleset v3`
  · `dry run — nothing written.`

Nothing for the operator to look at.

Planned at ticket-write: Dry run of `override-kind.ts` against the operator's account prints the report, with no error.
Agent-run; nothing for the operator to look at.
