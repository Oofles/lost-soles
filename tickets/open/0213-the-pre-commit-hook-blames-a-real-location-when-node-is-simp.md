---
id: 213
slug: the-pre-commit-hook-blames-a-real-location-when-node-is-simp
title: The pre-commit hook blames a real location when node is simply not on PATH
type: bug
priority: low
status: open
size: s
capability: 08-map-and-fog-renderer
depends_on: []
blocked_by: []
source: agent
created: 2026-09-28T15:07:27Z
started: 2026-09-28T16:24:49Z
---

## Description

## Description

`.githooks/pre-commit` runs `node scripts/check-fixture-geography.mjs` whenever a `__fixtures__/`
file is staged. If `node` is not on the hook's PATH (a non-login shell under `fnm` — found in ticket
`0200`'s session), the command fails with `node: command not found` and the hook then prints
**"COMMIT BLOCKED: a staged fixture carries a real location"**. That accuses clean data of leaking a
GPS track. Blocking is right, since a guard that cannot run is broken (§7.3, the same reasoning as
the missing-scanner branch just above it). The message is wrong.

## Steps to reproduce

1. Stage any file under `lib/**/__fixtures__/`.
2. `git commit` from a shell where `command -v node` fails.

## Expected vs actual

**Expected:** blocked, with *"node is not on PATH, so fixture coordinates were never checked"*.
**Actual:** blocked, claiming a real location was found.

## Acceptance criteria

- [x] The hook checks `command -v node` before running the scanner and fails with a message that
      names the missing interpreter, mirroring the missing-scanner branch.
      — Amended in scope, see `## Resolution`: layer 3 (skill frontmatter) had the identical
      defect in the same file, and it gets the same guard.
- [x] `scripts/pre-commit-hook.test.mjs` covers the no-node case.

## Notes

Cheap. Found while committing `0200`.


## Acceptance criteria

- [ ] TODO

## Steps to reproduce

1. TODO

## Expected vs actual

**Expected:** TODO

**Actual:** TODO

## Notes

TODO

## Operator validation

TODO

## Resolution

**Fixed in `.githooks/pre-commit`: a `require_node` helper runs before each node-backed layer.**
Without `node`, the hook still blocks, since a guard that cannot run is broken (§7.3). It now says
*"node is not on PATH, so <what> was never checked. This is the environment, not your staged
content."* The old message accused the data.

**One amendment to scope, stated rather than slipped in.** Layer 3, the SKILL.md frontmatter check,
had the same defect one screen above: `! node scripts/check-skills.mjs` in an `if`. Without node it
would have blocked with *"a staged SKILL.md has unparseable frontmatter"* against a valid file. The
cause, the file and the fix are all the same, so it gets the same one-line guard. The criterion only
named the fixture layer because that was the one that fired during `0200`.

**Tests.** `scripts/pre-commit-hook.test.mjs` gains a `withoutNode` option on `runHook`. It removes
`node` from the hook's stripped PATH after `makeBin` builds it, since `makeBin` still refuses to build
a PATH missing `node` by accident. There are two new cases:
- Layer 4, with a **synthetic** (Point Nemo) fixture: blocks, says `node is not on PATH`, and does
  not say `carries a real location`.
- Layer 3, with a **valid** SKILL.md: blocks, names node, and does not say `unparseable`.

Sabotage check: with the new tests and the old hook (`git show HEAD:.githooks/pre-commit`), both new
cases fail (2 failed, 34 passed). With the new hook: 36 passed, 1 skipped (the existing real-gitleaks
case). Full suite: green. `bash -n` is clean. `shellcheck` is not installed here, so it was not run.

## Operator validation

None needed. This is invisible tooling with nothing to look at. The hook test runs the real hook the
way git does, in a throwaway repo with a controlled PATH, which is the smoke test. This commit also
went through the patched hook with node on PATH.
