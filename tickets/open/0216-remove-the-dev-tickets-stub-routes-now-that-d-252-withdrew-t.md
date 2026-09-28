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

- [ ] Both `app/dev/tickets` pages are removed, and `app/routes.test.ts` drops them. Its comment
      cites D-252 for the change in route count.
- [ ] Nothing else links to `/dev/tickets`: grep `app/`, `components/` and `lib/`. The capture
      endpoint `/api/tickets/capture` is untouched (D-252 keeps it).
- [ ] `0114`'s criterion "`/api/dev/tickets` and `/dev/tickets` are owner-only (A-6)" is amended to
      the routes that still exist.
- [ ] `npm run typecheck`, `npm run lint` and `npm run test` pass.

## Notes

Related: D-252, `0016`, `0114`, `0215`.

## Operator validation

None needed from the operator: removing unreachable stubs. Smoke test by the agent after deploy:
`curl` shows `/dev/tickets` returns 404 while signed out, as before, and the app's other routes
are unaffected.
