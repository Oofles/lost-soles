---
id: 225
slug: audit-xp-not-lower-compare-xp-against-snapshots-skillstate-i
title: Audit xp-not-lower: compare XP against snapshots/skillstate/ instead of failing
type: feature
priority: high
status: closed
size: s
capability: 09-xp-engine-and-ledger
depends_on: []
blocked_by: []
source: agent
created: 2026-09-29T18:16:15Z
started: 2026-09-29T21:22:25Z
closed: 2026-09-29T21:25:21Z
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

- [x] `xp-not-lower` reads the newest snapshot per user from the bucket `amplify_outputs.json` names,
      and ERRs, rather than passing, when it cannot.
- [x] It FAILS when any baselined user's per-skill `displayedXp`, or the max of `level` and
      `levelHighWater`, is below the baseline, or when a baselined user has no snapshot at all.
      It names the user key, the skill and both numbers.
- [x] With no baseline recorded it is n/a with the observed figures, and `--record` sets the
      baseline. The baseline never falls, `--force` included.
- [x] The comparison is a pure exported function with self-tests in `tickets.test.mjs`, alongside
      `compareFog`'s. The `0183` test that asserts FAIL-until-implemented is updated to match.
- [x] `node .claude/skills/tickets/scripts/tickets.mjs audit 09-xp-engine-and-ledger` shows
      the row PASS or n/a-with-figures against the real bucket.

## Notes

Pure audit tooling. It changes nothing in `src/`. The baseline file already holds the fog entries
(D-225-style ratchet, see the `0183` decision), and this adds an `xp` section beside them.

## Operator validation

None for the operator: this is agent tooling with nothing to look at (D-229).

**Smoke test, run by the agent 2026-09-29 against the deployed bucket** (`devault` profile, bucket
from `amplify_outputs.json`): `node .claude/skills/tickets/scripts/tickets.mjs audit
09-xp-engine-and-ledger` →

```
n/a  xp-not-lower   no recorded baseline yet — the next 'audit --record' sets it (1 user(s):
                    cartography 13455/L22, constitution 1405/L10, wayfaring 4218/L15)
```

It read the one real snapshot
(`snapshots/skillstate/<sub>/2026-09-29T18:28:59.948Z-63.json`). `fog-no-refog` still PASSes in the
same run (cells 1035 → 1035, gen 61 → 63), so moving the S3 helpers did not disturb it. The first XP
baseline gets written by capability 09's `audit --record`, not here: recording is the audit's job.

## Resolution

**Files:** `.claude/skills/tickets/scripts/tickets.mjs`, `.claude/skills/tickets/scripts/tickets.test.mjs`.
Nothing in `src/`, and `regression-baseline.json` is unchanged until the next recorded audit.

- **`xpNotLower()`** keeps its 0183 arming predicate (non-test source referencing
  `snapshots/skillstate/`). From there it mirrors `fogNoRefog()`: ERR on an unreadable baseline,
  a missing bucket, a failed S3 read or an unrecognised snapshot shape. With no XP baseline it is
  n/a with the observed figures (skills above 0 xp, as `skill xp/Llevel`), and otherwise PASS or
  FAIL. FAIL says `XP DECREASED` and names the user key, the skill and both numbers.
- **`readSkillSnapshots(bucket)`** lists `snapshots/skillstate/`, takes the key that sorts last per
  uid (the filename leads with ISO `takenAt`), and maps each skill to
  `{ displayedXp, level: max(level, levelHighWater) }` under `userKey(sub)`. It checks the shape
  itself: a skill without a string `skillId` and numeric `displayedXp`/`level`/`levelHighWater`
  throws, so a changed D-259 shape shows as ERR rather than a silent pass.
- **`compareXp(baseline, current)`** is pure and exported. A baselined user with no snapshot, or a
  baselined skill missing from the newest snapshot, counts as a regression, since XP that vanished
  is the largest decrease there is. New users and skills do not.
- **`advanceBaseline()`** now ratchets both sections with a per-field max. It returns
  `{ fog, xp }` lists and `--record` prints `XP baseline raised` next to the fog line. A section
  this audit didn't read is written back unchanged. The file's `note` now describes the `xp`
  section. Because it only takes maxima, `--force` cannot lower it, and a test checks that.
- **Refactor:** the S3 listing and reading moved out of `readManifests` into `s3Keys` and `s3Json`,
  which both rows share. Behaviour is unchanged, including the "empty prefix → exit 1" allowance.

**Tests:** the 0183 test that asserted FAIL-until-implemented now asserts n/a naming the empty
bucket once armed. I added 12 tests: ERR on S3 and bucket failures, ERR on an unknown shape, n/a
then record then PASS with the sub hashed, newest-snapshot selection, three injected regressions,
a lower `level` with `levelHighWater` still at the baseline passing, a user with all snapshots gone,
a forced record that neither lowers XP nor drops fog, and pure `compareXp` cases. The fake `aws` in
the fixture now lists any prefix instead of hard-coding `users/*/manifest.json`. Result: 168/168.

**A judgement call I made without asking:** a skill whose `level` fell while its `levelHighWater`
did not **passes**. The criterion compares `max(level, levelHighWater)`, which is the level the
user has been shown, and D-135 protects exactly that. A curve change that re-derives `level`
lower is D-135's business, recorded in the high-water mark, and not a regression.

No new D-xxx: the ticket and 0183 already settle the design.
