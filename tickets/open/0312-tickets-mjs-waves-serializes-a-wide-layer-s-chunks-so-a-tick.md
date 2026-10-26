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
started: 2026-10-26T15:07:00Z
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

- [x] Waves are filled greedily: each wave takes up to `max` of the tickets whose in-capability deps are all in earlier waves, highest priority first, ties by lowest id.
- [x] A test with a wide layer and one ticket depending on the first chunk places that ticket in wave 2.
- [x] Existing waves tests still pass, or are updated with the reason.

## Notes

The `held` and `GATED` reporting should not change.

## Operator validation

None: tooling. The waves output is the check.

D-123 trigger checked? none.

## Resolution

`planWaves` now fills waves greedily instead of cutting whole topological layers into chunks.
Each pass takes the tickets whose in-capability `depends_on` are all in earlier waves, sorts them
by priority then id, and places the first `width` as the next wave. Tickets that were ready but not
taken stay in the pool and compete with whatever the new wave unblocks. `held` and the cycle check
are unchanged: a stuck ticket that depends on a held one is held, and an empty ready set with
tickets left over marks them as a cycle. Every pass places at least one ticket, so it terminates.
`GATED` is untouched (it comes from `auditBlockers`, not the planner).

**Files touched**
- `.claude/skills/tickets/scripts/tickets.mjs`: `planWaves` greedy fill, doc comment updated.
- `.claude/skills/tickets/scripts/tickets.test.mjs`: new 0312 test (six-wide layer at `--max 2`, a
  high ticket depending on wave 1 lands in wave 2, and its own dependent follows). It fails on the
  old planner, which gives `[[1,2],[3,4],[5,6],[113],[114]]`.
- `docs/capabilities/WAVES.md` §1: one paragraph saying waves fill greedily, and that a ticket meant
  to run last runs as soon as its declared deps allow.

**Existing tests:** all five 0269 waves tests pass unchanged. Their fixtures have no wide layer with
a dependent, so layers and greedy give the same plan.

**D-312's text** says `tickets.mjs waves` "layers a capability's open tickets by `depends_on`".
That is still accurate as a loose description, so no superseding decision is needed.

**`waves 18` before** (19 open, 6 waves):
1. 0112, 0307, 0308, 0312
2. 0175, 0216, 0259, 0268
3. 0275, 0290, 0297, 0303
4. 0309, 0310, 0311, 0315
5. 0316, 0317
6. 0117

**`waves 18` after** (19 open, 5 waves):
1. 0112, 0307, 0308, 0312
2. 0117, 0175, 0216, 0259
3. 0268, 0275, 0290, 0297
4. 0303, 0309, 0310, 0311
5. 0315, 0316, 0317

0113 is already closed, so the ticket's own example no longer shows. The visible effect is 0117
(high). Its only open in-capability dep is 0112, so it now moves to wave 2. 0117 is the MVP
definition-of-done sweep, which in spirit runs last. Its `depends_on` lists only
101/105/106/112–116, so the planner does what is declared. If the sweep should wait for the rest
of capability 18, that is a `depends_on` change on 0117 for the orchestrator. It is not a planner
change.
