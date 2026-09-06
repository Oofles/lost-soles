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
started: 2026-09-06T16:28:44Z
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

- [x] `archiveRaw(bytes, ref)` PUTs to `raw/<uid>/<source>/<externalId>/<sha256>.<ext>` and returns
      a `RawArchiveRef` (shape from `src/adapters/types.ts`, ticket 0026).
- [x] The pipeline calls `archiveRaw` and awaits success **before** `normalize()` is invoked; a
      test with the S3 client stubbed to reject asserts `normalize` was never called.
- [x] Archived bytes are byte-identical to what the adapter's fetch returned (golden-file test).
- [x] Object metadata includes `adapter`, `externalId`, `userId`, `schemaHint`, app version.
- [x] Archiving the same payload twice produces one object, same key, same ETag.
- [x] Bucket versioning is on and the bucket policy denies `DeleteObject`/overwrite on `raw/*` for
      every principal except the named break-glass/deletion role (I-3).
      **Amended — "overwrite" is met by non-destructiveness, not refusal (D-205).** No IAM
      condition distinguishes a PUT onto an existing key from the first PUT of a new one, so a
      policy able to refuse an overwrite would refuse every write including the archive's own.
      Built instead as: versioning on, **both** `s3:DeleteObject` and `s3:DeleteObjectVersion`
      denied (the second is the one that destroys bytes on a versioned bucket, and omitting it
      would have made versioning decorative), plus `IfNoneMatch: "*"` at the writer so the common
      case never writes a second version. The break-glass role did not exist and was created.
- [x] Content type and extension are derived from the adapter's declared `schemaHint`, not sniffed.
      **Amended — they are DECLARED ALONGSIDE `schemaHint`, not derived from it (D-204).**
      Deriving a MIME type from a hint string would need a vendor-shaped lookup table inside
      `src/pipeline`, which is exactly what D-100 forbids there. `fetchRaw` now returns all three
      — `contentType`, `ext`, `schemaHint` — and the archive copies each through untouched. The
      criterion's intent, *nothing about the bytes is inferred by looking at them*, is met in full
      and is asserted by a test that declares `application/vnd.ant.fit` over JSON bytes.

## Notes

Volume is trivial — ~15 KB gzipped per run, ~40 MB over five years, ~$0.001/month
(`01-architecture.md` §3). There is no reason to be selective about what gets archived.

Ordering is the whole ticket. Concurrency here (`Promise.all([archive, normalize])`) would pass
every test and silently destroy the D-101 guarantee the first time an archive PUT failed.

## Operator validation

> **D-181 — most of what follows is the AGENT's to run, not the operator's.**
> Swept 2026-09-02 (ticket `0147`). This ticket's capability has no screen of its own. Before asking
> the operator for any step below, check whether AWS credentials (`AWS_PROFILE=devault`), `curl`, or
> a script can answer it — if so it is a **smoke test**, and what it proved is recorded here at
> close *instead of* the instruction. Keep only what genuinely needs a human eye, a phone, or a real
> run. The text below is the original author's intent, kept as context for **what** to verify — not
> as a list of chores for the operator.

1. Sync one real Strava run (or invoke the pipeline directly against a fixture id).
2. In the S3 console, open `raw/<your-uid>/strava/<activity-id>/` — there is exactly one object,
   named for its sha256, and its metadata tab shows the adapter/externalId/userId/appVersion keys.
3. Download it and diff it against the response `curl`ing the Strava API directly gives you.
   It must be byte-identical, not merely equivalent JSON.
4. Attempt to delete the object from the console with your normal role. It must be denied.

## Resolution

**Files touched**

