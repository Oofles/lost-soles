---
id: 38
slug: strava-fixtures-and-rate-limit-backoff
title: Checked-in real-response fixtures, the fidelity floor, and rate-limit backoff
type: chore
priority: high
status: closed
size: m
capability: 05-strava-adapter
depends_on: [34, 35, 36]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
started: 2026-09-06T01:55:41Z
closed: 2026-09-06T02:23:05Z
---

## Description

Two things the adapter is not trustworthy without: real recorded responses to test against, and
correct behaviour when Strava says no.

**Fixtures — `src/adapters/strava/__fixtures__/`.** Capture **real** responses and commit them,
because contract §5 makes `normalize()` unit-testable from a checked-in fixture **with zero
mocking**, and because after 2026 these responses may not be re-acquirable. Required set:

> **AMENDED 2026-09-06 BY `0168`, WHICH IS NOW CLOSED. The instruction below originally read
> "redacted of tokens, *not of shape*", and that was wrong.**
>
> `github.com/Oofles/lost-soles` is **public**. Leaving the coordinates in publishes ~2,700 real
> GPS points per fixture — the street the operator starts on, and the route between — permanently
> and cloneably. `08-security-privacy.md` §7.2 already forbade this in as many words (*"Test
> fixtures are **synthetic coordinates**"*); nothing enforced it, so this ticket contradicted it
> in good faith.
>
> **The rule is now D-199: real fixtures, synthetic geometry.** Capture the real response. Keep
> every non-geometric field exactly as it arrived — field set, stream keys, point **count**, 1 Hz
> cadence, index alignment across streams, `original_size`, the gap and signal-loss structure,
> the int64 ids. Replace **only** the coordinates, generated along a synthetic path near Point
> Nemo (`-48.876, -123.393`). The fixture remains a real captured response in every respect the
> code can observe, which is the whole point of having one.
>
> Enforced by `scripts/check-fixture-geography.mjs` on the pre-commit hook, the Actions gate and
> the Amplify build. A hand-added fixture carrying a real track is blocked before it is committed.
> Rigid relocate-and-rotate of a real track was **considered and rejected** — see D-199.

1. An outdoor run: detail + streams, **~2,700 `latlng` points**, with `original_size` intact.
2. A `TrailRun` — proving the `type`/`sport_type` divergence is real, not theoretical.
3. A treadmill run recorded by a watch: streams **with `time`, `distance`, `heartrate`, `cadence`
   and no `latlng` key at all**.
4. A `manual: true` activity with an empty/absent `summary_polyline`.
5. A streams **404** response.
6. An activity with an `id` **above 2^53**, to lock the int64/`JSON.parse` corruption test.
7. A trace containing a real signal-loss jump (tunnel or urban canyon).
8. A DST-boundary activity, for the `startedAtLocal` assertions.
9. An unknown/novel `sport_type`.
10. A **429** response with full rate-limit headers.

**The fidelity floor** (contract §5, check 5). Assert **points-per-km above a threshold** on every
normalized trace, to catch a silent source-side decimation — the `summary_polyline` failure mode —
**before it permanently corrupts the map**. At 1 Hz a 6 min/km run gives ~360 points/km;
`summary_polyline` would give ~10-30. Set the floor well below the former and far above the
latter, name the constant, and justify it in a comment. A trace below the floor is a **loud
failure**, not a warning: by D-020 a bad reveal cannot be un-drawn.

**Rate limits** (`03-integrations.md` §2.5). **Limits are per-application, not per-athlete** — the
quota attaches to the `client_id` and is shared across every authorized athlete. Adding a user does
not add quota, it **splits** it. Default tier: **100 reads/15 min, 1,000 reads/day**; overall
200/2,000. Every call Lost Soles makes is a read, so the read bucket is the only one that binds.

**Read the headers; do not model the budget locally:**

```
X-RateLimit-Limit:      200,2000      # overall:  15min,daily
X-RateLimit-Usage:      12,431
X-ReadRateLimit-Limit:  100,1000      # read:     15min,daily
X-ReadRateLimit-Usage:  12,431
```

15-minute windows reset on natural boundaries (:00, :15, :30, :45); daily at **midnight UTC**.
Exceeding a limit returns **429**.

**On 429: do not retry immediately, and do not exponential-backoff blindly — the window is
fixed.** Sleep until the next natural boundary (or midnight UTC for the daily bucket) and resume.
For transient 5xx and network errors, exponential backoff **1s → 2s → 4s → 8s, max 5 attempts,
with full jitter**. A single global backfill worker with a per-user FIFO is the correct shape.

## Acceptance criteria

- [x] ~~All ten fixtures are committed~~ **Six** fixtures are committed under
      `src/adapters/strava/__fixtures__/` with a README naming what each one proves; every
      one is a real captured response, not hand-written.
      **AMENDED 2026-09-06, operator decision.** Four of the ten cannot be captured, for
      reasons that are properties of the world rather than of this ticket: the account has
      **zero** `type`/`sport_type` divergence in 104 activities over six years (fixture 2),
      the largest real id is `20014448765` against 2^53 ≈ 9.0 × 10¹⁵ (fixture 6), nothing
      novel has ever been recorded (fixture 9), and forcing a 429 costs ~1,000 reads of a
      quota shared across every athlete on the `client_id` (fixture 10). Split out as
      **`0173`** rather than satisfied by hand-writing four files and calling them
      captures. The six real ones are `real-run-outdoor` (2,537 pts), `real-run-signal-loss`
      (a genuine 35 m jump at index 1670), `real-run-dst-boundary`, `real-indoor-no-latlng`
      and `real-manual-streams-404` — the last covering original fixtures 4 and 5 together,
      because a manual activity's `/streams` IS the 404.
- [x] No fixture contains a live token, client secret, or refresh token.
      — and this was not free: a real detail response carries **`embed_token`**, a live
      token, which the capture tool now deletes rather than blanks. The guard fails on it.
- [x] `normalize` is tested against every fixture **with zero mocking** — no HTTP stub is
      needed because no HTTP is involved.
      — `normalize.test.ts` → *"every fixture normalizes"* DISCOVERS the directory rather
      than listing it, so a fixture added and then forgotten cannot sit unexercised.
- [x] The fidelity floor runs on every normalized trace with a named, commented constant,
      and a test feeds it an RDP-decimated version of fixture 1 and asserts the build
      **fails**.
      — `MIN_POINTS_PER_SECOND`, not points-per-km. **The specified metric could not do the
      job and the number justifying it was wrong**: measured against real responses, a
      `summary_polyline` is 20–49 points/km, not the 10–30 assumed here. See D-200 and the
      Resolution.
- [x] The floor's failure is an error that stops ingestion for that activity, not a logged
      warning.
- [x] Rate-limit headers are parsed from every response ~~including error responses~~ **that
      carries them**, and the remaining read budget is tracked from the headers rather than
      counted locally.
      **AMENDED 2026-09-06 by a live probe, which found §2.5's "every response" is wrong.**
      An authenticated 400 and an authenticated 404 for another athlete's activity both
      carry the headers; an authenticated **404 from `/streams`** does not, and neither does
      an unauthenticated 401. The `/streams` 404 is not exotic — §2.6 makes it the ordinary
      answer for every manual and GPS-less activity. Handled by `mergeRateLimit`: a
      header-less response carries no news, and usage only moves forward from the last
      observed reading. Without it, every piece stays individually correct and the worker
      forgets a 97%-full bucket the moment it touches a manual activity.
- [x] A 429 causes a sleep until the next natural 15-minute boundary (or midnight UTC for
      the daily bucket), **not** an immediate retry and **not** a blind exponential backoff;
      a test with a frozen clock asserts the computed wake time for each of the four
      boundaries.
- [x] Transient 5xx and network errors retry 1s/2s/4s/8s with **full jitter**, max 5
      attempts, then fail the job cleanly for the DLQ.
- [x] A 4xx that is not 429 is **not** retried.
- [x] The read budget check happens **before** a stream call is issued, so a backfill
      degrades to "resume tomorrow" rather than burning attempts against a closed window.
- [x] The capability doc records the steady-state budget (~6-10 reads/day against 1,000)
      and the backfill budget (~1,600 stream calls, ~2.3 days at 70% of quota), so a future
      change that multiplies call volume is visibly a budget decision.
- [x] Everything is under `src/adapters/strava/`; the 0027 T1 grep stays green.

## Notes


**Blocked 2026-09-05 on 0168:** The latlng fixtures cannot be committed to a public repo until 0168 settles how a real track is transformed

**Unblocked 2026-09-06.** `0168` closed with D-199 ("real fixtures, synthetic geometry") and
`scripts/check-fixture-geography.mjs`. The Description's fixture instruction is amended above.

> **2026-09-04, ticket `0165`.** This ticket's value went up sharply and the reason should be on
> it. `0032` shipped 76 green tests whose token-response fixtures were copied from
> `03-integrations.md` §2.2 step 3's example — so the suite proved the code matched the DOCUMENT,
> and the document was wrong about the live service. The connect flow refused every good grant and
> revoked it, and nothing in the suite could have caught that. **A fixture derived from a design
> doc is not a fixture; it is the design doc asserted twice.** That is the fidelity floor this
> ticket is for.
>
> **Ticket `0166` then found the same class again**, one string away: the callback spells its
> scope list with commas and the token response with spaces (RFC 6749 §5.1), and the parser was
> written for the one surface the document illustrated. Two bugs, two operator connects, one
> missing recorded response.


Fixture 6 (the >2^53 id) is the cheapest insurance in the capability. `upload_id` and
`activity.id` are int64s that `JSON.parse` **silently corrupts** — no error, just a wrong number —
and a wrong `externalId` breaks the deterministic `activityId`, which breaks idempotency, which
double-awards XP on replay. One fixture locks all of that down.

The archive earns its keep here: 1,600 stream calls are expensive and slow to re-acquire, and the
athlete cap (D-102/D-121) may remove access entirely. **Archive first, normalize second.**

Backfill state is `{ cursor, lastActivityId, completed, failedIds[] }` in DynamoDB and must survive
being killed at any point. The backfill job itself is not this ticket, but the backoff and budget
primitives it will use are.

## Resolution

**Files touched**

| File | What |
|---|---|
| `scripts/make-strava-fixture.mjs` | **new** — captures a real response and applies the D-199 transform, which is not a flag |
| `src/adapters/strava/__fixtures__/real-*.json` | **new** — five real captures covering six of the ten required fixtures |
| `src/adapters/strava/__fixtures__/ride-decimated-dense.json` | **new** — separates `simplified` from the floor |
| `src/adapters/strava/fidelity.ts` + `.test.ts` | **new** — the floor, 13 tests incl. the RDP case the criterion names |
| `src/adapters/strava/rate-limit.ts` + `.test.ts` | **new** — headers, budget, 429, backoff; 50 tests |
| `src/adapters/strava/normalize.ts` | the floor throws, after sanitation, where `time` is still in scope |
| `src/adapters/strava/normalize.test.ts` | the every-fixture sweep; `simplified` split from the floor |
| `src/adapters/strava/adapter.test.ts` | the polyline-decoder guard narrowed to the ingest path and **strengthened** |
| `scripts/check-fixture-geography.mjs` | extended to place names and `embed_token` |
| `docs/contracts/ingestion-contract.md` §5, `docs/03-integrations.md` §2.5 | amended, twice each |
| `docs/decisions/DECISIONS.md` | **D-200** |
| `docs/capabilities/05-strava-adapter.md` | the read budget, with measured figures |
| `tickets/open/0173-*.md` | **new** — the four fixtures no account can produce |

**Two criteria were amended, both because measurement contradicted the ticket.**

**1. The fidelity floor's metric was wrong, and wrong in the unsafe direction.** This
ticket justified points-per-km as *"~360 for a run; `summary_polyline` would give ~10-30."*
Measured against real captured responses instead of estimated:

| | points/km | points/second |
|---|---|---|
| real full streams (87 runs, 2 rides, 12 walks) | 182 – 684 | 0.94 – 0.99 |
| real `summary_polyline` | **20 – 49** | 0.047 – 0.110 |
| real `map.polyline` | 37 – 56 | — |

A floor set *"far above 30"* would have **passed a real `summary_polyline`**. And
points-per-km is a function of speed: at 1 Hz, 100 points/km is exactly 36 km/h, so any
floor in the 49–182 gap rejects a fast descent as corrupt — and `xp-rules-v1.yaml` already
carries `kinds: [ride]`. A sampling rate is speed-invariant and separates the same two
populations by 9–21×. Operator confirmed the change; recorded as **D-200**, with
`contracts/ingestion-contract.md` §5 check 5 amended, since the contract is canonical.

Two things about the floor that only appeared while building it:

- **The median, not the mean.** `duration / points` is destroyed by a pause: 20 minutes of
  running, a two-hour stop, 20 more, is a full-resolution 1 Hz trace whose mean rate is
  *below the floor*. A mean would refuse a real run because the operator stopped for lunch.
  There is a test asserting exactly that pair — mean fails, median passes.
- **An absent `time` stream is half the check.** `buildTrace` derives timestamps as
  `startedAt + (offsetS ?? i) * 1000`, so with no `time` stream it counts off the array
  index and fabricates a flawless 1 Hz cadence. A trace decoded from a `summary_polyline`
  has no time stream — it would have sailed through the rate floor, the check reporting
  "clean" for the one input it exists to reject. Found by writing the test, not the code.

**2. Four of the ten fixtures cannot be captured**, for reasons that belong to the world:
the account has zero `type`/`sport_type` divergence across 104 activities and six years;
the largest real id is `20014448765` against 2^53 ≈ 9.0 × 10¹⁵; nothing novel has been
recorded; and forcing a 429 costs ~1,000 reads of a quota shared across every athlete on
the `client_id`. Operator chose to drop them from the required set rather than let a
wording keep four real assertions unwritten — filed as **`0173`**.

**What the capture tool found that reading the API docs would not have.** The
post-write re-check — the generator does not get to vouch for itself — **deleted its own
first two fixtures**. A real detail response leaks in more places than the track:
`segment_efforts[].segment.start_latlng`/`end_latlng`/`map.polyline`, plus the segment's
town (`"Ponte Vedra Beach, Florida"`) and its name, plus **`embed_token`, which is a live
token** and squarely inside criterion 2. The transform is now a structural walk over the
whole payload rather than three named paths, and `check-fixture-geography.mjs` gained
place-name and token checks.

**A guard I miscalibrated and had to back out.** Extending the geography check to free text
(`name`, `description`) fired on eleven legitimate fixtures at once — `detail.name` on a
hand-written fixture is a test label, not a location. A guard with that false-positive rate
gets deleted by whoever it blocks, which is the reasoning that gave the D-100 check its two
tiers. Free text is scrubbed by the capture tool and deliberately not checked by the guard;
the note in the file says why, so it does not get re-added.

**Precision, corrected by measurement.** The transform first rounded to 5 decimal places
and put 1.5–2.7% of error into total path length — error injected into the exact quantity
the fidelity floor measures. Strava sends **6** dp (458 of the first 500 points of a real
capture). At 6 dp the drift is 0.02–0.05%, and the fixtures are more faithful.

**A collision worth recording: the floor supersedes `simplified`.** `ride-decimated-streams`
(3 points across 2,400 s) used to normalize to `simplified: true`; it now throws. That is
correct — `simplified` was the weaker answer to D-121, *mark it and let something downstream
decide*, and nothing downstream ever did. The flag keeps its job above the floor, and
`ride-decimated-dense` was added so both halves stay tested.

**The polyline-decoder guard, narrowed and strengthened.** `adapter.test.ts` asserted *no
polyline decoder exists anywhere in this repository*, and this ticket's privacy tooling
needs one — to prove a committed fixture's `summary_polyline` carries no real coordinate,
and to re-encode synthetic geometry. Two files are exempted **by exact path**, and the test
now also asserts that nothing under `src|lib|app|amplify|components` imports them or
decodes a polyline inline. That is strictly stronger than before: the old version scanned
for the word in an import line and would have passed a hand-rolled decoder written directly
into `normalize.ts` — the one file where it matters.

**Not done, deliberately:** the backfill worker itself. This ticket builds the backoff and
budget primitives it will use, as its own Notes say. `rate-limit.ts` is pure and stateless;
nothing yet calls it, and wiring it into `client.ts` is the backfill ticket's job — the
note at the top of `client.ts` reserving that seam is still accurate.

## Operator validation

**Everything below was run by the agent (D-181).** This ticket has no screen: it is
fixtures, a pure floor and pure rate-limit primitives. All of it is reachable with the
`devault` profile and `curl`, so none of it was routed to the operator.

**Against the LIVE Strava API**, on the connected account (`status: ACTIVE`,
`activity:read_all`, athlete `51449053`), ~56 reads across the session:

| Probe | Result |
|---|---|
| `GET /athlete/activities?per_page=200` | 200 — **104 activities**, 2020-02-24 → 2026-09-03. The source of the "four cannot be captured" table. |
| Stream sweep over **53 activities** | Found a **real** 35 m signal-loss jump at index 1670 of `19034403088`. Also confirmed `data.length === original_size` on every single one — Strava is returning full resolution, which is the premise the floor rests on. |
| Five captures | 2,537 / 3,153 / 3,114 points, plus a 200-with-no-`latlng` and a genuine `/streams` 404. |
| `parseRateLimit` on a live 200 | `read 2/100, 56/1000`; `budgetCheck` → `proceed`. |
| `parseRateLimit` on a live **401** | **No headers at all** — §2.5's "every response" is wrong. |
| Which errors carry headers | authenticated 400 **yes**, authenticated 404 for another athlete's activity **yes**, authenticated 404 from `/streams` **NO**, unauthenticated 401 **NO**. |
| `afterResponse(404, …)` on the live 404 | `{action:"fail"}` — not retried, per criterion 9. |
| `afterResponse(429, …)`, frozen clock | 15-min bucket → `2026-09-06T10:15:00.000Z`; daily → `2026-09-07T00:00:00.000Z`. |

**That `/streams` 404 finding produced real code.** It is the ordinary answer for every
manual and GPS-less activity, so a caller assigning each response's status would forget a
97%-full bucket the moment it touched one — every piece individually correct, combining
into an unthrottled worker. Hence `mergeRateLimit`, and a test that asserts precisely that
pair of behaviours. **This is the finding the smoke test existed for**; no unit test written
from the design document would have produced it, which is `0165`'s lesson restated.

**Fixture fidelity, verified field by field** against the untransformed captures (kept
outside the repo, never committed):

- Detail field set identical except **`embed_token`, deliberately removed** — the only
  difference, in either direction.
- Stream keys identical; every stream's `data.length` and `original_size` unchanged;
  every non-`latlng` stream byte-identical.
- Path length preserved to **0.02–0.05%**; the 35 m signal-loss jump survives as 35.4 m.
- `id`, `start_date`, `start_date_local`, `timezone`, `utc_offset`, `distance`,
  `moving_time`, `elapsed_time`, `manual`, `trainer`, `average_speed`, `max_speed`,
  `total_elevation_gain`, `workout_type` — all unchanged.

**Local gate:** `npm run typecheck` clean · `npm run lint --max-warnings 0` clean ·
`npm test` **872 passed, 1 skipped, 43 files** · `node scripts/check-boundaries.mjs` clean ·
`node scripts/check-fixture-geography.mjs` — 10,611 coordinates across 18 files, all inside
the box · `node scripts/build-index.mjs --check` up to date.

**One thing genuinely NOT verified, and it should be said plainly:** no real 429 was ever
observed. The boundary arithmetic is asserted on a frozen clock against the documented
header shape, and the live probes confirm that shape on the responses that carry it — but
the 429 path itself has never run against Strava. Capturing one costs a day of a shared
quota, which is `0173`'s call to make.

