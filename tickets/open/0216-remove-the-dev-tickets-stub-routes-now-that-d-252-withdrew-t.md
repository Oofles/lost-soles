---
id: 216
slug: remove-the-dev-tickets-stub-routes-now-that-d-252-withdrew-t
title: Remove the /dev/tickets stub routes now that D-252 withdrew the in-app ticket UI
type: chore
priority: low
status: open
size: s
capability: 18-mvp-hardening
depends_on: []
blocked_by: []
source: agent
created: 2026-09-28T17:42:28Z
started: 2026-10-26T19:03:53Z
---

## Description

D-252 (2026-09-28) withdrew capability `17`: there is no in-app ticket UI. Two stub routes from
`0016` remain, `app/dev/tickets/page.tsx` and `app/dev/tickets/[id]/page.tsx`. `app/routes.test.ts`
lists both as part of the app's route set (lines ~26–27, "owner-only (D-092)").

They are harmless. Both are owner-only stubs, and `0114` asserts they stay owner-only. But they are
routes for a feature that will never be built, and the route test pins them there as though they
were intended. Filed from `0215`'s sweep, not done inside it, because that ticket changed ticket
text only and this is code.

## Acceptance criteria

- [x] Both `app/dev/tickets` pages are removed, and `app/routes.test.ts` drops them. Its comment
      cites D-252 for the change in route count.
- [x] Nothing else links to `/dev/tickets`: grep `app/`, `components/` and `lib/`. The capture
      endpoint `/api/tickets/capture` is untouched (D-252 keeps it).
      *(The grep's only remaining hit is `routes.test.ts`'s own comment recording the removal.)*
- [x] `0114`'s criterion "`/api/dev/tickets` and `/dev/tickets` are owner-only (A-6)" is amended to
      the routes that still exist.
      *(Already done before this ticket started: `tickets/closed/0114-d123-standing-conditions-wired.md`
      carries an operator amendment (Q3 = a) under that criterion, scoping it to
      `/api/tickets/capture` and noting `/dev/tickets` is a stub `0216` deletes. Not re-edited here,
      since it is another ticket's file.)*
- [x] `npm run typecheck`, `npm run lint` and `npm run test` pass.

## Notes

Related: D-252, `0016`, `0114`, `0215`.

## Resolution

**Deleted**
- `app/dev/tickets/page.tsx`, `app/dev/tickets/[id]/page.tsx` — the two `0016` stubs for the UI
  D-252 withdrew.
- `components/stub.tsx` — the `Stub` component. Those two pages were its last consumers (every other
  `0016` stub has since been filled in), so leaving it would be dead code whose doc comment still
  claims "every route in §1.2 exists" as a stub.

**Changed**
- `app/routes.test.ts` — the screen map drops both segments; the count assertion goes from nine to
  seven, and the comment cites D-252 and `0216` for the change.
- `scripts/check-prerender-no-cell-data.mjs` — `/dev/tickets` removed from `ALLOWED_STATIC` (its
  reason string was literally "a Stub, deleted by ticket 0216"). An allowlist entry for a route that
  no longer exists would silently re-admit it as a prerendered page if it ever came back.
- `middleware.ts` — the matcher comment no longer names `/dev/tickets` as the example of an
  owner-only route; the matcher itself is unchanged. `middleware.test.ts`'s "still covers
  `/dev/tickets`" case is left as is: it tests the matcher pattern against a path string, and a
  path that no longer resolves must still be gated, so it remains a valid case.

**Docs made wrong by this change, corrected (doc-finding rule)**
- `docs/06-ui-ux.md` §1.2 — the route diagram box and the paragraph under it said the route
  "survives as a stub" until `0216`; §1.3's table row's "Cut later?" now reads "removed by `0216`".
- `docs/01-architecture.md` App Router structure — the shipped-tree listing dropped the two
  `dev/tickets` lines; "nine App Router segments" now says seven, with the reason.
- `docs/capabilities/18-mvp-hardening.md` — the public-surface table's prerendered-pages row no
  longer lists `/dev/tickets`.
- `docs/07-ticketsmith.md` §2.4 — "`/dev/tickets` is the UI page" now says it *was*, withdrawn by
  D-252, stubs deleted by `0216`.
- `docs/08-security-privacy.md` §2.4 A-6 already names only `/api/tickets/capture` (`0154`); no
  change needed. Historical/withdrawn text (`07` §5, `09-roadmap.md`, R6, capability `17`'s close
  record) is left as the record it is.

**Not touched:** `/api/tickets/capture` and everything behind it (D-252 keeps the endpoint).
`docs/INDEX.md` and `docs/.index-summaries.json` are stale for the edited docs; the orchestrator
regenerates them.

**Decisions:** none new. This executes D-252.

## Operator validation

Nothing perceptual. Agent-side, in the worktree: the full amplify.yml build-phase guard list,
`npm run typecheck`, `npm run lint`, `npx vitest run` and `npm run build` all pass; the built
`.next/app-path-routes-manifest.json` and `prerender-manifest.json` contain no `dev/tickets`.
Post-deploy smoke test (orchestrator): signed out, `/dev/tickets` 307s to `/?next=/dev/tickets`
exactly as before (the middleware gates every path before route resolution, so signed out cannot
distinguish a deleted route from a live one), and `/`, `/skills`, `/log`, `/settings` behave as
before. The deletion itself is proven by the build manifest, not by curl.

**2026-10-26, post-deploy (Amplify job 432, `d70401b`).** Signed out, `/dev/tickets` and
`/dev/tickets/0001` → 307 to `/?next=…`, as before. `/` → 200. `/skills`, `/log`, `/settings`
and `/chronicle` → 307, as before. `POST /api/tickets/capture` with no credential → 404, so the
endpoint is untouched.
