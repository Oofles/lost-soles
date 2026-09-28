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

- [ ] The hook checks `command -v node` before running the scanner and fails with a message that
      names the missing interpreter, mirroring the missing-scanner branch.
- [ ] `scripts/pre-commit-hook.test.mjs` covers the no-node case.

## Notes

Cheap. Found while committing `0200`.

## Operator validation

None needed. The hook test proves it.

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
