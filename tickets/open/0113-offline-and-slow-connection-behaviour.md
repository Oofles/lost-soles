---
id: 113
slug: offline-and-slow-connection-behaviour
title: Offline and slow-connection behaviour — the map degrades, never blanks
type: feature
priority: high
status: open
size: m
capability: 18-mvp-hardening
depends_on: [59, 90, 107]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
---

## Description

`06-ui-ux.md` §9.5. The app is opened outdoors, often on one bar. The design rule is that **the
network is never on the critical path to seeing your map.**

- **First paint is cache-only.** Cached basemap tiles plus the last `explored-r10.bin` from
  IndexedDB render before any request is issued. Target: **usable first paint in under 1 s with
  the radio off.**
- **The fog payload is fetched after first paint, never before**, and revalidated with
  `If-None-Match`. A 304 costs nothing; a changed payload swaps in without a flash.
- **There is no offline banner.** The plinth already shows *"Last: Thu · 8.4 km"*, which is the
  honest freshness signal — the date of the most recent thing the app knows about. A banner
  announcing a condition the user cannot fix is chrome that exists to blame the world.
- **Missing tiles are flat parchment**, never a checkerboard, never a spinner.
- **Writes never block.** Workout logs and ticket captures go to IndexedDB and flush on a
  background-sync queue with idempotency keys. The only sync UI in the app is the `N pending`
  badge on `/dev/tickets`.
- **API timeout 10 s, then queue.** No request is allowed to hold a screen.
- **No third-party requests at runtime.** Fonts are self-hosted; no analytics, no tag manager, no
  font CDN. Each is a slow-connection failure mode bought for nothing, and there is nobody to
  report analytics to anyway.

Degrading rather than blanking is the specific requirement: with stale data the map shows the
territory it knows about, dated honestly by the plinth line. It never shows an empty map, a
skeleton, or a spinner over the map area.

## Acceptance criteria

- [ ] With the radio off and a warm cache, `/` reaches usable first paint (basemap + fog) in
      **under 1 s**, measured on the operator's device and recorded as a number.
- [ ] The fog payload request is issued **after** first paint — asserted by a performance-timeline
      test that no fetch precedes the first contentful paint of the map canvas.
- [ ] Revalidation uses `If-None-Match`; an unchanged payload returns 304 and causes no visual
      change (no flash, no re-upload of the mask texture).
- [ ] Missing tiles render flat parchment; there is no checkerboard asset and no spinner anywhere
      over the map area — asserted by a grep and by a screenshot with tiles blocked.
- [ ] There is no offline banner, no connectivity toast, and no `navigator.onLine`-driven UI
      anywhere.
- [ ] Every API call has a 10 s timeout after which the write queues and the read falls back to
      cache; a test with a hung endpoint asserts no screen is blocked.
- [ ] A workout log and a ticket capture made in airplane mode both persist, both show as pending
      where their design says they should, and both flush exactly once on reconnect.
- [ ] Zero third-party origins are requested at runtime — asserted by a CI check over the built
      app's network origins and confirmed by an empty third-party list in a device trace.

## Notes

The "no offline banner" rule will feel wrong the first time a payload is stale and the map looks
slightly behind. It is still right: the plinth date is a truer statement than a banner, and it is
already on screen.

Note the interaction with §9.2's cache rule from `08-security-privacy.md` §2.4 C-3: authed
responses are `private, no-store`. Offline resilience comes from **IndexedDB and the service
worker's own cache of owner-scoped payloads**, never from a shared CDN cache of an authed
response.

## Operator validation

On the operator's Android phone, on a real walk: (1) airplane mode, cold-start the app from the
home-screen icon, and count — the map must be there and usable before you have finished saying
"one thousand one"; (2) log a set of pushups and capture a ticket while still offline, and confirm
both accept instantly with no error; (3) turn the radio back on, wait, and confirm both landed
exactly once (check GitHub for one commit, `/skills` for one XP award); (4) enable Chrome's slow
3G throttle and reload — the map must paint from cache and the fog must catch up silently with no
flash. Anywhere you see a spinner over the map, or a banner, this ticket is not done.
