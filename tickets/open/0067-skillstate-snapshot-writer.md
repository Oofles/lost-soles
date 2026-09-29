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
started: 2026-09-29T18:09:07Z
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

- [x] A snapshot object is written to `snapshots/skillstate/<userId>/<takenAt>-<generation>.json`
      after each successful ingest transaction and in replay step 0.
- [x] The object carries every field listed above for every skill, including skills at level 1
      with zero XP.
- [x] Writing is **outside** the ingest transaction and its failure never fails an ingest — a
      missed snapshot is logged, not fatal.
- [x] Snapshots are immutable: the key includes `takenAt` and the write uses
      `IfNoneMatch`/no-overwrite semantics.
- [x] The replay job can read the most recent snapshot for a user and use it as the D-135
      waterline when `SkillState` is empty, and a test proves that path by truncating T2.
- [x] A rebuild-drill test restores from raw traces plus the latest snapshot and asserts
      every skill's rebuilt `displayedXp` is **≥** the snapshot's (drill step 8, check 4).
- [x] The exception is documented in the code at the write site with a one-line comment naming
      **D-143** and why raw is insufficient — so nobody later "simplifies" it away as derivable.
- [x] Snapshots are covered by the same encryption and lifecycle policy as the rest of the
      bucket, and by account deletion.

## Notes

This is deliberately the *last* ticket in the capability: it snapshots the output of everything
before it, and writing it earlier means writing it twice.

Keep the format plain JSON, not a binary blob. It is read by a human exactly once — during an
incident — and that is the moment when a clever encoding costs the most.

The snapshot is not a backup of the ledger; the ledger is already durable and append-only. It is
a record of *display*, which is a different fact with a different lifetime.

## Resolution

**What shipped.** A snapshot of what the user is shown now lands in
`snapshots/skillstate/<uid>/<takenAt>-<generation>.json` after every ingest commit and in replay
step 0. When T2 is empty, step 0 takes its D-135 waterline from the newest snapshot.

- **`src/pipeline/skillstate-snapshot.ts`** (new). Its functions:
  - `buildSnapshot` is pure. It covers every registry skill, untrained ones included, plus any T2
    row the registry lacks. `level` falls back to the curve because ingest does not write it until
    `0219`. `levelHighWater` is never below `level`, and `firstSeenRulesVersion` falls back to the
    registry's `introducedIn`.
  - `writeSnapshot` sends a `PutObject` with `IfNoneMatch: "*"` and carries the D-143 comment at
    the write site.
  - `latestSnapshot` pages `ListObjectsV2` and takes the greatest key, since ISO `takenAt` sorts.
  - `waterlineOfSnapshot` leaves out untrained skills. Otherwise step 6 would create zero-XP T2
    rows that never existed.
  - `readShownRows` is the T2 read, now shared with the replay store.
- **Ingest** (`process-activity.ts`). `snapshotAfterIngest` runs after `persistWithLedger`
  returns. It catches every error and returns `{ key } | { failed }` on the result. The generation
  is the one this ingest published, or `manifest.json`'s when nothing was published (a traceless
  activity), or 0. `ProcessDeps` gained `snapshots`, and `registry` widened to include `curve`.
  The handler wires the deps, puts `snapshot` on the info line, and emits
  `outcome: "skillstate-snapshot-failed"` as a **warn** when a snapshot is missed. It never
  throws, so the SQS message is still acked.
- **Replay** (`xp-replay.ts`, `xp-replay-store.ts`). `ReplayStore` gained `latestSnapshot`,
  `writeSnapshot` and `currentGeneration`.
  - Step 0 on a fresh run: when T2 is empty it restores from the newest snapshot, using its
    `rulesVersion` as the from-version. It then writes the pre-flight snapshot **before** `putRun`,
    the freeze or any clear. A failure there is fatal.
  - The pre-flight snapshot **restates the restored skills, not the empty table**. Otherwise a
    replay that failed after step 0 would leave "nothing was shown" as the newest record.
  - A resumed run writes no second snapshot, because its waterline is the first attempt's.
  - `tools/xp-replay/replay-xp.ts` passes `snapshots`.
- **IAM** (`amplify/backend.ts`). New statement `WriteSkillStateSnapshots` gives `s3:PutObject` on
  `snapshots/skillstate/*` and nothing else. The ingest never reads a snapshot back; the replay
  CLI runs under operator credentials.
- **Tests:**
  - `skillstate-snapshot.test.ts` (new, 6 tests).
  - 4 ingest tests in `process-activity.test.ts`: key shape, `IfNoneMatch`, write only after the
    transaction, every field for every skill, the traceless generation, and a failed snapshot not
    failing the ingest.
  - 5 replay tests in `xp-replay.test.ts`: pre-flight ordering, no second snapshot on resume, a
    fatal pre-flight failure, **T2 truncated → waterline from the newest of two snapshots**, and
    **the rebuild drill**.
  - The drill test builds a new empty stack (no T2/T4/T6). Cells are re-derived from the fixture
    traces, the latest snapshot is carried across, and the replay runs to a stingier v2. Every
    skill's `displayedXp` and displayed level come out ≥ the snapshot's, and I-15 holds.
  - Mutation check: disabling the restore makes exactly the truncation test and the drill test
    fail.
  - The handler, IAM-count and grant-shape tests were updated for the new result field and the
    fifth S3 statement.

