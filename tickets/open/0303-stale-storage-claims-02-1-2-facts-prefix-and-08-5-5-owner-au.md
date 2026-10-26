---
id: 303
slug: stale-storage-claims-02-1-2-facts-prefix-and-08-5-5-owner-au
title: Stale storage claims: 02 §1.2 facts/ prefix and 08 §5.5 owner-auth model list
type: chore
priority: low
status: open
size: s
capability: 18-mvp-hardening
depends_on: []
blocked_by: []
source: agent
created: 2026-10-22T00:44:19Z
started: 2026-10-26T20:04:43Z
---

## Description

Found by the `16-rebuild-drill` audit (2026-10-21), outside the sections that capability cited, so
filed rather than fixed in the audit commit. Two passages describe storage that was never built:

- `02-data-model.md` §1.2, the S3 layout, lists `facts/<uid>/highwater.jsonl` and
  `facts/<uid>/identity.json`. Nothing in `src/`, `tools/` or `amplify/` writes a `facts/` key. The
  D-135 waterline is `snapshots/skillstate/<uid>/` (§8.2, D-259) and the floors are `isFloor` ledger
  rows (§4.6). The audit already corrected the same block's `traces/` and `cells/` lines (D-423).
- `08-security-privacy.md` §5.5 says Amplify Data owner authorization covers `Activity`, `Trace`,
  `ExploredCell` and `SourceAccount`. There is no `Trace` model (the route trace is an S3 object),
  and `ExploredCell` and `SourceAccount` are CDK tables, not `defineData` models. §2.4 A-1 depends on
  this sentence being true.

## Acceptance criteria

- [x] `02` §1.2 lists only prefixes something writes, each naming its writer, or says which are
      planned and by which decision.
- [x] `08` §5.5 names the real owner-scoping mechanism per store: `defineData` owner auth for the
      model tables, IAM/handler scoping for the CDK tables, `entity('identity')` for S3.
      *Amended at build: the criterion's "`entity('identity')` for S3" is itself stale. D-228
      found that rule covers no object (identity-pool id ≠ user-pool `sub`); S3 is owner-scoped by
      the `/api/fog` and `/api/runs/*` routes reading as the SSR compute role with the key built
      from the session `sub`. §5.5 says both.*
- [x] A `D-xxx` records each correction. *(Proposed as D-NEW-a and D-NEW-b; the orchestrator
      allocates the numbers.)*

## Notes

Doc-only. Grep every doc for `facts/` and for the `Trace` model before closing (capability 15's
REFLECT habit).

## Operator validation

None perceptual: doc-only. Smoke test: `grep -rn 'facts/' docs src tools amplify` returns only deliberate history.

## Resolution

Doc-only. Two design passages described storage that was never built; both now describe what the
code writes and how it is scoped, checked against `amplify/backend.ts`, `amplify/data/resource.ts`,
`amplify/storage/resource.ts` and every S3 key builder in `src/`, `lib/` and `tools/`.

**Files touched**

- `docs/02-data-model.md`
  - §1.1: the Rules row no longer claims an S3 `rules/` mirror (rules ship bundled, D-274).
  - §1.2: the S3 layout lists every prefix something writes, each with its writer. Added the
    ones the block never had: the three `raw/` sibling records (`.duplicate-of.json` D-263,
    `.retracted.json` D-421, `.kind-override/` D-284), `snapshots/skillstate/` (D-143, D-259),
    `users/<uid>/traces/web.json.gz` (D-299), `cells/<id>.classes.json` (0253) and
    `users/<uid>/backfill/batch.json`. A "NOT BUILT" block keeps `facts/<uid>/highwater.jsonl`
    (superseded by the snapshot and the `isFloor` rows), `facts/<uid>/identity.json` (planned,
    never built), the `rules/` mirror (never built, D-274) and `regions/` (planned by 05 §8.1, no
    ticket), so nobody goes looking for them.
  - §1.4: Break 1 says its `identity.json` fix is not built and Break 1 is open: the drill
    rebuilds against the same user pool, so pool loss is uncovered. Break 2's fix is restated as
    what was built (`isFloor` rows plus the per-ingest snapshot). The closing line names the
    snapshot waterline instead of "two small fact files".
  - §9.1 I-1 and I-2: same correction. I-2's CI-check column now names what `drillMayRead`
    actually allows (`raw/<uid>/`, `snapshots/skillstate/<uid>/`, and `manifest.json` as the
    verification target).
- `docs/08-security-privacy.md` §5.5: the first bullet now gives the owner-scoping mechanism per
  store: `defineData` owner auth for the five models (with the two `allow.authenticated()`
  custom mutations scoped by `identity.sub` and the owner allowlist in their handlers); IAM plus
  handler scoping for the five CDK tables (`ExploredCell`, `SourceAccount`, `OAuthState`,
  `IngestReceipt`, `CaptureGuard`); and for S3, the `entity('identity')` rule (which covers no
  object, D-228) next to the routes that actually serve the user's objects as the SSR compute
  role, keyed by the session's `sub`. The `Trace` model is gone. There never was one.

**Decisions.** D-NEW-a (02's storage map corrected; `facts/` never built, Break 1 open).
D-NEW-b (08 §5.5 names the real per-store mechanism). The orchestrator allocates the numbers.

**D-123 / §2.4 A-1.** Every store is still owner-scoped, so A-1's premise holds. For the CDK
tables and S3 the scoping is a property of the route handlers, because one role serves every user.
A-1's own wording ("every S3 prefix is under `entity('identity')` or an explicit `raw/<uid>/` IAM
condition") does not describe that, and §2.4 is not changed here. That is reported to the
orchestrator as an open question.

**REFLECT grep.** `grep -rn 'facts/' docs src tools amplify` leaves only deliberate history: 02's
"NOT BUILT" and amendment notes, `16-rebuild-drill.md`'s audit note, and
`tools/drill/ci/drill-ci.test.ts`, which asserts the drill is *refused* a `facts/` read. The
`Trace` hits that remain are the domain type from the ingestion contract, not a store. §2.4 A-1's
"`Trace` read path" names the route-trace store and is left alone.
