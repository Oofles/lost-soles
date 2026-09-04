---
id: 34
slug: strava-list-since
title: strava listSince(since) - the mandatory reconciliation sweep and the manual-sync producer
type: feature
priority: high
status: open
size: m
capability: 05-strava-adapter
depends_on: [33]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
started: 2026-09-04T21:54:13Z
---

## Description

`listSince(userId, watermark, creds): AsyncIterable<IngestJob>` — **mandatory, not optional**
(D-140, contract §3). It is the reconciliation sweep that covers **silently dropped webhooks**:
Strava retries a webhook three times, then drops it with **no DLQ and no replay**. Without
`listSince` there is no way to notice.

It is also the producer the **manual Sync** button runs on (roadmap §4.5). Building it before the
webhook costs nothing, because it is required either way, and it reaches the first-usable
milestone roughly one capability sooner.

Implementation:

- `GET /api/v3/athlete/activities?after=<epoch seconds>&per_page=200`, paged until a short page.
  200 per page is the maximum and the whole 8-year backfill is only ~8 list calls.
- Yield one `IngestJob` per activity as an **async iterable**, so the consumer can stop early and
  so a backfill never materialises 1,600 jobs in memory.
- **Parse ids as strings.** `activity.id` is an int64 and is **silently corrupted by
  `JSON.parse`** past 2^53 — no error, just a wrong number. Use a reviver or a bigint/string-mode
  parser so ids stay strings from the wire onward. `upload_id_str` is used where Strava provides
  it.
- Read the **list-endpoint GPS signal** before deciding anything downstream: `manual === true`, or
  an empty/absent `map.summary_polyline`, means "no GPS" and means 0035 must skip the stream call
  entirely. `summary_polyline` has exactly two legitimate uses — a cheap bounding-box prefilter
  and this has-GPS-at-all signal — and this is one of them. **Rendering it or projecting it to H3
  is not.**
- Advance `listSinceWatermark` on T7 **only after** the consumer confirms the page was fully
  enqueued, and advance it to the **oldest** unprocessed boundary rather than the newest seen, so
  a crash mid-page re-lists rather than skipping.
- Overlap the watermark by a margin (the nightly sweep covers 14 days per §2.7) so a
  clock-skewed or late-arriving activity is not stranded on the wrong side of the boundary.

## Acceptance criteria

- [x] `listSince` is implemented on the Strava adapter and satisfies the `SourceAdapter` type from
      0026 without a cast.
- [x] It returns an `AsyncIterable<IngestJob>` and pages with `per_page=200` until a short page.
- [x] A consumer that breaks after the first item stops the iteration and issues no further HTTP
      calls.
- [x] `activity.id` values above 2^53 survive as **exact strings** — a fixture with a large id
      asserts the emitted `externalId` matches the wire bytes character for character.
- [x] A plain `JSON.parse` of the same fixture is shown, in the test, to produce a **different**
      value — so the reviver is demonstrably doing work.
- [x] Each `IngestJob` carries a `hasGpsHint` derived from `manual` and `map.summary_polyline`,
      ~~and 0035 consumes it.~~ **AMENDED** — carried in `meta`, which the contract designates for
      "adapter-private hints"; promoting it to `IngestJob` itself would put one adapter's derived
      signal into every adapter's queue shape. The second clause is 0035's to satisfy and cannot be
      met from here; it is struck rather than ticked on that ticket's behalf.
- [x] The polyline is used **only** as that hint ~~and as a bbox prefilter~~ — a grep asserts
      `summary_polyline` is never passed to any projection, decode or render path. *(The bbox
      prefilter is the other legitimate use and is not built: nothing consumes one yet, and D-121.4
      permits it rather than requiring it.)*
- [x] `listSinceWatermark` advances only after successful enqueue and never skips an unprocessed
      activity; a test kills the iteration mid-page and asserts the next run re-lists it.
- [x] The watermark carries a documented overlap margin, with the margin as a named constant.
      *(TWO constants: §2.3 specifies 48 h for the 6-hourly sweep and 14 days for the nightly net.)*
- [x] Re-running `listSince` over the same window twice yields the same job set (the jobs
      themselves are idempotent downstream via the deterministic `activityId`).
- [x] ~~Everything is under `src/adapters/strava/`;~~ **AMENDED**, as in `0032` and `0033`:
      everything **vendor-specific** is under `src/adapters/strava/`; the 0027 T1 grep stays green.
      The watermark advance rule is source-agnostic policy and lives in `lib/sources/`.

## Notes

