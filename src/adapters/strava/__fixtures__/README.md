# Strava normalize fixtures

**Archived-envelope fixtures**, exactly as `sealRawEnvelope` (ticket 0035) writes them to S3:
`{ schemaVersion, source, detail, streams }`. `normalize()` reads nothing else, so a test
that feeds it one of these files is running the migration seam on its real input with zero
mocking — which is what `contracts/ingestion-contract.md` §5 asks for.

## Every coordinate in here is in the middle of the South Pacific

`-48.876, -123.393` is **Point Nemo**, the oceanic pole of inaccessibility — the point on
Earth farthest from any land. Nobody has run there, and nobody ever will.

This repository is **public**. A captured `latlng` stream is ~2,700 points of where the
operator actually ran, starting outside their own front door, and `git rm` does not undo a
blob that has been cloned. So the fixtures are real Strava *response shapes* carrying
synthetic *geometry*: the detail objects mirror live responses field for field (including
the `distance` stream Strava returns without being asked), and the tracks are short lines
over open ocean. Ticket `0168` settles this as a standing rule.

Coordinates being in one tiny, uninhabited box is also what makes the guard in
`normalize.test.ts` an **allowlist** rather than a denylist: it asserts every fixture point
is within a few km of Point Nemo. A denylist would have to name where the operator really
runs — which is the leak, written into the repo to prevent the leak.
