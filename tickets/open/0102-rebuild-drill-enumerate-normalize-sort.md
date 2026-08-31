---
id: 102
slug: rebuild-drill-enumerate-normalize-sort
title: Rebuild drill steps 1-3 — enumerate raw/, normalize in parallel, sort
type: feature
priority: high
status: open
size: m
capability: 16-rebuild-drill
depends_on: [38, 44]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
---

## Description

The front half of the `02-data-model.md` §8.3 rebuild drill, as a runnable script in the repo:
rebuild the entire application state from `raw/` alone, starting with enumeration, normalization
and ordering.

**Why this exists.** D-101 says user-supplied files are the system of record and everything else
is reconstructible. That is a claim. D-121 permits building MVP ingestion on the Strava API —
whose terms forbid retention and whose athlete cap can remove access — **only because** of that
reversibility. A reversibility that has never been exercised is a claim, not a property. This
capability is what converts it.

**Preconditions, verify all four before starting** (§8.3):

1. `aws s3 ls s3://lost-soles-storage/raw/<uid>/ --recursive --summarize` returns a non-zero
   object count matching the last known figure.
2. `rules/xp-rules-v*.yaml` present in git at the target commit.
3. Adapters that can `normalize()` every `<source>` present in the raw prefix are deployed —
   **including adapters for sources no longer in use.** An adapter is deleted only when its raw
   objects are, which under §8.1 is never. That is the standing cost of the D-100 boundary and
   the reason it is worth paying.
4. The newest `snapshots/skillstate/<uid>/*.json` is downloaded (D-143, §8.2).

**Step 0 — snapshot, then scope.** Write a fresh SkillState snapshot. Read `manifest.json` and
record `generation` and `cellCount` as the verification target.

**Step 1 — enumerate.** `ListObjectsV2` under `raw/<uid>/`. **The key is self-describing** —
`raw/<uid>/<source>/<externalId>/<sha256>.<ext>` — so `(userId, source, externalId)` come from the
path with no index and no database. That is the entire reason the key has that shape, and it is
why the drill needs nothing but the bucket.

**Step 2 — normalize, in parallel, order-independent.** Per object: reconstruct the `IngestJob`
from the key, `GetObject` the bytes, **verify the `sha256` in the key against the content**, then
call `registry.get(source).normalize(raw, ref, job)` — pure, no network, no clock (contract §3).
Emit `{activity, trace}`. A `normalize()` failure is logged with its key and does **not** stop the
run; the failure count is a step-8 assertion. ~2,000–5,000 invocations at ~20 ms is under two
minutes and embarrassingly parallel.

**Step 3 — sort.** By `activity.startedAt` ascending, ties broken by `activityId`. **Everything
after this point is order-dependent and must run single-threaded per user.**

## Acceptance criteria

- [ ] `npm run drill -- --phase=enumerate --uid=<uid>` prints the object count and the distinct
      `SourceId` set derived **only from key paths** — no DynamoDB call in the step-1 code path
      (asserted by a test with the Dynamo client stubbed to throw).
- [ ] Step 2 verifies the key's `sha256` against the fetched bytes and fails that object (not the
      run) on mismatch, recording the key.
- [ ] `normalize()` is invoked with `fetch` and `Date.now` stubbed to throw, and passes — the
      purity assertion the drill depends on and a §9.3 definition-of-done box.
- [ ] A `normalize()` failure logs `{key, source, error}` and increments a counter; the run
      continues and exits with the counter in its summary JSON.
- [ ] Step 3 output ordering is asserted stable: identical input in shuffled order produces a
      byte-identical sorted activity id list, ties broken by `activityId`.
- [ ] The four preconditions are checked by the script itself and it refuses to run if any fails,
      naming which one.
- [ ] The run emits a machine-readable summary (`objectCount`, `normalizeFailures`, `sourceIds`,
      `firstStartedAt`, `lastStartedAt`) to stdout as JSON — this is what 0104 and 0105 assert on.

## Notes

Nothing in steps 0–3 writes anything outside the summary. The drill is non-destructive by
construction until 0103's parallel-stack writes, and even those go to new empty tables.

The parallelism here is the reason the whole drill fits in a coffee break; do not serialise step 2
for tidiness. Do not parallelise step 4 onward for speed — the fold is order-dependent and a
parallel fold is a silently wrong map.

## Operator validation

From the laptop, run the enumerate phase against the live bucket with `--dry-run` and read the
printed object count against `aws s3 ls --summarize`. They must match exactly. On the phone,
nothing changes — this ticket has no UI and must have no effect on the running app; confirm the
map on `/` is unchanged after the run.
