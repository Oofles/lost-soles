---
id: 338
slug: delete-account-exits-0-on-closed-stdin
title: delete-account.ts exits 0 when stdin closes at the typed-uid prompt
type: bug
priority: low
status: open
size: s
capability: 16-rebuild-drill
depends_on: []
blocked_by: []
source: agent
created: 2026-11-03T18:26:02Z
---

## Description

Found by `0333`'s agent while dry-running the script with `< /dev/null`. This dates from `0106`. `tools/account-deletion/delete-account.ts` asks with `readline.question`, and on a closed stdin that promise never settles. The event loop drains and the process exits **0**, where an unconfirmed run should exit 3 (refused, nothing changed). Nothing is written: the prompt is before any delete. The cost is that a scripted or CI invocation reads a refusal as success.

## Acceptance criteria

- [ ] A closed stdin (EOF) at any `ask` prompt, the typed uid or step 3's `done` (D-477), is treated
      as "not confirmed": the run exits 3 with the same "nothing was changed" message as a
      mistyped answer. Tested with a stdin that ends before the answer.

## Steps to reproduce

1. `AWS_PROFILE=devault npx vite-node --config vitest.config.ts tools/account-deletion/delete-account.ts -- --user 00000000-0000-4000-8000-000000000333 --resume < /dev/null; echo exit=$?`
2. The preflight runs and the typed-uid prompt prints.

## Expected vs actual

**Expected:** the run is refused, and `exit=3`.

**Actual:** the process ends at the prompt with `exit=0`. Nothing is written.

## Notes

The likely fix is listening for readline's `close` and rejecting the pending question, or
`AbortSignal` on `question`. The dry run in Steps to reproduce is read-only and safe.

## Operator validation

None for the operator. Agent: the test, plus the repro command now printing `exit=3`.

D-123 trigger checked? none. This is an exit code on an existing refusal path, and no identity, share or public route is touched.
