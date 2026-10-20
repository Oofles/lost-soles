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
started: 2026-10-20T17:10:35Z
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

- [x] `npm run drill -- --phase=enumerate --uid=<uid>` prints the object count and the distinct
      `SourceId` set derived **only from key paths** — no DynamoDB call in the step-1 code path
      (asserted by a test with the Dynamo client stubbed to throw).
- [x] Step 2 verifies the key's `sha256` against the fetched bytes and fails that object (not the
      run) on mismatch, recording the key.
- [x] `normalize()` is invoked with `fetch` and `Date.now` stubbed to throw, and passes — the
      purity assertion the drill depends on and a §9.3 definition-of-done box.
- [x] A `normalize()` failure logs `{key, source, error}` and increments a counter; the run
      continues and exits with the counter in its summary JSON.
- [x] Step 3 output ordering is asserted stable: identical input in shuffled order produces a
      byte-identical sorted activity id list, ties broken by `activityId`.
- [x] The four preconditions are checked by the script itself and it refuses to run if any fails,
      naming which one. *(Amended: precondition 1's "matching the last known figure" needs that
      figure from somewhere, and nothing in the bucket records it. It is `--expect-objects=<n>`:
      when given, the count must equal it exactly; when omitted, only non-zero is checked and the
      precondition's `detail` says so. Proposed as a decision in the wave report.)*
- [x] The run emits a machine-readable summary (`objectCount`, `normalizeFailures`, `sourceIds`,
      `firstStartedAt`, `lastStartedAt`) to stdout as JSON — this is what 0104 and 0105 assert on.

## Notes

Nothing in steps 0–3 writes anything outside the summary. The drill is non-destructive by
construction until 0103's parallel-stack writes, and even those go to new empty tables.

The parallelism here is the reason the whole drill fits in a coffee break; do not serialise step 2
for tidiness. Do not parallelise step 4 onward for speed — the fold is order-dependent and a
parallel fold is a silently wrong map.

## Operator validation

> **D-181 — most of what follows is the AGENT's to run, not the operator's.**
> Swept 2026-09-02 (ticket `0147`). This ticket's capability has no screen of its own. Before asking
> the operator for any step below, check whether AWS credentials (`AWS_PROFILE=devault`), `curl`, or
> a script can answer it — if so it is a **smoke test**, and what it proved is recorded here at
> close *instead of* the instruction. Keep only what genuinely needs a human eye, a phone, or a real
> run. The text below is the original author's intent, kept as context for **what** to verify — not
> as a list of chores for the operator.

From the laptop, run the enumerate phase against the live bucket with `--dry-run` and read the
printed object count against `aws s3 ls --summarize`. They must match exactly. In the desktop browser,
nothing changes — this ticket has no UI and must have no effect on the running app; confirm the
map on `/` is unchanged after the run.

## Resolution

**Files touched**
- `src/pipeline/rebuild-drill.ts` (new) — the front half as a module: `classifyRawKey`,
  `enumerationFromListing`/`enumerateRaw` (step 1), `reconstructRef`/`reconstructJob`,
  `newestPayloads`, `normalizeAll` (step 2), `sortForFold` (step 3), `checkPreconditions`,
  `newestSnapshot`, `readVerificationTarget` (step 0), and `runDrillFrontHalf`, which returns
  `{summary, sorted, duplicatePointers}`. `sorted` is `DrillEntry[]` = `{activity, trace?, ref}`
  in fold order, the seam `0103` builds steps 4–7 on.
- `src/pipeline/rebuild-drill.test.ts` (new) — 16 tests, against an in-memory bucket and the REAL
  manual adapter.
- `tools/drill/rebuild-drill.ts` (new) — the CLI. Summary JSON on stdout, per-object failures as
  `{key, source, error}` JSON lines on stderr, exit 0 / 3 (refused) / 2 (usage).
- `package.json` — `"drill": "vite-node --config vitest.config.ts tools/drill/rebuild-drill.ts --"`.

**Phases.** `--phase=enumerate` runs the preconditions, step 0 and step 1. `--phase=normalize`
continues through steps 2 and 3. `--dry-run` is accepted and changes nothing, because neither
phase writes to AWS. The summary records it so the habit carries over to `0103`'s phases.

**Decisions made, and why**
- **Step 1 classifies keys by shape, not by depth** (§8.3 step 1, D-263, D-284). There are four
  classes:
  - payload: `raw/<uid>/<source>/<externalId>/<sha256>.<ext>`
  - kind override: `<externalId>.kind-override/<id>.json`, the same depth as a payload
  - duplicate pointer: `<externalId>.duplicate-of.json`, one segment shallower
  - unrecognised: anything else. These are listed in the summary and never passed to
    `normalize()`.

  The live bucket has 123 objects: 118 payloads (117 from the primary source, 1 manual), 5 kind
  overrides on one activity, 0 duplicate pointers and 0 unrecognised keys.
- **Several payloads for one activity: all are verified, and only the newest is emitted.** Live
  data has two activities with two payload objects each. These are re-fetches that returned
  different bytes, which `archive.ts` explains is legitimate. Every object is sha-checked and
  normalized, because corruption anywhere in the system of record is worth knowing about.
  - **Which one is emitted:** the newest, by greatest `LastModified` with the key as tie-break.
    That is `replay.ts`'s existing rule, and those are the bytes the latest ingest scored.
  - **No fallback:** the newest is chosen from the listing before anything is normalized. If the
    newest fails, its activity fails; the drill never falls back silently to older bytes.
  - **Why not emit both:** the fold would get two rows with one `activityId`, in an undefined
    order.

  The summary reports the skipped objects as `supersededObjects`. Live: 118 payloads become 116
  activities, which equals the live `Activity` table count (116).
- **ref and job are rebuilt from the key and the listing alone** (D-196):
  - `ref.archivedAt` is the object's `LastModified`, the same value `archiveRaw`'s HEAD path
    returns on a repeat archive.
  - `ref.sha256` is the key's digest, verified against the bytes.
  - `job.meta` is `null`, so revision is 1, as in `tools/replay` and `archived-trace.ts`.
  - `job.enqueuedAt` is the archive instant.
  - `job.ingestKey` is `drill:<key>`. No `normalize()` reads it, and the real value cannot be
    rebuilt outside the adapter.
- **Purity is checked inside the drill, not just in a test.** Every normalize goes through
  `assertNormalizeIsPure`, which runs it twice with `fetch`, `Date.now`, `new Date()`,
  `Math.random` and the others trapped, and requires the two results to agree. An `ImpurityError`
  fails that object only. The drill also checks that the `activityId` `normalize()` returns
  matches the one the key implies.
- **The newest kind override is applied after normalize()** with `applyKindOverride`. This is
  §8.3 step 2 as amended by D-284; the ticket body predates the amendment. The override key comes
  from the step-1 listing (greatest key), so no second list call is needed. If the override cannot
  be read, that activity fails and the run continues.
- **Step 3 uses `foldOrder`**, the single I-14 comparator in `src/domain/fold.ts`, so the drill and
  the fold cannot disagree on order. Failures are sorted by key, so two runs print the same
  summary.
- **Step 0 is read-only in this ticket.**
  - It reads `users/<uid>/manifest.json` and records `generation` and `cellCount`. A missing
    manifest is recorded as generation 0 (D-259).
  - It does **not** write a fresh SkillState snapshot. The ticket Notes say steps 0–3 write
    nothing, but §8.3 step 0 says to write one. No acceptance criterion covers the write, so it is
    left out and returned to the orchestrator as an open question.
  - Precondition 4 downloads the newest snapshot (greatest key under
    `snapshots/skillstate/<uid>/`, D-259 shape) to `--out`, which defaults to the OS temp dir.
- **Preconditions are checked after the listing.** Precondition 3 needs the step-1 source set, and
  listing writes nothing. Precondition 2 reads `git ls-files rules/`, so an untracked YAML does
  not count. If any precondition fails, the drill skips step 0 and step 2, names each failure on
  stderr and exits with code 3.
- The bucket name comes from `amplify_outputs.json`; the design's `lost-soles-storage` is a
  placeholder.

**Not done here:**
- Steps 4–8 (`0103`).
- Filtering D-263 duplicate losers out of the activity set. Their pointers are classified, counted
  and returned as `FrontHalf.duplicatePointers` for `0103`'s step 8 check 2. The live bucket has
  none.

**Agent smoke test (live, read-only, `AWS_PROFILE=devault`).** These ran from the worktree and
used only `ListObjectsV2` and `GetObject`:
- `npm run drill -- --phase=enumerate --uid=5488e4b8-… --expect-objects=123 --dry-run` exited 0
  with all four preconditions ok, `objectCount` 123 (matching `aws s3 ls --recursive --summarize`'s
  `Total Objects: 123`), `sourceIds` `["manual", <primary>]`, and step 0 recording generation 269
  and cellCount 5211.
- `--phase=normalize` exited 0 with `normalizeFailures` 0, `activityCount` 116, `supersededObjects`
  2, `kindOverridesApplied` 1, `firstStartedAt` 2020-02-24T13:11:04.000Z and `lastStartedAt`
  2026-10-14T01:12:32.000Z.
