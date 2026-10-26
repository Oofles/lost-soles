---
id: 315
slug: tickets-yml-passes-a-commit-that-deletes-tickets-index-json
title: tickets.yml passes a commit that deletes tickets/index.json
type: bug
priority: low
status: open
size: s
capability: 18-mvp-hardening
depends_on: []
blocked_by: []
source: agent
created: 2026-10-26T12:32:10Z
started: 2026-10-26T20:52:53Z
---

## Description

Found by `0231` (D-446). `tickets.yml` checks `tickets/index.json` with `tickets.mjs index` and then
`git diff --exit-code`. A commit that deletes `tickets/index.json` leaves the regenerated file
untracked, and `git diff` ignores untracked files, so CI passes a tree with no index. The pre-commit
hook agrees with CI by design (D-446), so neither layer catches it.

## Steps to reproduce

1. `git rm tickets/index.json && git commit -m x` (with the hook's layer 5 passing per D-446).
2. Push. `tickets` is green.

## Expected vs actual

**Expected:** CI fails when the committed tree has no `tickets/index.json`.

**Actual:** CI passes.

## Acceptance criteria

- [x] `tickets.yml` fails when `tickets/index.json` is missing from the committed tree, using
      `git status --porcelain` or `git ls-files --error-unmatch` as well as `git diff --exit-code`.
- [x] The pre-commit hook's layer 5 is tightened to match, so the two still agree (D-446).

## Notes

Low priority: nothing deletes the file in normal work.

## Operator validation

None: CI configuration. Proven by a test or a throwaway push showing the red run.

**Result, 2026-10-26.** The red run was proven before merge, in a scratch clone: on a commit that
deletes the index, `git ls-files --error-unmatch tickets/index.json` exits 1, and the old step's
`git diff --exit-code` exits 0. After the push, GitHub Actions `tickets` run 40401641127 on
`ffa90a3` completed `success` in 25 s, so the new presence check passes a normal tree. The hook
tests (64 pass) cover layer 5's block.

## Resolution

**Files touched**

- `.github/workflows/tickets.yml`: the "index.json is current" step now runs
  `git ls-files --error-unmatch tickets/index.json` **before** `tickets.mjs index`, failing with
  "tickets/index.json is missing from the commit". The existing regenerate + `git diff --exit-code`
  check is unchanged after it.
- `scripts/check-staged-indexes.mjs` (the hook's layer 5 checker): an index absent from the staged
  tree now returns 1 with the same fix text as a stale one ("missing from the staged tree", then
  `tickets.mjs index` / `git add tickets/index.json`). Under 0231 it returned 0 on purpose, to agree
  with CI. The header comment now describes CI's new presence check.
- `scripts/pre-commit-hook.test.mjs`: a new layer-5 test, "blocks a commit that deletes
  tickets/index.json, naming the fix (0315)". `ciVerdict()`, the test's independent model of CI,
  now runs the same `ls-files --error-unmatch` before regenerating. The "agrees with CI on every
  staged tree" scenario for a deleted index is renamed "(both block, 0315)". It still asserts
  hook verdict == CI verdict, and both are now 1.
- `.githooks/pre-commit` itself is unchanged: layer 5 already reaches the checker for a staged
  deletion (0231 lists `$index_paths` without a diff filter), so the checker was the only place
  that needed tightening.

**Decisions.** I chose `ls-files --error-unmatch` over `git status --porcelain` (the ticket allows
either). It asks the committed tree directly whether the path is tracked, and it is checked before
regeneration, so it does not depend on what the generator leaves behind. No new D-xxx: D-446's rule
(the hook and CI judge the same thing) holds, and both layers were tightened together, as D-446
expected when it ticketed this gap. Under D-446 the hook was never meant to be stricter than CI.

**Proof that CI now fails.** In a scratch clone
(`/tmp/claude-1000/.../scratchpad/ciclone`, not this branch), the new `tickets.yml` was committed
with `git rm tickets/index.json` (throwaway commit `a453e65`). Each line of the step was run in turn
(the sandbox refused a script):
`git ls-files --error-unmatch tickets/index.json` → `error: pathspec 'tickets/index.json' did not
match any file(s) known to git`, **exit 1** (the new step fails here). `tickets.mjs index` regenerated
the file (exit 0), and `git diff --exit-code tickets/index.json` then returned **exit 0** with
`git status --porcelain` showing `?? tickets/index.json`. That reproduces the original bug, which
was the old step's only verdict.

**Gate run in the worktree:** every amplify.yml build-phase guard (with
`AWS_APP_ID`/`AWS_BRANCH` set for `check-secret-storage --require-literals`), `npm audit`,
`drill:ci`, typecheck, lint, `npx vitest run`, `npm run build`, the post-build guards,
`tickets.test.mjs` and `check-skills.mjs`. All exited 0.


**Orchestrator, at merge (2026-10-26):** recorded as D-458, which closes the gap D-446 left open.
