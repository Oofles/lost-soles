---
id: 195
slug: activity-route-polyline-and-latest-run-endpoint
title: Persist the per-activity route polyline (S-7) and serve the latest run as GeoJSON
type: feature
priority: high
status: closed
size: m
capability: 08-map-and-fog-renderer
depends_on: []
blocked_by: []
source: agent
created: 2026-09-10T22:06:02Z
started: 2026-09-10T22:08:01Z
closed: 2026-09-10T23:18:53Z
---

## Description

**`0057` cannot be built, and neither can `0085`.** Both draw a run's route from "the stored
polyline object per activity". That object is designed and never written.

`02-data-model.md` §5.1 lists it as access pattern **S-7** — *"Trace polyline on activity detail →
`traces/<activityId>.polyline.gz` → one immutable GET"* — and §2.9's rebuild-drill step 4 writes it
alongside the cell set. Nothing implements either half:

- `src/adapters/strava/normalize.ts:492` sets `traceRef: null` with a comment saying the pipeline
  fills it in. `src/pipeline/persist.ts:167` passes `activity.traceRef` straight through, so the
  T3 column is null on every row ever written.
- No object is ever `PutObject`ed under `traces/`.
- No endpoint serves one. `app/api/` has fog, auth and ticket-capture routes only.
- The client cannot enumerate activities at all — `generateClient` appears nowhere in `app/`,
  `components/` or `lib/`, and `/chronicle` and `/run/[activityId]` are still `<Stub>`.

**No ticket in the backlog covers S-7.** This one does. It is `source: agent`, filed mid-session
while picking up `0057`, and it is deliberately the smallest thing that unblocks it: write the
artefact, and serve exactly one of them.

### The artefact is the SEGMENTS, and it is not called a polyline

`traceToCells` (`src/domain/fog.ts`) already computes precisely the geometry that should be
stored. §2.2 steps 1–3 split the trace on gaps, clean it, collapse dwells and split on implausible
jumps (D-212), leaving `segments: GeoPoint[][]` — and step 5 measures every candidate cell against
*those* segments. It is a local `const` today, thrown away after the filter runs.

Storing it has three properties worth having:

1. **The drawn route and the revealed ground come from one computation.** A second sanitisation
   path would drift, and the two would disagree about where the runner was.
2. **`0057`'s criterion 8 — "no chord drawn across the gap" — is true by construction.** The
   joining chords are not filtered out of this array; they never enter it. `fog.ts`'s own comment
   says so: *"Only the joining chords — the gaps and the implausible jumps — are absent from this
   list, which is exactly how 'the chord contributes no distance' is implemented: it is not
   skipped, it never exists."*
3. It is a GeoJSON `MultiLineString` with no conversion — one line per segment.

**The key in `02` §5.1 cannot be used as written.** `scripts/check-boundaries.mjs`'s STRICT tier
bans `/polyline/i` throughout `src/domain` and `src/pipeline` (D-121, D-100), in code *and* in
prose. A writer in `src/pipeline` holding the string `traces/<id>.polyline.gz` fails CI, and the
available dodges — defining the key in `lib/` and importing it, or an exemption — are the
"guard that has to be dodged is a guard that gets disabled" failure that `check-design-tokens.mjs`
and `.githooks/pre-commit` both warn about in their own comments.

**There is already a settled precedent for exactly this collision.** §2.2's pseudocode called
step 5's helper `distancePointToPolyline`; the gate caught it, and `05-fog-of-war.md` §2.2 *"was
corrected to match rather than the reverse"` — the argument is not a polyline, it is the list of
segments step 3 produced. The same correction applies here, and for the same reason: D-121's
substance is that a `summary_polyline` is a **degraded** trace which permanently corrupts a map
that cannot re-fog, so naming our own full-fidelity artefact after it is the confusion the guard
exists to prevent.

So the key is **`users/<uid>/traces/<activityId>.segments.json.gz`**, and `02-data-model.md` §5.1
is amended to match, with a `D-xxx` recording it. The `users/<uid>/` prefix is not a second
divergence: `explored-blob-store.ts:115-117` already records that everything the user owns lives
there *"(`02` §6.1, `05` §7.3, including `traces/`)"*, and the worker's S3 grant is scoped to it.

### Where the write goes

Between `blobs` and `persist`, as its own phase, for the reason `INGEST_PHASES` gives for `cells`
and `blobs` sitting where they do: above the transaction, so a failure leaves the receipt
`PROCESSING` with no `Activity` row, and redelivery repeats the whole set idempotently. A
deterministic key makes the `PutObject` naturally idempotent.

`traceRef` then reaches T3 the only way it can — `processActivity` hands `persistActivity` an
activity with the key set, rather than the null `normalize()` produced.

