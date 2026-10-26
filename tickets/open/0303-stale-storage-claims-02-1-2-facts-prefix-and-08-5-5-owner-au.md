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

- [ ] `02` §1.2 lists only prefixes something writes, each naming its writer, or says which are
      planned and by which decision.
- [ ] `08` §5.5 names the real owner-scoping mechanism per store: `defineData` owner auth for the
      model tables, IAM/handler scoping for the CDK tables, `entity('identity')` for S3.
- [ ] A `D-xxx` records each correction.

## Notes

Doc-only. Grep every doc for `facts/` and for the `Trace` model before closing (capability 15's
REFLECT habit).

## Operator validation

None perceptual: doc-only. Smoke test: `grep -rn 'facts/' docs src tools amplify` returns only deliberate history.
