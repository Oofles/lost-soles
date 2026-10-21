# 16-rebuild-drill

> **Stub, generated during backlog validation.** The authoritative design is the
> `#### \`16-rebuild-drill\`` section of [`../09-roadmap.md`](../09-roadmap.md). This file is where the
> DESIGN step's output belongs, and where [`AUDIT.md`](AUDIT.md) results are appended at close.

## Tickets (5)

- `0102` — Rebuild drill steps 1-3 — enumerate raw/, normalize in parallel, sort
- `0103` — Rebuild drill steps 4-8 — re-project cells, fold, replay XP, verify, cut over never
- `0104` — CI rebuild drill on every build against a ~20-object fixture spanning every SourceId
- `0105` — EXECUTE THE DRILL FOR REAL, once, before MVP ship — four numbers pasted or it did not happen
- `0106` — Account-deletion runbook, executed once against a throwaway account

## Design notes

_Filled in at the DESIGN step, before TICKET-WRITE._

## Account deletion, executed (`0106`)

The runbook is [`../runbooks/account-deletion.md`](../runbooks/account-deletion.md); the script is
`tools/account-deletion/delete-account.ts`. Gate item **A-5** of D-123 Trigger A (`08` §2.4) needs it
executed once against a throwaway account with genuinely ingested data. That execution:

Executed 2026-10-20 by the orchestrator (wave 16.1), from the laptop, `AWS_PROFILE=devault`.

- Throwaway account `drill-0106@example.invalid`, sub `f4183488-a0a1-702e-5354-3f957fe2e8f6`:
  created 18:04:29Z, seeded 18:04:41Z, deleted by the run 18:05:31Z → 18:05:38Z. **Trigger A was
  open for about 70 seconds** and is closed: the account no longer exists.
- Seed: `tools/account-deletion/seed-throwaway.ts` archived the synthetic `run-continuous.json`
  (Point Nemo) under `raw/<sub>/strava/18736594040/` and enqueued one job; the real
  `process-activity` worker took the receipt to `DONE` within seconds.
- Archive guard (preflight, IAM simulation against the live bucket policy): `cli-user` →
  `explicitDeny` for `s3:DeleteObject` and `s3:DeleteObjectVersion`; `LostSolesArchiveDeletion` →
  `allowed` for both. Live probe: `AccessDenied` for the default credentials.
  - **The first attempt aborted with zero side effects**: the probe's made-up `VersionId` got
    `InvalidArgument`, because S3 checks the id's format before authorisation. The probe now uses
    the literal `"null"` version id, which S3 accepts; the second attempt is the one recorded here.
- Upstream: `strava no-connection` (no `SourceAccount` row — recorded no-op, D-348).

| Table | Before | After |
|---|---|---|
| SourceAccount | 0 | 0 |
| ExploredCell | 10 | 0 |
| Activity | 1 | 0 |
| XpLedgerEntry | 3 | 0 |
| SkillState | 3 | 0 |
| Landmark | 0 | 0 |
| Profile | 1 | 0 |
| IngestReceipt | 1 | 0 |
| OAuthState | 0 | 0 |

| S3 prefix (current / noncurrent / delete markers) | Before | After |
|---|---|---|
| `raw/<sub>/` | 1 / 0 / 0 | 0 / 0 / 0 |
| `users/<sub>/` | 9 / 0 / 0 | 0 / 0 / 0 |
| `snapshots/skillstate/<sub>/` | 1 / 0 / 0 | 0 / 0 / 0 |

- "What could not be deleted": **Nothing.** The confirmation states PITR's 35-day window for
  `LostSolesExploredCell` (complete 2026-11-24T18:05:38Z) and lists the eight tables without PITR
  (D-404, `0300`).
- Independent check afterwards, SDK `ListObjectVersions` (the CLI command is broken in this
  environment): `raw/<sub>/`, `users/<sub>/` and `snapshots/skillstate/<sub>/` each 0 versions,
  0 delete markers.
