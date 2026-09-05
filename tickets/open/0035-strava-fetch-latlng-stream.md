---
id: 35
slug: strava-fetch-latlng-stream
title: Fetch the full latlng stream - never summary_polyline, and never send resolution/series_type
type: feature
priority: high
status: open
size: m
capability: 05-strava-adapter
depends_on: [33, 34]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
started: 2026-09-05T00:53:57Z
---

## Description

`fetchRaw` for an activity: the detail call plus the streams call, returning **raw bytes exactly
as Strava gave them** for the pipeline to archive before anything trusts them (D-121.2).

```
GET https://www.strava.com/api/v3/activities/{id}/streams
    ?keys=latlng,time,altitude
    &key_by_type=true
Authorization: Bearer <access_token>
```

`keys` is **required** (CSV, minItems 1). `key_by_type` is **required and must be `true`** —
there is effectively no other supported mode; it makes the response an object keyed by stream
type instead of a bare array. All streams for an activity are **index-aligned and equal length**:
element *i* of `latlng` corresponds to element *i* of `time` and `altitude`.

**TRAP 1 — `resolution` and `series_type` are response metadata, NOT request parameters.**
The only parameters on `getActivityStreams` are `id`, `keys` and `key_by_type`, verified against
the live `swagger.json`. Older Strava documentation prose, older client libraries (**stravalib**,
**stravaj**) and essentially every blog post on the subject still describe
`resolution=low|medium|high` and `series_type=distance|time` as query parameters. **They were
removed and are now silently ignored** — no error, no effect. If you are debugging "why won't it
downsample", the answer is that it cannot. The consequence is good: **streams always return at
full recording resolution**, typically 1 Hz, so a 45-minute run is ~2,700 points, and
`"resolution": "high"` in the response is confirming you got everything.

**TRAP 2 — never use `summary_polyline`** (D-121 mitigation 4). It is tempting because it is
**free**: it arrives on the list endpoint, 200 activities per call, zero extra rate limit, while
the `latlng` stream costs **one API call per activity**. Do not take the trade.

| | Points, typical 10 km run | Fidelity |
|---|---|---|
| `latlng` stream | **~2,700** (1 Hz) | full device precision |
| `map.summary_polyline` | **~100-300** | Ramer-Douglas-Peucker simplified; **tens of metres of cross-track error on curves**; corners cut; switchbacks and loops collapsed to straight chords |

RDP decimation deletes precisely the detail fog-of-war depends on. A tight loop through a park
becomes a chord across it: it reveals ground the user never ran and fails to reveal ground they
did. **By D-020 both errors are permanent** — the map never re-fogs, so a bad reveal is a scar
you cannot remove without rebuilding from the archive.

**Do not fetch streams for activities with no GPS.** Use the `hasGpsHint` from 0034
(`manual === true`, or empty/absent `summary_polyline`) and skip the call — a rate-limit saving
and a correctness measure both.

**Also int64-safe:** `upload_id` and `activity.id` are int64s that `JSON.parse` silently corrupts.
Ids stay strings; use `upload_id_str` where provided.

## Acceptance criteria

- [x] The request sends exactly `keys` and `key_by_type=true` and **no** `resolution` and **no**
      `series_type`; a test inspects the outgoing URL and fails if either appears.
- [x] A code comment at the call site records that those two are response metadata, so the next
      reader does not "fix" it back. *(And a test asserts the comment is still there — the comment
      is the only thing standing between a plausible-looking edit and a silent no-op.)*
- [x] `keys` includes `latlng`, `time` and `altitude`.
- [x] `summary_polyline` is never decoded, never projected, never rendered — a repo grep asserts
      no polyline-decoding dependency is imported anywhere outside a bbox-prefilter helper.
      *(There is no bbox-prefilter helper yet, so the exemption has nothing to exempt: the
      asserted state is zero decoders anywhere, declared or imported.)*
- [x] A real 45-minute run fixture yields **~2,700** `latlng` points, and the test asserts a lower
      bound well above the 100-300 that `summary_polyline` would give. **The fixture is SYNTHETIC,
      not captured** — this repository is public and a real `latlng` stream is 2,700 points of
      where the operator actually ran, starting outside their front door (ticket `0168`). The
      ~2,700 figure is verified against REAL runs in the smoke test instead.
- [x] Streams are asserted **index-aligned and equal length** before zipping; a mismatched fixture
      raises rather than silently truncating. **AMENDED on where it runs:** the assertion is
      `assertStreamsAligned`, exported and pure, called by `normalize` after the archive PUT —
      *not* inside `fetchRaw`. §3.1 rule 1 archives before the parser is trusted and rule 5 never
      deletes on ingest failure, so a `fetchRaw` that threw here would destroy the only evidence
      of what Strava actually sent. The raising still happens; one phase later, costing a replay
      instead of the payload.
