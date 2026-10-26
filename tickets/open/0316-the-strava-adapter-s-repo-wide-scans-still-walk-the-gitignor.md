---
id: 316
slug: the-strava-adapter-s-repo-wide-scans-still-walk-the-gitignor
title: The Strava adapter's repo-wide scans still walk the gitignored tmp/ directory
type: bug
priority: low
status: open
size: s
capability: 18-mvp-hardening
depends_on: []
blocked_by: []
source: agent
created: 2026-10-26T12:32:10Z
---

## Description

Found by `0295`. The two repo-wide scans in `src/adapters/strava/adapter.test.ts`
(`summary_polyline`, and "no polyline decoder exists anywhere in this repository") now skip
`.claude/worktrees`, but still walk the gitignored `tmp/` scratch directory. `0250` made
typecheck, lint and vitest collection ignore `tmp/`. These scans still read it, so a probe left
in `tmp/` that imports a polyline decoder fails the suite on code that never ships.

## Steps to reproduce

1. `mkdir -p tmp/x && echo "import polyline from '@mapbox/polyline'" > tmp/x/p.ts`
2. `npx vitest run src/adapters/strava/adapter.test.ts`

## Expected vs actual

**Expected:** passes; `tmp/` is scratch.

**Actual:** fails, listing `tmp/x/p.ts`.

## Acceptance criteria

- [ ] Both scans skip `<root>/tmp`, with a case in the existing "repo-wide scans see only the
      repository's own tree (0295)" block.
- [ ] Any other repo-walking test or guard that reaches `tmp/` is fixed or listed in the Resolution.

## Notes

None.

## Operator validation

None: test-only.
