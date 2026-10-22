---
id: 312
slug: tickets-mjs-waves-serializes-a-wide-layer-s-chunks-so-a-tick
title: tickets.mjs waves serializes a wide layer's chunks, so a ticket unblocked early waits for the whole layer
type: bug
priority: med
status: open
size: s
capability: 18-mvp-hardening
depends_on: []
blocked_by: []
source: agent
created: 2026-10-22T19:51:44Z
---

## Description

`planWaves` (`tickets.mjs` ~1806-1818) builds whole topological layers first, then cuts each layer into chunks of `max`. Each chunk becomes its own wave, and the next layer starts only after the last chunk. In capability 18, 0113 depends on 0293, which is in wave 1, yet 0113 is planned for wave 7, behind every other ticket of layer 1. A high-priority ticket waits on unrelated low-priority ones. Found by the orchestrator, wave 18.1.

## Steps to reproduce

1. `node .claude/skills/tickets/scripts/tickets.mjs waves 18` before wave 18.1 merges.
2. Find 0113 (high, depends on 0293 in wave 1).

## Expected vs actual

**Expected:** 0113 is in wave 2, the first wave after 0293's, ordered by priority among everything ready then.
**Actual:** 0113 is in wave 7.

## Acceptance criteria

- [ ] Waves are filled greedily: each wave takes up to `max` of the tickets whose in-capability deps are all in earlier waves, highest priority first, ties by lowest id.
- [ ] A test with a wide layer and one ticket depending on the first chunk places that ticket in wave 2.
- [ ] Existing waves tests still pass, or are updated with the reason.

## Notes

The `held` and `GATED` reporting should not change.

## Operator validation

None: tooling. The waves output is the check.

D-123 trigger checked? none.
