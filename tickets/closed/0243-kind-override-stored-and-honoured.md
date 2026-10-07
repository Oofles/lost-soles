---
id: 243
slug: kind-override-stored-and-honoured
title: A kind override is stored as a correction and honoured by ingest, rebuild and scoring
type: feature
priority: med
status: closed
size: m
capability: 10-add-workout
depends_on: [237]
blocked_by: []
source: agent
created: 2026-10-07T11:43:42Z
started: 2026-10-07T12:12:25Z
closed: 2026-10-07T12:44:47Z
---

## Description

The storage, ingest, rebuild and scoring half of `0171`, split out on 2026-10-07 (D-284). `0244`
adds the UI on top of it.

`Activity.kind` is derived once from the source's type string and rewritten on every delivery
(`persistActivity` does an unconditional `Put`). A rebuild (`02` §8.3) re-derives it from `raw/`.
So an override stored only on the Activity row would be undone by the next sync and by any
rebuild. This ticket gives a kind correction a durable home and makes every path that writes
`kind` honour it.

All of the design questions are settled in **D-284**. Do not re-open them here.

## Acceptance criteria

- [x] A kind override is an immutable fact under `raw/`, a sibling of the activity's archive
      prefix (the `dedupe.ts` `.duplicate-of.json` pattern). It records the derived kind, the new
      kind, who set it and when. A later override is a new object, and the newest one wins.
- [x] Ingest applies the override after `normalize()`. A re-sync or `reingest` of an overridden
      activity stores the overridden `kind`, and a test proves it.
- [x] `replay.ts` and the §8.3 rebuild apply the override the same way, so a rebuild does not
      revert it. `02` §8.3 is amended to say so.
- [x] The derived kind survives on the Activity row next to the override (`derivedKind`), so the
      UI can show "was X".
- [x] The sanitizer's outlier gate keeps using the DERIVED kind, so an override never changes the
      trace (D-284 a).
- [x] A pipeline entry point applies an override and re-scores that one activity with the
      D-142 replay rule: delete its non-floor rows, re-score under the new kind, and write
      `retained_floor` for any skill's shortfall. No skill's XP goes down (D-135). If no skill
      would gain, it writes nothing and reports that.
- [x] Revealed cells stay revealed whatever the new kind (D-020). If the new kind reveals ground
      and the old one did not, its cells are revealed with `firstRunAt = startedAt`, and no
      discovery XP is awarded (D-260, D-284 c).
- [x] The kind must be one the rules know about. An unknown kind is refused before anything is
      written.

## Notes

- The fast-read mirror the operator agreed to (D-284) is the Activity row's `kind` +
  `derivedKind` + `kindOverride` provenance fields. Do not add a separate table unless the
  implementation shows the row cannot carry them, and ask first if it cannot.
- The re-score must take the same concurrency guard as the replay job (`replayInProgress` on
  Profile), so it cannot interleave with a ruleset replay.
- D-278 (revised activities do not re-score) is untouched. That rule covers the source changing
  the content. This ticket covers the operator asserting a kind, which re-scores explicitly.

- **Depends on `0237`.** The `retained_floor` id is unique only per (skill, version pair). A
  per-activity re-score that leaves a skill short would collide with an earlier floor and wedge
  ingest. `0237`'s per-run discriminator has to cover per-correction floors as well.

## Resolution

**What was built.**

- `src/pipeline/kind-override.ts` holds the fact and the one function that applies it.
  - **Where it lives:** `raw/<uid>/<source>/<externalId>.kind-override/<id>.json`, next to the
    archive prefix and never inside it. `id` is time-first, so the newest override is the greatest
    key. `IfNoneMatch: "*"` is used, as `raw/*` requires everywhere.
  - **Helpers:** `knownKinds` / `assertKnownKind` (any kind an enabled activity row matches on),
    `readKindOverride`, and `applyKindOverride`. The last is pure. It replaces `kind`, keeps
    `derivedKind`, and builds the T3 mirror.
- **Ingest.** `processActivity` applies the override immediately after `fetchArchiveNormalize`. A
  `reingest` takes the same path, so a re-sync or replay keeps the override. The trace is never
  touched: the outlier gate already ran inside `normalize()` against the derived kind (D-284 a).
  - `ProcessDeps.kindOverrides` is **required**. Both Lambdas supply it.
  - `log-workout` also runs `processActivity` and had no `s3:ListBucket`, so it now has one,
    scoped to `raw/*`. Without it S3 answers a missing key with 403 and every manual log would
    have failed. A stack test pins the grant.
- **T3.** `activityItem` writes `derivedKind` on every row (equal to `kind` when nothing was
  corrected) and `kindOverride` (the mirror, or `null`). The schema gains both fields plus a
  `KindOverride` custom type, so AppSync can return them to `0244`.
