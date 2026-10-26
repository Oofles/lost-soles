---
id: 311
slug: beat3-test-tsx-title-still-says-693-for-seven-skills-contrad
title: beat3.test.tsx title still says 693 for seven skills, contradicting D-192
type: chore
priority: low
status: open
size: s
capability: 18-mvp-hardening
depends_on: []
blocked_by: []
source: agent
created: 2026-10-22T19:51:44Z
started: 2026-10-26T20:52:53Z
---

## Description

A test title in `lib/level-up/beat3.test.tsx` reads "… (693 for seven skills)". D-192 says the Total Level ceiling is never stated as a number. The assertion itself computes it correctly; only the title is stale. Found by the 0116 agent.

## Acceptance criteria

- [x] The title states the arithmetic (enabled rows × `maxLevel`) and no number.
- [x] `grep -rn '693' lib src app components` finds no ceiling literal in a test title or assertion.

## Notes

Trivial; pair it with another small ticket.

## Operator validation

None: a test title.

**Result, 2026-10-26, after Amplify job 434 (`ffa90a3`) succeeded.** The build's `npm test` passed
with the new title and computed ceiling. On `main` the orchestrator re-ran
`npx vitest run lib/level-up/beat3.test.tsx` (with the adapter test): 84/84 pass.

D-123 trigger checked? none.

## Resolution

**Files touched**

- `lib/level-up/beat3.test.tsx` — the Total Level ladder test. Title now ends "(enabled rows ×
  maxLevel)" with no figure. The two assertions that hardcoded the ceiling (`toBe(693)` and the
  ladder's last rung) now compare against `ceiling`, computed in the test from the fixture as
  `SKILLS.filter((s) => s.enabled).length * CURVE.maxLevel`. The second criterion names
  assertions as well as titles, so the literal in the assertions went too, not only the title.
  The fixture stays at seven enabled rows: that keeps the ceiling above 500, so the test still
  shows the computed rung appended after the fixed ladder.

**Remaining `grep -rn '693' lib src app components` hits, and why each stays**

- `src/scoring/levels.test.ts:24` — a doc comment recording the history of falsified figures
  ("594 → 693 → 792 → 891") as the reason D-192 exists. That is history, not a ceiling claim
  in a title or assertion. Stays.
- `src/adapters/strava/__fixtures__/*.json` and `src/adapters/__fixtures__/equivalence-run.gpx`
  — `693` appears as a stream index or inside coordinate digits. Not a ceiling. Stays.

**Decisions**: none new. This applies D-192.

**Verification**: amplify.yml build-phase guards, `npm run typecheck`, `npm run lint`,
`npx vitest run`, `npm run build`, all run in the worktree before commit.

