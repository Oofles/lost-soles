---
id: 154
slug: docs-say-post-api-dev-tickets-the-built-endpoint-is-api-tick
title: Docs say POST /api/dev/tickets; the built endpoint is /api/tickets/capture
type: bug
priority: med
status: open
size: s
capability: 03-ticket-capture-endpoint
depends_on: []
blocked_by: []
source: agent
created: 2026-09-03T20:09:43Z
---

## Description

## Description

Found while writing `0024`'s rotation runbook, by trying to cite the verify step of
`08-security-privacy.md` §8.2 and discovering the path it names does not exist.

The endpoint shipped by `0018` is **`POST /api/tickets/capture`** (`app/api/tickets/capture/route.ts`).
The design docs consistently call it **`/api/dev/tickets`**. Ten occurrences across four documents:

- `docs/07-ticketsmith.md` — §2.4 data-flow diagram (twice, including the read-cache `GET`), §5.3
  background-sync flush, §5.7 push webhook (`/api/dev/tickets/webhook`), §6.4 endpoint heading,
  §7 threat table row
- `docs/08-security-privacy.md` — §2 checklist item **A-6** ("`/api/dev/tickets` remains owner-only")
  and §8.2's **Verify** step
- `docs/06-ui-ux.md` §7.3 — the background-sync queue target
- `docs/INDEX.md` and `docs/.index-summaries.json` — both carry the §2.4 diagram line, so a
  rebuild propagates the wrong path into the index

**Why this is a bug and not a typo.** Two of these are operational instructions that get followed
under pressure: §8.2's Verify runs during a **leak response**, and A-6 is a security checklist item
someone will tick by curling a path that 404s for the wrong reason. A checklist that passes because
the endpoint does not exist is worse than one that fails.

**The fix is one direction or the other, not both.** Either the docs adopt `/api/tickets/capture`,
or the route moves. Recommend **the docs change**: the route is deployed, live, referenced by
`tools/capture/capture.sh`, and covered by `0150`'s smoke test — moving it would break all three to
satisfy a path nobody chose deliberately. Note that `07-ticketsmith.md` §5.7's
`/api/dev/tickets/webhook` names a route capability `17`'s `0110` has not built yet, so that one is
a naming decision for `0110` rather than a correction.

## Acceptance criteria

- [ ] Every occurrence of `/api/dev/tickets` in `docs/` names the real route, or is explicitly
      marked as a not-yet-built route with the name `0110` will use.
- [ ] `08-security-privacy.md` §8.2 Verify and §2 checklist item A-6 both name a path that exists.
- [ ] `docs/INDEX.md` is rebuilt so the §2.4 summary line no longer carries the stale path, and
      `build-index.mjs --check` is clean.
- [ ] A grep for `api/dev/tickets` across `docs/` returns only intentional references to `0110`'s
      future webhook route.

## Notes

Filed from `0024` under D-152 rather than fixed inline: the runbook needed one correct path, this
needs ten edits across four documents plus an index rebuild. The runbook
(`docs/runbooks/github-pat-rotation.md`) already uses the correct path throughout.

Related: `0031` (doc corrections), `0110` (the webhook route whose name is still open), `0140` (the
INDEX staleness gate that will need the rebuild).

## Acceptance criteria

- [ ] TODO

## Steps to reproduce

1. TODO

## Expected vs actual

**Expected:** TODO

**Actual:** TODO

## Notes

TODO

## Operator validation

TODO
