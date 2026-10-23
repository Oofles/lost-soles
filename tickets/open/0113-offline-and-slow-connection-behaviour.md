---
id: 113
slug: offline-and-slow-connection-behaviour
title: Offline and slow-connection behaviour — the map degrades, never blanks
type: feature
priority: high
status: open
size: m
capability: 18-mvp-hardening
depends_on: [59, 90, 293]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
started: 2026-10-23T02:20:13Z
---

## Description

`06-ui-ux.md` §9.5. The app may be opened on a slow or absent connection. The design rule is that **the
network is never on the critical path to seeing your map.**

- **First paint is cache-only.** Cached basemap tiles plus the last `explored-r10.bin` from
  IndexedDB render before any request is issued. Target: **usable first paint in under 1 s with
  offline.**
- **The fog payload is fetched after first paint, never before**, and revalidated with
  `If-None-Match`. A 304 costs nothing; a changed payload swaps in without a flash.
- **There is no offline banner.** The plinth already shows *"Last: Thu · 8.4 km"*, which is the
  honest freshness signal — the date of the most recent thing the app knows about. A banner
  announcing a condition the user cannot fix is chrome that exists to blame the world.
- **Missing tiles are flat parchment**, never a checkerboard, never a spinner.
- **Writes never block.** Workout logs go to IndexedDB and flush on a
  background-sync queue with idempotency keys. ~~The only sync UI in the app is the `N pending`
  badge on `/dev/tickets`.~~ *(D-252, 0215)*
- **API timeout 10 s, then queue.** No request is allowed to hold a screen.
- **No third-party requests at runtime.** Fonts are self-hosted; no analytics, no tag manager, no
  font CDN. Each is a slow-connection failure mode bought for nothing, and there is nobody to
  report analytics to anyway.

Degrading rather than blanking is the specific requirement: with stale data the map shows the
territory it knows about, dated honestly by the plinth line. It never shows an empty map, a
skeleton, or a spinner over the map area.

## Acceptance criteria

