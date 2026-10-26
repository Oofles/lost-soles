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

- [ ] `tickets.yml` fails when `tickets/index.json` is missing from the committed tree, using
      `git status --porcelain` or `git ls-files --error-unmatch` as well as `git diff --exit-code`.
- [ ] The pre-commit hook's layer 5 is tightened to match, so the two still agree (D-446).

## Notes

Low priority: nothing deletes the file in normal work.

## Operator validation

None: CI configuration. Proven by a test or a throwaway push showing the red run.