`listSince` is what makes the honest debt in roadmap §4.5 payable: between the first-usable
milestone and capability `14`, the app has upkeep (a Sync button) and **D-013 is not satisfied**.
That is a scheduled debt with a named payoff ticket, not a drift. If the gap between `08` and `14`
grows past a few weeks, `14` gets promoted ahead of `15`-`17`.

Rate-limit budget for this path (`03-integrations.md` §2.5): steady state is 4 reconciliation
sweeps/day at ~1 page each — 4 calls against a 1,000/day read quota. The list endpoint is
effectively free; the stream calls in 0035 are the entire cost. Backoff is 0038.

Backfill is a **checkpointed background job**, never a synchronous "connect your account" flow —
state `{ cursor, lastActivityId, completed, failedIds[] }` in DynamoDB, resumable after being
killed at any point. That job is out of scope here; this ticket must not make it harder to build.

## Operator validation

> **D-181 — most of what follows is the AGENT's to run, not the operator's.**
> Swept 2026-09-02 (ticket `0147`). This ticket's capability has no screen of its own. Before asking
> the operator for any step below, check whether AWS credentials (`AWS_PROFILE=devault`), `curl`, or
> a script can answer it — if so it is a **smoke test**, and what it proved is recorded here at
> close *instead of* the instruction. Keep only what genuinely needs a human eye, a phone, or a real
> run. The text below is the original author's intent, kept as context for **what** to verify — not
> as a list of chores for the operator.

None directly — `listSince` has no screen of its own; it is exercised through the Sync button in
capability `06`. Its behaviour is verified here by tests against checked-in fixtures. The operator
sees it at the milestone: pressing Sync and having a run that Strava's webhook would have dropped
still appear.

## Resolution

**Files touched.**

| File | What |
|---|---|
| `src/adapters/strava/adapter.ts` | **new** — the `SourceAdapter` object; `listSince` real, three phases stubbed |
| `src/adapters/strava/json-ids.ts` | **new** — `JSON.parse` that keeps int64 ids exact |
| `lib/sources/list-since-watermark.ts` | **new** — pure, source-agnostic: where the watermark should sit |
| `lib/sources/source-account-store.ts` | `readListSinceWatermark`, `advanceListSinceWatermark` |

Tests: `adapter.test.ts` (27), `json-ids.test.ts` (12), `list-since-watermark.test.ts` (10) are new;
`source-account-store.test.ts` gained 6. **658 passing**, all four gates clean, build clean.

**The decisions, and why.**

**1. A reviver cannot do what §2.7 asks, and the design doc's wording hides that.** §2.7 says to
keep ids exact with *"a reviver, or a JSON parser with a bigint/string mode"*. A plain reviver
**cannot** — by the time it is called the number has already been scanned into a double, so
`String(value)` faithfully returns the corrupted value. What works is the reviver's THIRD argument,
`context.source` (ES2025 source-text access), which hands back the wire characters. The doc is right
in spirit and wrong about the mechanism, and `json-ids.ts` records that where the next person will
find it rather than at the cost of a wrong activity id.

**2. And it has a fallback, because a green local test proves nothing here.** `.nvmrc` pins Node
22, local and CI run Node 23, and the Amplify SSR compute is a third runtime nobody here chose. So
`SOURCE_TEXT_AVAILABLE` is PROBED at load, not version-sniffed. Where it is absent the fallback is
exact to 2^53 and **throws** beyond — deliberately not a best-effort regex over the raw text. That
is `athleteIdToString`'s choice from 0032, for the same reason: refusing is recoverable, an
`externalId` that is quietly wrong is a second activity for one run, forever, on a map that never
re-fogs. Strava's ids are ten to eleven digits today, so the throwing branch guards a future.

**3. The ingestKey collides with the webhook's on purpose.** `01-architecture.md` §3 keys the
receipt on `sha256("strava:<owner>:<object>:<aspect>")`. A sweep job uses `aspectType: "create"`, so
a sweep that finds activity 42 and a webhook that already delivered it produce the SAME key and the
conditional `PutItem` drops the second. That is what lets the sweep run every six hours over a
48-hour window without ingesting everything eight times. An honest-looking `"sweep"` aspect would
mint a distinct key and duplicate every activity the webhook already handled — it looks like the
careful choice and is the broken one.

**4. `listSince` does not and cannot advance the watermark.** It knows what Strava returned and has
nothing to say about what reached the queue. Advancing on the strength of a list call succeeding is
exactly the mistake the pure module exists to prevent, so the split is: `listSince` produces,
`nextListSinceWatermark` decides, `advanceListSinceWatermark` writes, and the two consumers that
actually know — the manual Sync (`0043`) and the scheduled sweep (`0095`) — call the last two. Each
job carries its `startedAt` in `meta`, because the job is the only thing that survives the queue.

