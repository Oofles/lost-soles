---
id: 295
slug: a-repo-walking-test-sees-agent-worktrees-and-fails-the-wave
title: A repo-walking test sees agent worktrees and fails the wave gate
type: bug
priority: med
status: open
size: s
capability: 18-mvp-hardening
depends_on: []
blocked_by: []
source: agent
created: 2026-10-19T13:47:44Z
started: 2026-10-26T03:02:11Z
---

## Description

`docs/capabilities/WAVES.md` §2 says agent worktrees under `.claude/worktrees/` are gitignored "and
neither `tsc` nor `vitest` sees it". One test does: `src/adapters/strava/adapter.test.ts` > "no
polyline decoder exists anywhere in this repository" walks the filesystem rather than the git index,
so during capability 15's wave 1 gate it found each worktree's copy of
`scripts/make-strava-fixture.mjs` and failed. It passed once the worktrees were removed. Every wave's
orchestrator gate runs while worktrees still exist, so every wave will hit this.

## Steps to reproduce

1. Have any agent worktree present under `.claude/worktrees/`.
2. `npx vitest run src/adapters/strava/adapter.test.ts` from the main checkout.

## Expected vs actual

**Expected:** the test scans only the repository's own tree and passes.

**Actual:** it fails, listing `.claude/worktrees/agent-*/scripts/make-strava-fixture.mjs` as unexpected importers.

## Acceptance criteria

- [ ] The scan excludes `.claude/` (or enumerates via `git ls-files`), with a test that a file under `.claude/worktrees/` is not scanned.
- [ ] Any other filesystem-walking test or guard is checked for the same blind spot, and fixed or listed in the Resolution.

## Notes

Found by the orchestrator in capability 15 wave 1 (2026-10-19). Workaround until fixed: remove the
worktrees (WAVES §4 step 8) before the gate.

## Operator validation

None needed: a test-only change, proven by the suite with a worktree present.
