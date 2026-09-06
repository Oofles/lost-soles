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

Four fixtures the account **cannot** produce — a `TrailRun`, an id above 2^53, a novel
`sport_type`, and a 429 — are ticket `0173`.

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
