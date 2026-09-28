---
id: 86
slug: the-plinth-over-the-map
title: The plinth over the map — Total Level, cells revealed, last run, three destinations
type: feature
priority: high
status: open
size: m
capability: 13-home-plinth-and-chronicle
depends_on: [53, 65]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
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

- [ ] `/` renders a full-bleed map with the plinth over it and no other UI.
- [ ] Total Level and lifetime cells are both fully visible with **zero** scrolling and zero clicks in
      the desktop browser at a typical window size, and still not broken at a narrow window.
- [ ] On a first-ever load (no stored camera) the map opens on the bounding-box centre of the
      most recent traced run at z14 (D-249; precedence stored camera → latest run → configured
      home → extract bounds, as `0186` shipped it), not on device location and not fitted to the
      whole territory. A stored camera always wins on reload.
- [ ] The milestone bar shows a named numeric target (`next: 300`), never a bare percentage.
- [ ] Clicking the last-run line navigates to `/run/:activityId` for that run.
- [ ] ~~The three destination buttons are ≥56dp tall and all three centres fall inside the §9.2
      one-handed thumb arc;~~ *(D-251, 0215)* Add workout is the widest and is centred (subject to
      `0187`'s desktop layout).
- [ ] A repository test asserts the home route renders **no** element whose content matches
      streak / today / this week / days since / goal / check-in, and no badge or dot component.
- [ ] There is no "log a run" or per-exercise control anywhere on `/`.
- [ ] With no interaction for ten minutes the screen is byte-identical to how it started: no
      polling-driven prompt, no modal, no toast.
- [ ] Floating chrome is opaque and gold appears only as fill or rule, never as body text (D-148).

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