- [x] An activity whose `hasGpsHint` is false issues **zero** stream calls; a test counts HTTP
      calls, not just outcomes.
- [x] `fetchRaw` returns the response bytes **unmodified**, with `contentType` and `ext`, and
      performs no transformation, no reshaping and no id coercion on the archived bytes.
      **CLARIFIED:** there are TWO responses and one return value, so they are sealed into an
      envelope by **concatenating buffers** — each response appears contiguously and unchanged.
      See D-194 for why one object rather than `03-integrations.md` §3.2's three.
- [x] Ids parsed for job construction stay strings; a fixture with an id above 2^53 round-trips
      exactly, and `upload_id_str` is preferred where present.
- [x] Everything is under `src/adapters/strava/`; the 0027 T1 grep stays green. *(Unamended and
      literally true this ticket — no file outside the adapter directory changed.)*

## Notes

The fidelity floor from contract §5 (assert points-per-km above a threshold, to catch a silent
source-side decimation **before** it permanently corrupts the map) ships in 0038 with the real
fixtures. This ticket is what it guards.

The stream calls are the entire rate-limit cost of the system: ~1,600 for an 8-year backfill at
1,000 reads/day, so ~2.3 days budgeted at 70%. That is the number that makes backfill a
checkpointed background job and makes the S3 archive pay for itself immediately — those calls are
expensive, slow to re-acquire, and after 2026 may not be re-acquirable at all.

Note the two stream-name traps while you are here: there is **no `power`** (it is `watts`) and
**no `temperature`** (it is `temp`). Not needed for MVP, but the next person to add heart rate
will hit them.

## Operator validation

> **D-181 — most of what follows is the AGENT's to run, not the operator's.**
> Swept 2026-09-02 (ticket `0147`). This ticket's capability has no screen of its own. Before asking
> the operator for any step below, check whether AWS credentials (`AWS_PROFILE=devault`), `curl`, or
> a script can answer it — if so it is a **smoke test**, and what it proved is recorded here at
> close *instead of* the instruction. Keep only what genuinely needs a human eye, a phone, or a real
> run. The text below is the original author's intent, kept as context for **what** to verify — not
> as a list of chores for the operator.

**Desktop, the browser devtools Network tab (or a CloudWatch log of the outgoing request).** Sync
one real outdoor run and inspect the actual request URL to `/streams`: confirm it carries only
`keys` and `key_by_type`, and confirm the response's `original_size` matches the point count the
adapter reports. Then, on the phone at the map screen after capability `08` lands, compare a known
tight loop (a lap of a park) against reality: if it renders as a chord across the park rather than
a loop, `summary_polyline` has crept in somewhere and the reveal is permanent.

## Resolution

**Files touched — all four under `src/adapters/strava/`**, which is the first ticket in this
capability where the scope criterion held as written.

| File | What |
|---|---|
| `adapter.ts` | `fetchRaw`; the detail call, the conditional streams call, and the two traps recorded at the call site |
| `raw-envelope.ts` | **new** — sealing and opening the archive envelope, `assertStreamsAligned`, `uploadIdOf` |
| `raw-envelope.test.ts` | **new**, 19 tests |
| `adapter.test.ts` | +17 tests |

Plus `docs/decisions/DECISIONS.md` (**D-194**) and the superseded-section note in
`03-integrations.md` §3.2 — D-153's rule that the code or the doc changes, never neither.
**694 passing**, all four gates clean.

**I probed the live API before writing the parser**, which is the lesson `0165` cost a session to
learn: a fixture built from a design document tests that the code matches the document. Three
things the probe corrected or confirmed, none of which are in §2.4 as written:

1. **Strava returns a `distance` stream nobody asked for.** Requesting `latlng,time,altitude`
   returns FOUR streams. §2.4's example response shows only the three. `assertStreamsAligned`
   therefore checks *every stream present*, not the requested keys — a checker written from the
   doc would have passed a misaligned `distance` straight through to whichever ticket starts
   reading it.
2. **A GPS-less activity's `/streams` returns 404**, with `{"message":"Resource Not Found"}` —
   not an empty 200. §2.5 says to treat that as "no streams" rather than an error, and it is now
   confirmed rather than assumed.
