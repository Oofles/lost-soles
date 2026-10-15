---
id: 86
slug: the-plinth-over-the-map
title: The plinth over the map — Total Level, cells revealed, last run, three destinations
type: feature
priority: high
status: open
size: m
capability: 13-home-plinth-and-chronicle
depends_on: [53, 65, 187]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
started: 2026-10-15T16:40:48Z
---

## Description

The home screen is a fullscreen map plus one card at the bottom: **the plinth**. That is the whole
home screen (`06-ui-ux.md` §2.1, §2.2). *(Where the plinth sits on a wide desktop viewport follows
`0187`'s desktop pass over `06` §2 — D-251, 0215.)*

**D-013 is the specification.** The home screen demands **nothing**. No check-in, no streak, no
ring, no goal, no "days since", no chore, no nag. Open it after three weeks away and it is exactly
as pleased to see you as it was yesterday. Progress is visible at a glance and there is nothing to
maintain. This is the decision the user abandoned Habitica over; the home screen is where it is
either honoured or quietly broken.

It must satisfy three things at once:

1. **P4** — the map is the first thing you see. Not a summary of the map. The map.
2. **P5** — two seconds tells you whether you are further along than last time. That needs exactly
   two things present without scrolling or clicking: **the shape of your territory** and **Total
   Level**.
3. **D-013 / H2** — nothing on it may ask you for anything.

```
│  TOTAL LEVEL   271        12,480 cells   │  ← the two glance numbers
│  ▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░  next: 300          │
│  Last: Thu · 8.4 km · 21 new cells       │  ← click → /run/:id
│  ┌────────┐  ┌──────────────┐  ┌───────┐ │
│  │ SKILLS │  │ + ADD WORKOUT│  │ RUNS  │ │  ← ~~56dp tall, thumb arc~~ *(D-251, 0215)*
```

**What earns its space** (§2.3): the map full bleed, opening framed on ~~the **end point of your last
run**~~ **your most recent run** (D-249: its bounding-box centre) at z14 — not on your home, not on your whole territory, because the interesting thing is the
edge you most recently pushed and the fog just beyond it. Total Level as the headline, in the
largest type in the app outside the level-up card, because it moves ~6× faster than any single skill
and keeps mid-game weeks from feeling empty. Lifetime cells revealed, the numeric twin of the map's
shape. A progress bar toward the next Total Level milestone with a **named target** — a bare
percentage reads as nothing. The last run as one clickable line, which is the door into `/run/:id`
and answers the single most common reason to open this app: *did my run land?* Three destinations,
with Add workout centre and widest because it is the only *action* on the screen (D-061).

**What does not earn its space, and must not be added later:** this week's or today's numbers (P5 —
transient, and one step from a weekly goal, which is N2); any per-exercise button (D-061 exists to
keep these off); a "log a run" affordance (ingestion is automatic — a manual entry advertises that
the automation is not trusted); streak, calendar, ring, goal, "days since" (H2, absolutely); a nag
when nothing has synced; a notification dot.

Chrome: mode toggle top-**left** (D-052, persists), settings gear top-right, recentre control above
the plinth on the right edge, with a separate small fit-to-territory control next to `⌖` (D-253;
both belong to `0101`). A handle on the plinth (click or drag) opens the Chronicle (0088). ~~Per
D-124 the target is a large Android phone and per §9.2 the three buttons must sit in the one-handed
thumb arc;~~ *(D-251, 0215)* per D-148 all floating chrome is opaque.

## Acceptance criteria

- [x] `/` renders a full-bleed map with the plinth over it and no other UI.
- [x] Total Level and lifetime cells are both fully visible with **zero** scrolling and zero clicks in
      the desktop browser at a typical window size, and still not broken at a narrow window.
- [x] On a first-ever load (no stored camera) the map opens on the bounding-box centre of the
      most recent traced run at z14 (D-249; precedence stored camera → latest run → configured
      home → extract bounds, as `0186` shipped it), not on device location and not fitted to the
      whole territory. A stored camera always wins on reload.
- [x] The milestone bar shows a named numeric target (`next: 300`), never a bare percentage.
- [x] Clicking the last-run line navigates to `/run/:activityId` for that run.
- [x] ~~The three destination buttons are ≥56dp tall and all three centres fall inside the §9.2
      one-handed thumb arc;~~ *(D-251, 0215)* Add workout is the widest and is centred (subject to
      `0187`'s desktop layout).
- [x] A repository test asserts the home route renders **no** element whose content matches
      streak / today / this week / days since / goal / check-in, and no badge or dot component.
- [x] There is no "log a run" or per-exercise control anywhere on `/`.
- [x] With no interaction for ten minutes the screen is byte-identical to how it started: no
      polling-driven prompt, no modal, no toast.
- [x] Floating chrome is opaque and gold appears only as fill or rule, never as body text (D-148).

## Notes

Depends on 0053 (the MapLibre shell as the home route) and 0065 (Total Level / Total XP). The plinth
reads the derived stats feed built in 0090; until that ships, read the two glance numbers directly and
swap the source, not the layout.

The handle opens the Chronicle (0088) and the new-run line's states are 0087 — this ticket owns
the layout, the two glance numbers and the three destinations, and stubs the rest.

Every item in the "does not earn its space" list has been proposed by somebody, in some fitness app,
for a good-sounding reason. `06-ui-ux.md` §2.3 and D-013 are the standing answer. If one is proposed
again, it needs a decision record, not a commit (07 §1.2: never expand a ticket's scope).

**2026-09-28 — opening-camera criterion amended (08 drift audit, D-249).** This ticket originally
required the map to open "framed on the end point of the most recent activity at z14". Ticket `0186`
shipped the initial camera during capability `08` as the most recent run's **bounding-box centre**
(`lib/map-camera.ts` `runCamera` / `firstLoadRunCamera`), behind a stored camera, and D-249 records
that as the design. That behaviour already exists; this ticket must not re-implement or replace it.
The `⌖` recentre-on-end-point control is unchanged and belongs to `0101`.

- **Amended by D-313 (0187, 2026-10-15).** The plinth is a fixed left rail at ≥1024px beside the map pane, not a card at the bottom; `RUNS` is the only way into the Chronicle (no handle); `⌖` and the other map controls sit on the map pane's right edge above the attribution; the interim Sync is a text line in the rail. `06` §2.1–§2.2 is the specification; where this ticket's wording disagrees, §2 wins.

## Operator validation

In the desktop browser: open the app and start a two-second timer. Before it
ends, can you say whether you are further along than the last time you looked? That is P5 and it is
the only test that matters here.

~~Then reach for each of the three buttons with your thumb without shifting your grip — all three must
be comfortable, not merely possible. Do this with slightly damp hands after a run (§9.3), because
that is when the screen is actually used.~~ *(D-251, 0215)*

Finally, the D-013 test, which takes patience: leave the app alone for two weeks, then open it. It
must greet you with exactly what it greeted you with before — no catch-up prompt, no "welcome back",
no gap in the bar, nothing that implies you owe it anything. If anything on the screen makes you feel
behind, the ticket is not done.

**Done 2026-10-15 (operator, desktop browser, soles.devaultsecurity.com).** P5's two-second test
passes: Total Level and cells read as the headline. The rail and the map read as one screen. The gold
underline on + ADD WORKOUT and the gold bar are enough emphasis without competing with the map. The
last-run line fits on one line, and `Sync now` reads as quiet. The operator: *"All 4 checks look great
and I love the side bar!"*

**The two-week D-013 test was not run as written.** Waiting two weeks is constructing a scenario (D-229).
Its substance is held by `components/plinth/plinth.test.tsx`'s refusal tests: no streak, no "days
since", no catch-up or welcome-back copy, no relative age (D-316), and nothing scheduled over 10
minutes (`lib/plinth/load.test.ts`).

**Agent smoke test, after Amplify job 401 built `ae569ad` (SUCCEED).** On both hosts, `/` returns 200 and
signed-out `/api/runs/latest` returns 404. A signed-out visitor sees none of the plinth's strings.

**Follow-up from the operator:** a quick-view list of every skill's level and XP bar in the rail's
empty lower space. Filed separately, not widened into this ticket (D-152).

## Resolution

**What shipped.** `/` is now `HomeScreen`: the plinth, the `⚙` link and the map pane, and nothing
else. At ≥1024px the plinth is D-313's fixed, opaque, 24rem rail down the left edge with a 1px
`--line` rule on its right, and the map's container starts where the rail ends. Below 1024px the
same content stacks as an opaque bottom card, capped at 55% of the height (D-251: it must not
break; nothing more). The rows run top-down in §2.2's order: Total Level (Spectral 600 28px, the
largest type on `/`) with lifetime cells on the same baseline; the milestone bar with a named
target; the last-run line (one link); then SKILLS · + ADD WORKOUT · RUNS (`1fr 1.5fr 1fr`, 40px,
RUNS → `/chronicle`); then the interim `Sync now` caption line.

**Files.**
- `components/plinth/home-screen.tsx` (new, client): reads the three inputs and renders the
  plinth, the gear and `MapShell`. DOM order is §2.2's focus order.
- `components/plinth/plinth.tsx` (new): pure presentation of the model, plus `PLINTH_CSS`, the
  one stylesheet (an inline style cannot hold the 1024px media query). It positions the rail,
  the card, the destinations, the gear and the map pane (`.home-pane`).
- `lib/plinth/model.ts` (new): `plinthModel`, `milestoneTarget` and `lastRunLine`. These are
  pure functions, so no component decides a number or a sentence.
- `lib/plinth/load.ts` (new): `loadStanding`. It is `/skills`' loader without the ledger read:
  cache first (the same `skills:<uid>` key `/skills` and `/log` use), then the replay gate, then
  `SkillState.list`, written back to the cache. A fresh browser with no cache waits for the
  network instead of drawing every skill at level 1. Nothing runs on a timer except the replay
  gate's existing poll, which fires only while a replay is running.
- `components/map/map-shell.tsx`: two optional home-only props. `paneClassName` replaces the
  full-window inline `shell` style with the pane class. `onLatestRun` hands `useLatestRun`'s
  collection up to the plinth.
- `lib/runs/wire.ts`, `lib/runs/server.ts`: `/api/runs/latest`'s feature properties also carry
  `startedAtLocal`, `distanceM` and `newCellCount`. The `byUserAndStart` index projects ALL, so
  this costs no extra read.
- `components/add-workout-link.tsx`: now the plinth's centre destination (`.plinth-dest
  plinth-dest-primary`). The `+` is `aria-hidden`.
- `components/sync-button.tsx`: restyled as a caption-size text button labelled `Sync now`: ink
  text with a gold underline, so gold is a rule here (D-148). The pending state and the
  `aria-live` result line are unchanged; the in-flight indication is still `0087`'s.
- `app/page.tsx`: renders `<HomeScreen home={home} />` inside the provider. The bare Add workout
  and Sync pair that sat over the map is gone.
- Tests: `components/plinth/plinth.test.tsx` (new; criteria 1, 5–8 and 10, plus the
  ten-minute/no-clock half of 9), `lib/plinth/model.test.ts` and `lib/plinth/load.test.ts` (new),
  and an added case in `lib/runs/server.test.ts`. `app/page.test.tsx` now inspects
  `HomeScreen`'s props as the signed-out payload. It still asserts `{ home: null }` and no
  coordinate, so 0186's privacy check is unchanged. `components/add-workout-link.test.tsx` now
  reads the plinth instead of `app/page.tsx`.

**Decisions made, and why.**
- **The last-run line comes from the fetch the first camera already makes.** `/api/runs/latest`
  is the latest *traced* activity. Reading the line from the same feature means the line, the
  D-249 first camera and `⌖` (`0101`) always name the same run. `/` also gains no second query
  path for activity data, and `app/page.test.tsx` still forbids any server-side read (0186). The
  catch: a strength log newer than the last run does not take over the line. That fits "Last
  *run*" and §4.5's "the last run is the selected run".
- **Total Level is `skillsPanel()`'s sum over the same cache key**, not `Profile.totalLevel`.
  The plinth and the `/skills` header therefore cannot disagree (`lib/skills/panel.ts` already
  promises that). `0090` changes the source, not the shape.
- **Lifetime cells is the explored set's size** (r11, the same cells `newCellCount` counts). It
  is cached in IndexedDB, so it is there before any network call.
- **Line wording: `Last: Fri 28 Aug · 8.40 km · 21 new`.** This follows §2.2's `21 new`. I added
  the day of the month to the weekday because "Thu" alone is ambiguous after a week away, and a
  relative age ("3 weeks ago") would be a "days since" (H2). The distance uses `runDistance`, the
  run page's own format. Parts the run lacks are left out, and a run with no new cells says
  nothing about it.
- **Below 1024px the card sits 36px off the bottom, not 16px.** §2.2 says 16px insets, and it
  also says nothing may cover MapLibre's attribution (row 10, `0052`). At the window's bottom
  edge the two collide, and the attribution is the licence requirement.
- **The `⚙` link is built here** (top-right of the map pane, 40 × 40px, opaque). The ticket's
  chrome paragraph lists it, `0089` assumes it exists ("reachable from the home gear"), and no
  other ticket builds it. The mode toggle (`0098`) and `⌖`/fit (`0101`) are not built here.
- **The first camera is untouched.** `firstLoadRunCamera`/`runCamera` (`0186`, D-249) is
  unchanged and covered by `lib/map-camera.test.ts`. The pane takes no `padding`, because
  MapLibre's container *is* the pane (§2.2).
- **Last-run states are not built here.** The new-run line, "Connect Strava to begin" and
  reconnect are `0087`'s. When there is no traced run, row 7 keeps its height and stays empty,
  so the buttons never move. The Chronicle panel is `0088`'s; RUNS only links to `/chronicle`.

**Checked by rendering.** I rendered the plinth with a populated model, `tokens.css` and a
stand-in map pane to static HTML. Headless Chromium screenshots at 1440 × 900 (the rail) and
800 × 900 (the card) show both glance numbers, the bar and its target, the line and all three
buttons with no scrolling. The fonts were system fallbacks, not Inter and Spectral, which is the
wider case.