### What is served

**One endpoint, `GET /api/runs/latest`**, shaped exactly like `app/api/fog/route.ts`: `dynamic =
"force-dynamic"`, uid re-derived from the verified session via `currentUserId()` and **never** read
from the query string, body or a header (`08-security-privacy.md` §5.3), 404 byte-identical to
`middleware.ts`'s signed-out response.

It queries T3's `byUserAndStart` index (`ScanIndexForward: false`, `Limit: 1`) for the caller's most
recent activity with a non-null `traceRef`, GETs the object, and returns a GeoJSON
`FeatureCollection` with one `MultiLineString` feature carrying `activityId` and `startedAt`.

**The latest run only, not the whole history.** `0057`'s criteria 4 and 5 both name *"the latest
run"*, and `0085` owns the permanent accumulated web of every past route in capability 12. A list
endpoint built now would be built against no client that can page it.

## Acceptance criteria

- [x] `src/domain/fog.ts` exports the sanitised segments — §2.2 steps 1–3 — and `traceToCells`
      consumes that same function rather than computing them a second time. A test asserts the
      cell set is byte-identical to what it was before the extraction.
- [x] The word `polyline` appears nowhere under `src/domain` or `src/pipeline`, and
      `node scripts/check-boundaries.mjs` passes.
- [x] The ingest pipeline writes `users/<uid>/traces/<activityId>.segments.json.gz` — gzipped
      GeoJSON `MultiLineString`, one line per segment — as its own phase between `blobs` and
      `persist`.
- [x] A trace that produced a split writes more than one line, and no line joins two segments'
      endpoints. Asserted against `0045`'s split fixture.
- [x] An activity with no trace (treadmill, manual, strength) writes no object and keeps
      `traceRef: null`. That is a normal outcome, not an error.
- [x] `persistActivity` writes the object's key to T3's `traceRef` for a traced activity, and a
      test asserts a non-null value reaches the item — the column is null on every row today.
- [x] Re-delivering the same message overwrites the same key and changes nothing observable.
- [x] `GET /api/runs/latest` returns the most recent traced activity's geometry as a GeoJSON
      `FeatureCollection`, and 404s for a signed-out caller.
- [x] The route derives the uid from the session only. A test asserts a uid supplied in the query
      string is ignored.
- [x] A caller with no traced activity at all gets a well-formed empty `FeatureCollection`, not a
      404 and not a 500 — "no runs yet" is the first-load state, not an error.
- [x] `02-data-model.md` §5.1's S-7 row names the key that is actually written, and a `D-xxx`
      records why it is not the one the doc shipped with.

## Notes

**Deliberately not in scope**, and each is someone else's ticket:

- The permanent trace layer of every past route — `0085`, capability 12.
- Any Amplify Data client on the browser, or a real `/chronicle` list. This endpoint is a server
  route precisely so that neither is needed yet.
- Backfilling `traceRef` on the rows already written. Those activities' raw bytes are archived and
  `0102`/`0103`'s rebuild drill is the mechanism; a one-off backfill script here would be a second
  one. **A consequence worth stating plainly: until a replay runs, `/api/runs/latest` answers with
  an empty collection on this account, because every existing row has `traceRef: null`.** The
  smoke test at close has to import an activity through the queue to have anything to serve.
- Compression choice beyond `gzip`. §5.1 says one immutable GET; the object is a few KB.

**Capability 08, not 06.** The write lands in capability 06's pipeline, which is closed and
audited — but the deliverable is "the map can draw a route", this is 08's discovered work, and
filing it into 06 would re-open an audited capability and fail its `capability-tickets-closed`
check. `AUDIT.md` §4's *"did this capability change anything an earlier one depends on"* is the
mechanism built for exactly this, and 08's audit is where it gets re-validated.

## Resolution

Built as specified, with one design divergence (D-235), one decision the ticket did not settle
(D-236), and three self-inflicted failures worth recording because two of them were caused by the
same mistake in how I verified.

### What was built

| File | What it owns |
|---|---|
| `src/domain/fog.ts` | `traceToSegments` — §2.2 steps 1-3, extracted out of `traceToCells` |
| `src/pipeline/route-trace-store.ts` | the key, the GeoJSON shape, the gzipped PUT |
| `src/pipeline/process-activity.ts` | the `traces` phase, and `traceRef` reaching `persistActivity` |
| `amplify/functions/process-activity/handler.ts` | the worker's `traces` dep |
| `amplify/backend.ts` | `custom.activityTableName`, and `dynamodb:Query` on T3 for the SSR compute |
| `lib/runs/server.ts` | the T3 query, the row selection, the S3 read |
| `app/api/runs/latest/route.ts` | the endpoint |
| `docs/02-data-model.md` §5.1 | S-7 amended, with the reasoning inline |

