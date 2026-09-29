---
id: 225
slug: audit-xp-not-lower-compare-xp-against-snapshots-skillstate-i
title: Audit xp-not-lower: compare XP against snapshots/skillstate/ instead of failing
type: feature
priority: high
status: open
size: s
capability: 09-xp-engine-and-ledger
depends_on: []
blocked_by: []
source: agent
created: 2026-09-29T18:16:15Z
---

## Description

`tickets.mjs audit`'s `xp-not-lower` row (`§4`, D-153) has been n/a because nothing wrote
`snapshots/skillstate/`. `0067` now writes it, so the row FAILS on purpose (`0183`): *"the
skill-state snapshot now exists … but no XP comparison is implemented"*. **Capability 09's audit
cannot pass until this lands.** Filed by the agent during `0067`, as agreed with the operator
before the work started.

Build the comparison the way `fog-no-refog` does it:

- Read the newest `snapshots/skillstate/<uid>/*.json` per user (the key sorts by ISO `takenAt`).
- Compare it against a per-user XP baseline in `docs/capabilities/regression-baseline.json`,
  keyed `sha256(sub)[:16]` like the fog entries.
- Raise the baseline only in `audit --record`, taking the per-field max.

The snapshot's shape is `src/pipeline/skillstate-snapshot.ts` (`SkillStateSnapshot`), and D-259
records it.

## Acceptance criteria

- [ ] `xp-not-lower` reads the newest snapshot per user from the bucket `amplify_outputs.json` names,
      and ERRs, rather than passing, when it cannot.
- [ ] It FAILS when any baselined user's per-skill `displayedXp`, or the max of `level` and
      `levelHighWater`, is below the baseline, or when a baselined user has no snapshot at all.
      It names the user key, the skill and both numbers.
- [ ] With no baseline recorded it is n/a with the observed figures, and `--record` sets the
      baseline. The baseline never falls, `--force` included.
- [ ] The comparison is a pure exported function with self-tests in `tickets.test.mjs`, alongside
      `compareFog`'s. The `0183` test that asserts FAIL-until-implemented is updated to match.
- [ ] `node .claude/skills/tickets/scripts/tickets.mjs audit 09-xp-engine-and-ledger` shows
      the row PASS or n/a-with-figures against the real bucket.

## Notes

Pure audit tooling. It changes nothing in `src/`. The baseline file already holds the fog entries
(D-225-style ratchet, see the `0183` decision), and this adds an `xp` section beside them.

## Operator validation

None for the operator: this is agent tooling with nothing to look at. The smoke test is the real
`audit 09-xp-engine-and-ledger` run against the deployed bucket, recorded here at close.
