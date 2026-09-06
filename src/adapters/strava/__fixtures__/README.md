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
