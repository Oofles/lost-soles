---
id: 301
slug: rebuild-drill-resurrects-retracted-activities
title: Rebuild drill resurrects retracted activities
type: bug
priority: low
status: open
size: s
capability: 16-rebuild-drill
depends_on: []
blocked_by: []
source: agent
created: 2026-10-21T03:53:20Z
started: 2026-10-21T19:31:21Z
---

## Description

raw/ keeps no record of a D-355 retraction, so the drill (0103) writes a TOMBSTONED activity back as ACTIVE. XP still agrees, because tombstoned XP was kept (D-135), but the activity would reappear in the run list. No tombstoned activities exist live today. Found by 0103.

## Acceptance criteria

- [x] The drill learns of D-355 retractions from a durable source outside the tables it rebuilds
      (for example a record written beside the raw object at retraction time), and a test retracts
      one fixture activity and asserts the rebuilt Activity row is `TOMBSTONED`.
- [x] A retracted activity still contributes its kept XP (D-135) and its cells (D-020) in the rebuild.
- [x] Step 8 check 2's reconciliation accounts for tombstoned activities, if they change the count.
      *(They do not: a tombstoned activity is still one T3 row, so the formula is unchanged and a
      test asserts check 2 passes with one retracted. A record with no payload names no row and
      is reported as `retractionsWithoutActivity`.)*

## Steps to reproduce

1. Retract an activity (D-355) so its Activity row is `TOMBSTONED`.
2. Run the drill (`--phase=rebuild`) into a fresh target.
3. Read the rebuilt Activity row.

## Expected vs actual

**Expected:** the rebuilt row is `TOMBSTONED`, as it was before the drill.

**Actual:** it is `ACTIVE`, because `raw/` keeps no record of the retraction, so the activity reappears in the run list after cutover.

## Notes

Found by `0103` (wave 16.2). No tombstoned activities exist live today, so the live drill (`0105`) is not affected yet. Whatever records the retraction must not be deletable by the drill and must not live only in the rebuilt tables, or D-101 ("everything is reconstructible from raw") stays untrue for retractions.

## Operator validation

Smoke test, agent's to run: the fixture test above, and a drill into a scratch target after a synthetic retraction. No perceptual check.

## Resolution

**Where the record lives.** `raw/<uid>/<source>/<externalId>.retracted.json`, a sibling of the
activity's archive prefix: the shape D-263 set for `.duplicate-of.json` and D-284 for
`.kind-override/`. The ticket's own example names it, and the precedent settles the protection:
under `raw/*` it inherits I-3 (bucket-policy deny on both delete actions for every principal but the
break-glass role), `IfNoneMatch: "*"` refuses an overwrite, and D-401 forbids an expiration rule.
It is not in any table the drill rebuilds, so D-101 now holds for retractions. The worker already
holds `s3:PutObject` on `raw/*` (`WriteAndReadRawArchive`), so no IAM or CDK change. `replay.ts`
lists `<externalId>/` with the trailing slash, so it never sees the sibling.

**Live path.** `retractActivity` writes the record after `confirmRetracted` answers `gone` and
**before** the T3 tombstone: system of record first, derived row second, like archive-before-persist.
A failed write throws, T3 stays `ACTIVE`, SQS redelivers. A redelivery's `412` counts as success.
`present` writes nothing. A `gone` for a run never imported still writes the record (the drill
ignores it). The handler wires `archive: { s3, bucket: RAW_ARCHIVE_BUCKET }`.

**Drill.** Step 1 classifies the record as `kind: "retraction"` (never a payload, never
unrecognised) into `Enumeration.retractions` / `FrontHalf.retractions`, and
`summary.retractionCount`. The back half writes the row `ACTIVE` at step 4, folds it at step 5 and
scores it at step 6 like any other, then, after `writeActivityScores`, calls the new
`DrillStore.tombstoneActivities`. The Dynamo store reuses live's `tombstoneActivity` (same
`UpdateItem`, same condition) and throws on anything but `tombstoned`. Writing it `TOMBSTONED` at
step 4 was not an option: `activityScoreItem` is conditioned on `#status = :active`, so step 6 would
fail. Skipping its score would leave `xpAwarded`/award columns at 0 where live kept them. Re-scoring
is what live history did: ingest scored it, the retraction only flipped `status`. Under the same
rules that re-derives exactly the rows live kept (D-135), and its cells are folded (D-020). New
summary fields: `activitiesTombstoned`, `retractionsWithoutActivity`.

**Check 2.** Unchanged. A tombstoned activity is one row.

**Known divergence, recorded.** Under a *changed* `--rules`, the drill re-scores a retracted
activity under the new rules, while a live rebalance keeps its old rows (`xp-replay.ts` step 2).
The snapshot waterline and floors still guarantee nothing displayed falls (check 4). A same-rules
drill, the default, is exact.

**Files.**
- `src/pipeline/retraction-record.ts` (new): key, suffix, `recordRetraction`.
- `src/pipeline/retract.ts`: record before tombstone; `RetractDeps.archive`.
- `amplify/functions/process-activity/handler.ts`: wires `archive`.
- `src/pipeline/rebuild-drill.ts`: `retraction` key kind, `retractions`, `retractionCount`.
- `src/pipeline/rebuild-drill-back.ts`: `DrillStore.tombstoneActivities`, the step 6 tombstone, summary fields.
- `src/pipeline/rebuild-drill-store.ts`: `tombstoneActivities` via `persist.tombstoneActivity`.
- Tests: `retract.test.ts` (S3 fake, record shape and order, redelivery, failure, `present`),
  `rebuild-drill.test.ts` (classification from the writer's own key, front half carries it),
  `rebuild-drill-back.test.ts` (TOMBSTONED after scoring, ledger rows and XP equal a run without
  the retraction, cells kept, check 2 passes, orphan records, the Dynamo update shape),
  `handler.test.ts`, and the `archive` dep in `aspects-e2e.test.ts` and `lib/runs/tombstone.test.ts`.
- `docs/02-data-model.md`: §8.3 step 1 (three sibling kinds, the `0301` note) and T3 `status`.
  `docs/INDEX.md` left for the orchestrator.

**Not done here.** `tools/drill/rebuild-drill.ts` (the CLI) needed no change: the new summary
fields reach its JSON output through `rebuild`. No backfill: no tombstoned activities exist live.