**The extraction is the load-bearing part.** `traceToCells` already computed
`segments: GeoPoint[][]` and threw it away after step 5's filter ran. Storing *that* array —
rather than sanitising the trace a second time for the renderer — is what makes the drawn line and
the revealed ground incapable of disagreeing. It also hands `0057` its criterion 8 for free: the
chords between segments are not filtered out, they never enter the array, so a renderer cannot
draw one.

**The extraction was proved behaviour-preserving against the pre-extraction code**, not against
itself. `git show HEAD:src/domain/fog.ts` was compiled alongside the new one and the two compared
over six trace shapes; the resulting cell ids for four of them are pinned as literals in
`src/domain/trace-segments.test.ts`. A snapshot taken after the change would have asserted that
the refactor agrees with itself, which is the assurance a refactor cannot give itself.

### D-235 — the artefact is not called what `02` §5.1 called it

`02` §5.1 specified `traces/<activityId>.polyline.gz`. That string cannot exist in `src/pipeline`:
`scripts/check-boundaries.mjs`'s STRICT tier bans `/polyline/i` there under D-100/D-121, in code
*and* in prose. The two dodges available — defining the key one directory away and importing it,
or a file exemption — are the *"a guard that has to be dodged is a guard that gets disabled"*
failure that `check-design-tokens.mjs` and `.githooks/pre-commit` both warn about in their own
comments.

**The precedent was already set one function away and went the same direction.** §2.2's step-5
helper was specified as `distancePointToPolyline`; the same gate caught it, and `05-fog-of-war.md`
was corrected rather than the code. The rename is not cosmetic: D-121's substance is that a
`summary_polyline` is a *degraded* trace which permanently corrupts a map that cannot re-fog, and
this object is the opposite — full fidelity, the same geometry the reveal filter measured against.
`users/<uid>/` and `no-cache` are the other two corrections; both are argued in D-235.

### D-236 — geometry is written for any traced activity, D-189 or not

The ticket did not settle whether a traced ride the rules refuse to score should still get a line.
It should: `traceRef` is a fact about the recording, and T3 documents its null case as
*"treadmill, manual, strength"* — a statement about having a trace. Deciding otherwise would put a
rules question inside the store, and since D-020 makes the map permanent, a later ruleset edit
would retroactively change which past runs are drawable.

### What went wrong

**1. `check-boundaries` failed in CI (Amplify job 186) and had passed locally.** Both hits were
real — the store's test used `strava#9001` as an activity id inside `src/pipeline`, which D-100
forbids, and the assertion that the key does *not* carry the banned spelling had to write the
banned spelling to say so. The local run had passed because I piped the guard's output to `tail`,
which discards the exit code.

**2. `tsc` was silently reusing `tsconfig.tsbuildinfo` and skipping my new file.** A real type
error — `activityItem`'s second parameter is a `DiscoveryAward`, and I passed
`{ ingestKey, newCellCount }` — sat undetected through several `npx tsc --noEmit` runs that all
reported success. `check-adapter-deletion.mjs` found it, because that check runs
`tsc --incremental false` in a staged copy; it reported it as an adapter leak, which is what it
was looking for rather than what was there. **Every gate was re-run afterwards by exit code, with
`--incremental false` and with `public/maplibre` moved aside.**

**3. The reader read an attribute the store does not have, and every unit test passed.**
`latestRun` read `row.activityId`. `persist.ts:148` writes `id: activity.activityId` — I-5's
deterministic id under the Amplify model's own primary key — so there is no `activityId` attribute
on a T3 item at all. My fixtures had invented one, so eleven tests certified a reader against a
store that does not exist. **Only the live smoke test found it**, returning an empty collection
over a row that plainly had geometry.

The fix is not just the attribute name: `lib/runs/server.test.ts` now builds its rows by calling
the shipped `activityItem`, so a fixture cannot describe a shape the writer does not produce.
Reverting `server.ts` to the old attribute now fails 3 of the 11 tests; before, it failed none.

### Not done, deliberately

No permanent trace layer (`0085`, capability 12), no client-side Amplify Data, no list endpoint —
`0057`'s criteria name *"the latest run"* twice and never ask for more, and a list endpoint built
now would be built against no caller. No backfill script: the rebuild drill (`0102`/`0103`) is the
mechanism, and the replay below used `0192`'s existing tool rather than a second one.

## Operator validation

**Nothing here is the operator's.** This ticket ships an S3 object, a T3 column and an HTTP
endpoint — no screen, no perceptual judgement, nothing two competent people could disagree about
by looking at it (D-181, narrowed by D-229). Everything below I ran myself with AWS credentials.
`0057` is where the operator's eyes are actually needed, and this ticket exists to unblock it.

