---
id: 26
slug: adapter-types-and-registry
title: src/adapters/types.ts and registry.ts - SourceAdapter, IngestJob, IngestCommand, mandatory listSince
type: feature
priority: high
status: closed
size: m
capability: 04-domain-contract-and-rules
depends_on: [25]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
started: 2026-09-03T20:29:07Z
closed: 2026-09-03T20:36:49Z
---

## Description

The adapter side of the D-100 boundary. Transcribe `docs/contracts/ingestion-contract.md` §3 into
`src/adapters/types.ts`: `SourceAdapter<TCreds>`, `InboundRequest`, `AckResult`, `IngestJob`,
`IngestCommand`. Types only — no concrete adapter here.

The four-phase shape, and why each constraint is load-bearing:

- **`accept(req)` — PHASE 1**, runs in the public endpoint, **latency-critical** (Strava: 2s hard
  deadline). **MUST NOT** call the source API, refresh tokens, or touch S3. Validation and job
  construction only.
- **`fetchRaw(job, creds)` — PHASE 2**, runs in the worker, may use the network. Returns raw bytes
  **exactly as the source gave them**, no transformation. The pipeline archives these to S3
  **before `normalize()` is ever called** (D-121.2).
- **`normalize(raw, ref, job)` — PHASE 3, PURE.** No network, no AWS SDK, no clock, no randomness.
  **This is the migration seam**: unit-testable from a checked-in fixture with zero mocking, the
  only place a vendor's wire format is understood, and the function that survives to replay the
  S3 archive after the client code dies. Its purity is enforced by CI (0027) and depended on by
  the rebuild drill.
- **`listSince(userId, watermark, creds)` — MANDATORY, not optional** (D-140). Push adapters may
  return empty and rely on events, but **every** adapter implements it: it is the reconciliation
  sweep that covers **silently dropped webhooks**. Strava retries 3x then drops with no DLQ and no
  replay. It is also what the manual Sync path in capability `06` runs on.
- `refreshCredentials?(creds)` is the one optional member.

`IngestCommand` is **intents, never side effects**: `ingest` | `reingest` (edit, bumps revision) |
`retract` (deleted at source) | `disconnect`.

`src/adapters/registry.ts` is **the one file in the entire codebase that names concrete
adapters** — a map from `SourceId` to `SourceAdapter`. Everything else resolves an adapter through
it. This is what makes "swapping the primary source touches one directory plus one registry line"
true rather than aspirational.

## Acceptance criteria

- [x] `src/adapters/types.ts` exports `SourceAdapter`, `IngestJob`, `RawArchiveRef` re-export,
      `InboundRequest`, `AckResult` and `IngestCommand` matching contract §3 names exactly.
- [x] `listSince` is a **required** member of `SourceAdapter` — a type test asserts an object
      literal omitting it fails to compile.
- [x] `refreshCredentials` is the only optional member.
- [x] `normalize`'s signature is synchronous (returns `NormalizedIngest`, not a `Promise`), so
      purity is structurally encouraged rather than only documented.
- [x] `SourceAdapter` is generic in `TCreds` and `src/adapters/types.ts` contains no credential
      shape of its own.
- [x] `registry.ts` exports a lookup keyed by `SourceId` and a `getAdapter(id)` that throws a
      typed error on an unknown id rather than returning `undefined`.
- [x] `registry.ts` is the **only** file outside `src/adapters/<source>/` that imports a concrete
      adapter module — asserted by a test, not by convention.
- [x] `IngestCommand` has exactly the four variants and none of them performs an action.
- [x] `tsc --noEmit` passes with zero `any` in `src/adapters/types.ts` and `registry.ts`.
- [x] The registry compiles and its test passes with **zero** adapters registered — the boundary
      must exist before Strava does.

## Notes

Contract §1 conflict 8: 01's `accept`/`fetchRaw`/`normalize` split is the better core, and 03 was
right that `listSince` is mandatory. Both halves were kept. Do not restore either doc's original
shape.

The temptation this ticket exists to resist is putting Strava-shaped fields into `IngestJob`
"just for now". `IngestJob` carries `userId`, `source`, `externalId`, `command` and an opaque
`meta` — nothing vendor-specific. The 0027 grep will catch it if you slip.

## Resolution

**Files added**

- `src/adapters/types.ts` — the adapter interface. Types only, no runtime code, no concrete adapter.
- `src/adapters/registry.ts` — the lookup, `getAdapter()`, `UnknownAdapterError`. Ships empty.
- `src/adapters/adapter-interface.types.test.ts` — 13 compile-time assertions plus 3 runtime tests.
- `src/adapters/registry.test.ts` — 7 tests, including the import-boundary scan.

**Files amended**

- `docs/contracts/ingestion-contract.md` §3 — `InboundRequest`, `IngestJob`, `IngestCommandKind`
  and `AckResult` added to the canonical block, with an amendment banner.
- `docs/01-architecture.md` §3 — its `IngestJob`/`AckResult` marked SUPERSEDED **in place**, with
  the reasoning, rather than edited to look as though it had been right.
- `docs/decisions/DECISIONS.md` — **D-187**.
- `eslint.config.mjs` — `no-explicit-any: error` extended from `src/domain`/`src/pipeline` to
  `src/adapters/**`, which criterion 9 requires. Scoped to the whole directory, not the two files:
  an `any` in a concrete adapter is how a vendor's shape escapes untyped.

