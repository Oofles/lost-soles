---
id: 39
slug: archive-raw-before-normalize
title: pipeline/archive.ts — write the raw source payload to S3 before normalize runs
type: feature
priority: high
status: open
size: m
capability: 06-ingest-pipeline
depends_on: [12, 35]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
---

## Description

D-121.2 and `01-architecture.md` §3 "archive raw before normalize": every raw payload a source
returns is written to S3 **before** a single field of it is parsed. This is not a logging
convenience — D-101 makes `raw/` the system of record, and I-3 makes those objects immutable and
undeletable. If the archive PUT fails, we do not normalize; the job returns to the queue.

Key shape, self-describing so a backfill five years from now needs no database to interpret it:

```
raw/<uid>/<source>/<externalId>/<sha256>.<ext>
```

The `sha256` of the verbatim bytes makes the object content-addressed, so the write is naturally
idempotent — re-archiving the same payload overwrites itself with identical bytes. Object
metadata carries `adapter`, `externalId`, `userId`, `schemaHint` and the app version.

Verbatim bytes only: no pretty-printing, no field stripping, no re-encoding. Anything that
touches the bytes before they land breaks the re-normalization escape hatch (a fixed gap-detection
bug, or a future H3 resolution change re-derived from the archive per `05-fog-of-war.md` §2.1).

The bucket policy denying `s3:DeleteObject` on `raw/*` and the versioning flag are part of this
ticket, not a later hardening pass — I-3 is structural, not a convention.

## Acceptance criteria

- [ ] `archiveRaw(bytes, ref)` PUTs to `raw/<uid>/<source>/<externalId>/<sha256>.<ext>` and returns
      a `RawArchiveRef` (shape from `src/adapters/types.ts`, ticket 0026).
- [ ] The pipeline calls `archiveRaw` and awaits success **before** `normalize()` is invoked; a
      test with the S3 client stubbed to reject asserts `normalize` was never called.
- [ ] Archived bytes are byte-identical to what the adapter's fetch returned (golden-file test).
- [ ] Object metadata includes `adapter`, `externalId`, `userId`, `schemaHint`, app version.
- [ ] Archiving the same payload twice produces one object, same key, same ETag.
- [ ] Bucket versioning is on and the bucket policy denies `DeleteObject`/overwrite on `raw/*` for
      every principal except the named break-glass/deletion role (I-3).
- [ ] Content type and extension are derived from the adapter's declared `schemaHint`, not sniffed.

## Notes

Volume is trivial — ~15 KB gzipped per run, ~40 MB over five years, ~$0.001/month
(`01-architecture.md` §3). There is no reason to be selective about what gets archived.

Ordering is the whole ticket. Concurrency here (`Promise.all([archive, normalize])`) would pass
every test and silently destroy the D-101 guarantee the first time an archive PUT failed.

## Operator validation

1. Sync one real Strava run (or invoke the pipeline directly against a fixture id).
2. In the S3 console, open `raw/<your-uid>/strava/<activity-id>/` — there is exactly one object,
   named for its sha256, and its metadata tab shows the adapter/externalId/userId/appVersion keys.
3. Download it and diff it against the response `curl`ing the Strava API directly gives you.
   It must be byte-identical, not merely equivalent JSON.
4. Attempt to delete the object from the console with your normal role. It must be denied.