| File | What |
|---|---|
| `src/pipeline/archive.ts` | New. `archiveRaw` + `rawArchiveKey` + `RawArchiveError`. |
| `src/pipeline/fetch-archive-normalize.ts` | New. The ordering, as one named seam. |
| `src/pipeline/archive.test.ts`, `fetch-archive-normalize.test.ts` | New, 14 tests. Source-agnostic. |
| `src/pipeline/__fixtures__/` | New. A deliberately ugly neutral payload + README. |
| `src/adapters/strava/archive-fidelity.test.ts` | New, 5 tests. The real adapter's bytes end to end. |
| `src/adapters/types.ts`, `docs/contracts/ingestion-contract.md` | `schemaHint` on `fetchRaw` (D-204). |
| `src/adapters/strava/{adapter,raw-envelope}.ts` | Declares `RAW_ENVELOPE_SCHEMA_HINT`, derived from `SCHEMA_VERSION`. |
| `amplify/storage/resource.ts` | `versioned: true`, `keepOnDelete: true`. |
| `amplify/backend.ts` | The `RawArchive` stack: break-glass role + two Deny statements. |
| `amplify/raw-archive-immutability.test.ts` | New, 8 tests. Synthesizes the backend and asserts I-3 in CI. |
| `lib/app-meta.ts` | `APP_VERSION`, with a test asserting it matches `package.json`. |
| `docs/01` §3, `docs/02` I-3, `docs/08` §6.2 | Amended for D-205. |