3. **The "~2,700 points" figure is per 45 MINUTES, not per 10 km.** Both framings appear in the
   ticket and the doc. A real 30.3-minute run returned 1,809 points — 60/min, so ~2,687 for 45
   minutes, which matches almost exactly. Points-per-km came out at 404, well above the ~270 the
   per-10-km reading implies, so the fidelity floor `0038` sets from the km figure would have been
   set low.

**The decisions.**

**1. One archive object, not three — D-194.** The design contradicted itself: the contract and
`RawArchiveRef` describe one content-addressed object, `03-integrations.md` §3.2 describes
`manifest.json` + `summary.json` + `streams.json` under a Hive-partitioned revisioned prefix. D-140
already settles which wins, and ticket `0039` had independently restated the contract's layout — so
two of the three artefacts agreed before this ticket asked. Recorded as a decision and §3.2 amended
in place, rather than left to contradict the contract for the next reader.

**2. The envelope concatenates buffers; it never parses and re-serialises.** That is what makes
§3.1 rule 2 true in the strong sense — an int64 id in the archive is the int64 id the wire carried,
because nothing ever turned it into a number. It also means a malformed response yields a malformed
envelope, which is correct: the archive holds what arrived, and a wrapper that repaired a bad
payload would destroy the only evidence of what went wrong.

**3. The alignment check is not in `fetchRaw`.** Criterion 6 put it "before zipping", and the
obvious reading is that `fetchRaw` validates. It must not: §3.1 rule 1 archives before the parser
is trusted, rule 5 never deletes on ingest failure, and a `fetchRaw` that threw on a malformed
stream would mean the response never reached S3 and nobody could ever look at it. The check ships
here as a pure exported function; `normalize` calls it after the PUT.

**4. The `latlng` fixture is synthetic, and that is a privacy decision, not a convenience.** This
repo is public. A captured 2,700-point stream is the operator's route from their own front door.
Filed as `0168`, which also blocks `0038` for its `latlng` fixtures; the synthetic geometry here is
a circle, so it has no bearing, no start and no route.

**What is not built.** The bbox prefilter — the *other* legitimate use of `summary_polyline` under
D-121.4. Nothing consumes one, and D-121.4 permits it rather than requiring it. `normalize` is
`0036`; the adapter still does not join `registry.ts`'s `ADAPTERS` until it lands.

## Operator validation

**None required.** Everything was reachable with AWS credentials and `fetch`, and is recorded below
as smoke tests (D-181). The ticket's original text asked the operator to inspect a request URL in
devtools and compare `original_size` to a reported point count — both are a script's job and are
done below. Its second half, comparing a tight loop against reality on the map screen, is a real
operator check and belongs to **capability `08`**, which is the first ticket that renders anything.

**1. `fetchRaw` against a real outdoor activity**, through the live 0033/0034 stack:

```
HTTP calls         2   /api/v3/activities/<id> then /api/v3/activities/<id>/streams
stream params      keys=latlng,time,altitude key_by_type=true
resolution sent    false      <- criterion 1
series_type sent   false      <- criterion 1
envelope bytes     75972 application/json json
detail id (string) string "17156249188"      <- criterion 9
upload id          18251349120               <- upload_id_str preferred
streams returned   latlng, time, altitude, distance     <- FOUR, one unrequested
lengths            { latlng: 1809, time: 1809, altitude: 1809, distance: 1809 }
index-aligned      OK                         <- criterion 6
resolution (resp)  high | original_size 1809  <- matches the data length exactly
```

`original_size` equalling the returned length is §2.4's *"`resolution: high` is confirming you got
everything"*, observed rather than quoted.

**2. The fidelity floor, on real runs** (criterion 5):

```
1809 latlng points over 30.3 min = 60/min
projected for a 45-min run: ~2687 points        <- the doc says ~2,700
longest of the 6 most recent: 3153 points over 54.3 min
above the 1,000 lower bound: true
summary_polyline would give 100-300
```

A real recording carries **ten to thirty times** what the free summary would. That ratio is the
entire argument for spending one API call per activity, and it is now measured rather than cited.

**3. A GPS-less activity** (criterion 7):

```
HTTP calls         1   (the detail only)
stream calls       0
streams archived   null   (a fact, not an absence)
detail archived    Run
```

Zero stream calls, counted at the `fetch` boundary. The stream calls are the entire rate-limit cost
of the system (~1,600 for an eight-year backfill against 1,000 reads/day), so every one of these is
a read that never happens.

**4. Gates.** `npm test` 694 passed / 1 skipped; `tsc --noEmit`, `eslint --max-warnings 0`,
`check-boundaries.mjs`, `check-design-tokens.mjs` all clean; `npm run build` clean.