- Cognito user gone: `list-users --filter 'sub = "<sub>"'` returns `[]`.
- Owner untouched: item counts of all eleven tables (ExploredCell 6,491, Activity 116,
  XpLedgerEntry 368, IngestReceipt 123, …) and the bucket's total (1,436 objects) are identical
  before the seed and after the deletion.

## The drill, executed for real (`0105`)

The full §8.3 drill was run once against the live raw archive, into a parallel stack, with **no
cutover** and **no step 9**. This is the run that turns D-101 from a claim into a measurement.

Executed **2026-10-21** by the orchestrator (wave 16.4), from the laptop, `AWS_PROFILE=devault`,
uid `5488e4b8-d081-7014-748e-edd1937f8083`. The drill code ran at commit **`dfb844a`**. The stack
definition, `tools/drill/target-stack.ts`, was written for this run and lands in `0105`'s commit.

```
npx tsx tools/drill/target-stack.ts 20261021 <scratch>/drill
aws cloudformation deploy --stack-name LostSolesRebuildDrill-20261021 --template-file <scratch>/drill/template.json
npm run drill -- --phase=rebuild --uid=5488e4b8-d081-7014-748e-edd1937f8083 --expect-objects=123 --target=<scratch>/drill/target.json
```

### The four numbers

Each value was printed by the run (`run.json` / stderr). None was typed from memory.

| # | Number | Value | Against |
|---|---|---|---|
| 1 | Objects under `raw/<uid>/` at drill start | **123** (118 payloads, 5 kind overrides, 0 duplicate pointers, 0 retractions; sources `manual`, `strava`) | `--expect-objects=123` |
| 2 | `normalize()` failures | **0** | must be 0 |
| 3 | Final `cellCount` | **5,211** | step 0 `manifest.json` `cellCount` **5,211** (`==`, `fogAlgoVersion` 1 unchanged) |
| 4 | Final Total XP | **70,994** | snapshot `snapshots/skillstate/5488e4b8-…/2026-10-18T13:23:30.035Z-269.json` total **70,994** |

Step 0's verification target: live `manifest.json` `generation` **269**, `cellCount` **5,211**. The
waterline is the precondition-4 snapshot named above, written by ingest (D-259, D-399). The drill
did not write it.

### Step 8, as printed by the run

```
step 4: 116 activities, 112 routes, 110 cells files
step 5: 5211 cells folded (step 0: 5211), 5349 T6 items
step 6: 360 rows, 3 floors, Total Level 100
step 6: 0 landmarks backfilled, 0 on a route
step 7: generation 270 (step 0: 269), 112 routes in the web
step 8 check 1 PASS normalize() failures == 0 — 0 failures
step 8 check 2 PASS activities == payloads − superseded − duplicates — 116 written; 118 payloads − 2 superseded − 0 duplicate pointers = 116
step 8 check 3 PASS rebuilt cellCount vs step 0 — 5211 cells rebuilt, step 0 published 5211 (==, fogAlgoVersion unchanged)
step 8 check 4 PASS every skill's displayedXp ≥ the snapshot's — 10 skills at or above 2026-10-18T13:23:30.035Z's snapshot
step 8 check 5 PASS Σ ledger xpAwarded == xpLedgerSum, per skill — 363 rows over 6 skills
step 8 check 6 PASS spot-check itemisation — d4e7ac35b1ca7968f38acb3cf46f27f812d24aed037e6ae4b3321b37b2e0be8f: 5 rows match
```

Exit code 0. The rules version was v3, the snapshot's own, so this was a same-rules rebuild. The
three `retained_floor` rows (cartography 13,342, constitution 31, wayfaring 98) equal the live
ledger's three floors, as the `0103` rehearsal predicted. The 0 landmarks are correct: the live
`Landmark` table also holds 0 items. Kind overrides: 1 applied, because all 5 override objects
belong to one activity (`strava/20076758956`), and only the newest counts.

### Per skill: snapshot, rebuilt and live

"Rebuilt" was read back from the target `SkillState` table before teardown. "Live" is the live
`SkillState` table, read at the same moment.

