---
id: 78
slug: post-run-route-and-end-state
title: /run/:activityId route, its four entry points, and the persistent end state
type: feature
priority: high
status: closed
size: m
capability: 12-post-run-moment
depends_on: [53, 62]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
started: 2026-10-08T15:29:31Z
closed: 2026-10-08T16:15:14Z
---

## Description

The scaffolding for the post-run moment: the route itself, the entry-point behaviour matrix, and
the **end state** the whole sequence exists to deliver you to.

`06-ui-ux.md` §3.3 is the load-bearing sentence: *"The end state is the canonical view of a run.
The sequence is a decorated way of arriving at it."* Build the canonical view first. It is plain
DOM plus a map, it needs no choreography, and every later ticket in this capability either
animates into it or skips to it.

**Entry points (§3.1), exactly:**

| Entry | Behaviour |
|---|---|
| ~~Push notification "your run is on the map"~~ | ~~Deep-link to `/run/:id`, auto-play from beat 1~~ *(Withdrawn by D-253, 0215: no push notification when a run lands; the plinth's new-run line reports it the next time the app is opened.)* |
| Plinth `1 new run — tap to open` | Deep-link to `/run/:id`, auto-play from beat 1 |
| App opened cold with an unseen import | Home renders first; the plinth line pulses **once**. It does **not** auto-play |
| Chronicle → any past run | Opens in **static end state**, with a `⟲ Relive` control |

The cold-open rule is not a nicety. Ambushing the user with an eight-second animation they did not
ask for is how a reward becomes an obstacle, and that is a D-013 failure wearing a costume.

The end state: lit map on top (pannable again), full ledger below, chronicle line, frontier line,
`⟲ Relive`, and route stats (distance, duration, date, source). It is persistent and scrollable
with **no timeout**. Browser back returns to `/`.

Whether the sequence auto-plays is a function of `autoplay` intent passed by the entry point, not
of the run's age or the `seen` flag alone — the flag is owned by 0084. This ticket takes a boolean
and honours it.

## Acceptance criteria

- [x] `/run/:activityId` resolves for any activity id the signed-in user owns and ~~404s~~ **renders
      the 404 page** for one they do not. *(Amended 2026-10-08, operator, D-292: under Next 15.5's
      streaming metadata a browser gets the 404 page with HTTP status 200. No run data reaches it,
      and a missing id is indistinguishable from another account's.)*
- [x] Opening the route with no autoplay intent renders the static end state — map, ledger,
      chronicle line, frontier line, `⟲ Relive`, route stats — with no animation of any kind.
- [x] `⟲ Relive` restarts the sequence from beat 1 and returns to this same end state.
- [x] The end state has no timeout and no auto-navigation: left untouched for five minutes it is
      unchanged.
- [x] Browser back from the end state lands on `/`, not on a blank history entry.
- [x] A deep link to `/run/:id` from a fresh page load (new tab) opens the route
      directly and does not flash the home screen first.
- [x] Opening the app cold with an unseen import lands on `/` — asserted by a test that the
      router never auto-navigates to `/run/:id`.
- [x] The ledger and both text lines render correctly with WebGL disabled (map area falls back to
      a static image or blank parchment). The numbers never depend on the graphics (§3.4).

## Notes

Depends on 0053 (the MapLibre shell as the home route) for the map component and 0062 (the
`XpLedgerEntry` table) for the per-skill rows this page reads. The ledger read is a plain query by
`activityId`; no scoring happens here.

Beats 4 and 5 render *into* this page and are specified in 0083 — this ticket lays out their slots
and may render them from a stub string. The tally rows are 0081; render them un-animated here.

Do not put a "Run imported!" toast, a title card, or a spinner anywhere on this route. §3.2 forbids
all three, and the prohibition applies to the static entry as much as to the animated one.

- *(from `0244`, 2026-10-07)* `app/run/[activityId]/page.tsx` already renders
  `<ActivityKind activityId>` (`./activity-kind.tsx`) under the stub: the kind, "was X", and a
  quiet "Change" control backed by `setActivityKind`. Place it in the persistent end state; it is
  self-contained and must stay secondary (D-051).

## Resolution

**Built** (commits `be884a9`, `8798e5a`):

- `app/run/[activityId]/page.tsx` is a server component. `runById` (`lib/runs/server.ts`) does a
  base-table `Query` by `id`, because the SSR role holds `dynamodb:Query` on T3 and nothing else, so
  no new grant was needed. It then compares the row's `userId` with the session `sub`. Not-owned and
  not-found both return `null` and render `notFound()`. Geometry is read through the rebuilt
  `routeTraceKey(uid, id)`, never off `traceRef`, as in `latestRun`.
- `run-moment.tsx`: `RunMoment` always renders the end state (`EndState`), in §3.3's order: map,
  ledger, chronicle line, frontier line, `⟲ Relive`, route stats, then 0244's `ActivityKind`.
  `RunSequence` is mounted on top of it while a sequence plays and unmounted on `onDone`. No beat
  exists yet, so it finishes at once. That is the contract `0079`–`0084` inherit: whatever plays
  ends by calling `onDone`, and the end state is already underneath. Phase is a reducer
  (`momentReducer`); Relive bumps a `play` key so each replay mounts a fresh sequence.
- **Autoplay intent is `?play=1`**, written only by `runHref(id, { play: true })`
  (`lib/runs/wire.ts`). The page drops it from the address bar once read, so a reload or a copied
  link opens the end state. The Chronicle links without it. **The plinth's new-run line (`0086`)
  must link with `runHref(id, { play: true })`.**
- `run-ledger.tsx` + `lib/runs/ledger.ts`: the per-run ledger, read from `XpLedgerEntry.byActivity`
  through AppSync (owner-scoped). It sums per skill, omits zeros, sorts by XP descending, reads one
  ruleset version (the newest present, so a mid-replay read cannot double-count) and skips floor
  rows. It shows the cells-claimed/remembered line with zero halves omitted, and the run's total XP.
  Bars, levels, the reason breakdown and the count-up are left to `0081`.
- The chronicle and frontier lines are stub strings in their `data-slot`s, for `0083`.
- **Back from a cold deep link** (`lib/runs/history.ts`): when the document's own navigation entry
  is this URL (`performance` navigation timing, type `navigate`), a `/` entry is slipped underneath.
  It goes through the **unpatched `History.prototype` methods**. Next 15 patches
  `history.pushState`/`replaceState` to copy the current page's router tree into the entry, so a
  seed written the normal way would "restore" the run page under the URL `/`. The prototype-written
  seed has no `__NA`, and Next's `popstate` handler answers that with a full reload of `/`. Reloads
  and soft navigations are not seeded.
- `MapShell` gains a framed single-run mode (`run` prop). The map is 55vh at the top of a scrolling
  page, fitted with `fitBounds(..., { padding: 12%, animate: false })`. It draws this run's line
  (`useLatestRun(map, layer, fixed)` skips the fetch) and leaves the stored home camera alone in
  both directions. `runBounds` was extracted from `runCamera` (`lib/map-camera.ts`).
- `/chronicle` gains a plain list of the 50 most recent activities linking to `/run/:id`
  (`chronicle-links.tsx`, `recentRuns`). The sheet, totals and paging are still `0088`'s. The links
  use `replace`: the Chronicle is a sheet that closes when a run opens, so back lands on `/` (§3.3).
- `ActivityKind` lost the side padding it had while sitting under the stub.

**Tests:** `lib/runs/run-page.test.ts` (18) covers ownership, the 404 null, key rebuild, untraced
runs, `recentRuns`, `runHref`, `runLedger` and the history seed (cold, soft, reload, `?play=1`).
`app/run/[activityId]/run-moment.test.tsx` (15) covers end-state contents and order, no
animation/toast/spinner markup, rendering with the map absent (criterion 8), autoplay vs. static,
the Relive reducer, and **criterion 7 as a source scan**: no `push`/`replace`/`redirect`/`location`
navigation to `/run/` anywhere in `app`, `components`, `lib` or `middleware.ts`.
`use-latest-run.test.ts`'s "generation is the only trigger" assertion was updated for the new
mount-constant `fetchLatest` dependency. Full suite: 2959 pass.

**What went wrong, honestly:**
- **Criterion 1's literal "404" does not hold for browsers.** Next 15.5 streams metadata to non-bot
  user agents, which commits the response as 200 before the page's `notFound()` runs. The browser
  shows Next's 404 page (`NEXT_HTTP_ERROR_FALLBACK;404`, noindex) with no run data. I asked the
  operator, who chose to accept the rendered 404 and amend the criterion (D-292) rather than set
  `htmlLimitedBots: /.*/` globally.
- My first test fixtures used `source: "strava"` and tripped `check-boundaries` (D-100). They use
  `manual` now.
- My first version of the Chronicle link pushed, so back from a Chronicle-opened run went to
  `/chronicle`. The ticket's own validation (and §3.3) says `/`. Fixed with `replace` in `8798e5a`.
- The agent shell defaults to Node 20, which fails ~200 unrelated tests. Run under `fnm use 22`.
  The build and lint also trip on gitignored `tmp/` scratch from earlier tickets, which CI never
  sees; it was moved aside for the local build.

**Not done here, by design:** the `seen` flag and skip (`0084`), beats 1–5 (`0079`–`0083`), the
plinth's pulse on cold open (`0086`/`0087`), and the web-of-past-routes dimming on `/run/:id`
(`0085`). The fog's ambient drift (05 §4.5) still runs on this map. It is the map's steady-state
look, the same as on `/`, not a sequence animation.

## Operator validation

In the desktop browser, from the Chronicle, click a run from last week. It must open **static** — no
camera move, no counting numbers — and be immediately scrollable. Scroll to the bottom, confirm the
route stats and `⟲ Relive` are reachable. Press back once: you are on `/`. Now click the
same run again and hit `⟲ Relive`; when it settles you are on this same page, in the same scroll
position rules, not somewhere new. Finally, narrow the window to ~400 px and confirm the ledger is
still legible and the map has not eaten the text.

### Evidence

**Agent smoke test, deployed site, 2026-10-08** (`tmp/0078/smoke.mjs`, headless Chromium against
`soles.devaultsecurity.com`). Setup: a throwaway Cognito user, with one synthetic run seeded for it
(T3 row, gzipped S3 trace near Point Nemo, four T4 ledger rows). All of it was deleted in `finally`.

- Signed in through the real Authenticator. A full document load of `/run/<id>` rendered the run,
  and a MutationObserver installed before the first byte saw **no home map mount at any point**
  (criterion 6).
- Static end state, `data-phase="end"`: `RETURN FROM THE FOG`, Wayfaring +520 / Constitution +107
  / Cartography +15 in that order, `7 cells claimed`, no `0 remembered`, `Total XP +642`, both line
  slots, `⟲ Relive`, `5.23 km`, `30:00`, `Fri 28 Aug 2026`, `Manual`. Zero elements with a CSS
  animation or transition; no toast/spinner text; the map canvas mounted in its slot (criterion 2).
- `history.back()` from the cold deep link → `/`, with the home map (criterion 5).
- `?play=1` → dropped from the URL, and the page settled on the end state.
- `⟲ Relive` → back to `data-phase="end"`, with identical ledger text and the same path (criterion 3).
- `/chronicle` links the run with no `play=`. Clicking it opened the static end state.
- Another account's real activity id and a nonexistent id both render the 404 page with no run data
  (criterion 1, as amended). The caller's own id returns 200.
- 400px: no horizontal scroll (scrollWidth 385 = clientWidth). Screenshots checked by me: the ledger
  is legible, and the map is a box above the text, not over it.
- **Left untouched for 300 s: path, phase and full page text unchanged** (criterion 4).
- Chromium with `--disable-webgl --disable-3d-apis`: ledger, both lines and stats all render, and
  the map area says it cannot run the map (criterion 8).
- Final run after `8798e5a` deployed (Amplify job 334), soak off: **37/37 passed**, including back from a Chronicle-opened run → `/`, and cleanup confirmed.

**Perceptual check, for the operator, in the desktop browser.** This is the ticket's own list.
Open `/chronicle`, click a run from last week. It opens **static**: no camera move, no counting
numbers. Scroll to the bottom and confirm `⟲ Relive` and the route stats. Press back once and
check you land on `/`. Click the same run again and hit `⟲ Relive`; it should settle on this same
page. Narrow the window to ~400 px: is the ledger still legible, and has the map left the text
alone? *Pending.*


**Operator, 2026-10-08, desktop browser.** `/chronicle` looks right. Two findings:
- *Relive only scrolls to the top.* Expected for now: `RunSequence` is a placeholder until `0079`–`0084`.
- *Back left the site, and there was no back control.* A real bug. With `/chronicle` opened from the address bar, nothing of the app sat behind it, and the `replace` link removed the only entry. Fixed in `e408eaa`: a cold `/chronicle` now seeds `/` beneath it, the same way a cold `/run/:id` does (`app/chronicle/seed-home.tsx`). `/run/:id` also gains §7's desktop `←` arrow to `/`. The smoke test adds both cases, and 39/39 pass against job 336.