- **`src/pipeline/kind-rescore.ts`, the entry point (`rescoreKind`).**
  - It refuses an unknown kind, or a missing, foreign or tombstoned activity, before any write.
  - It writes the `raw/` fact.
  - If the new kind reveals ground and the old did not, it writes the cells with
    `firstRunAt = startedAt`, outside the transaction. It skips the award and the replay mark, so no
    discovery XP is paid (D-284 c).
  - It then re-scores in **one** transaction:
    - the T3 mirror, conditioned on the kind it read;
    - ledger deletes, replacements and puts, plus `reconcile`'s floors with the activity's old
      per-skill sums as the waterline and run key `kind-<overrideId>` (`0237`'s discriminator);
    - SkillState ADDs of `max(0, new − old)`;
    - ingest's own Profile item, which carries the `replayInProgress` / `ledgerRulesVersion`
      condition.
  - When no skill would gain, it writes the mirror plus a `ConditionCheck` on the same condition,
    and reports "no skill would gain".
  - `planRescore` is the pure half.
- `tools/kind-override/override-kind.ts` is the operator CLI (a dry run by default) until `0244`
  builds the UI.
- **Rebuild.** The §8.3 rebuild drill is not code yet (`0105`), so "the rebuild honours it" means
  two things for now:
  - `02` §8.3 now says step 1 must skip correction objects, step 2 applies `applyKindOverride`
    after `normalize()`, and check 2 counts payloads only.
  - `applyKindOverride` is the function the drill will call. `replay.ts`'s reingest is covered
    because it goes through `processActivity`.
- **Docs.** The T3 table in `02` gains both columns.

**Decisions.**

- **D-285** (the operator chose this mid-ticket) has two parts:
  - The re-score passes no ground split, so ground-scored skills rate at the recent multiplier.
  - The concurrency guard is the replay flag checked **inside** the transaction, not a lock.

  A lock was considered first and rejected. The replay's `freeze` is unconditional and `thaw`
  clears the flag, so sharing a lock would have needed a holder field on both sides. The atomic
  check gives the same exclusion that ingest already relies on.

**What went wrong or was found.**

- `tools/replay/replay-activities.ts` decides what a payload is by path depth (5 segments). An
  override object has the same depth, so it would have been enqueued as a phantom activity with
  externalId `<id>.kind-override`. It now skips those. Found by reading, before it ever ran.
- No test failed unexpectedly. The re-score tests run against an in-memory T1–T4 that **applies**
  each transaction, so "no skill goes down" is asserted on the resulting ledger.

**Tests added.**

- `kind-override.test.ts` (10): key layout, newest wins, IfNoneMatch and 412, known kinds, apply.
- `kind-rescore.test.ts` (16):
  - refusals happen before any write;
  - ride → walk: Wayfaring gains 250 = 5 km × 100 × 0.5, Roving's whole award becomes a floor, no
    skill drops, SkillState equals Σ ledger, cells are revealed without Cartography, and the cell
    writes carry `startedAt`;
  - walk → run writes nothing to the ledger or the map;
  - walk → ride leaves the map alone;
  - a replay in progress refuses the re-score, and the ledger and T3 are untouched.
- `process-activity.test.ts` (+6): the override is honoured, the newest wins, an uncorrected row
  has `derivedKind == kind` and a null mirror, the effective kind decides the reveal, the cells are
  identical to an honest walk (the trace is untouched), and a `reingest` keeps the override.
- `log-workout-mutation.test.ts` (+1): the ListBucket grant.

## Operator validation

**None for the operator.** This ticket has no UI (`0244` adds it), so I ran a smoke test against
the deployed stack. The operator chose the variant that moves no XP.

Setup:
- Deploy: Amplify job 309 for `fb6ad22`, which SUCCEEDED.
- Target: the real activity `ab00f078…` (Strava 20076758956, 2026-09-07, a 1.04 km run, 69 XP).

Results:

1. **Override recorded.** `override-kind.ts --kind walk --confirm` printed "run → walk: no skill
   would gain, so no XP was written". The `raw/` object
   `…/strava/20076758956.kind-override/20261007T124235795Z-hpb2tx.json` exists (307 bytes).
2. **Survives a reingest through the real worker.** `replay-activities.ts --external 20076758956
   --confirm` sent the job over SQS to the Lambda, which logged `outcome: persisted`. Its cells were
   65 unchanged, 0 added, published as generation 131, and `xp.alreadyScored: true`. Afterwards T3
   showed:
   - `kind: walk` and `derivedKind: run`;
   - `kindOverride` = {walk, run, setBy `tools/kind-override`, setAt, key};
   - `xpAwarded: 69`.
3. **The ledger did not move (add-only, trivially).** It had 77 rows both before and after, with
   identical per-skill sums: constitution 1584, wayfaring 4675, cartography 15985, might 80.
4. **The dry run lists 19 activities** (18 Strava + 1 manual) with the override object present, so
   the replay tool fix works.
5. **The unknown kind was refused live.** `--kind swim` raised `UnknownKindError` and wrote nothing.
6. **Reverted** to `run` with a second override object, so the newest wins. The row now reads
   `kind: run`, `derivedKind: run`, with a non-null mirror. The two `raw/` objects stay for good,
   as `raw/*` requires.

**Not exercised live:** the floor path. The operator declined a permanent ~63 Roving XP on the real
account, so `kind-rescore.test.ts` is the only proof of that path.