**Decisions.** **D-259** supersedes `02` §8.2's cadence and key. There is no monthly job; the key
is `<takenAt>-<generation>`; `generation` is the explored-map generation. It also records the
restore semantics. `02` §8.1/§8.2 are amended to match. The operator approved all four points
before work started.

**Follow-ups.**
- Filed **`0225`**. The audit's `xp-not-lower` row now FAILS by design, since source references
  `snapshots/skillstate/` and no comparison exists. **Capability 09's audit cannot pass until
  `0225` lands.**
- Added a dated note to **`0106`** (account deletion): the runbook must delete
  `snapshots/skillstate/<uid>/` and its noncurrent versions. **That note is how the last
  criterion's "and by account deletion" is met.** No deletion code exists yet, because the
  runbook ticket is still open. As agreed with the operator, this ticket records the prefix there
  and builds no deletion. Encryption and lifecycle need no work: the prefix sits in the same
  bucket, so it inherits both (checked live, below).

**What to know.**
- **The restore only happens when T2 is completely empty.** An ingest into an empty T2 *before*
  the replay would write a low snapshot that becomes the newest. §8.3 avoids this by rebuilding
  into a parallel stack, and the amended §8.2 says replay must run before ingest resumes on
  rebuilt tables. The restore does not take a max over every snapshot; nothing required it.
- `takenAt` is the wall clock. It records when the snapshot was taken and is never used for
  scoring, so I-12 does not apply.
- Nothing went wrong in the build. The only surprise was two stale test fixtures: the handler
  mocks predate the result's `snapshot` field, and the IAM statement count grew by one.

## Operator validation

**Nothing here needs the operator** (D-181/D-229). The original text asked for the JSON to be
compared with the `/skills` panel, but that panel is still a stub (see `0066`; the perceptual check
lives in `0073`). The panel reads T2, so the agent compared the snapshot against T2 directly.
Everything below ran on 2026-09-29 against account `286588821906`.

**Automated.**
- `npm run typecheck` and `npm run lint` are clean.
- The full suite passes: 131 files, 2,414 tests.
- Every `scripts/check-*.mjs` gate passes.
- `docs/INDEX.md` is regenerated, and `tickets.mjs validate` reports 0 errors.

**Deploy.** Amplify job 248 (commit `00b98b6`) SUCCEEDED.

**Live smoke test, ingest path: the deployed Lambda, the real queue, real data.**
- `tools/replay/replay-activities.ts --external 20358657069 --confirm` re-ingested one of the
  operator's archived runs through the queue. It was a replay (D-229), so layer 1 awarded nothing:
  the log shows `alreadyScored: true`.
- The worker's info line carried
  `snapshot: {key: "snapshots/skillstate/5488e4b8-…/2026-09-29T18:28:59.948Z-63.json"}`.
- The object's contents: `trigger: "ingest"`, `rulesVersion: 1`, `generation: 63`, which equals
  `manifest.json`'s generation. All 10 registry skills are present.
- **Every trained skill matches T2 field for field:**
  - wayfaring 4218 / 4218 / L15 / hw 15
  - cartography 13455 / 13455 / L22 / hw 22
  - constitution 1405 / 1405 / L10 / hw 10
  - The 7 untrained skills are 0 XP, L1, hw 1.
- `head-object` shows `AES256` and `application/json`, and the object has a version id.
- The bucket has default SSE-S3, **no lifecycle configuration** (so snapshots are retained forever
  like everything else there), and versioning.
- `iam simulate-principal-policy` on the worker role over the snapshot prefix: `PutObject`
  allowed; `GetObject` and `DeleteObject` implicitDeny.

**Live smoke test, replay path: 18/18, on the real tables and bucket.** It ran the shipped
`replayUser` and `dynamoReplayStore` as the synthetic user `smoke-0067-<ts>`.

| # | What it proved |
|---|---|
| S1a–b | The key is `<uid>/<takenAt>-<generation>.json`. **A second PUT to the same key is refused by S3 with `PreconditionFailed` 412**. |
| S2 | `latestSnapshot` picks the newer of two snapshots. |
| S3a–c | With **T2 empty**, step 0 restored the waterline from the snapshot and logged `restored from 2026-09-28…`. The run finished `DONE` with waterline `{cartography 1300/L10, wayfaring 725/L12}`. |
| S3d ×10 | Every skill in T2 afterwards is ≥ the snapshot (drill check 4, live). `levelHighWater` 12 survived even though the curve gives 725 XP a lower level. |
| S3e | Exactly two floor rows restored the XP: cartography 1300, wayfaring 725. |
| S4 | The newest object is the `replay-preflight` snapshot, and its skills equal the restored ones. |

Cleanup removed 2 SkillState rows, 3 ledger rows, the Profile row, the generation counter and 8 S3
objects; 0 rows remain.

**Open item, left on purpose.** The real snapshot written above stays in the bucket: it is exactly
what production should hold.
