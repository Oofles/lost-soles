---
id: 283
slug: cdk-synth-tests-leak-cdk-out-directories-into-tmp
title: CDK synth tests leak cdk.out directories into /tmp
type: chore
priority: med
status: open
size: m
capability: 18-mvp-hardening
depends_on: []
blocked_by: []
source: agent
created: 2026-10-16T15:19:43Z
---

## Description

Every `amplify/*-stack.test.ts` synth leaves a `/tmp/cdk.out*` directory of about 48 MB behind.
On 2026-10-16, during capability `14`'s wave 1, about 380 of them filled the 16 GB `/tmp` tmpfs,
and `npx vitest run` reported 14 false failures until the agent deleted them. That is the same
"full `/tmp`" false failure the local-guards note warns about, with a second source.

## Acceptance criteria

- [ ] Each synth test writes to a temporary outdir it removes afterwards, even when the test fails
      (`afterAll`/`finally`).
- [ ] A full `npx vitest run` leaves no new `/tmp/cdk.out*` entries, checked by a before/after count.

## Notes

Filed by `0091` (wave 1, capability `14`). It is likely one shared helper the stack tests already
call; check `amplify/*-stack.test.ts` for the synth entry point before touching each file.

## Operator validation

None: build hygiene. Smoke: `ls -d /tmp/cdk.out* | wc -l` before and after a full suite run.
