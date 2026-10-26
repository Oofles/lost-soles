---
id: 316
slug: the-strava-adapter-s-repo-wide-scans-still-walk-the-gitignor
title: The Strava adapter's repo-wide scans still walk the gitignored tmp/ directory
type: bug
priority: low
status: closed
size: s
capability: 18-mvp-hardening
depends_on: []
blocked_by: []
source: agent
created: 2026-10-26T12:32:10Z
started: 2026-10-26T20:52:53Z
closed: 2026-10-26T21:18:39Z
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

- [x] Both scans skip `<root>/tmp`, with a case in the existing "repo-wide scans see only the
      repository's own tree (0295)" block.
- [x] Any other repo-walking test or guard that reaches `tmp/` is fixed or listed in the Resolution.

## Notes

None.

## Resolution

**Files touched**

- `src/adapters/strava/adapter.test.ts`: `sourceWalker` now excludes a set of root-keyed paths,
  `<root>/.claude/worktrees` (0295) and `<root>/tmp` (new `SCRATCH` constant). Both scans
  (`summary_polyline`, and "no polyline decoder exists anywhere") use this walker, so both are
  fixed by the one change. New case in the 0295 block: `tmp/x/p.ts` is skipped, and
  `src/tmp/b.ts` is still scanned.
- `scripts/check-design-tokens.mjs`: `tmp` added to `EXCLUDED`, the set filtered out of the
  derived top-level scan roots, so only `<root>/tmp` is skipped and a nested `tmp/` is still
  scanned. The self-test gains `tmp/probe/leak.tsx` (must pass), `lib/tmp/leak.tsx` (must fire),
  and a dangling `tmp/chromium-profile/SingletonLock` symlink: if the exclusion regresses,
  `statSync` throws and the self-test dies. That symlink is the failure recorded in project memory.
- `scripts/check-fixture-geography.mjs`: `fixtureDirs` skips `<base>/tmp` by path. The `SKIP`
  name list is unchanged, so a `tmp/__fixtures__` inside the tracked tree is still found. The
  self-test's discovery assertion now plants `tmp/probe/__fixtures__` (must not be found) and
  `lib/tmp/__fixtures__` (must be found), and asserts the exact set.

**Decisions made, and why**

- **Exclude by path, not by name.** This matches 0295's reasoning for `.claude/worktrees`.
  `tmp/` at the root is the gitignored scratch directory (`.gitignore`, and 0250's
  tsconfig/eslint/vitest excludes). A directory named `tmp` inside `src/`, `lib/` or `app/` would
  be tracked code, so it stays scanned in all three places.
- **The privacy guard skips tmp/ too.** `check-fixture-geography` protects *a public
  repository* (08 §7.2 / D-199). `tmp/` is gitignored and never committed, so a probe fixture
  there is outside that scope. Before the fix, a real-location probe at `tmp/x/__fixtures__/`
  failed the gate (exit 1, listing `tmp/x/__fixtures__/probe.json`). Afterwards it passes. A
  force-added `tmp/` file is the remaining gap. The fixture guard already has the same gap
  for `.claude/`, which it skips by name.

**Survey (criterion 2): how "reaches tmp/" was established**

Grepping is not proof, so the survey was run empirically. Probes were planted under `tmp/x/`:
a polyline import, a `summary_polyline` use, a raw hex in a `.tsx`, a real-location
`__fixtures__/probe.json`, and a dangling `SingletonLock` symlink. Every `node scripts/…` line in
`amplify.yml` then ran with a preload that patches `fs.readdirSync/statSync/lstatSync/
readFileSync/opendirSync/existsSync` and records any access under `<root>/tmp`. The full vitest
suite ran with the same tracer as a setup file.

- Before the fix: `check-design-tokens` crashed on the symlink, `check-fixture-geography` walked
  `tmp/` and flagged the probe, and `adapter.test.ts` failed listing `tmp/x/p.ts` (the ticket's
  reproduction).
- After the fix: none of the 35 amplify.yml guard invocations touches `tmp/`, and all pass with
  the probes present (`check-third-party-origins` and `check-prerender-no-cell-data` were run
  after `npm run build`, because they read `.next`). The full suite (274 files) passes with the
  probes present. Its only remaining access is TypeScript's own `tsconfig` glob, which lists
  `tmp/` once and drops it per `"exclude": [..., "tmp"]`. That is not a repo-walking test.
- Other walkers start from subtrees (`src/`, `lib/`, `app/`, `components/`, `.next/`,
  `scripts/`), or skip by name/dot-prefix (`check-boundaries`, `check-fog-render-boundary`,
  `check-mode-boundary`, `check-private-method-update`, `src/rules/no-skill-names.test.ts`,
  etc.). The trace confirms none of them reaches `tmp/`.

The planted probes were removed afterwards (`tmp/` deleted).

## Operator validation

None: test-only.

**Result, 2026-10-26, on `main` after Amplify job 434 succeeded.** `check-design-tokens.mjs
--self-test` exits 0 (it now plants the dangling `tmp/` symlink), `check-fixture-geography.mjs
--self-test` exits 0, and `npx vitest run src/adapters/strava/adapter.test.ts` passes. Before merge,
the agent ran every guard and the full suite with probes planted under `tmp/`, and nothing failed.
The orchestrator accepted one trade-off: `check-fixture-geography` no longer sees a file
force-added under the gitignored `tmp/`. That is the same gap it already has for `.claude/`.
