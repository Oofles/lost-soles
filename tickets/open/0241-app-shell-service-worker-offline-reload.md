---
id: 241
slug: app-shell-service-worker-offline-reload
title: App-shell service worker so a cold reload renders offline
type: feature
priority: low
status: open
size: m
capability: 10-add-workout
depends_on: []
blocked_by: []
source: agent
created: 2026-10-06T18:50:58Z
---

## Description

Filed from 0068 under D-282. The app has no service worker. /log renders offline when reached by navigation from / (the route is static and prefetched; rows come from the bundled registry and standing from IndexedDB), but a hard reload with the network off cannot load any route at all.

06 §9.5 wants first paint cache-only, under 1 s with the radio off, for the map as well as /log. A service worker serving the app shell and the static chunks would give that on every route. It would also make the Background Sync API available, which could take over from LogQueueRunner's in-page polling.

## Acceptance criteria

- [ ] With DevTools → Offline, a hard reload of `/` and of `/log` renders from cache.
- [ ] The service worker caches only the app shell and static chunks, never an API response that carries location data (`08` §9.10).
- [ ] A deploy replaces the cached shell without a manual cache clear.

## Notes

Weigh this against D-013 and N5 before building: a service worker is a cache that can serve a stale app, and a stale app is a support burden with no support desk.

## Operator validation

Desktop browser, DevTools → Offline, hard reload of `/log`: the page renders and a log queues.
