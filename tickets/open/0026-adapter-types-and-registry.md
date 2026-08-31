---
id: 26
slug: adapter-types-and-registry
title: src/adapters/types.ts and registry.ts - SourceAdapter, IngestJob, IngestCommand, mandatory listSince
type: feature
priority: high
status: open
size: m
capability: 04-domain-contract-and-rules
depends_on: [25]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
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

- [ ] `src/adapters/types.ts` exports `SourceAdapter`, `IngestJob`, `RawArchiveRef` re-export,
      `InboundRequest`, `AckResult` and `IngestCommand` matching contract §3 names exactly.
- [ ] `listSince` is a **required** member of `SourceAdapter` — a type test asserts an object
      literal omitting it fails to compile.
- [ ] `refreshCredentials` is the only optional member.
- [ ] `normalize`'s signature is synchronous (returns `NormalizedIngest`, not a `Promise`), so
      purity is structurally encouraged rather than only documented.
- [ ] `SourceAdapter` is generic in `TCreds` and `src/adapters/types.ts` contains no credential
      shape of its own.
- [ ] `registry.ts` exports a lookup keyed by `SourceId` and a `getAdapter(id)` that throws a
      typed error on an unknown id rather than returning `undefined`.
- [ ] `registry.ts` is the **only** file outside `src/adapters/<source>/` that imports a concrete
      adapter module — asserted by a test, not by convention.
- [ ] `IngestCommand` has exactly the four variants and none of them performs an action.
- [ ] `tsc --noEmit` passes with zero `any` in `src/adapters/types.ts` and `registry.ts`.
- [ ] The registry compiles and its test passes with **zero** adapters registered — the boundary
      must exist before Strava does.

## Notes

Contract §1 conflict 8: 01's `accept`/`fetchRaw`/`normalize` split is the better core, and 03 was
right that `listSince` is mandatory. Both halves were kept. Do not restore either doc's original
shape.

The temptation this ticket exists to resist is putting Strava-shaped fields into `IngestJob`
"just for now". `IngestJob` carries `userId`, `source`, `externalId`, `command` and an opaque
`meta` — nothing vendor-specific. The 0027 grep will catch it if you slip.

## Operator validation

None — types and a lookup table, no runtime surface and nothing rendered. The property this
ticket buys is validated for real at 0027 (the boundary greps) and, ultimately, on the day the
Strava adapter is swapped out, which is the scenario D-121 exists to make survivable.
