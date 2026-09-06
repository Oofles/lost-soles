# Strava normalize fixtures

**Archived-envelope fixtures**, exactly as `sealRawEnvelope` (ticket 0035) writes them to S3:
`{ schemaVersion, source, detail, streams }`. `normalize()` reads nothing else, so a test
that feeds it one of these files is running the migration seam on its real input with zero
mocking — which is what `contracts/ingestion-contract.md` §5 asks for.

## Real response, synthetic geometry (D-199)

This repository is **public**. A captured `latlng` stream is ~2,700 points of where the
operator actually ran, starting outside their own front door, and `git rm` does not undo a
blob that has been cloned. `08-security-privacy.md` §7.2 has always said it: *test fixtures
are synthetic coordinates.*

So a fixture here is a **real captured response with its coordinates replaced**. Everything
the code can observe is real and unmodified — the field set, the stream keys, the point
count, the 1 Hz cadence, index alignment across streams, `original_size`, the gap and
signal-loss structure, the int64 ids, including the `distance` stream Strava returns without
being asked. Only the geometry is generated, along a synthetic path near **Point Nemo**
(`-48.876, -123.393`), the oceanic pole of inaccessibility — ~2,688 km from land in every
direction. Nobody has run there and nobody is going to.

Rigid relocate-and-rotate of a real track was considered and rejected: it preserves the
route *shape*, and a route shape is matchable against OpenStreetMap. See D-199.

## The guard, and why it is an allowlist

`scripts/check-fixture-geography.mjs` asserts every coordinate in every `__fixtures__`
directory in the repo is within ~5.5 km of Point Nemo. It runs on the **pre-commit hook**
(the last point upstream of an irreversible act), the Actions gate, the Amplify build, and
`npm test` via `normalize.test.ts`.

It is an **allowlist** on purpose. The obvious guard — "no coordinate near where the operator
runs" — cannot be written without committing where the operator runs, which is the leak,
written into the repo to prevent the leak. Inverting it also means it fails **closed** on
geometry it has never seen, including an adapter that does not exist yet.

It covers `latlng` streams, `start_latlng`/`end_latlng`, and encoded `polyline` /
`summary_polyline` strings. An encoded polyline is not less of a location for being
unreadable to a human — and a `summary_polyline` that is neither empty nor decodable is
rejected too, because *"I could not read it"* must never resolve to *"clean"*.

Note that none of layers 1–3 in `08` §7.3 can see this class at all: gitleaks and the
credential patterns hunt for secret *shapes*, and a GPS track is just numbers.

## Two kinds of fixture, and the prefix tells you which

**`real-*.json` are captured**, by `scripts/make-strava-fixture.mjs`, from the connected
account. Everything the code can observe is exactly what Strava returned. Ticket `0038`.

| Fixture | Activity | What it proves |
|---|---|---|
| `real-run-outdoor` | `11032320114` | The ordinary case at full resolution — **2,537 points**, `original_size` 2537, six index-aligned streams. The fidelity-floor tests decimate this one. |
| `real-run-signal-loss` | `19034403088` | A **real 35 m GPS jump at index 1670**, found by sweeping 53 activities. Not a constructed outlier — a watch losing its fix mid-run. |
| `real-run-dst-boundary` | `16337819831` | 2025-11-02, the US fall-back day. `start_date_local` vs `start_date` with `utc_offset` -18000. |
| `real-indoor-no-latlng` | `14328627563` | Streams **200 with `time` and `altitude` and no `latlng` key at all** — the shape that crashes `streams.latlng.data[0]`. |
| `real-manual-streams-404` | `19162776719` | A `manual: true` activity with an empty `summary_polyline`, whose `/streams` answers **404**. Archived as `streams: null`. |

**Everything else is constructed**, by hand, for one targeted assertion — three to six
points, readable in full, and named for the behaviour it pins down. They are not weaker
fixtures, they are a different tool: `run-paused` exists to put a gap at a known index, and
a real capture would bury that in three thousand points.

### The naming convention

