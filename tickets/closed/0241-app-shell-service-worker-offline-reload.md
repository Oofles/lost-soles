---
id: 241
slug: app-shell-service-worker-offline-reload
title: App-shell service worker so a cold reload renders offline
type: feature
priority: low
status: closed
size: m
capability: 10-add-workout
depends_on: []
blocked_by: []
source: agent
created: 2026-10-06T18:50:58Z
started: 2026-10-07T16:07:45Z
closed: 2026-10-07T16:07:50Z
---

## Description

Filed from 0068 under D-282. The app has no service worker. /log renders offline when reached by navigation from / (the route is static and prefetched; rows come from the bundled registry and standing from IndexedDB), but a hard reload with the network off cannot load any route at all.

06 §9.5 wants first paint cache-only, under 1 s with the radio off, for the map as well as /log. A service worker serving the app shell and the static chunks would give that on every route. It would also make the Background Sync API available, which could take over from LogQueueRunner's in-page polling.

## Acceptance criteria

- [x] ~~With DevTools → Offline, a hard reload of `/` and of `/log` renders from cache.~~
      **Declined (D-287), 2026-10-07, operator's decision.** No service worker. For `/` this
      also conflicts with the next criterion, because `/`'s HTML carries the home coordinate.
- [x] ~~The service worker caches only the app shell and static chunks, never an API response that carries location data (`08` §9.10).~~
      **Moot (D-287):** there is no worker, so nothing is cached. The constraint is what ruled
      out caching `/`.
- [x] ~~A deploy replaces the cached shell without a manual cache clear.~~
      **Moot (D-287):** with no worker, every deploy is live on the next load, which is the
      upkeep argument for declining.

## Notes

Weigh this against D-013 and N5 before building: a service worker is a cache that can serve a stale app, and a stale app is a support burden with no support desk.

## Resolution

**Declined, recorded as D-287.** The operator chose this on 2026-10-07, from three options:
decline, a narrow `/log`-only worker, or a full worker after restructuring `/`. No code ships.
The criteria are struck through with reasons, not met.

**What decided it.**
- **The conflict in the ticket.** `/` is dynamic on purpose: its HTML embeds the operator's
  home map coordinate (`lib/map-home.ts`, `0053`). Caching that HTML would cache location data,
  which criterion 2 forbids (`08` §9.10). The cache would also keep serving it after sign-out,
  past `middleware.ts`'s server-side auth. Criterion 1 for `/` was therefore unreachable
  without first moving the coordinate into a client fetch.
- **The weighing the Notes asked for (D-013, N5).**
  - The only gap is a cold load with no signal at all.
  - Navigation-reached `/log` (D-282), the IndexedDB log queue, the queue flushing later, and
    the IndexedDB-cached map paint all already work.
  - A service worker is permanent, sticky machinery: a kill switch, versioned caches, an update
    path, and a middleware exemption, all for one user's edge case.
- **The narrow option** (`/log` only) was rejected. It costs all of that upkeep for the one
  route that is already reachable offline.

**Docs.**
- `docs/decisions/DECISIONS.md` gains D-287, including how to revisit: move the home coordinate
  into a client fetch first, and only on evidence from real use.
- `docs/06-ui-ux.md` §9.5's first bullet is amended: the cache-only paint applies to a running
  app.

## Operator validation

Desktop browser, DevTools → Offline, hard reload of `/log`: the page renders and a log queues.

### Result

**None, and none is possible.** No code shipped and nothing was deployed, so there is no screen
to look at and no infrastructure to test. The decision itself was the operator's, made on
2026-10-07 after reading the trade-off, including the `/` home-coordinate conflict.