**The finding, and the four things the design did not settle.** Contract §3 specifies
`SourceAdapter` and `IngestCommand` in full but only *references* `InboundRequest`, `AckResult` and
`IngestJob` — it never gives their shapes. `01-architecture.md` §3 does, and one of them is wrong:
`AckResult { jobs: IngestJob[] }` **cannot express a deletion**, even though `IngestCommand`'s
`retract` and `disconnect` variants are defined eleven lines below it in the same file. Classifying
an inbound payload is precisely what phase 1 exists to do, and its return type could carry only two
of the four possible answers.

This was raised before any code was written, per D-152, along with three smaller gaps: no
`InboundRequest` shape anywhere; `IngestJob`'s field names conflicting between `01` and this
ticket's own Notes; and `IngestJob.command` being mutually recursive with `IngestCommand` as
specified (the job-carrying variants hold a job, so a job holding a full command nests for ever).
The operator approved all four resolutions. They are recorded as **D-187** — the substantive one
being `commands: IngestCommand[]`, which subsumes the old field since `ingest`/`reingest` each wrap
a job.

**Why the gap was invisible until now.** D-140 reconciled `Activity`/`Trace`/`SourceAdapter` by
comparing two documents where they *overlapped*. These three types are defined in only one document,
so there was nothing to conflict and nothing to reconcile. A type only one doc defines is not
thereby agreed — it is unreviewed. That is the generalisable lesson and it is written into D-187.

**Decisions taken while building, worth knowing:**

- **`IngestJob` keeps `ingestKey` and `enqueuedAt` from `01`** even though this ticket's Notes list
  only five fields. Both are source-agnostic, and `02-data-model.md` §8's rebuild drill reconstructs
  an `IngestJob` from an S3 key — dropping them would have broken a documented recovery path. The
  Notes were resisting *vendor-specific* fields, which these are not.
- **`rawBody` is `Buffer`, not a parsed object.** A webhook signature is computed over the exact
  bytes sent; parsing before verifying destroys the ability to verify at all. Cheap to get right
  now, impossible to retrofit once an adapter has been written against a parsed body.
- **`getAdapter` throws rather than returning `undefined`.** Every caller is on a path where an
  unknown source is unrecoverable, and an `undefined` surfaces later as a property access on
  nothing, far from the id that caused it. `UnknownAdapterError` carries `.source` as a field so a
  handler can map it to a 400 without matching on a message string.
- **The boundary test discovers adapter directories rather than naming one.** It must still mean
  something the day a real adapter exists, and it must not itself name a vendor — `registry.ts` is
  exempt from `check-boundaries.mjs` but `registry.test.ts` is not.

**What went wrong.**

1. Two files were written importing `@/domain/activity`. The `@/*` alias maps to the **repo root**,
   not to `src/`, so the correct specifier is `@/src/domain/activity`. `tsc` caught it immediately.
   Worth noting because `check-boundaries.mjs`'s own comments contain the same mistake in an
   illustrative example (`from "@/adapters/strava/types"`), so the wrong form is written down in
   the repo and will be copied again.
2. The type-test file's header comment contained the glob `**/` + `*.types.test.ts`, whose `*/`
   **closed the block comment early** and produced 30 cascading parse errors that looked nothing
   like their cause. Reworded rather than escaped.
3. The first draft of the boundary scan would have passed vacuously over an empty tree in a way
   indistinguishable from a broken `ROOT`. Two guards were added: a floor on the number of files
   scanned, and a self-test proving the detector fires on a synthetic violation — the same
   discipline `check-boundaries.mjs --self-test` already uses.

**Deliberately not done** (would have been scope creep, D-152): `01-architecture.md`'s
`listHistorical?` and `adapter: AdapterId` are also superseded, by D-140's existing banner. They
were left alone. Only the two shapes *this* ticket changes are marked.

## Operator validation

**None required of the operator, and none invented.** This ticket has no screen, no endpoint and no
deployed resource — it is two type modules and an empty lookup table. There is nothing an eye or a
hand can answer that a compiler cannot answer better.

What the agent ran instead, on this machine (Node 22, WSL2), all from a clean tree:

| Check | Command | Result |
|---|---|---|
| Typecheck, zero `any` | `npm run typecheck` | exit 0 |
| Lint at `--max-warnings 0` | `npm run lint` | exit 0 |
| Full suite | `npm test` | 19 files, 298 passed, 1 skipped |
| This ticket's tests alone | `npx vitest run src/adapters` | 2 files, 10 passed |
| D-100 boundary grep | `node scripts/check-boundaries.mjs` | exit 0 |
| ...and its self-test | `node scripts/check-boundaries.mjs --self-test` | 29 cases passed |

**The one check worth naming separately**, because it is the criterion most easily faked: the
`@ts-expect-error` asserting that an adapter without `listSince` cannot compile was verified to fire
for the *right reason*. Adding `listSince` back to that object literal turns it into
`TS2578: Unused '@ts-expect-error' directive` at exactly that line and nothing else — so the
directive is suppressing the missing-member error specifically, not masking an unrelated one. A
`@ts-expect-error` that passes because of some *other* error is the standard way this class of
assertion rots, and it would have looked identical from the outside.

The property this ticket actually buys — that swapping the primary source touches one directory and
one registry line — is not observable today with zero adapters registered. `0027` greps for it and
the day a real adapter is swapped is when it is proven. What is verifiable now is that the seam
exists and is enforced, which is the whole reason it was built before the first adapter.
