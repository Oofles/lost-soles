---
id: 310
slug: decide-whether-a-re-process-with-zero-new-cells-should-regen
title: Decide whether a re-process with zero new cells should regenerate the explored blob
type: chore
priority: low
status: open
size: s
capability: 18-mvp-hardening
depends_on: []
blocked_by: []
source: agent
created: 2026-10-22T19:51:44Z
started: 2026-10-26T20:04:43Z
---

## Description

After the receipt TTL, or on `reingest`, re-processing an already-ingested activity still bumps `generation`, re-PUTs the explored blob over identical cells, sends `ADD exploredChildren 0`, re-puts T3 and writes the receipt's DONE. None of these moves XP or the map, and `src/pipeline/idempotency.test.ts` (0116) pins the list. But 0116's idempotency criterion asked for a write count of zero, which holds literally only inside the TTL. Found by the 0116 agent, wave 18.1.

## Acceptance criteria

- [ ] A decision is recorded: either the list is accepted as value-idempotent, or zero-new-cell re-processes skip the generation bump and blob PUT.
- [ ] If skipped, `idempotency.test.ts` asserts zero aggregate and blob writes, and the drill still passes.

## Notes

A generation bump with identical content invalidates every client's cached blob for nothing, which is a cost argument for skipping it.

## Operator validation

None: no visible change either way.

D-123 trigger checked? none.
