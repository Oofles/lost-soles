---
id: 237
slug: retained-floor-id-collides-across-replays
title: A second replay over the same version pair collides on the retained_floor id and wedges ingest
type: bug
priority: med
status: open
size: s
capability: 09-xp-engine-and-ledger
depends_on: []
blocked_by: []
source: agent
created: 2026-10-02T15:19:39Z
---

## Description

**Found by capability 09's drift audit (2026-10-02).** The `retained_floor` row id is
`__floor__#<skill>#v<from>-<to>` (`src/scoring/floorId`, `src/scoring/reconcile.ts:41`), unique only
per (skill, from-version, to-version). The floor put is conditional on `attribute_not_exists(id)`
(`src/pipeline/xp-replay-store.ts:~389-396`).

A second replay over the **same version pair** that finds a fresh shortfall writes a floor with
an id that already exists. That happens on a repeated v1 → v1 replay (the D-271 remedy) after a
tombstone, or v1 → v2 → v1 → v2. The put throws at step 5, the ReplayRun goes FAILED, and
`replayInProgress` stays up — so every ingest is refused (D-273) until someone clears the flag
by hand.

`reconcile.test.ts:62` only covers re-running the *same* run, which is why this went unseen.

## Acceptance criteria

- [ ] The floor id includes the ReplayRun id (or another per-run discriminator), so two replays
      over the same version pair each write their own floor row. Re-running the *same* run is
      still idempotent.
- [ ] A test replays twice over the same version pair with a shortfall between them, and asserts
      both floors are present and the second run completes.
- [ ] 02-data-model §4.6 states the new id shape, and the known-defect note pointing here is removed.
- [ ] Existing live floor rows keep working: the reader does not depend on the old id shape.

## Steps to reproduce

1. Replay v1 → v1 for a user (`replay-xp.ts --confirm`); a shortfall writes floor `__floor__#<skill>#v1-1`.
2. Tombstone an activity that contributed to that skill.
3. Replay v1 → v1 again: the new shortfall's floor has the same id.

## Expected vs actual

- **Expected:** the second replay writes its own floor and completes; ingest resumes.
- **Actual:** the conditional put throws, the ReplayRun is FAILED, `replayInProgress` stays up, and every ingest is refused.

## Notes

TODO

## Operator validation

TODO
