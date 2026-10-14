---
id: 261
slug: override-kind-hard-codes-bundled-rulesets
title: override-kind.ts hard-codes rulesets v1-v2 and refuses a ledger on v3
type: bug
priority: low
status: open
size: s
capability: 09-xp-engine-and-ledger
depends_on: []
blocked_by: []
source: agent
created: 2026-10-14T14:41:02Z
---

## Description

`tools/kind-override/override-kind.ts` builds its ruleset map as
`new Map([1, 2].map((v) => [v, loadRuleSet(v)]))`. The operator's ledger is on **v3**, so the tool
now refuses every user with `RulesVersionNotBundledError` before doing anything. Found in `0248`,
whose backfill tool copied the same line and hit it against prod. That copy was fixed to read
`BUNDLED_RULES`, which is what the worker does (`0234`). It fails closed, so nothing was mis-scored.

## Acceptance criteria

- [ ] `override-kind.ts` builds `bundled` from `rules/xp-rules.bundled.ts` (every version), as the
      worker and `tools/landmarks/backfill-landmarks.ts` do.
- [ ] No other tool under `tools/` hard-codes a version list (grep for `loadRuleSet(v)` over a literal array).

## Steps to reproduce

1. `npx vite-node --config vitest.config.ts tools/kind-override/override-kind.ts -- --user <sub> --activity <id> --kind walk`
   for a user whose ledger is on v3.

## Expected vs actual

**Expected:** a dry-run report of the correction.

**Actual:** `RulesVersionNotBundledError: … ledger is on xp-rules v3, and this worker bundles only v1, v2.`

## Notes

- Filed from `0248`, 2026-10-14.

## Operator validation

Dry run of `override-kind.ts` against the operator's account prints the report, with no error.
Agent-run; nothing for the operator to look at.
