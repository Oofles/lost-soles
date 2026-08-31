---
id: 38
slug: strava-fixtures-and-rate-limit-backoff
title: Checked-in real-response fixtures, the fidelity floor, and rate-limit backoff
type: chore
priority: high
status: open
size: m
capability: 05-strava-adapter
depends_on: [34, 35, 36]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
---

## Description

Two things the adapter is not trustworthy without: real recorded responses to test against, and
correct behaviour when Strava says no.

**Fixtures — `src/adapters/strava/__fixtures__/`.** Capture **real** responses (redacted of
tokens, not of shape) and commit them, because contract §3 makes `normalize()` unit-testable from
a checked-in fixture **with zero mocking**, and because after 2026 these responses may not be
re-acquirable. Required set:

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

- [ ] All ten fixtures are committed under `src/adapters/strava/__fixtures__/` with a README
      naming what each one proves; every one is a real captured response, not hand-written.
- [ ] No fixture contains a live token, client secret, or refresh token.
- [ ] `normalize` is tested against every fixture **with zero mocking** — no HTTP stub is needed
      because no HTTP is involved.
- [ ] The fidelity floor runs on every normalized trace with a named, commented constant, and a
      test feeds it an RDP-decimated version of fixture 1 and asserts the build **fails**.
- [ ] The floor's failure is an error that stops ingestion for that activity, not a logged warning.
- [ ] Rate-limit headers are parsed from **every** response, including error responses, and the
      remaining read budget is tracked from the headers rather than counted locally.
- [ ] A 429 causes a sleep until the next natural 15-minute boundary (or midnight UTC for the
      daily bucket), **not** an immediate retry and **not** a blind exponential backoff; a test
      with a frozen clock asserts the computed wake time for each of the four boundaries.
- [ ] Transient 5xx and network errors retry 1s/2s/4s/8s with **full jitter**, max 5 attempts,
      then fail the job cleanly for the DLQ.
- [ ] A 4xx that is not 429 is **not** retried.
- [ ] The read budget check happens **before** a stream call is issued, so a backfill degrades to
      "resume tomorrow" rather than burning attempts against a closed window.
- [ ] The capability doc records the steady-state budget (~6-10 reads/day against 1,000) and the
      backfill budget (~1,600 stream calls, ~2.3 days at 70% of quota), so a future change that
      multiplies call volume is visibly a budget decision.
- [ ] Everything is under `src/adapters/strava/`; the 0027 T1 grep stays green.

## Notes

Fixture 6 (the >2^53 id) is the cheapest insurance in the capability. `upload_id` and
`activity.id` are int64s that `JSON.parse` **silently corrupts** — no error, just a wrong number —
and a wrong `externalId` breaks the deterministic `activityId`, which breaks idempotency, which
double-awards XP on replay. One fixture locks all of that down.

The archive earns its keep here: 1,600 stream calls are expensive and slow to re-acquire, and the
athlete cap (D-102/D-121) may remove access entirely. **Archive first, normalize second.**

Backfill state is `{ cursor, lastActivityId, completed, failedIds[] }` in DynamoDB and must survive
being killed at any point. The backfill job itself is not this ticket, but the backoff and budget
primitives it will use are.

## Operator validation

**Desktop, CloudWatch logs during a deliberate throttle.** Temporarily drop the local read budget
to a handful of calls and run a Sync over several activities. Confirm the log shows the worker
sleeping to a natural boundary (a `:00`/`:15`/`:30`/`:45` wake time) rather than hammering, and
that after the window opens the remaining activities import with no duplicates and no gaps. Then,
on the phone's map, confirm the runs that imported before and after the pause both appear — a
throttle must never leave a half-imported run that silently reveals half a route.
