---
id: 295
slug: a-repo-walking-test-sees-agent-worktrees-and-fails-the-wave
title: A repo-walking test sees agent worktrees and fails the wave gate
type: bug
priority: med
status: closed
size: s
capability: 18-mvp-hardening
depends_on: []
blocked_by: []
source: agent
created: 2026-10-19T13:47:44Z
started: 2026-10-26T03:02:11Z
closed: 2026-10-26T12:45:58Z
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

- [x] The scan excludes `.claude/` (or enumerates via `git ls-files`), with a test that a file under `.claude/worktrees/` is not scanned.
- [x] Any other filesystem-walking test or guard is checked for the same blind spot, and fixed or listed in the Resolution.

## Notes

Found by the orchestrator in capability 15 wave 1 (2026-10-19). Workaround until fixed: remove the
worktrees (WAVES §4 step 8) before the gate.

## Resolution

**Files touched**

- `src/adapters/strava/adapter.test.ts` is the only code change. Both repo-root scans in this file
  (`summary_polyline` "appears nowhere outside this adapter directory", and "no polyline decoder
  exists anywhere in this repository") now share one `sourceWalker(root, skip)`, which excludes the
  PATH `<root>/.claude/worktrees` on top of each scan's existing name-based skip set. A new
  describe block, "the repo-wide scans see only the repository's own tree (0295)", builds a temp
  tree and proves: a file under `.claude/worktrees/agent-x/` is not scanned; the rest of `.claude/`
  (the tracked `/tickets` skill) still is; `node_modules` is still skipped; and with the root set
  to a worktree itself (`…/.claude/worktrees/agent-x`), that worktree's own files are scanned.
  The exclusion is relative to the scan root, never "any path containing `.claude/worktrees`".

**Decisions made, and why**

- **Exclude by path relative to the root. Not by `git ls-files`, and not by the name `.claude`.**
  Excluding the name `.claude` would silently stop scanning `.claude/skills/`, which is tracked
  code in this repository. `git ls-files` would be exact, but it makes a unit test depend on a
  `.git` being present and git being on PATH (`tools/drill/ci` already needs a tree fallback for
  exactly that reason). The path exclusion is the smallest change that keys on the repo root's own
  tree, and it works unchanged from the main checkout and from inside a worktree. No config file
  was edited, so nothing overlaps with what `0250` changes.

**Reproduced, then fixed.** With a fake worktree at `.claude/worktrees/agent-fake0295/` holding a
copy of `scripts/make-strava-fixture.mjs`, the unchanged suite failed exactly as reported, listing
`.claude/worktrees/agent-fake0295/scripts/make-strava-fixture.mjs` as an unexpected importer.
After the fix, the fake worktree was extended with `src/x/bad.ts` (a polyline import, the string
`summary_polyline` and a `CREDIT_NEW` constant). The FULL vitest suite, `tsc`, `eslint` and every
amplify.yml guard were then run with it present, and all were green. The fake was then removed.

**Other filesystem walkers checked (criterion 2)**

I read every `readdirSync` walker under `src/ lib/ app/ components/ amplify/ scripts/ tools/` and
in the tickets skill. Only the two in `adapter.test.ts` walk from the repository ROOT without
excluding dot-directories, and those two were the bug. None of the rest needed a change:

- Start at named subtrees (`src`, `lib`, `app`, `components`, `amplify`, `public`, …), which a
  worktree under `.claude/` can never be inside: `src/adapters/registry.test.ts`,
  `src/rules/no-skill-names.test.ts`, `src/scoring/no-positional-sets.test.ts`,
  `src/scoring/d146-guard.test.ts`, `src/scoring/propagate.test.ts` (walks `src/`),
  `src/pipeline/*.test.ts`, `src/domain/contract-drift.test.ts`, `lib/run-moment/seen.test.ts`,
  `lib/skills/detail.test.ts`, `lib/http/offline-contract.test.ts`,
  `app/run/[activityId]/run-moment.test.tsx`, `src/adapters/strava/oauth.test.ts` (its own dir),
  and the guards `check-boundaries`, `check-fog-render-boundary`, `check-mode-boundary`,
  `check-fog-hot-path`, `check-private-method-update`, `check-drill-no-delete`,
  `check-home-not-in-client`, `check-adapter-deletion` (named `COPY` list), and the post-build
  scans of `.next/`.
- Walk from the root but already exclude dot-directories: `scripts/check-design-tokens.mjs`
  (`rootsFor` drops every name starting with `.`) and `scripts/check-fixture-geography.mjs`
  (`SKIP` contains `.claude`).
- `tools/drill/ci/drill-ci.ts` and `tools/drill/rebuild-drill.ts` already use `git ls-files`.

There is a related gap that is not this ticket's blind spot: the root walkers in `adapter.test.ts`
also descend into a gitignored `tmp/` if one exists (the "local tmp breaks guards" problem). `0250`
owns the `tmp/` excludes, so it is left alone here to keep the merge mechanical.

**Verification (in this worktree):** all amplify.yml build-phase guards pass, except
`check-secret-storage.mjs`, which refuses to run locally without `AWS_APP_ID`/`AWS_BRANCH`. That
is an environment limit, not a finding, and its `--self-test` passes. `npm run typecheck`,
`npm run lint`, `npx vitest run` (268 files, 4462 passed, 1 skipped), `npm run build` and the
post-build guards all pass. In one full run with the fake worktree present,
`amplify/pitr-tables.test.ts` timed out once at 6 s while sibling agents were loading the machine.
It passes on its own and in the clean full run.

## Operator validation

None needed: a test-only change, proven by the suite with a worktree present.

**Smoke test, 2026-10-26 (orchestrator):** the wave-1 gate on main ran with all four agent
worktrees still under `.claude/worktrees/`, which is the exact condition that failed capability 15's
gate. All 38 amplify.yml checks passed, `npm test` included, before any worktree was removed.
