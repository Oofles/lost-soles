---
id: 67
slug: skillstate-snapshot-writer
title: snapshots/skillstate/ writer — the one documented exception to D-101
type: feature
priority: high
status: open
size: s
capability: 09-xp-engine-and-ledger
depends_on: [62, 63, 66]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
---

## Description

**D-101** says user-supplied files are the system of record and everything else is
reconstructible from raw. **D-143 names the single documented exception:** D-135 requires
knowing what the user was *shown*, and **what was displayed is not derivable from raw files**.
A GPX tells you the run happened; it cannot tell you that the app once printed `Wayfaring 47`
on the screen.

So the displayed state is snapshotted to S3 under `snapshots/skillstate/`, and those snapshots
are the durable waterline that the replay job's step 0 reads when live `SkillState` is gone —
after a table rebuild, a region move, or the scheduled rebuild drill.

Written at two moments:

1. **After every successful ingest transaction** — cheap, append-only, keyed by generation.
2. **In replay step 0**, before anything is cleared, as the pre-flight waterline.

Contents per snapshot: `userId`, `takenAt`, `rulesVersion`, `generation`, and per skill
`{skillId, displayedXp, xpLedgerSum, level, levelHighWater, firstSeenRulesVersion}`.

Retained forever. At six users and a few thousand activities this is kilobytes.

## Acceptance criteria

- [ ] A snapshot object is written to `snapshots/skillstate/<userId>/<takenAt>-<generation>.json`
      after each successful ingest transaction and in replay step 0.
- [ ] The object carries every field listed above for every skill, including skills at level 1
      with zero XP.
- [ ] Writing is **outside** the ingest transaction and its failure never fails an ingest — a
      missed snapshot is logged, not fatal.
- [ ] Snapshots are immutable: the key includes `takenAt` and the write uses
      `IfNoneMatch`/no-overwrite semantics.
- [ ] The replay job can read the most recent snapshot for a user and use it as the D-135
      waterline when `SkillState` is empty, and a test proves that path by truncating T2.
- [ ] A rebuild-drill test restores from raw traces plus the latest snapshot and asserts
      every skill's rebuilt `displayedXp` is **≥** the snapshot's (drill step 8, check 4).
- [ ] The exception is documented in the code at the write site with a one-line comment naming
      **D-143** and why raw is insufficient — so nobody later "simplifies" it away as derivable.
- [ ] Snapshots are covered by the same encryption and lifecycle policy as the rest of the
      bucket, and by account deletion.

## Notes

This is deliberately the *last* ticket in the capability: it snapshots the output of everything
before it, and writing it earlier means writing it twice.

Keep the format plain JSON, not a binary blob. It is read by a human exactly once — during an
incident — and that is the moment when a clever encoding costs the most.

The snapshot is not a backup of the ledger; the ledger is already durable and append-only. It is
a record of *display*, which is a different fact with a different lifetime.

## Operator validation

Not on-screen. Validate from the **AWS console on the laptop, with the phone beside it**: after
completing a run and watching the `/skills` panel update on the **Pixel 8 Pro**, open the S3
bucket and find the newest object under `snapshots/skillstate/`. Open it and check that the
levels in the JSON match, skill for skill, the levels currently on the phone's screen. If any
number differs, the snapshot is being taken at the wrong point in the transaction.
