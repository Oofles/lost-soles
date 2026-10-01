---
id: 179
slug: pipeline-step-3-the-cross-source-dedupe-lookup-that-i-22-ass
title: Pipeline step 3 — the cross-source dedupe lookup that I-22 assumes exists
type: feature
priority: med
status: closed
size: m
capability: 06-ingest-pipeline
depends_on: []
blocked_by: []
source: agent
created: 2026-09-07T22:40:00Z
started: 2026-10-01T02:37:02Z
closed: 2026-10-01T02:57:16Z
---

## Description

**Nothing queries `byUserAndDedupe`.** The index is deployed, `dedupeKey` is written on every
activity, `src/domain/dedupe-key.ts` computes the anchor and the tolerance comparison (D-211) —
and no code path calls any of it. `contracts/ingestion-contract.md` §3 lists `DEDUPE` as
pipeline step 3, between normalize and sanitize; `src/pipeline/process-activity.ts` goes
credentials → fetch → archive → normalize → score gate → persist. Step 3 is not there.

Found while fixing `0169`. **I-22 asserted this was already in force** — its evidence column read
*"GSI2 `byUserAndDedupe` is queried at pipeline step 3 (contract §3) before any write. CI: a
fixture supplies the same run through two adapters…"* — and neither half was true. The register
has been corrected to say so, which is why this ticket exists rather than a quiet TODO.

**Why nothing has broken.** Strava is the only adapter, and intra-source duplication is already
handled: `activityId` is `sha256(userId:source:externalId)`, so a webhook replayed three times
recomputes one id. Cross-source duplication cannot happen until a second source can produce the
same run under a different `externalId`.

**Why it must land before the second adapter, not with it.** `02-data-model.md` §1493 names the
failure: cross-source duplication *"silently doubles XP and doubles cell visit counts"* on a map
that never re-fogs (D-020) and a ledger that can only add (D-135). It is invisible — the second
activity looks completely normal — and by the time anyone notices, the correction is a rebuild.

## Acceptance criteria

- [x] `process-activity.ts` runs the dedupe lookup as step 3, **after normalize and before the
      score gate**, using `dedupeCandidateKeys` and `isSameActivity` from
      `src/domain/dedupe-key.ts`. No second implementation of either (D-211).
- [x] A duplicate is dropped without writing an `Activity`, without awarding XP, and without a
      cell write — and the receipt still reaches a terminal state rather than being retried.
- [x] The loser records a `duplicateOf` pointer at the winner, per `03-integrations.md` §2.7,
      so the archive stays complete. Higher-fidelity trace wins; ties by the source priority
      §2.7 lists.
- [x] The worker holds `dynamodb:Query` on `byUserAndDedupe` — it does not today, and the grant
      in `amplify/backend.ts` is an explicit action list, not `grantReadWriteData`.
- [x] The CI fixture I-22 names: one run supplied through two adapters with differing
      `externalId`s and components that straddle every old bucket boundary, asserting **one**
      activity and **one** award.
- [x] I-22's evidence column is rewritten from "NOT YET ENFORCED" to what actually enforces it,
      and contract §3's step 3 loses its `NOT BUILT` marker.

## Notes

**The candidate set is 0–2 rows** (D-211 bounds the probe to two keys, and a 30-minute window
holds one activity or none on almost every day at ~400 activities a year). GSI2 is `KEYS_ONLY`,
so each candidate costs a `GetItem` to fetch the fields `isSameActivity` compares. That is a
deliberate trade recorded in `02-data-model.md` — if the candidate count ever stops being ~1, the
change is `INCLUDE (startedAt, distanceM, elapsedS)` rather than a different key.

**Where it goes matters.** After normalize, because it needs the normalized scalars; before the
score gate, because the whole point is not to award. Note the score gate is also where the
receipt claim is taken — a duplicate dropped here has not claimed anything, so whatever marks it
terminal has to be `recordFailure`-shaped rather than a claim release. `0044`'s D-210 is the
neighbouring decision and worth reading first.

**A second adapter is `0112`/`0113` territory (D-112 GPSLogger, D-113 Health Connect).** This
should land before either, and the CI fixture is the only way to test it until one exists.

## Resolution

**Decisions (operator, 2026-09-30): D-263.** The ticket's criterion 3 quoted §2.7's rule that the
higher-fidelity trace wins. That rule can't be honoured: the recording that arrives first is
already scored, its XP is a floor (D-135) and its cells can't re-fog (D-020). So **the activity
already scored always wins**, and criterion 3's "higher-fidelity wins" is satisfied by that
amendment, not by code. The `duplicateOf` pointer is archived permanently, because the receipt
expires after 90 days and the rebuild drill has to count collisions. §2.7 and the migration
runbook line D-7 are amended, struck through, not rewritten.

**Files**
- `src/pipeline/dedupe.ts` *(new)*:
  - `findDuplicate` queries GSI2 for each of `dedupeCandidateKeys`, `GetItem`s the three compared
    fields per candidate, and calls `isSameActivity`. It never restates either function.
  - `recordDuplicatePointer` writes `raw/<uid>/<source>/<externalId>.duplicate-of.json` with
    `If-None-Match`, and treats a 412 as already written.
- `src/pipeline/process-activity.ts`: a new `dedupe` phase between `normalize` and `gate`, a
  required `dedupe` dep, `dedupeMs` in the timings, and a new `{ outcome: "duplicate" }` result.
  The pointer is written **before** the receipt, so a failed pointer write leaves the receipt
  claimable.