| Skill | Snapshot displayedXp | Rebuilt displayedXp | Rebuilt level | Live displayedXp | Rebuilt ≥ snapshot |
|---|---|---|---|---|---|
| cadence | 0 | — | — | — | yes |
| cartography | 26,678 | 26,678 | 27 | 26,678 | yes |
| constitution | 11,077 | 11,077 | 20 | 11,077 | yes |
| endurance | 0 | — | — | — | yes |
| fortitude | 0 | — | — | — | yes |
| might | 80 | 80 | 4 | 80 | yes |
| roving | 1,017 | 1,017 | 9 | 1,017 | yes |
| slayer | 0 | — | — | — | yes |
| vigil | 660 | 660 | 8 | 660 | yes |
| wayfaring | 31,482 | 31,482 | 29 | 31,482 | yes |
| **Total** | **70,994** | **70,994** | | **70,994** | |

"—" marks a skill with no XP. Neither live nor the rebuild writes a `SkillState` row for one.

### The live map was untouched

| Live `users/<uid>/manifest.json` | `generation` | `cellCount` | ETag |
|---|---|---|---|
| Before (20:17:48Z) | **269** | 5,211 | `861cb1047a3a97c130f346506bfce16a` |
| After (20:20:49Z) | **269** | 5,211 | `861cb1047a3a97c130f346506bfce16a` |

The two reads are byte-identical (`cmp`), and `LastModified` is still 2026-10-18T13:23:30Z. The
target's own manifest was `generation` 270, `deltasFrom` 270, `cellCount` 5,211.

### Wall-clock and cost, against §8.3's estimate

| | §8.3 estimate | Measured |
|---|---|---|
| Drill, steps 0–8 | under 30 minutes | **64.0 s** (`wallClockMs` 63,973; 20:19:10Z → 20:20:17Z) |
| Whole exercise, deploy → teardown | — | **3 min 33 s** (stack create 66 s, drill, teardown 32 s) |
| Request charges | roughly $0.50 | **about $0.01**, estimated from counted requests (below) |

**Both measurements are more than an order of magnitude under the estimate. That is a finding about
the estimate's volume, not about speed.** §8.3 sized the drill at 2,000–5,000 raw objects and
20k–150k cells, which is the five-year figure. The archive holds **123 objects** and **5,211 cells**
today, 1/16 to 1/40 of that range (cf. `0177`: size from real counts). The cost estimate is built
from counted requests, because Cost Explorer lags by about a day and the stack's tags are not
activated as cost-allocation tags. The counts were about 7,300 DynamoDB write units (5,349 T6
items, plus Activity and ledger rows each with three GSIs), a few thousand strongly consistent
read-back units, 337 S3 PUTs and about 400 GETs. At us-east-1 on-demand prices that is under
$0.01. CloudFormation is free.

**What scales:** the run printed no per-step timings, so this is an upper bound. If the whole 64 s
scaled with cell count, 150k cells would take about 30 minutes, right at §8.3's ceiling. Most of the
time is probably T6's 5,349 conditional `PutItem`s, and if so the ceiling holds. The estimate is
plausible at volume, but this run cannot prove it. The pre-D-121 re-run will measure it at whatever the volume
is then.

### Teardown

- Stack **`LostSolesRebuildDrill-20261021`**
  (`arn:aws:cloudformation:us-east-1:286588821906:stack/LostSolesRebuildDrill-20261021/827ad6c0-cd8c-11f1-8fe4-0ec272070561`):
  created 2026-10-21T20:17:59Z. **Deleted 2026-10-21T20:21:00Z**, and `DELETE_COMPLETE` by 20:21:32Z.
- Before deletion, the bucket `lost-soles-drill-20261021-286588821906` was emptied of its 337
  objects with `aws s3 rm --recursive`. That ran outside `tools/drill/`, whose code may not delete
  anything (`check-drill-no-delete`).
- Afterwards: `list-tables` shows no `LostSolesDrill-*` table, and `HeadBucket` returns 404.

## Audit

_Appended by `/tickets audit` at close. See [`AUDIT.md`](AUDIT.md)._

## Reflection

_Filled in at the REFLECT step, after USE._