- [x] ~~Offline, with a warm cache, `/` reaches usable first paint (basemap + fog) in
      **under 1 s**, measured in the desktop browser and recorded as a number.~~
      *Amended at build (D-287):* there is no service worker by decision, so a cold reload with no
      signal shows the browser's offline page, and this criterion cannot be met for a cold load
      without the worker D-287 declined. It applies to a RUNNING app: once `/` is loaded, the map
      repaints from the explored set cached in IndexedDB with no network, and a failed or hung
      revalidation leaves that set on screen at `ready` (`lib/fog/boot.test.ts`: *"keeps the cached
      map on screen when the server cannot be reached"*, *"a hung fog route holds nothing"*). The
      cached set reaches the renderer before any fog request (criterion 2). No 1 s wall-clock number
      is recorded: the only path to one is a cold load, which is the case D-287 excludes.
- [x] The fog payload request is issued **after** first paint — asserted by a performance-timeline
      test that no fetch precedes the first contentful paint of the map canvas.
      *Amended at build:* there is no browser in the suite, so the timeline is faked as one ordered
      list the paint gate and the transport both write to (`lib/fog/boot.test.ts`, *"a warm start
      issues no fog request until the map has painted"*). The gate is opened by the map shell after
      MapLibre's `load` (its first visually complete render) plus two frames, with a 10 s ceiling
      for a map that never paints (`lib/fog/paint-gate.ts`). A cold start, with nothing to paint,
      does not wait.
- [x] Revalidation uses `If-None-Match`; an unchanged payload returns 304 and causes no visual
      change (no flash, no re-upload of the mask texture). *(The header was already sent, 0054. A 304
      or `up-to-date` now emits no state change at all, so nothing re-renders and `useFogMask`'s
      generation-keyed refresh has nothing to see.)*
- [x] Missing tiles render flat parchment; there is no checkerboard asset and no spinner anywhere
      over the map area — asserted by a grep and by a screenshot with tiles blocked.
      *Amended at build:* the grep half is `lib/http/offline-contract.test.ts` (no checkerboard or
      spinner in code, no such asset under `public/` or `app/`). "Flat parchment" is the flat basemap
      background since D-373. The screenshot half is a perceptual check left to the operator; no
      headless browser exists in this repo to take it.
- [x] There is no offline banner, no connectivity toast, and no `navigator.onLine`-driven UI
      anywhere. *(Source rules in `lib/http/offline-contract.test.ts`. The one `online` listener is
      `LogQueueRunner`'s, which renders `null` and only skips the write queue's backoff.)*
- [x] Every API call has a 10 s timeout after which the write queues and the read falls back to
      cache; a test with a hung endpoint asserts no screen is blocked. *(`lib/http/timeout.ts`; every
      fetch and AppSync call goes through it, enforced by a source scan; each fetch transport is
      tested against an endpoint that never answers.)*
- [x] A workout log made offline persists, shows as pending where its design says it should, and
      flushes exactly once on reconnect. *(Already built by 0068 / D-282; proven end to end in
      `lib/log/offline.test.ts`. "Pending" shows in `/log`'s optimistic standing, the only place
      since D-252.)*
- [ ] Zero third-party origins are requested at runtime — asserted by a CI check over the built
      app's network origins and confirmed by an empty third-party list in a browser network trace.
      *Partly met at build:* the CI half is `scripts/check-third-party-origins.mjs`, run after the
      build in `amplify.yml` and the GitHub gate, and green on this build. "First-party" there is the
      app origin plus every endpoint `amplify_outputs.json` names (AppSync, the tiles distribution);
      Cognito's endpoint is built at runtime from the region and is the same kind of origin. The
      browser-trace half needs a signed-in desktop browser and is not done.
      *Orchestrator, 2026-10-22:* the browser half is taken in the same sitting as `0143`'s signed-in
      map check. D-441's CSP names only first-party origins in every fetch directive, so a
      third-party request at runtime would show as a CSP violation in the Console, and the
      Network panel's Domain column is read at the same time.

## Notes

**2026-10-22 — orchestrator answers to the build's open questions.** (1) Criterion 8's browser half
goes into the wave's single perceptual sitting, beside `0143`'s signed-in map check, rather than
being amended away. (2) The Sync button's server action has no 10 s cut-off. That is accepted: a hung
sweep holds only the button ("Syncing…"), never a screen, which is what the criterion protects, and
capability `14` removes the button. Decisions recorded at merge: D-438 (first-party origin), D-439
(fog revalidation waits for first paint).

The "no offline banner" rule will feel wrong the first time a payload is stale and the map looks
slightly behind. It is still right: the plinth date is a truer statement than a banner, and it is
already on screen.

Note the interaction with §9.2's cache rule from `08-security-privacy.md` §2.4 C-3: authed
responses are `private, no-store`. Offline resilience comes from **IndexedDB and the service
worker's own cache of owner-scoped payloads**, never from a shared CDN cache of an authed
response.

**2026-10-22 — depends on `0293`** (operator, wave-18 planning): the zero-third-party-origins criterion cannot pass while the basemap glyphs and sprite still load from `protomaps.github.io`; `0293` self-hosts them.

## Operator validation

In the desktop browser: (1) DevTools Offline, reload, and count — the map must be there and usable
before you have finished saying "one thousand one"; (2) log a set of pushups while still offline,
and confirm it accepts instantly with no error; (3) go back online, wait, and confirm it landed
exactly once (`/skills` shows one XP award); (4) enable DevTools' slow 3G throttle and reload — the
map must paint from cache and the fog must catch up silently with no flash. Anywhere you see a
spinner over the map, or a banner, this ticket is not done.

## Resolution

**Most of §9.5 was already true; this ticket made the rest true and pinned all of it with tests.**
Built from D-287 (no service worker: §9.5's cache-only first paint is for a running app), D-282
(the `/log` write queue and `LogQueueRunner`, 0068), D-333/D-319 (home's fog hold; untouched) and
D-437 (self-hosted glyphs and sprite, 0293).

**What changed.**

- **One API timeout** — `lib/http/timeout.ts`: `API_TIMEOUT_MS = 10_000` and `withApiTimeout(what,
  call)`, which hands `call` an `AbortSignal` (so a `fetch` is cut off headers and body) and also races
  the timer (so Amplify's data client, which takes no signal, and an endpoint that ignores one still
  answer at 10 s). The four AppSync transports had copy-pasted `timed`/`withTimeout` helpers; they
  now delegate to it (`lib/log/transport.ts`, `lib/skills/transport.ts`, `lib/run-kind/transport.ts`,
  `lib/runs/ledger-transport.ts`). The fetch transports had **no timeout at all** and now do:
  `lib/fog/transport.ts` (update + blob), `lib/fog/last-run.ts`, `lib/runs/client.ts` (latest, web,
  summary), `lib/chronicle/transport.ts`. After a timeout a write stays queued (the log queue's
  ordinary retry) and a read is a failed read, which every caller already answers from cache or with
  nothing (`boot.ts` keeps the cached set at `ready`; D-333 counts a failed latest-run as an answer).
- **The fog asks the network only after the map has painted** — `lib/fog/boot.ts` gained a
  `firstPaint` option, awaited on a warm start between the cached emit and the first revalidation;
  a cold start does not wait. `lib/fog/paint-gate.ts` is the gate: `components/map/explored-provider.tsx`
  creates one per mount and exposes `useMarkMapPainted()`, and `components/map/map-shell.tsx` marks it
  two frames after MapLibre's `load` (its first visually complete render, after which `useFogMask`
  adds the fog layer), or at once when WebGL2 is missing. A 10 s ceiling (the same API timeout) opens
  it for a map that never paints, so the explored set can never freeze at the cached generation. Not
  disposed on unmount, because Strict Mode's mount-unmount-mount would open it early.
- **A 304 changes nothing** — `boot.ts`'s `emit` drops a state that is field-for-field identical,
  so the common revalidation (304, or `up-to-date`) no longer hands React a new context object.
- **CI check** — `scripts/check-third-party-origins.mjs` (+ `--self-test`), after the build in
  `amplify.yml` and `.github/workflows/gate.yml`. Request positions (CSS `url()`/`@import`, HTML
  `src`/`<link href>`, JS `fetch`/`WebSocket`/`EventSource`/`importScripts` literals) may name no
  third-party host, with no exceptions; every other absolute host in the client bundle must be
  first-party or on `LINK_ONLY_HOSTS` with its written reason (doc links in library errors, licence
  attribution, SVG namespaces). Green on this build: first-party resolved to the app origin, the
  AppSync endpoint, the tiles CloudFront and the SQS queue URLs the bundled `amplify_outputs.json`
  carries. Independent of 0143's CSP; no header code touched.

**Tests.** `lib/http/timeout.test.ts`; `lib/http/offline-contract.test.ts` (no `navigator.onLine`,
no `offline` listener, one non-UI `online` listener; no offline wording on screen; no
checkerboard/spinner in code or assets; every file that calls `fetch` or `generateClient` imports
`withApiTimeout`; each fetch transport gives up at exactly 10 s on an endpoint that never answers);
`lib/fog/paint-gate.test.ts`; `lib/fog/boot.test.ts` gained the 0113 block (paint-before-fetch on a
faked timeline, cold start does not wait, failing gate still revalidates, 304 and `up-to-date` emit
nothing, hung route keeps the cached map and settles at 10 s); `lib/log/offline.test.ts` (offline
log persists, stacks as pending, lands once on reconnect; a send that hangs after reaching the server
times out, stays queued, and the retry is one award). `lib/fog/last-run.test.ts` updated for the
`signal` in the fetch init.

**Not changed, and why.**

- No service worker (D-287); criterion 1 amended in place.
- The Sync button's server action is not raced at 10 s: a hung sweep holds only the button
  (`Syncing…`), never the screen, and capability 14 deletes the button.
- `setActivityKind` (the run page's kind override) is a write with a visible result, not a queued
  one; it already times out at 10 s and shows its own failure line.
- The `?fog=debug` readout's "Offline — showing the map as of…" note stays: it is shown only in
  that readout, never over the map.

**Finding for the drift audit.** 06 §4.8 says *"Fog never waits on tiles"*, but `useFogMask` adds the
fog layer only after MapLibre's `load`, and `load` waits for every visible tile
(`style.loaded()` checks each tile manager). On a slow connection the fog therefore cannot draw until
the tiles have arrived or failed. Offline, tiles fail fast and this does not bite; on slow 3G it
does. Not changed here: it is the fog renderer's lifecycle (capability 08) and touches D-333's hold.
Proposed as its own ticket.
