---
id: 88
slug: chronicle-sheet
title: /chronicle — the run list as a sheet opened from the plinth
type: feature
priority: med
status: open
size: m
capability: 13-home-plinth-and-chronicle
depends_on: [86, 78]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
started: 2026-10-15T18:28:53Z
---

## Description

The Chronicle is the list of everything you have done. It renders as a **sheet over the map**,
opened from the plinth's handle, and it **exists as a route** (`/chronicle`) so that the browser
back button and deep links behave (`06-ui-ux.md` §1.2, §1.5).

That dual nature is the whole ticket: it must feel like a sheet and behave like a route. Opening it
pushes a history entry; back dismisses it to `/` rather than leaving the app; a cold deep link to
`/chronicle` renders the map underneath and the sheet already up, so back still lands on `/` and not
on a blank stack.

Rows are runs and logged workouts in reverse chronological order. A row carries the date, the
activity kind, its headline measure (distance for a run, the workout summary for a logged session)
and its new-cell count where it has one. Clicking a row opens `/run/:activityId` in **static end
state** with `⟲ Relive` — never auto-playing (0078's entry matrix).

Rules that follow from D-013 and `06-ui-ux.md` §2.3, and that this list will invite breaking:

- **No calendar view, no week grid, no gaps rendered.** A list has no holes in it; a calendar has
  nothing but holes, and every empty square is an accusation.
- **No aggregates by week or month.** Cumulative totals live on the plinth; period totals are one
  step from period goals (N2).
- **No filters, no search, no sort control** in v1. It is a list, newest first.
- Unseen runs may be marked, quietly, with the same gold treatment as the plinth line — and the mark
  disappears once seen (0084's per-device flag). It never becomes a count badge.

Paging: the list must survive a backfilled archive of years. Virtualise or page it; do not render
2,000 rows.

## Acceptance criteria

- [x] ~~Clicking (or dragging) the plinth handle opens the Chronicle sheet over the map, with the
      map still visible behind it.~~ **Amended (D-313, D-314):** clicking the plinth's `RUNS`
      button — the only way in; there is no handle and no drag — opens the Chronicle in the rail's
      column at ≥1024px, replacing the rail's contents, with no scrim and the map live beside it;
      below 1024px it takes the bottom card's place and takes D-314's touch swipe-down. *Reason:*
      the ticket predates D-313, which removed the handle and the sheet-over-the-map.
- [x] `/chronicle` exists as a route: navigating to it directly renders home beneath with the sheet
      open, and browser back dismisses to `/` without exiting the app.
- [x] Back from a run opened out of the Chronicle returns to the Chronicle, and a second back to `/`.
      Three levels of back behave with no blank or duplicated entries.
- [x] Rows are reverse chronological and include runs and manually logged workouts in one list.
- [x] Clicking a row opens `/run/:id` in static end state — no auto-play, asserted by a test.
- [x] An unseen run is marked in gold; the mark clears after the run is seen or skipped, and no
      numeric badge is ever rendered. *(Amended by the operator, D-324: at most one row, the
      latest traced run, carries the mark. Marking every unseen run made a backfill a gold wall.)*
- [x] A list of 2,000 activities scrolls at the §6.4 frame budget in the desktop browser; DOM node count
      stays bounded. *(Proved with a synthetic 2,000-row fixture in the test suite — window render
      p95 under 16.7 ms, DOM ≤ `maxWindowRows` rows at every scroll offset. How it FEELS to scroll
      in the real browser is the operator's perceptual check.)*
- [x] No calendar, week grid, filter, search, sort or period-total UI exists — asserted by a
      repository test over the component tree.
- [x] The sheet is dismissible by Esc, a close control and back, and dismissing it does not move the
      map camera.

## Notes

Depends on 0086 (the plinth and its handle) and 0078 (the run route it opens).

The screen map (§1.2) is deliberately seven routes and two of them are sheets. Keeping `/chronicle`
a route rather than local state is what makes the back button predictable at every depth, which is
the capability's own done-condition. Do not implement it as a modal held in component state.

Post-run sequences are never launched from here without an explicit `⟲ Relive` click — replays are
opt-in (§3.1). Getting this wrong turns browsing your history into being ambushed by animations.

- **Amended by D-313 (0187, 2026-10-15).** The Chronicle opens from the plinth's `RUNS` button only (no handle to click or drag), in the rail's column with no scrim and the map usable beside it — the §2.5 panel, not a sheet over the map. Below 1024px it takes the bottom card's place. It uses `lib/sheet/swipe-dismiss.ts` (D-314) where it is a bottom sheet.
- **Operator, 2026-10-15 (wave 1 of `13`), settling the open question above: back from a run opened out of the Chronicle returns to the Chronicle**, at the same scroll position, and a second back goes to `/`. Chronicle row links push rather than replace. A run opened any other way still goes back to `/`. This amends `06` §3.3's "Back returns to `/`": amend the doc and record the decision (D-321).

## Operator validation

In the desktop browser: open the Chronicle from the plinth. Open a run from three months ago, then press back — you must be
back in the Chronicle at the same scroll position, not at the top and not on `/`.

Now the back-button sweep, which is this capability's done-condition: from `/`, open Chronicle → open
a run → hit `⟲ Relive` → skip → back → back. You should end on `/` having passed through the
Chronicle exactly once, with nothing blank in between. *(Amended in wave 1: the sweep had three
backs, written for the old replace links. With push links (D-321) the stack after the skip is
`/, /chronicle, /run`, so two backs reach `/`.)*

Then scroll the whole list after a full Strava backfill. It must stay smooth to the bottom, and
nothing in it should make an unremarkable month look like a failure.

- 2026-10-08 (operator, during 0078 validation): **an open question to decide here, not a settled one.** Should back from a run opened from the Chronicle reopen the list instead of going to `/`? §3.3 says it goes to `/`, so today's links use `replace`. The other way costs little: the links push instead of replace. A run opened any other way would still go back to `/`. Ask the operator before building the sheet's dismiss behaviour.

## Resolution

Built by a wave-1 agent (capability `13`), 2026-10-15. Not yet deployed. The orchestrator closes it.

**The shape: a route group, so the map is mounted once under `/` and `/chronicle`.** The old
`app/page.tsx` is now `app/(home)/layout.tsx` (moved with `git mv`, body unchanged apart from taking
`children`). `app/(home)/page.tsx` is `/` and renders nothing. `app/(home)/chronicle/page.tsx` is
`/chronicle`. `HomeScreen` takes `children` and leaves the plinth out when the path is `/chronicle`,
so the panel takes the rail's column. Opening and dismissing the Chronicle never remounts MapLibre,
so the camera cannot move (criterion 9). This follows the precedent `app/skills/layout.tsx` set for
the skill sheet. The other way to do it, the Chronicle page rendering its own copy of the home
screen, would rebuild the map every time `RUNS` was clicked. The group adds no URL segment, and the
seven-route screen map is unchanged (`app/routes.test.ts` paths updated).

**Data.** `recentRuns` (0078's 50 bare links) is replaced by `chroniclePage(uid, deps, after)` in
`lib/runs/server.ts`. It runs one `Query` on `byUserAndStart`, newest first, 50 rows per page, with a
`ProjectionExpression` so that `raw` never travels. Every field is a T3 column `persist.ts` already
wrote. **The new-cell count is the stored `newCellCount`**, the same column the run page and the
plinth's last-run line read, so there is no second counts source and nothing here overlaps `0090`.
Later pages come from a new **`GET /api/runs/chronicle?after=<cursor>`**. It has the same posture as
`/api/runs/web`: uid from the session only, 404 when signed out, `no-store, private`. The cursor
holds only `[startedAt, id]` (base64url). `userId` is put back from the session, so a cursor can
never name another account's history. A malformed cursor gets a 400. The first page is rendered on
the server with the route.

**Rows** (`lib/chronicle/rows.ts`, pure) show the date (from `startedAtLocal`), the kind
(`kindLabel`), the headline measure and `N new`. The measure is the distance, else the logged
session's sets (labels from the bundled registry's `exercises[].label`, so a new type is a YAML row,
D-031), else the duration. A row with no new cells says nothing about cells (D-316). Row links
**push** (no `replace`), carry no `?play`, and so open the end state (§3.1).

**Virtualisation** (`lib/chronicle/window.ts`, pure) uses fixed 56px rows. Only the window plus 8
rows of overscan each side are in the DOM, absolutely placed inside a list as tall as everything
loaded. The next page is fetched when the window comes within 20 rows of the end of what is loaded.
A failed page waits for the next scroll and never shows an error. The DOM bound
(`maxWindowRows(900)` = 34) and a render-time sweep over a synthetic 2,000-row history are asserted
in `components/chronicle/chronicle-panel.test.tsx`.

**Back** (operator's call, 2026-10-15) has three parts. (a) Row links push. (b) `/chronicle` opened
cold gets `/` seeded underneath (`seedHomeBehind`, as in 0078, now called from the panel). (c)
`lib/chronicle/return.ts` keeps a module-level snapshot (loaded rows, cursor, `scrollTop`) taken as
the panel unmounts. A later Chronicle mount restores it **only when the most recent `popstate`
landed on `/chronicle`**. So a back from a run restores the position, while a fresh `RUNS` click
(a push, with no popstate) starts at the top. Relive followed by a skip pops the sequence sentinel
onto `/run/:id`, not `/chronicle`, and the walk is unchanged. `lib/chronicle/return.test.ts` walks
the stack through a fake session history. Dismissal (Esc, the `×` control, and below 1024px the
swipe) is always `router.back()`, because a `/` is always behind the Chronicle.

**Unseen mark.** *(Superseded at merge by D-324: the flag is asked for, and the mark drawn on, only the latest traced row — `unseenIds` replaced `isUnseen`. The rest of this paragraph is as built.)* This is `0084`'s per-device `seen` flag, asked once per loaded **traced** row. A
logged workout is never "unseen": the user entered it, and it has no reveal. The mark is a 3px gold
inset rule (`--accent`, D-148: a rule, never text) with visually hidden "not yet seen". There is no
count anywhere. Nothing is drawn until IndexedDB answers, so there is no flash of gold. The mark
clears because a back from the run remounts the panel, which asks again.
`lib/run-moment/seen.test.ts`'s importer allowlist gains the panel.

**Layout CSS** (`CHRONICLE_CSS`). At ≥1024px the panel is the rail's geometry: `left:0`, full
height, 24rem, a 1px `--line` right rule, opaque. Below 1024px it sits where the card was (16px
sides, 36px bottom per D-315), growing to `top: 72px`. That is 16px below a 40px top control at 16px,
because the mode toggle (`0098`) does not exist yet. The header is sticky. The list scrolls inside
the panel, which is also the swipe-dismiss element (D-314 needs its `scrollTop`).

**Design docs amended.** `06` §3.3: back from a Chronicle-opened run returns to the Chronicle (the
operator's decision, proposed as a new D-xxx). `06` §1.5: *"there is no swipe-down"* contradicted
D-314 and the orchestrator's instruction. It now says both over-parent surfaces take D-314's
touch-only swipe below 1024px, never as the only way out. `docs/INDEX.md` is not regenerated (the
orchestrator owns it). The 06 line ranges after §1.5 shift by +2, and after §3.3 by +4 more.

**Not built (out of scope, see report):** the lifetime totals §1.4/§2.5 put at the Chronicle's top.
They belong to `0090`'s feed, and no criterion here asks for them.

Files: `app/(home)/layout.tsx` (was `app/page.tsx`), `app/(home)/page.tsx`,
`app/(home)/chronicle/page.tsx` (was `app/chronicle/page.tsx`), `app/(home)/layout.test.tsx` (was
`app/page.test.tsx`), deleted `app/chronicle/chronicle-links.tsx` and `app/chronicle/seed-home.tsx`,
`app/api/runs/chronicle/route.ts` and its test, `components/chronicle/chronicle-panel.tsx`,
`components/chronicle/chronicle-rows.tsx`, `components/chronicle/chronicle-panel.test.tsx`,
`components/plinth/home-screen.tsx`, `lib/chronicle/{rows,window,return,transport}.ts`, tests for
rows and return, `lib/runs/server.ts`, `lib/runs/wire.ts`, `lib/runs/run-page.test.ts`,
`lib/run-moment/seen.test.ts`, `app/routes.test.ts`, `app/new-workout-type.test.tsx`,
`components/plinth/plinth.test.tsx`, `docs/06-ui-ux.md`.

**Decisions recorded at merge (orchestrator):** D-321 (back to the Chronicle), D-322 (`(home)` route group), D-323 (paged endpoint and cursor), D-324 (gold mark on the latest unseen run only, operator), D-329 (no lifetime totals in the Chronicle, operator). The proposed "lifetime totals at the Chronicle's top" ticket was declined by D-329. The run page's `←` bug is `0274`.