**5. The watermark is not monotonic, and a `Math.max` would silently delete the overlap.** In steady
state the new value lands at roughly `now - 48h`, which is BEHIND a watermark set six hours ago.
That is the margin working: the sweep is meant to keep re-examining two days, because `start_date`
is when the user ran and not when the activity appeared. Recorded on the function, because tidying
it into a monotonic advance would look like an improvement.

**6. The adapter is NOT registered in `ADAPTERS`.** Criterion 1 needs an object satisfying
`SourceAdapter` without a cast, so `accept`/`fetchRaw`/`normalize` exist as stubs that throw naming
their tickets (`0093`, `0035`, `0036`). Registering it would make `getAdapter("strava")` hand back
something that fails on three of its four phases; registration lands with `normalize` in `0036`.
Agreed with the operator before the work started.

**What went wrong.**

**The polyline grep failed on the design's own reasoning.** The first version flagged
`src/domain/activity.ts`, whose `Trace.simplified` comment reads *"Strava's `summary_polyline` would
be true — which is exactly why D-121.4 forbids it"*, and `scripts/check-boundaries.mjs`, whose job
is to carry the word in a pattern. Both are the rule being recorded, not broken. The grep now skips
comment lines and `scripts/`, the same exemption `check-design-tokens.mjs` already makes for a
comment naming a colour — deleting the explanation to satisfy the check would have traded the
reasoning for the assertion, which is the wrong way round.

**What is NOT proven, and by how much.** The multi-page path did not run live: the account holds 104
activities over six and a half years, so a real sweep returns ONE page and the loop exits on the
short-page check. Paging, the `MAX_PAGES` guard and the id-past-2^53 case are covered by unit tests
only. `SOURCE_TEXT_AVAILABLE` was confirmed true on Node 23 locally and has **not** been observed on
the deployed runtime — worth a line of output the first time `0043` or `0095` runs there.

## Operator validation

**None required** — everything was reachable with AWS credentials and is recorded below (D-181).
`listSince` has no screen of its own; the operator meets it at the milestone, pressing Sync and
having a run that Strava's webhook would have dropped still appear.

**1. `listSince` against the live account**, through the real 0033 token lifecycle:

```
runtime
  node                     v23.11.1
  JSON source-text reviver AVAILABLE (exact past 2^53)

stored listSinceWatermark: (never swept)

listSince(from 2018-01-01T00:00:00.000Z)
  activities returned   104
  with GPS              101
  without GPS             3        <- criterion 6, on real data
  sport types           Ride, Run, Walk, Workout
  externalId types      string     <- criterion 4
  ids are all digits    true
  ingestKeys unique     true       <- criterion 10
  no polyline on a job  true       <- criterion 7
  oldest                2020-02-24T13:11:04.000Z id 3127918027
  newest                2026-09-03T01:55:18.000Z id 20014448765

early break: HTTP calls issued 1 (must be 1)   <- criterion 3
```

Six and a half years of the operator's real history, and **three activities the GPS hint correctly
marks as traceless** — which is 0035 skipping three stream calls it would have learned nothing from.

**2. The watermark rule, driven by those real dates** (criterion 8). The sweep is made to die having
missed one activity from the middle of the page:

```
19 activities in 2026, 2026-01-24T03:43:08Z .. 2026-09-03T01:55:18Z

the sweep completed cleanly
  watermark -> 2026-09-01T01:55:18.000Z      = newest minus the 48h overlap

the sweep died having missed 2026-07-28T11:27:46.000Z (activity 10 of 19)
  watermark -> 2026-07-26T11:27:46.000Z
  pinned BELOW the dropped activity     true
  even though 18 others were confirmed
  activities the next sweep re-lists    11
  had it advanced to the newest SEEN -> 2026-09-01T01:55:18.000Z
  activities permanently lost           1  (2026-07-28T11:27:46.000Z)
```

That last pair is the entire ticket in two lines. The naive rule loses a real run off the operator's
own map, permanently, on a map that by D-020 never re-fogs. The implemented rule pays eleven
re-listed activities — one free list call, §2.5 — to keep it.

**3. Gates.** `npm test` 658 passed / 1 skipped; `tsc --noEmit`, `eslint --max-warnings 0`,
`check-boundaries.mjs` and `check-design-tokens.mjs` all clean; `npm run build` clean. **All four
run locally this time**, which is the habit `0033` cost a failed deploy to learn.