### Deploy

Amplify job **186 FAILED** on `check-boundaries` (see Resolution), **187 SUCCEED** (`ff7a273`),
**188 SUCCEED** (`b645afa`, the reader fix).

### The live IAM grant, read back from the deployed role

`LostSolesAmplifyComputeRole` now carries exactly one statement touching T3:

```
QueryActivityForLatestRun | dynamodb:Query |
  ["…:table/Activity-nog4xy2l7baqlhghpndh2565qe-NONE",
   "…:table/Activity-nog4xy2l7baqlhghpndh2565qe-NONE/index/*"]
```

No `Scan`, no `GetItem`, no write. The role's four pre-existing `Scan` grants are on the CDK
tables it owns outright (capture guard, source accounts, OAuth state, ingest receipts) and none
reaches T3.

**The table name is in the client bundle**, like `basemapTilesUrl` before it — so I checked what
that actually grants. The browser's authenticated Cognito role
(`amplify-…-amplifyAuthauthenticatedU-3AL7rBieBPqs`) has **no DynamoDB access at all**: four S3
statements scoped to `users/${cognito-identity.amazonaws.com:sub}/*` and nothing else. The name
grants nothing.

### The endpoint, live and gated

Against `https://soles.devaultsecurity.com`, unauthenticated:

| Request | Result |
|---|---|
| `GET /api/runs/latest` | `404 {"error":"not found"}` |
| `POST /api/runs/latest` | `404` |
| `GET /api/fog?since=0` (comparison) | `404 {"error":"not found"}` — byte-identical |

### The write, through the real pipeline

Ten `reingest` jobs through the deployed SQS queue and the deployed worker, using `0192`'s
`tools/replay/replay-activities.ts`. **No run was required and none was performed** (D-229): the
bytes were already in `raw/` under D-101, which is what that archive is for.

- **Queue drained to `0/0`, DLQ `0`, 10 geometry objects written, 10 of 11 T3 rows now carry
  `traceRef`.** The eleventh is the 2025-08-04 activity with archived bytes and no receipt —
  ticket `0193`, untouched by this.
- **Cell counts did not move** (12, 28, 10, 16, 78, 10, 27, 18, 9, 10 before and after). The
  replay re-derived the same ground from the same bytes; D-020's append-only writes held.
- **One job hit a `ConditionalRequestConflict` (S3 409)** on the manifest — ten workers racing on
  one `regenerateExplored` publish, which `explored-blob-store.ts`'s `maxAttempts` exists for and
  which exhausted its retries under a bulk replay. **It self-healed on SQS redelivery** 16 minutes
  later (the queue's visibility timeout), which is exactly what the phase ordering is built for:
  the failure was above the transaction, so no row was written and the redelivery repeated the
  whole set. Nothing reached the DLQ. Not caused by this ticket; filed as `0196`.
- **The PUT is idempotent on real S3** — the object written by the single-activity replay is
  byte-identical to the one written by the bulk replay that followed it.

### The stored geometry, all ten objects

| | |
|---|---|
| Content type / encoding / cache | `application/geo+json` / `gzip` / `no-cache` |
| Coordinate precision | 6 dp, as documented |
| Sizes | 2.1 KB – 20.2 KB gzipped |

**Three of the nine runs are genuinely split into two lines** — real gap or teleport splits from
real recordings, not a fixture. Across all nine, 15,926 vertices, **the longest edge anywhere is
16.8 m**. A chord across a split would be hundreds of metres to kilometres. `0057`'s criterion 8
holds against real data, which is a stronger claim than the synthetic test makes.

The 8.64 km run reads as a loop: 3,603 vertices, first `[-81.41001, 30.128103]` and last
`[-81.410045, 30.128052]` — about 5 m apart.

### The shipped reader, against real DynamoDB and real S3

`latestRun` driven with the deployed table and bucket:

| # | What it proved |
|---|---|
| 1 | **Before the bulk replay** — returned the 2026-08-30 run, correctly **skipping five newer activities** whose `traceRef` was still null. The page-and-filter path, on real rows. |
| 2 | **After** — returns 2026-09-10 "Night Run", 648 vertices, the genuinely latest run |
| 3 | An unknown user → `{"type":"FeatureCollection","features":[]}`, not a 404 and not a throw |
| 4 | Run #1 is what caught the `id`/`activityId` bug; a fixture-only suite had certified it green |

### The whole CI set, by exit code

Nine guard scripts, `tsc --noEmit --incremental false`, `npm run lint`, and **1,881 tests across
102 files** (37 new) — all exit 0, with the generated `public/maplibre` moved aside (tickets
`0188`/`0190`). `npm run build` succeeds; `/api/runs/latest` appears in the route table.