**Decisions.** D-204 (`schemaHint` on `fetchRaw`; descriptors declared, never sniffed) and D-205
(I-3's overwrite half). Both were forced by the build, and both are recorded in full in
`DECISIONS.md` rather than summarised here.

**What the ticket did not know, and what it cost.**

Three things were true of the deployed system that no document recorded, and finding them is most
of why this ticket was larger than its title:

1. **Bucket versioning was OFF.** `08` §6.2 has said "Versioning: ON" since it was written. It
   was not on. Every design argument that leans on versioning — the ransomware control, the
   fat-finger control, and D-205's whole resolution of the overwrite problem — was resting on a
   setting nobody had checked.
2. **The archive was actively deletable, and by a robot.** `defineStorage` defaulted to
   `RemovalPolicy.DESTROY` with `autoDeleteObjects: true`, which meant a live IAM role
   (`…CustomS3AutoDeleteObjects…`) holding `s3:DeleteObject*` on the whole bucket and an `ampx`
   teardown that would have emptied `raw/` as a normal, successful operation. I-3 says these
   objects are undeletable. `keepOnDelete: true` retires the role and the removal policy together.
3. **The break-glass role did not exist.** `01` §3 and `08` §6.2 both except "an explicit
   break-glass role" from the deletion deny. There was no such role, so the sentence had nothing
   to except and was unenforceable as written — a control that reads as present and is absent.

**The Deny collides with the auto-delete role, necessarily.** An explicit Deny on `raw/*` covering
every principal would have made a stack teardown fail halfway, part-deleted. Options were put to
the operator; the chosen one was to deny it *and* retire auto-delete, accepting that a torn-down
stack now leaves the bucket behind. That is the same trade `LostSolesSourceAccount` records and it
is the correct direction: the archive is the one artifact no rebuild can reproduce.

**A second Deny that was not asked for and is not scope creep.** `DenyBucketPolicyTampering…`
stops `s3:DeleteBucketPolicy` outside CloudFormation. Without it the immutability control could be
switched off by the same administrator credentials it constrains — which is a comment, not a
control. CloudFormation is excepted via `aws:CalledVia` so `ampx` can still update the policy.

**Where the ordering lives, and why it is a module.** 0042 owns the worker handler; this ticket
owns only `fetch → archive → normalize`. It is a named function with its own test rather than
three lines in a handler because the dangerous edit — `Promise.all([archive, normalize])` — is
*faster*, *looks better*, and would pass every test while destroying D-101 the first time a PUT
failed. The test asserts a call ORDER, so it fails identically whether normalize ran before the
archive or concurrently with it.

**What went wrong on the way.**

- **`check-boundaries.mjs` rejected the first draft of the pipeline tests**, correctly. Tier 1
  fires on `/strava|athlete|polyline/i` anywhere under `src/pipeline` — comments and fixtures
  included — and the tests had reached for the adapter's fixtures. The fix was not an exemption:
  the pipeline tests now run on a neutral fixture, and the "byte-identical to what the adapter
  returned" criterion moved to `src/adapters/strava/archive-fidelity.test.ts`, where naming a
  vendor is legal. The module comment in `archive.ts` also had to lose the words "Strava" and
  "athlete". That is the check working as designed.
- **The int64 assertion was green for the wrong reason at first.** The id originally chosen,
  `18736594040123456`, happens to be exactly representable as a double, so `JSON.parse` round-trips
  it unchanged and a test built on it would have passed against a re-encoding archive. Changed to
  the odd `…457`, which genuinely rounds to `…456`. Verified by mutation before being trusted.
- **`archivedAt` is second-accurate on the replay path**, not millisecond-accurate: a first write
  stamps the caller's clock, a 412 replay reads S3's `LastModified`, and S3 stores that to the
  second. Found by the smoke test asserting equality and getting `false`. Accepted rather than
  fixed with a HEAD on every PUT — it is provenance, nothing keys on it, and `sha256` is the
  identifier. Recorded in `archive.ts` so the next reader is not puzzled by it.
- **The CDK assertions were mutation-tested before being believed.** Removing `versioned`,
  `keepOnDelete` and the `DeleteObjectVersion` action failed 4 of the 8 structural tests; a green
  suite over a control nobody had broken proves nothing.

## Operator validation

**No operator step. Everything here is infrastructure and code, and all of it was verified by the
agent with `AWS_PROFILE=devault` against the deployed `main` bucket** (D-181). There is no screen,
no phone, and nothing a human eye can see that a call cannot.

**Automated, in CI** — 27 new tests, suite at 919 passing:
`archive.test.ts` (10), `fetch-archive-normalize.test.ts` (4), `archive-fidelity.test.ts` (5),
`raw-archive-immutability.test.ts` (8, synthesizes the real backend). Plus `tsc --noEmit`,
`eslint --max-warnings 0`, `next build`, and all five `scripts/check-*.mjs` clean.

**Live smoke test**, 2026-09-06 16:49 UTC, against
`amplify-d14fhvl4rp79nn-ma-lostsolesuserdatabucket5-mpiyvettxgde` after Amplify job 108 deployed
the stack. Ran the real `archiveRaw` as `cli-user`, which holds `AdministratorAccess` — so the
bucket policy is the only thing standing between it and the archive:

| # | Checked | Result |
|---|---|---|
| 1 | `get-bucket-versioning` | `Status: Enabled` (was **absent** before this ticket) |
| 2 | Bucket policy statements | `DenyRawArchiveDeletionExceptBreakGlass` present, `Action: [s3:DeleteObject, s3:DeleteObjectVersion]`, `Resource: …/raw/*`, `StringNotLike aws:PrincipalArn = …role/LostSolesArchiveDeletion`. `DenyBucketPolicyTamperingOutsideCloudFormation` present. |
| 3 | The auto-delete `Allow` | **Gone.** The `…CustomS3AutoDeleteObjects…` statement granting `s3:DeleteObject*` bucket-wide is no longer in the policy. |
| 4 | `iam get-role LostSolesArchiveDeletion` | Exists. Trusted by `…:root`, `MaxSessionDuration` 3600. |
| 5 | Real PUT | `raw/smoke-0039-…/gpslogger/smoke-1/0f153c91…b85c9.json`, 88 bytes |
| 6 | `head-object` metadata | `{adapter: gpslogger, externalid: smoke-1, userid: …, schemahint: gpslogger/raw@1, appversion: 0.1.0}`, `ContentType: application/json`, `ContentLength` 88 = body length |
| 7 | Archive the identical payload twice | same key ✓, **same ETag** ✓, and `list-object-versions` shows **1 version**, not 2 — the conditional PUT refused the second write |
| 8 | `delete-object` as **administrator** | `AccessDenied`. **I-3 holds against the account's most privileged principal.** |
| 9 | `delete-object-version` after `sts assume-role LostSolesArchiveDeletion` | Deleted 1, 0 errors, 0 objects remaining under the smoke prefix. **The break-glass path works** — the deny has exactly the one exception it claims. |

Step 9 doubles as cleanup: the smoke object was written under `raw/smoke-0039-<epoch>/` and then
removed via break glass, so nothing synthetic remains in the archive. That the removal *required*
break glass is itself the proof of step 8.