- `src/pipeline/ingest-receipt.ts`: `recordDuplicate` moves the receipt to `DONE` with zero awards
  and `duplicateOf`. It uses the score gate's claimability conditions, because no claim is held at
  step 3. `IngestReceipt.duplicateOf` is new.
- `src/pipeline/archive.ts`: `isPreconditionFailed` is now exported for reuse.
- `amplify/backend.ts`: `dynamodb:Query` on `…/index/byUserAndDedupe` alone.
- `amplify/functions/process-activity/handler.ts`: wires `dedupe`, and logs the duplicate's winner
  and pointer.
- `src/adapters/__fixtures__/gpx-adapter.ts`: had **its own private dedupe-key hash**, a second
  implementation D-211 forbids. It now calls `computeDedupeKey`.
- `src/pipeline/__fixtures__/process-rig.ts` *(new)*: the `process-activity.test.ts` rig, moved
  unchanged except for exports and an `adapter` option. The criterion-5 fixture has to live in
  `src/adapters/strava/` (D-188), and a second copy of a 450-line rig would drift.
- Docs:
  - contract §4 step 3 loses `NOT BUILT`. The ticket cited §3, but the pipeline list is §4.
  - I-22's evidence column is rewritten.
  - T8 gains a `duplicateOf` row.
  - `01` §4 row 10 notes the step.
  - `03` §2.7 and runbook D-7 are amended.
  - D-263 is added.

**Tests**
- `src/pipeline/dedupe.test.ts`, 8 tests:
  - a match across the neighbouring anchor bucket, with two queries
  - an absent distance abstains
  - a distance beyond max(100 m, 3%) doesn't match
  - the activity's own row is skipped
  - the pointer sits outside the replay prefix
  - a 412 counts as success
  - any other failure propagates
  - the index name agrees with `resource.ts`
- `process-activity.test.ts`, 7 tests:
  - a duplicate stops before the gate, with no cells, blobs or transaction
  - the receipt goes to `DONE`, not `FAILED`
  - the pointer is placed correctly
  - the query and projection shape
  - the activity's own row is not a duplicate
  - a different run in the same anchor bucket is kept
  - a failed pointer write leaves the receipt untouched
- `amplify/xp-ledger-tables.test.ts`: T3's grant is now `GetItem`/`PutItem`/`Query`, and the
  `Query` reaches only `byUserAndDedupe`.
- **Criterion 5:** `src/adapters/strava/cross-source-dedupe.test.ts`:
  - The real `real-run-outdoor.json` goes through `normalizeStrava`, and the same run's
    `equivalence-run.gpx` goes through the GPX fixture adapter under a different `externalId`.
    Both share one T3 whose GSI2 fake filters on the real key.
  - The GPX recording's start, distance and elapsed are placed one step across each bucket edge of
    the formula D-211 retired. The test asserts the old formula would have split the pair.
  - It asserts one activity, one transaction and `duplicate` → winner.
  - **Mutation-checked:** with `findDuplicate` forced to return `null`, it fails
    (`persisted` ≠ `duplicate`).
  - The GPX fixture has no distance, so the test **overrides the three scalars** rather than
    editing the GPX, whose points the equivalence test compares cell for cell. The trace is
    untouched.

**What went wrong along the way**
- The first commit was blocked by the pre-commit hook because node wasn't on PATH (the
  fnm-memory issue). It went through with node exported.
- A test id `a-strava` in `src/pipeline` tripped D-100's boundary grep, so it was renamed.
- `bundle-leak.test.mjs` "failed" only because I ran a vitest file with plain node. It passes
  under vitest.

**Known limits, stated in `dedupe.ts` and I-22:**
- GSI reads are eventually consistent, so two sources delivering within about a second of each
  other can each miss the other. That's accepted at one user's volume.
- A `TOMBSTONED` activity still wins a collision. Its cells are permanent, so letting the copy
  through would double the visit counts. Retraction semantics belong to capability 14.
- The rebuild drill's collision count from the pointers is still planned (capability 16).

## Operator validation

Nothing for the operator to look at: no rendered surface, and a duplicate is invisible by design.
Agent smoke tests, 2026-09-30, WSL2 + AWS `devault`:

- **Full suite:** 2,460 passed and 1 skipped; `tsc`, `eslint --max-warnings 0` and every
  `scripts/check-*.mjs` are clean.
- **Deploy:** Amplify job 264 (commit `7a6bd6b`) SUCCEEDED. The worker
  `…processactivitylambda939…` was last modified 2026-10-01T02:49Z, after the push.
- **Live IAM (criterion 4):** `iam simulate-principal-policy` against the deployed worker role
  gives `dynamodb:Query`:
  - on `Activity-…/index/byUserAndDedupe`: **allowed**
  - on the base table: **implicitDeny**
  - on `index/byUserAndStart`: **implicitDeny**
- **Live data, read-only:** I ran `findDuplicate` with my own credentials against the real
  `Activity-nog4xy2l7baqlhghpndh2565qe-NONE`, using a real 2026-08-30 run (8,561.6 m, 4,137 s):
  - a copy shifted +60 s, +20 s and +1% **matched the real row**
  - the row itself returned `null`
  - the same numbers 3 h later returned `null`

  This proves the deployed index, its key names, and the stored `dedupeKey`s (rewritten under
  `0169`) agree with `computeDedupeKey`. Nothing was written. I deliberately did **not** push a
  synthetic duplicate through the live worker: it would write a permanent, undeletable pointer
  under the real user's `raw/` (I-3), and no second source adapter is registered to send one.
- **What remains unproven:** a real duplicate from a second real source. That becomes possible
  with D-112/D-113, the same limitation `0169` recorded.
