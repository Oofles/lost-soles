---
id: 283
slug: cdk-synth-tests-leak-cdk-out-directories-into-tmp
title: CDK synth tests leak cdk.out directories into /tmp
type: chore
priority: med
status: closed
size: m
capability: 18-mvp-hardening
depends_on: []
blocked_by: []
source: agent
created: 2026-10-16T15:19:43Z
closed: 2026-10-26T02:05:59Z
---

## Description

Every `amplify/*-stack.test.ts` synth leaves a `/tmp/cdk.out*` directory of about 48 MB behind.
On 2026-10-16, during capability `14`'s wave 1, about 380 of them filled the 16 GB `/tmp` tmpfs,
and `npx vitest run` reported 14 false failures until the agent deleted them. That is the same
"full `/tmp`" false failure the local-guards note warns about, with a second source.

## Acceptance criteria

- [x] Each synth test writes to a temporary outdir it removes afterwards, even when the test fails
      (`afterAll`/`finally`). *Met by `0230`: every test file gets its own `TMPDIR`, removed in
      `afterAll`, and swept at teardown if the file threw at module scope.*
- [x] A full `npx vitest run` leaves no new `/tmp/cdk.out*` entries, checked by a before/after count.
      *Met by `0230`: `scripts/vitest-global-setup.mjs` counts before and after on every run and
      fails it on a new entry.*

## Notes

Filed by `0091` (wave 1, capability `14`). It is likely one shared helper the stack tests already
call; check `amplify/*-stack.test.ts` for the synth entry point before touching each file.

## Operator validation

None for the operator. Smoke test as for `0230` (2026-10-25, `main` at `3955546`): a full gate run
on a clean worktree left the `/tmp/cdk.out*` count unchanged (20 → 20) and no per-file dirs.

## Resolution

**Closed as a duplicate of `0230`**, which fixed the same leak (`c21716b`). That fix is in the
vitest config (`globalSetup` + `setupFiles`), not in a helper, so it covers all 18 synth-calling
`amplify/*.test.ts` suites, every `*-stack.test.ts` this ticket names included, and any added
later. The shared helper this ticket's Notes guessed at does not exist and is not needed. No code
was written under this ticket.