**`real-` means captured. No prefix means constructed.** That is the whole rule, and it is
the one thing to check before trusting a fixture as evidence of what Strava actually sends.
A constructed fixture proves the code handles a shape; only a captured one proves the shape
is real. `0165` is why the distinction is worth a prefix: 76 green tests were built from a
design document's worked example, so the suite proved the code matched the *document* while
the live service refused every grant.

`http/` holds HTTP responses rather than archive envelopes — see below.

### The four that CANNOT be captured, and why (ticket `0173`)

JSON has no comments, so the rationale lives here rather than in a header inside each file.
Adding a `_comment` key was the alternative and is worse: an archive-envelope fixture's one
valuable property is being byte-shaped like what `sealRawEnvelope` writes, and a key Strava
never sends would quietly cost exactly that.

| Fixture | Why no real capture is possible | What it locks down |
|---|---|---|
| `trailrun-legacy-type-mismatch` | The account has **zero** `type`/`sport_type` divergence in 104 activities across six years — every one is `Run/Run`, `Ride/Ride`, `Walk/Walk` or `Workout/Workout`. | That the legacy `type` and the modern `sport_type` are read as two different fields, and that `sport_type` wins. |
| `unknown-sport-type` | By definition the interesting value is one Strava has not shipped. The name is deliberately absurd — a plausible-but-unshipped value would quietly become correct the day Strava shipped it, and stop testing the unknown branch. | The fallback for a `sport_type` this code has never seen. |
| `oversized-activity-id` | The largest real id on the account is `20014448765` — 2.0 × 10¹⁰ against 2^53 ≈ 9.0 × 10¹⁵. Strava is **five orders of magnitude** from minting one. | The whole silent chain: `JSON.parse` rounds the id → `externalId` is wrong → `computeActivityId` is wrong → a re-ingest is a SECOND activity → XP awarded twice, on a ledger that only ever adds (D-135). The id is 2^53 **+ 1**, the smallest integer a double cannot hold, because it is the boundary that ships. |
| `http/429-rate-limited`, `http/429-daily-exhausted` | Forcing a real 429 costs ~1,000 reads of a quota that is **per-application** and shared across every athlete on the `client_id` (§2.5) — a day of budget, on the only connected account. | That `afterResponse` reads *which* bucket is exhausted off the headers and sleeps to the matching natural boundary, rather than retrying immediately or backing off blindly against a fixed window. |

The 429 pair is constructed but not invented: the header **names** and the **limit** values
are exactly those observed on live 200s from `client_id 276053` on 2026-09-06
(`x-readratelimit-limit: 100,1000`). Only the usage counters are moved to their ceilings,
and the two files differ in exactly one field — a test asserts that, so the pair keeps
isolating the one variable it was built to isolate.

They live under `http/` because they are HTTP responses, not archive envelopes. That also
keeps `normalize.test.ts`'s every-fixture sweep — which reads only the top level of this
directory — from trying to normalize them.

All of them are exercised in `synthetic-fixtures.test.ts`, against real behaviour rather
than merely loaded. **Being constructed is not the same as being decorative**, and if the
account ever does produce a real divergence, a novel type or an oversized id, those tests
are the ones that should be replaced by a capture.

## Capturing a new one

```
node scripts/make-strava-fixture.mjs <activityId> --name <fixture-name> \
     [--keep-raw <dir outside the repo>] [--dry-run]
```

The D-199 transform is **not a flag and cannot be turned off**; a capture tool with an
`--allow-real-coordinates` escape hatch is one that gets run with it at 11pm. The script
re-reads what it wrote through the same check the pre-commit hook runs and **deletes the
file** if the two disagree, so the generator never gets to vouch for itself.

What it rewrites, all of it found by running the tool rather than by reading the API docs:
`streams.latlng`, `start_latlng`/`end_latlng`, `map.polyline`/`summary_polyline`, and — the
one that was missed first time — **`segment_efforts[].segment`**, which carries a nearby
segment's exact coordinates *and* its town (`"Ponte Vedra Beach, Florida"`) *and* its name.
It also **deletes `embed_token`**, which is a live token.

Scalar coordinates are mapped through the track rather than dropped at the origin: a
segment that began a third of the way into the real run begins a third of the way into the
synthetic one, so the fixture stays internally consistent.
