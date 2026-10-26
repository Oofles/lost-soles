---
id: 310
slug: decide-whether-a-re-process-with-zero-new-cells-should-regen
title: Decide whether a re-process with zero new cells should regenerate the explored blob
type: chore
priority: low
status: closed
size: s
capability: 18-mvp-hardening
depends_on: []
blocked_by: []
source: agent
created: 2026-10-22T19:51:44Z
started: 2026-10-26T20:04:43Z
closed: 2026-10-26T20:33:15Z
---

## Description

After the receipt TTL, or on `reingest`, re-processing an already-ingested activity still bumps `generation`, re-PUTs the explored blob over identical cells, sends `ADD exploredChildren 0`, re-puts T3 and writes the receipt's DONE. None of these moves XP or the map, and `src/pipeline/idempotency.test.ts` (0116) pins the list. But 0116's idempotency criterion asked for a write count of zero, which holds literally only inside the TTL. Found by the 0116 agent, wave 18.1.

## Acceptance criteria

- [x] A decision is recorded (D-454: the list is accepted as value-idempotent): either the list is accepted as value-idempotent, or zero-new-cell re-processes skip the generation bump and blob PUT.
- [x] (Not applicable: D-454 did not skip.) If skipped, `idempotency.test.ts` asserts zero aggregate and blob writes, and the drill still passes.

## Notes

A generation bump with identical content invalidates every client's cached blob for nothing, which is a cost argument for skipping it.

## Operator validation

**None owed.** The decision keeps the shipped behaviour; no code changed and nothing was deployed.
`src/pipeline/idempotency.test.ts` already pins the accepted write list and stays green.

## Resolution

**Decided by the operator, 2026-10-26, at wave 18.5: accept as value-idempotent (D-454).**

The orchestrator offered two options: accept the list, or skip the generation bump and blob PUT on
zero new cells. Before recording, it checked the reason it had given for accepting.
`src/pipeline/explored-blob-store.ts` merges this activity's cells into the previous generation, and
its error path says a crash after T6's writes is healed because "a redelivery republishes". To that
redelivery, those cells already look written, so a zero-new-cell skip would leave the map without
them permanently. Avoiding that would need a separate heal path. The cost of accepting is one
redundant blob download per cached client per re-process, and re-processes are rare.

`0116`'s literal "write count of zero" criterion holds inside the receipt TTL. Past it, D-454 is
the rule. No code changed. Files touched: `docs/decisions/DECISIONS.md` (D-454).
