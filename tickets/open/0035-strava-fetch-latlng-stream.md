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

- [ ] The request sends exactly `keys` and `key_by_type=true` and **no** `resolution` and **no**
      `series_type`; a test inspects the outgoing URL and fails if either appears.
- [ ] A code comment at the call site records that those two are response metadata, so the next
      reader does not "fix" it back.
- [ ] `keys` includes `latlng`, `time` and `altitude`.
- [ ] `summary_polyline` is never decoded, never projected, never rendered — a repo grep asserts
      no polyline-decoding dependency is imported anywhere outside a bbox-prefilter helper.
- [ ] A real 45-minute run fixture yields **~2,700** `latlng` points, and the test asserts a lower
      bound well above the 100-300 that `summary_polyline` would give.
- [ ] Streams are asserted **index-aligned and equal length** before zipping; a mismatched fixture
      raises rather than silently truncating.
- [ ] An activity whose `hasGpsHint` is false issues **zero** stream calls; a test counts HTTP
      calls, not just outcomes.
- [ ] `fetchRaw` returns the response bytes **unmodified**, with `contentType` and `ext`, and
      performs no transformation, no reshaping and no id coercion on the archived bytes.
- [ ] Ids parsed for job construction stay strings; a fixture with an id above 2^53 round-trips
      exactly, and `upload_id_str` is preferred where present.
- [ ] Everything is under `src/adapters/strava/`; the 0027 T1 grep stays green.

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

**Desktop, the browser devtools Network tab (or a CloudWatch log of the outgoing request).** Sync
one real outdoor run and inspect the actual request URL to `/streams`: confirm it carries only
`keys` and `key_by_type`, and confirm the response's `original_size` matches the point count the
adapter reports. Then, on the phone at the map screen after capability `08` lands, compare a known
tight loop (a lap of a park) against reality: if it renders as a chord across the park rather than
a loop, `summary_polyline` has crept in somewhere and the reveal is permanent.
