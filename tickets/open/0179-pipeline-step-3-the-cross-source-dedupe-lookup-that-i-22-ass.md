---
id: 179
slug: pipeline-step-3-the-cross-source-dedupe-lookup-that-i-22-ass
title: Pipeline step 3 — the cross-source dedupe lookup that I-22 assumes exists
type: feature
priority: med
status: open
size: m
capability: 06-ingest-pipeline
depends_on: []
blocked_by: []
source: agent
created: 2026-09-07T22:40:00Z
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

- [ ] `process-activity.ts` runs the dedupe lookup as step 3, **after normalize and before the
      score gate**, using `dedupeCandidateKeys` and `isSameActivity` from
      `src/domain/dedupe-key.ts`. No second implementation of either (D-211).
- [ ] A duplicate is dropped without writing an `Activity`, without awarding XP, and without a
      cell write — and the receipt still reaches a terminal state rather than being retried.
- [ ] The loser records a `duplicateOf` pointer at the winner, per `03-integrations.md` §2.7,
      so the archive stays complete. Higher-fidelity trace wins; ties by the source priority
      §2.7 lists.
- [ ] The worker holds `dynamodb:Query` on `byUserAndDedupe` — it does not today, and the grant
      in `amplify/backend.ts` is an explicit action list, not `grantReadWriteData`.
- [ ] The CI fixture I-22 names: one run supplied through two adapters with differing
      `externalId`s and components that straddle every old bucket boundary, asserting **one**
      activity and **one** award.
- [ ] I-22's evidence column is rewritten from "NOT YET ENFORCED" to what actually enforces it,
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

## Operator validation

None expected — no rendered surface, and the failure is invisible by construction. The
verification is the CI fixture in criterion 5. An honest end-to-end check only becomes possible
once a second adapter exists, so a fix landing before then is verified by fixture and not by a
real duplicate run — the same limitation `0169` recorded.
