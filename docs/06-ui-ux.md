# 06 — UI / UX

**Status:** design proposal, ready to build from.
**Last updated:** 2026-10-15 — desktop-first pass over the IA (ticket `0187`, D-313)
**Answers to:** `00-vision.md` (principles) and `decisions/DECISIONS.md` (settled facts).
**Companions:** `04-game-design.md` (§4.2 is the seed of §3 here), `05-fog-of-war.md`
(§4–§5 are the rendering contract §4 here dresses). §7 is superseded (D-252).

Binding constraints this document is written under, restated so no reader has to go looking:

- **D-050** — dark fantasy: ink, parchment, lantern-light, gold leaf, deep navy.
- **D-051** — the map stays a genuinely legible street map. **Atmosphere never costs legibility.**
- **D-052 / D-133** — two modes, atlas and adventure; cold territory shows in atlas **only**.
- **D-053** — parchment basemap, dark fog. Not dark-on-dark. *(The parchment ground is superseded
  by **D-373**: the basemap is stock Protomaps `light`. Light ground, dark fog, still never
  dark-on-dark. The app chrome keeps its parchment ramps.)*
- **D-061 / D-062** — one "Add workout" button → one dedicated page → one row per type, one click.
- **D-013 / P3** — zero upkeep. Nothing in this UI may ask for maintenance.
- **D-227 / D-251** — **the desktop browser is the only surface this app is designed for**, for
  viewing and for input alike. The watch or phone records the run, and the run arrives through an
  adapter; that is the source device, not a screen this document draws.
- **D-253** — the map is driven by **mouse and keyboard**. No long-press, no gesture-only path.
- **D-252** — there is no in-app ticket UI. §7 is kept as a record and marked superseded.
- **D-122** — MVP scope. No combat, no route planner, no loot. Do not draw them.

> **The one-line brief for every screen in this document:** the app is a place you go *after*
> the run to see what happened (P2), and the thing you are there to see is the map (P4).
> Everything else is chrome around that, and chrome is a maintenance cost.

### The surface, stated once (D-227, D-251, D-313)

- **The design case is a desktop browser window**, roughly 1280–1600px wide and 800–1000px
  tall, driven by mouse, trackpad and keyboard. Every wireframe in §1–§6 is drawn for it.
- **Narrow widths must not break, and nothing is optimised for them.** Ordinary responsive CSS:
  no horizontal page scroll, nothing clipped, nothing unreachable, down to ~360px. There is no
  phone layout, no thumb arc and no sunlight case, and one touch gesture only: below 1024px a
  finger swipe-down dismisses a sheet, never the only way out *(D-314)*. Where an older sentence
  survives in §3, §5 or §6 saying "tap", read it as *click or activate*.
- **Units.** Sizes written `dp`/`sp` in older sections mean CSS px at 100% zoom (`sp` scales
  with the browser's text size). New text uses `px`.
- **Operator validation convention.** A ticket's `## Operator validation` is performed in the
  **desktop browser**, and only for perception (D-229). **The phone is never a validation
  surface**: its only role in this project is recording runs, and a check that needs one is
  either faked through the manual adapter or a replayed activity, or it is not a check.

---

## Contents

1. [Information architecture](#1-information-architecture)
2. [The home screen](#2-the-home-screen)
3. [The post-run moment](#3-the-post-run-moment--return-from-the-fog)
4. [The map screen](#4-the-map-screen)
5. [The skills panel](#5-the-skills-panel)
6. [Add workout](#6-add-workout-d-061)
7. [Ticket capture UI](#7-ticket-capture-ui-d-092)
8. [Visual system](#8-visual-system)
9. [Accessibility and reality checks](#9-accessibility-and-reality-checks)
10. [What we are deliberately not building](#10-what-we-are-deliberately-not-building)

---

## 1. Information architecture

### 1.1 The rule that shapes it

Every screen is a thing that must be styled, kept responsive, kept accessible, kept working
when the data model changes, and kept in your head. **P9 says build for one user and do not
pay the tax of many; the equivalent here is build seven screens and do not pay the tax of
twenty.** The test each screen has to pass is not "would this be nice" but *"what breaks if
this does not exist, and where would its content otherwise live?"*

The second shaping rule comes from **P4**: the map is the product, and the vision explicitly
rules out "any home screen where the map is not the first thing you see." So the home screen
**is** the map. That single collapse removes the most common screen in this app category —
the dashboard — and it removes it correctly, because a dashboard is a screen whose entire job
is to link to other screens.

### 1.2 The screen map

```
                          ┌───────────────────────────────┐
   cold start ──────────► │  /  ·  MAP + PLINTH  (home)   │ ◄──── back from everywhere
                          │  the map is the home screen   │
                          └───┬───────┬────────┬──────────┘
                              │       │        │
            ┌─────────────────┘       │        └──────────────────┐
            │                         │                           │
            ▼                         ▼                           ▼
  ┌───────────────────┐   ┌──────────────────────┐   ┌──────────────────────┐
  │ /skills           │   │ /log                 │   │ /chronicle           │
  │ SKILLS PANEL      │   │ ADD WORKOUT  (D-061) │   │ CHRONICLE (run list) │
  │ ├ dialog: /skills/│   │ one row per type     │   │ panel over the map,  │
  │ │   :skillId      │   │ one click to log     │   │ in the rail's column │
  │ │ also from the / │   │                      │   │                      │
  │ │ quick-view, back│   │                      │   │                      │
  │ │ to /  (D-330)   │   │                      │   │                      │
  └───────────────────┘   └──────────┬───────────┘   └──────────┬───────────┘
                                     │                          │
                                     └───────────┬──────────────┘
                                                 ▼
                                   ┌──────────────────────────────┐
                                   │ /run/:activityId             │
                                   │ THE POST-RUN MOMENT (§3)     │
                                   │ auto-plays on new import;    │
                                   │ replays on demand            │
                                   └──────────────────────────────┘

   ── owner-only, off the main path ───────────────────────────────────────────
  ┌──────────────────────┐   ┌──────────────────────┐
  │ /settings            │   │ /dev/tickets         │
  │ small, boring        │   │ WITHDRAWN (D-252):   │
  │ reached from the ⚙   │   │ a stub until `0216`  │
  └──────────────────────┘   └──────────────────────┘
```

Seven routes. Two of them (`/chronicle`, the skill detail) render **over** their parent — the
Chronicle as a panel beside the live map, the skill detail as a dialog over the panel — and
exist as routes only so the browser's back button and deep links behave. The skill detail has a
second way in: a row of the plinth's quick-view opens it straight from `/`, and dismissing it goes
back to `/`, not to `/skills` *(D-330)*. Accepted cost: the sheet is still the `/skills/:skillId`
route, so the map unmounts while it is open and the `/skills` panel is drawn behind the dialog; a
deep link or a reload lands on `/skills` as before. `/dev/tickets` lost its
UI to D-252; the route survives as a stub, and its removal (with `app/routes.test.ts`'s count)
is ticket `0216`, not this document.

### 1.3 Justification, screen by screen

| Route | Why it exists | What breaks without it | Cut later? |
|---|---|---|---|
| `/` map + plinth | P4 (map is the product) + P5 (progress in a glance). It is home, map, and dashboard in one surface. | Everything. | Never |
| `/run/:id` | P2's consequence: "the post-run reveal is the single most important moment in the product. That is where the budget goes." | The reward loop. The app becomes a scorecard. | Never |
| `/skills` | Constraint R1 — every session must move a *named* number, and the user must be able to go look at those names. Runescape's skills panel is the explicitly-loved reference. | Levels exist but are unreadable; the "9 runs to 48" plan (04 §4.1) has no home. | Never |
| `/log` | D-061, verbatim: an Add workout **button**, not per-exercise buttons, opening a **dedicated page**. | Strength work is unloggable (D-060: no API on earth exposes reps). | Never |
| `/chronicle` | The only way back to a past run's `/run/:id`. It carries no lifetime totals (D-329): those live on the plinth. A panel over the map, not a page — it is a list, and a list does not deserve a screen of its own. | Past runs are unreachable; the reveal is a one-shot you can never look at again. | No, but keep it thin |
| `/dev/tickets` | ~~D-090 + D-092, phone-friendly capture.~~ **Withdrawn by D-252:** at the desk the repo, `tickets.mjs` and the agent are already open. | Nothing. | Yes — `0216` |
| `/settings` | Connect, reconnect or disconnect each source, named by its connector's display name, never a hard-coded "Strava" *(D-100)* — reconnecting is the one recurring chore S3 permits. Sign out, the account-deletion entry point, a build line. ~~reduced-motion/battery, units~~ — *amended by ticket `0089`: no preference control of any kind; reduced motion follows the OS, units follow the locale (D-013).* | Re-auth has nowhere to happen and the app dies silently when the token expires. | Never, but keep it under one screenful |

### 1.4 Screens deliberately refused

- **A stats/dashboard page.** P5 rules out "progress that only exists inside a stats page."
  Lifetime totals live at the top of the Chronicle sheet, where you are already looking at your
  history. A separate analytics screen is a screen whose job is to be impressive rather than
  useful, and it invites N4 (competing with your past self).
- **A profile page.** There is one user (P9). A profile is a social-network organ; N1.
- **An achievements/badge gallery.** Milestones (04 §4.3) are *placed on the map* as landmarks
  and shrines wherever they can be — "every milestone that can be a landmark should be a
  landmark." A gallery is a list you must go hunt through, which P5 explicitly rules out.
- **A calendar / heatmap grid.** It is a streak visualisation wearing a disguise, and streaks
  are H2's exact prohibition. A grid with holes in it is a picture of your failures.
- **An onboarding flow.** P9 permits skipping it. First run: connect Strava, backfill, watch
  the biggest reveal you will ever see. That *is* the onboarding.
- **A notifications inbox — or any notification at all.** P3's corollary once permitted one push
  ("your run is on the map"); D-253 dropped it. The plinth's new-run line reports a landed run
  the next time the app is opened (§2.4), and anything more is the nagging D-013 refuses. A
  notification that accumulates into a list you must clear is a chore.

### 1.5 Navigation model

**No nav bar, no sidebar of links, no tab strip.** Any of them permanently spends a strip of a
map-first screen on links, and implies peer sections — which these are not. The map is the
trunk; everything else is a destination you visit and leave.

Instead: **the plinth** (§2), a fixed opaque rail on the left of the window, with the map
filling the rest. It carries the glanceable state *and* the three destinations — it is not a
column of links. Everything else is reached from
inside those, or from the `⚙` at top-right.

- **The browser's back always returns toward `/`.** From `/`, back leaves the app like any page.
- **Things that open over a parent** — the Chronicle panel and the skill-detail dialog — are
  routes, so back dismisses them. Every one also closes on **Esc** and on a visible **close
  control**, and the dialog additionally on a click on its scrim. No dismissal is gesture-only.
  ~~and there is no swipe-down~~ Below 1024px, where each is a bottom sheet, both also take
  D-314's touch swipe-down (`lib/sheet/swipe-dismiss.ts`) — a finger only, never a mouse, and
  never the only way out *(ticket `0088`, reconciling this line with D-314)*.
- **Deep links land where they point.** A pasted `/run/:id` or `/chronicle` renders `/`
  underneath, so back goes to `/`, not to a stack of nothing. (The push notification that used
  to be the main deep link is gone — D-253, §1.4.)
- **At ≥1024px the plinth is the rail** (§2.2, D-313 — §4.8's old one-line sketch, promoted
  to the main specification). Below 1024px its content stacks as a card over the map, the
  simplest arrangement that does not break (D-251). Same routes, same content, either way.

---

## 2. The home screen

### 2.1 What it is

**The plinth**, a fixed opaque rail down the left edge of the window, and **the map**, full
bleed across everything to the right of it. That is the whole home screen.

It must satisfy three things simultaneously:

1. **P4** — the map is the first thing you see. Not a summary of the map. The map.
2. **P5** — two seconds tells you whether you are further along than last time. That requires
   exactly two things to be present without scrolling or clicking: **the shape of your
   territory** and **Total Level**.
3. **D-013 / H2** — nothing on it may ask you for anything. Open it after three weeks away and
   it is exactly as pleased to see you.

**A rail, chosen over a floating card** (D-313, operator 2026-10-15). This section used to
inherit a phone layout (a bottom card in the thumb arc) with a one-line desktop adaptation in
§4.8: "the plinth becomes a fixed left rail at ≥1024px". The rail is now the main specification.
The alternative considered was the same content as an opaque card floating over the bottom-left
corner of a map that fills the whole window. The operator chose the rail. **The costs accepted
with it**, recorded so they are known rather than rediscovered:

- the map is a pane beside a column rather than the whole window — closer to the app-frame shape
  §1.1 removed, and P4's "full bleed" now means *full bleed within the pane*;
- below 1024px a second arrangement is needed (§2.2's last paragraph), so there are two layouts
  to keep working, not one (P9);
- the Chronicle must share the rail's column with the plinth (§2.5).

What the rail buys: the map is never occluded, the glance numbers sit where a reading eye
starts, and the plinth's position is fixed at every desktop size.

### 2.2 Wireframe — the design case, a ~1440 × 900 window

```
┌────────────────────────────────────┬─────────────────────────────────────────────┐
│ TOTAL LEVEL  271      12,480 cells │ ┌────────────┐                       ┌────┐ │
│ [4]                                │ │▓  ATLAS   ▓│ [1]              [2]  │ ⚙  │ │
│ ▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░  next: 300  │ │ ADVENTURE  │                       └────┘ │
│ [5]                                │ └────────────┘                              │
│                                    │                                             │
│ Last: Fri 28 Aug · 8.40 km · 21 new│                                             │
│ [7]  (D-316)                     › │               THE MAP PANE                  │
│ ────────────────────────────────── │     light map + dark fog (D-373);           │
│ ┌───────┐ ┌──────────────┐ ┌─────┐ │     first-ever load framed on the           │
│ │SKILLS │ │ + ADD WORKOUT│ │RUNS │ │     latest run's bbox centre, z14           │
│ └───────┘ └──────────────┘ └─────┘ │     (D-249), in the PANE's centre           │
│ [9]                                │                                             │
│ Sync now  (interim, until cap 14)  │                                             │
│ Strava needs reconnecting    [12]  │                                      ┌────┐ │
│ ────────────────────────────────── │                                 [6]  │ ⤢  │ │
│ ACTIVITY                      [11] │                                      └────┘ │
│ ◇ Wayfaring   ▓▓▓▓▓▓▓▓░░░░░░░░  42 │                                      ┌────┐ │
│ ◇ Might       ▓▓▓░░░░░░░░░░░░░  17 │                                 [8]  │ ⌖  │ │
│ META                               │                                      └────┘ │
│ ◇ Cartography ▓▓▓▓▓░░░░░░░░░░░  31 │                                             │
│ [3]                                │                    © Protomaps · © OSM [10] │
└────────────────────────────────────┴─────────────────────────────────────────────┘
```

| # | Element | Position and size | Notes |
|---|---|---|---|
| 1 | **Mode toggle** | Top-left **of the map pane**, 16px insets | Two-row segmented control, both labels always visible (§4.2). Click either row, or press `M` (D-253). Persists. |
| 2 | **Settings** `⚙` | Top-right of the map pane, 16px insets, 40 × 40px | The door to `/settings` (the §2.4 reconnect line is the other, and appears only when needed). |
| 3 | **The plinth — the rail** | At ≥1024px: fixed, full window height, left edge, **24rem wide** | Opaque `--surface-raised` (D-148), a 1px `--line` rule on its right edge, no shadow, no radius. 16px padding. Content sits at the top, in rows 4, 5, 7, 9, the interim Sync line, 12 and 11 in exactly that order; the space below row 11 stays empty rail. Only row 11 gives way when the window is short: it scrolls inside itself, so rows 4–9 never scroll away. The rail scrolls internally if rows 4–9 alone outgrow the window height. |
| 4 | **The two glance numbers** | First row | `TOTAL LEVEL` label + the number in the §8.4 Total Level style (the largest type on `/`), left; lifetime cells revealed, right-aligned on the same baseline. Not links. |
| 5 | **Milestone bar** | Second row, full rail width less padding | Named target (`next: 300`), never a bare percentage (§2.3). At the level ceiling the target is the ceiling itself, written `of 2,277` — the `/skills` header's wording, computed from the ruleset, never a literal. |
| 6 | **Fit to territory** | Right edge of the map pane, above ⌖, 40 × 40px, 8px gap | Frames the whole explored set. A separate control, not a long-press (D-253); `0101`'s. |
| 7 | **Last run** | Third row, one line | One link: the whole line is the hit area, `›` at its end. Click → `/run/:id` end state. Text: `Last: Fri 28 Aug · 8.40 km · 21 new` — the latest traced run, the date from its own wall clock, missing parts omitted *(D-316)*. This line also carries the §2.4 new-run state, and only that one; reconnect is row 12 *(D-337)*. |
| 8 | **Recentre** `⌖` | Right edge of the map pane, 40 × 40px, its bottom 16px above the attribution | Recentres on the last run's end point at z14 (§4.4); `0101`'s. |
| 9 | **Three destinations** | Fourth row, below a `--line` rule | `SKILLS` · `+ ADD WORKOUT` · `RUNS` in one row, all 40px tall, 8px apart, columns `1fr 1.5fr 1fr` so Add workout is centred and widest (D-061). `RUNS` → `/chronicle`. |
| 10 | **Attribution** | Bottom-right **of the map pane**, MapLibre's own control, uncompacted | A licence requirement (`0052`). Nothing may cover it. |
| 11 | **Skills quick-view** | Fifth row, below the Sync line, the reconnect line when present, and a `--line` rule; ≥1024px only | `0270`. A glance, not a second skills panel: one 32px row per TRAINED skill — sigil, name, a 3px bar to the next level in `/skills`' fills, the level; no XP. `ACTIVITY` then `META` headings, registry order; an untrained skill has no row and an empty group no heading. Each row links to `/skills/<id>`'s sheet, which dismisses back to `/`. Below 1024px it is omitted: the bottom card only must not break (D-251). |
| 12 | **Reconnect line** | Own caption-size line directly below the Sync line; present only when a token is broken | `<source> needs reconnecting`, named by the connector's display name, one ink link to `/settings` *(D-337, D-318)*. The only failure `/` ever shows. Replacing row 7 would hide the last run, which §2.3 says the plinth still shows. |
| 13 | **Jump to a region** | Right edge of the map pane, directly under `⚙`, 40 × 40px, 8px gap | `0285`. Closed by default; opens a short list under itself of the regions the operator has run in — runs whose starts chain within 50 km, most recently run first — each labelled with the most prominent place the basemap names inside it (D-302), else its coordinate area. Choosing one frames that region's ground; the mode is untouched, and the stored camera follows (D-249). Arrows, Enter and Esc in the list (D-253). Absent entirely with fewer than two regions. |

**All map chrome lives on the map pane** — the toggle, `⚙`, jump-to, fit, `⌖` and the attribution are
positioned against the pane, never against the window, so none of them ever sits under the rail.

**No drag handle** (D-313). The phone wireframe carried a `▁▁▁` handle on the plinth that a
thumb dragged up into the Chronicle. With a pointer it is a second, smaller door to the place
`RUNS` already opens. `RUNS` is the door to the Chronicle.

**Interim, until capability `14` automates ingest:** the manual Sync control (`09` §2.3 — the
one thing D-013 is knowingly violated for) moves *into* the rail as a quiet caption-size text
button on its own line below the three destinations, and capability `14` deletes that line with
no other layout change. It is never a fourth destination button. Beneath the button sits a
reserved `aria-live` status line, one caption tall whether or not it has text, so nothing jumps:
`Checking for new activities…` while the press is in flight (the button itself reads `Syncing…`),
then D-318's result sentence — `N activities queued.` — or nothing at all.

**The camera is not offset for the rail.** The map is a pane beside the rail, not a surface
under it: MapLibre's container *is* the pane, so the first-load framing (D-249) centres the
latest run in the visible map with no `padding` at all. The pane is narrower than the window,
not occluded by anything.

**Focus and keyboard order** follows reading order, left to right: the last-run line →
`SKILLS` → `+ ADD WORKOUT` → `RUNS` → (interim Sync) → the reconnect line when present (D-337) → the quick-view's rows (`0270`) → mode toggle → `⚙` → jump-to (`0285`) → the map (arrow keys
and `+`/`−` act on it while it holds focus, D-253) → fit → `⌖`. `M` toggles the mode from
anywhere on `/` except while a text field has focus. Every focusable element shows the §9.4
focus ring.

**Below 1024px** (the "must not break" case, D-251; nothing here is designed beyond that). The
rail goes away and its content stacks, unchanged and in the same order, as an opaque card over
the bottom of a map that now fills the window: 16px side insets, its bottom edge clear of the
MapLibre attribution (36px; D-315), full width less 32px, 8px radius,
capped at 55% of the window height and scrolling beyond. The right-edge map controls sit 16px
above that card.

**The plinth belongs to `/` only.** `/run/:id` is §3's, and its ledger owns the bottom of the
window there.

### 2.3 What earns its space, and what does not

**Earns it:**

- **The map, full bleed** — across the whole pane beside the rail (§2.1). Non-negotiable (P4). It opens framed on ~~the *end point of your last
  run*~~ **your last run**, not on your home, and not on your whole territory — because the
  interesting thing is the edge you most recently pushed, and the fog just beyond it. Zoom
  defaults to z14, where a neighbourhood's worth of frontier is visible.
  **Amended by D-249 (08 audit, 2026-09-28):** the initial camera on a first-ever load (nothing
  stored) is the **bounding-box centre of the most recent traced run** at z14, not its end point
  (ticket `0186`, `lib/map-camera.ts` `runCamera`). Precedence is stored camera → latest run →
  configured home → extract bounds (`firstLoadRunCamera`); a stored camera always wins on reload,
  so this framing applies once. The `⌖` control (§4.4) still recentres on the last run's end point.
- **Total Level, as the headline.** 04 §1.2 is explicit: "Total Level is the headline number on
  the home screen, not any individual skill," because it moves ~6× faster than any one skill
  and keeps mid-game weeks from feeling empty. Set in the largest type in the app outside the
  level-up card.
- **Cells revealed, lifetime.** The other guaranteed-non-zero number (04 §4.1), and the one
  most directly tied to D-012 (novelty). It is the numeric twin of the map's shape.
- **Progress toward the next Total Level milestone** (100/150/200/…, up to the ceiling — 04 §4.3;
  the ceiling is computed from the ruleset, never a literal) — a bar with a named target, because
  a bare percentage reads as nothing.
- **The last run, one line, clickable.** It is the door back into §3, and it answers "did my run
  land?" — which is the single most common reason to open this app.
- **Three destinations.** Skills, Add workout, Runs. Add workout is centre and widest: it is the
  only *action* on the screen, and D-061 says it is one button.

**Does not earn it:**

- **This week / today's numbers.** P5: "rules out a home screen that leads with today's numbers
  rather than cumulative ones. Today's numbers are transient; the point of this app is the
  accumulation." A weekly total is also one short step from a weekly goal, which is N2.
- **Any per-exercise button.** D-061 exists precisely to keep these off this screen.
- **A "log a run" affordance.** Ingestion is automatic (D-121). A manual run entry on the home
  screen advertises that the automation is not trusted.
- **Streak, calendar, ring, goal, "days since."** H2, absolutely.
- **A nag when no run has synced.** If Strava has not delivered in a while, that is *not* an
  event. The plinth simply still shows the last run, whenever it was. The only failure surfaced
  is a genuinely broken token, and it appears as a quiet ink-coloured line in the plinth —
  `<source> needs reconnecting` → `/settings`, its own line under Sync (§2.2 row 12, D-337) —
  never a red badge, never a modal.
- **Notification dot / inbox.** §1.4.

### 2.4 States

| State | Plinth shows | Map shows |
|---|---|---|
| Cold start, cached | Cached totals immediately | Cached basemap + last `explored-r11.<gen>.bin` (D-237) from IndexedDB, drawn before any network call |
| Fresh import waiting | `1 new run — open it` in ink text with an `--accent-text` rule, never gold text *(D-148, D-335)*. Its pulse fires once per run per page load — a reload is a cold open *(D-319)* — and the line itself stays until the run is seen; it never turns red or repeats | Only the run's NEW cells held back; re-crossed ground stays clear, because the map never re-fogs *(D-319, D-020)*. The reveal belongs to §3. While the hold is pending — the latest-run answer does not yet speak for the explored set on screen — the fog keeps its last drawn frame *(D-333)* |
| Nothing ever imported, no source connected | `Connect <source> to begin` — the only call to action in the app. A connected account still awaiting its first import is told nothing *(D-320)* | The basemap, unfogged, centred on the configured home, else the extract bounds (D-249's precedence with no run to frame). Never device location: a desktop browser's geolocation is an IP guess and a permission prompt |
| Broken token | The ordinary plinth, plus the `<source> needs reconnecting` caption under the Sync line (§2.2 row 12, D-337); the last-run line still shows the last run | Identical |
| Sync in progress | The button reads `Syncing…`; the status line beneath it `Checking for new activities…`, then `N activities queued.` or nothing (D-318) | Identical; no overlay, nothing blocked but the button |
| Three weeks idle | Identical to any other day | Identical |
| Offline | Everything above, from cache, with no error chrome | Cached tiles; missing tiles render as the flat basemap background (D-373; was "flat parchment"), never as grey checkerboard |

The empty state deserves a note: with no territory, the map is *all* fog and reads as broken.
So before the first import, fog is not drawn at all — the street map sits there clean, and
the fog arrives, for the first time, as part of the first reveal. The first thing the fog ever
does is burn back.

### 2.5 Where the Chronicle opens (D-313)

`RUNS` opens `/chronicle` **in the rail's column, replacing the rail's contents**: the same
24rem width, the full window height, with the run list scrolling inside it. The plinth's rows are
not drawn while it is open. *(Confirmed by the operator, 2026-10-15.)* The Chronicle does **not**
repeat the lifetime totals at its own top: it is a plain list, newest first, and cumulative
numbers live on the plinth alone *(D-329, operator, 2026-10-15, superseding this paragraph's
earlier "carries the lifetime totals at its own top")*.

- **No scrim, and the map stays live.** The map to its right pans and zooms as normal. A list of
  places you have been, beside the map of those places, is the one case where both should be
  usable at once, and a scrim would make the map a backdrop.
- **Dismissal:** Esc, its close control, and back (§1.5). Dismissing it does not move the camera.
- **Clicking a row** goes to `/run/:id` in end state (§4.5). Back returns to the Chronicle.
- **The unseen mark** goes on at most one row — the latest traced run, when this device has not
  seen it — as a 3px inset `--accent-text` rule plus hidden text, never a count *(D-324, D-335)*.
- Below 1024px it takes the bottom card's place as a fixed panel at full height: 16px side
  insets, `top: 72px` (clear of the `⚙`: 16 + 40 + 16) and `bottom: 36px` (clear of the
  attribution, D-315). It does not grow with its content. It is still a panel, not a full-screen
  page. The 72px is revisited when the mode toggle (`0098`) lands, which shares that top edge.

The skill detail is the other thing that opens over a parent, and it is deliberately different:
a **centred dialog with a scrim** over `/skills` (§5.5, as `0074` built it), because the panel
behind it has nothing to do while you read it.

---

## 3. The post-run moment — "Return from the Fog"

This is the most important screen in the app and it is not really a screen. `04-game-design.md`
§4.2 establishes it as **a sequence, not a screen**, ~8–10 seconds, skippable, never requiring a
decision. This section specifies it to the frame.

**Why it gets the budget:** P2 puts the phone in your pocket during the run, which means the
app has exactly one moment to justify its existence, and this is it. Everything else in this
document is infrastructure for these nine seconds.

### 3.1 Entry points

| Entry | Behaviour |
|---|---|
| ~~Push notification "your run is on the map"~~ | *Dropped by D-253: there is no push notification.* A pasted `/run/:id` link to an unseen run behaves as the next row |
| Plinth `1 new run — open it` | Opens `/run/:id`; the sequence auto-plays from beat 1 |
| App opened cold with an unseen import | Home renders first (map, pre-run territory), then the plinth's new-run line pulses **once**. It does **not** auto-play. Ambushing the user with a nine-second animation they did not ask for is how a reward becomes an obstacle |
| Chronicle → any past run | `/run/:id` opens in **static end-state**, with a `⟲ Relive` control. Replays are opt-in |

A run is marked `seen` the first time the sequence completes or is skipped. `seen` is a local
per-device flag; it never affects scoring (D-135's spirit: display state is not truth).

### 3.2 The sequence

Total: **8.4 s** nominal, plus ~1.4 s per level-up card. Every beat is skippable by tap, and a
tap during any beat **jumps to the end state** — never to the next beat. One tap always ends it.

```
 t=0.0 ──────────────────────────────────────────────────────────── t≈8.4s
 │
 │ BEAT 1  THE MAP                                    0.0 → 2.9 s
 │  ├ 0.0–0.4  camera flies to the run's bounding box, eased, fog frozen
 │  ├ 0.4–2.6  lantern travels the route; fog burns back behind it
 │  └ 2.6–2.9  lantern lands, settles, one soft pulse at the final point
 │
 │ BEAT 2  THE TALLY                                  2.9 → 6.0 s
 │  ├ 2.9–3.2  camera pulls back ~1.5 z; parchment ledger rises from bottom
 │  └ 3.2–6.0  rows count up, staggered 240 ms apart
 │
 │ BEAT 3  LEVEL-UPS (if any)          interrupt, queued, 1.4 s each
 │
 │ BEAT 4  THE CHRONICLE LINE                         6.0 → 7.2 s
 │
 │ BEAT 5  THE FRONTIER LINE                          7.2 → 8.4 s
 │
 ▼ END STATE (persistent, scrollable, no timeout)
```

#### Beat 1 — the map, first, always (0.0 → 2.9 s)

04 §4.2: *"If we only ever get one thing right in this app, it is this 2.5 seconds."* It must
never be preceded by a numbers panel, a title card, a loading spinner, or a "Run imported!"
toast.

- **Camera.** From wherever home left it, fly to the run's bounding box with 12% padding,
  `easeOutCubic`, 400 ms. If the run is already in frame, do not move — a gratuitous camera
  move at the start reads as jank. *Amended at the `12` audit (2026-10-15):* `/run/:id` mounts its
  own map already framed on the run (`0078`), so on entry the run is always in frame and the
  camera does not move. The flight happens only on ⟲ Relive after the user has panned.
- **Mode.** The sequence always plays in **adventure** rendering, regardless of the user's
  saved mode. This is the one moment where atmosphere outranks planning, because you are not
  planning — you are looking at what you did. On completion it cross-fades back to the
  saved mode, with the toggle's own 320 ms fade (§4.3) *(was 300 ms; one fade for every mode
  change, operator, `0098`)*. This is legal under D-051: legibility is a *task* guarantee, and there is no
  wayfinding task inside the reveal. The cross-fade back is what keeps the promise.
- **The lantern.** A point of warm light (`--lantern-500 #FFB347`, 18dp soft radius, additive)
  travels the actual `latlng` stream — the full stream, never `summary_polyline` (D-121
  mitigation 4), because a corner-cut route drawn in a celebratory animation is exactly how
  trust dies (S4). Traversal is **arc-length parameterised, not time parameterised**: constant
  screen speed, so a 3 km run and a 20 km run both take 2.2 s. Pace is not the subject.
- **The route inks in behind it**: `run-core #fff2d0` at 2.5px over `run-glow #ffb347` blurred
  10px at 0.35 (05 §4.4, verbatim — this palette was chosen to survive both parchment and dark
  fog, and it is reused unchanged here).
- **The fog burns back.** Cells revealed by this run are splatted into the mask progressively,
  gated on the lantern's arc position, so the mist retreats *behind* the light rather than all
  at once. Implementation note that matters: the client already draws the run's polyline into
  the mask as a thick soft line (05 §4.4's "optimisation worth taking"), so **beat 1 does not
  wait on the server's cell write.** The reveal is client-side. Latency can never delay it.
- **Three kinds of ground read differently as they clear:**

  | Ground | Visual | Duration |
  |---|---|---|
  | **New** (never run) | Gold-white bloom at the reveal edge, `--gold-300 #E8C87A` (§8.1's value; this row said `#E3C766` until D-295) → fades to bare parchment over 600 ms | The loud one |
  | **Remembered** (>6mo, re-armed, 50% credit — D-120) | Cool flush, `--frost-400 #7FA8C9`, dimmer and slower, 900 ms, like breath clearing off glass | The quiet, nostalgic one |
  | **Familiar** (<6mo) | No bloom. The route ink simply lays down over already-clear ground | Silent |

  Three distinct treatments for three distinct scoring classes is not decoration — it is the
  user being able to *see* why the tally says what it says, which 04 §4.2 requires.

- **Sound: none.** No audio in this app, ever. It is used after a run, often around other
  people, sometimes with headphones still playing something else. Sound is also state you must
  configure, which is upkeep.

#### Beat 2 — the tally (2.9 → 6.0 s)

The camera pulls back 1.5 zoom levels (so the newly-lit territory sits in context, not filling
the frame) and a parchment ledger rises over the bottom ~55% of the screen with a 300 ms
`easeOutQuint`. The map stays visible above it. It is never a full-screen takeover: the ledger
is a thing laid *on* the map, in keeping with the fiction that the map is the artifact.

```
┌──────────────────────────────────────────────┐
│                                              │
│        (map, still lit, upper 45%)           │
│                                              │
├──────────────────────────────────────────────┤
│  RETURN FROM THE FOG        Thu 28 Aug · 8.4km│
│                                              │
│  Wayfaring    +578   ▓▓▓▓▓▓▓░░░  L47  8,001 →48│
│  Cartography  +380   ▓▓▓▓▓░░░░░  L41  4,567 →42│
│  Constitution +193   ▓░░░░░░░░░  L41↑ 6,644 →42│
│  ────────────────────────────────────────────│
│  148 cells claimed · 58 remembered           │
│  3.18 km never run before                    │
│                                              │
│  Total XP  1,884,120 → 1,885,271   (+1,151)  │
│  Total Level  271                            │
│                            [ tap a row for ⌄ ]│
└──────────────────────────────────────────────┘
```

*The figures are 04 §8.2's Example A (+578 / +380 / +193, 148 new and 58 re-armed cells), the
same numbers `src/scoring/propagate.test.ts` asserts.*

- Rows appear **staggered 240 ms apart**, top to bottom, each sliding up 8dp with a 180 ms fade.
- The `+578` **counts** from 0 to its value over 700 ms with `easeOutExpo` — fast at the start,
  visibly decelerating into the final digit. Tabular numerals, so nothing reflows while counting.
- The XP bar fills in the same 700 ms window. If the fill crosses 100%, it does **not** wrap —
  it fills to full, holds, and hands off to beat 3.
- `L41 ↑` marks a level gained; the arrow is `--progress-activity` (`--gold-700` on parchment —
  `--gold-500` is 2.24:1 there, and a mark that carries meaning needs 3:1; D-296, after D-291) and
  is the only colour in the row: the bars are ink.
- **Tapping a row expands it to the reason breakdown** (04 §4.2): Wayfaring's reads `318 XP new ground · 197 XP familiar ground · 63 XP
  remembered ground` — every amount says XP, never a cell noun (`0277`, D-332). Constitution's
  single part reads `193 XP share`: it is fed XP, not ground *(operator, 2026-10-16: keeps what
  ships)*. *D-309 (`12` audit, 2026-10-15):* **"remembered" is the only word
  the player sees for re-armed ground** — in this breakdown, the cells line above it and the skill
  sheet alike. `re-armed`/`rearmed_ground` is the ledger's reason id, never on-screen copy. This falls out of the `XpLedger` for free and it is the thing that
  makes the numbers feel *accountable* rather than dispensed. Expansion pauses the sequence.
- **"3.18 km never run before"** is deliberately given its own line and phrased in distance, not
  cells. Cells are the mechanic; kilometres of new road is the *feeling* (D-012).
- Total XP is shown as an explicit `old → new` transition, because it is one of only two numbers
  guaranteed non-zero every single session (04 §4.1) and it is therefore the tally's floor.

#### Beat 3 — level-ups interrupt (1.4 s each, queued)

04 §4.2: *"This is the only moment in the app permitted to be loud."* Take that literally.

```
        ╔══════════════════════════════════╗
        ║  ·  ·  ·   gold leaf border  ·  ·║
        ║                                  ║
        ║           ╭────────╮             ║
        ║           │ SIGIL  │             ║   ← skill sigil, ink on gold
        ║           ╰────────╯             ║
        ║                                  ║
        ║          WAYFARING               ║   ← Spectral 600, 22sp, uppercase, tracked (D-297)
        ║                                  ║
        ║           46  →  47              ║   ← 46 crossfades out as 47
        ║                                  ║      rises in, 500 ms
        ║        ─── ADEPT ───             ║   ← milestone name only at
        ║  A landmark now stands where     ║      10/25/50/75/90/99
        ║  you earned it.                  ║
        ╚══════════════════════════════════╝
```

- The card takes the screen: map dims to 25% under a `--navy-900` scrim at 0.72.
- Entry: scale 0.94 → 1.0 with a 220 ms `easeOutBack` (overshoot 1.02), gold border wiping in
  clockwise over 400 ms. Hold 800 ms. Exit: fade + 4dp rise, 200 ms. 1.4 s in all (D-297: the parts
  once summed to 1.2 s against the 1.4 s total; the total wins).
- One card per level. If a run grants three levels, three cards queue at 1.4 s each. This is the
  only place the sequence is allowed to exceed its budget, and it should — a triple level-up is
  the best thing that can happen and rushing it is a design failure.
- **Milestone levels** (10/25/50/75/90/99, 04 §4.3) add the tier name and, where the milestone
  places something on the map, a single line naming it. At 50 and 99 the card exits by *flying
  into the map* to the cell where it was earned, which then pulses once. Place-bound milestones
  are the strongest reward this app has (04 §4.3); make the placement visible at the moment it
  happens.
- **Total Level milestones** (100/150/… up to the computed ceiling, 04 §1.2) use the same card
  with the app's crest instead of a skill sigil.

#### Beat 4 — the chronicle line (6.0 → 7.2 s)

One generated sentence, in the setting's voice, keyed off the run's most distinctive computed
fact (04 §4.2 supplies the template table and the examples).

- Rendered in **Spectral Italic 17sp**, `--ink-700`, on the ledger, centred, with 22dp of air
  above and below. Nothing else on screen moves while it is there.
- It fades in over 500 ms and stays in the end state.
- *"Thirty-eight paces in a hundred fell on roads that had never felt your step."*
- *"You returned to Ashgrove Lane after two hundred and eleven days. It remembered you."*

This line is cheap (a template table over facts the ledger already computed) and it does more
emotional work per byte than anything else in the app. It is what makes the app feel like it is
paying attention.

**Where a name comes from** (D-302). `{street}` and `{place}` are facts like any other, read off the
basemap's own pmtiles archive (its `roads` and `places` layers) — no reverse geocoder, no third
party. `{street}` is the named road most of the run's re-armed cells lie on; its gap is the shortest
gap among those cells, from each cell's previous `lastRunAt`, which ingest stores beside the run's
classes because the re-arming write destroys it. `{place}` is the town or neighbourhood at the run's
first fix. Motorways and rail never name a street. No name known, the row waits.

#### Beat 5 — the frontier line (7.2 → 8.4 s)

One line at the very bottom: the best-scored unexplored frontier and its distance — not the
nearest. It is the first cluster in `05` §8.4's novelty ÷ distance order that is at least half
unexplored (novelty ≥ 0.5) and at least 250 m from the run's origin; below 250 m is the doorstep,
not a frontier. When nothing passes, there is no line *(D-336)*.

```
  ◇  Unclaimed ground 1.2 km north — Millbrook
```

- `--ink-500`, 14sp, with a small hollow diamond glyph. It is **quiet by construction**.
- **The name** is the town or neighbourhood nearest the frontier's centre, within 3 km, from the
  basemap's `places` layer (D-302). None within reach, the line ends at the bearing. Naming ground
  still under the fog is deliberate: a name says a destination exists; the fog keeps what it looks
  like.
- Tapping it recentres the map there in atlas mode. (Post-MVP it seeds the route planner, D-070.)
- **Ignoring it costs nothing.** It never repeats, never turns red, never counts down, never
  appears as a notification. D-013 and 04 §4.2 both spell this out. It is a signpost, not a task.

### 3.3 The end state

When the sequence finishes it does not navigate anywhere. `/run/:id` settles into a persistent,
scrollable page: the lit map on top (pannable again), the full ledger below, chronicle line,
frontier line, and at the bottom a `⟲ Relive` control plus route stats (distance, duration,
date, source). Back returns to `/` — ~~always~~ **except for a run opened from the Chronicle,
whose back returns to the Chronicle at the scroll position it was left at, and a second back to
`/`** *(operator, 2026-10-15, ticket `0088`; proposed as a decision in that ticket's
Resolution)*. The Chronicle's row links push rather than replace; a run opened any other way —
the plinth's last-run line, a pasted link — still backs to `/`. The scroll position is restored
when the current history entry's Navigation API key is the one the list was left from, with
`popstate` as the fallback where that API is missing *(D-321, D-339)*.

The end state is the *canonical* view of a run. The sequence is a decorated way of arriving at it.

### 3.4 Skip, interruption and failure

- **Tap anywhere** → jump to end state, instantly, no fade. Not "next beat." One tap ends it.
  *(D-298: "anywhere" excludes the sequence's two controls — a tally row's expander, which pauses
  the sequence (§3.2), and the frontier line. Esc and Back always end it.)*
- **Back** during the sequence → end state, then a second back → `/`.
- **`prefers-reduced-motion`** (05 §4.5) → no lantern traversal, no counting numbers, no card
  overshoot. The reveal becomes a single 400 ms cross-fade from pre-run to post-run territory;
  the ledger fades in complete; level-up cards appear and hold without scaling. Everything is
  still *sequenced* (you still see the map before the numbers) — only the motion is removed.
- **Backfill.** The first Strava import fetches years of history. Do **not** queue 300
  sequences. Backfill produces **one** aggregate reveal: the whole archive burns back at once
  over 4 s, with a ledger showing lifetime totals and starting levels, and a single card:
  `Total Level 214`. Individual runs are then just rows in the Chronicle, unseen-flagged off.
  *(D-298: built in `0257`, capability 14, with the paced historical import `0177`.)*
  *(`0257`, operator 2026-10-17: the import is paced over minutes to hours, so it plays on the
  **next map visit** after the import, once per device, from a server-side batch record
  (`users/<uid>/backfill/batch.json`: window, imported ids, standing before and after). Every
  imported activity is not-new on every device. The burn clears outward from the map's centre;
  the ledger rises at 4 s, the card plays at 5.0–6.4 s, and home returns at 8.4 s.)*
  *(D-354, as built: until home knows whether a reveal is due, the fog holds its last frame; the
  import's cells are held back and the plinth is veiled while the reveal is ready or playing.
  Reduced motion is a 400 ms cross-fade on the same phase boundaries. The failure bullet below
  differs here: a lost WebGL context aborts the aggregate reveal **to home**, not to a run's end
  state, and with no WebGL2 at all the numbers still play. Zero prior territory still gets a fog
  layer.)*
- **Failure mid-sequence.** If WebGL context is lost (05 §4.5 says this genuinely happens under
  GPU memory pressure), abort to the end state with a static map image (D-298: the route drawn from its geometry, until
  the rebuilt map is ready). The ledger is
  plain DOM and always survives. **The numbers must never depend on the graphics.**

### 3.5 The fallback: a run with no new territory

This is the case that decides whether the app survives month four. Local ground fills in; S2
predicts discovery decay by month 4–6. On a Tuesday loop round the block, `newCells = 0`.

**The failure to avoid is precise:** a ledger with `Cartography +0` and a map where nothing
visibly happened reads as *"that run did not count"* — which is the INTVL wound (I1) reopened by
the reward screen instead of the scoring engine. The scoring is correct (half XP, still XP,
never zero); the *presentation* is where it can go wrong.

**Four rules.**

**1. Never render a zero.** A skill that earned nothing this session is **omitted from the
ledger**, not shown at 0. Cartography with no new ground simply is not in the list. An absent
row is neutral; a zero is an accusation. (The breakdown on tap still shows the full truth for
anyone who wants it.)

**2. Beat 1 changes subject, and keeps its 2.9 seconds.** It is never shortened, never skipped.
Instead of fog burning back, the lantern traverses the route over already-clear ground and the
route **inks into the permanent trace layer** — every route you have ever run, drawn faintly in
ink (`--ink-300` at 0.28, via `--trace-line`; *not* sepia — `--ink-300` is the blue-shifted ink ramp, D-299), accumulating into a visible web of worn paths across your
territory. On a no-new-ground run, the beat is *this line joining the web*, and the segments you
have run most darken perceptibly — in bounded steps, each stretch of ground drawn once, so a daily
commute stops at 0.60 instead of compounding to black (D-299). The subject shifts from *territory* to *the record of your
passage*, which is still cumulative, still permanent, and still yours.

> This layer is worth building for its own sake: it is the second permanent artifact in the
> app, it costs one GeoJSON source, and it makes ordinary runs visible. It is **not** a
> repetition reward (P6) — nothing is scored off it, there is no "10th time" badge (N4), it is
> just the honest shape of where you actually go.

**3. The tally leads with what did move.** Row order is not fixed; it is **sorted by XP gained,
descending**. On a no-new-ground run Wayfaring leads, Constitution follows, and the two
guaranteed-non-zero lines carry the bottom:

```
  RETURN FROM THE FOG          Tue 2 Sep · 5.1 km
  Wayfaring     +255   ▓▓▓▓▓▓▓▓░░  L47  7,748 →48
  Constitution   +85   ▓▓░░░░░░░░  L41  6,560 →42
  ──────────────────────────────────────────────
  5.1 km added to the record
  Total XP  1,885,263 → 1,885,603   (+340)

  "Old roads, run well. The map holds them still."

  ◇  Unclaimed ground 1.2 km north — Millbrook
```

Note `+255`, not `+510`: half XP on known ground (D-120). The app does not hide the discount —
but it never labels it as a penalty either. There is no `(halved)` annotation, no strikethrough,
no "you could have earned 510." The number is the number.

**4. The chronicle line does the emotional work.** The template table gets a dedicated set of
**no-new-ground lines**, and they are written to be *warm*, never consoling:

- *"Old roads, run well. The map holds them still."*
- *"The eleventh league along the river. It knows your weight by now."*
- *"You have now walked further than the road from here to Carlisle."* (lifetime threshold)
- *"Ashgrove Lane comes back into season in nineteen days."* (a cell approaching the 6-month
  re-arm — the *only* forward-looking line, and it is an invitation, not a deadline. The cell is
  the soonest to re-arm within ~170 m of the run, as of the run: D-305)

Never: *"No new territory today"*, *"0 cells discovered"*, *"Try somewhere new!"* The first
states a lack, the second quantifies it, the third gives an instruction — and instructions are
N2 in miniature.

**And there is always something.** 04 §4.1's guarantee holds by construction: cells revealed
and Total XP are the two numbers that can never be zero for a real activity, and Total XP is
always on screen. If literally every skill row were somehow empty, the ledger still shows the
Total XP transition and the chronicle line, and that is enough — a small honest number that
went up beats a large fake one.


---

## 4. The map screen

### 4.1 There is no map screen

`/` **is** the map (§1.1, §2.1). This section is not a second screen; it is the specification of
the surface that §2 put a plinth on top of, and the same surface that §3 lights up. Everything
here applies equally on `/` and on `/run/:id`, because they render the same map with different
camera framing and a different top layer.

What §4 owes the rest of the document: the mode toggle and its exact consequences (D-052 /
D-133), the input contract (D-253), how routes draw over fog (05 §4.4), how you get from a line on the
map back to the run that drew it, and how cold territory shows up in atlas without turning into a
third thing competing with the reveal edge.

The rendering itself — shaders, mask passes, layer order, zoom bucketing — is **05-fog-of-war.md
§4–§6 and is not restated here.** This section is what the pointer and the keyboard touch.

### 4.2 The mode toggle (D-052)

**Placement.** Top-left, 16px insets, as drawn in §2.2. It is a **two-state segmented control with both labels
permanently visible** — never an icon, never a single button whose label is the state you are not
in. A toggle that shows one word forces the user to work out whether it is naming the current
mode or the destination, every single time.

```
  ┌────────────┐
  │ ▓ ATLAS  ▓ │   ← selected: gold-leaf fill, --ink-900 text
  ├────────────┤
  │  ADVENTURE │   ← unselected: --parch-100 at 0.82, --ink-600 text
  └────────────┘
      two 32px rows, wide enough for ADVENTURE at the §8.4 Label size with 12px
      either side (~112px), 8px corner radius, 1px --ink-400 hairline
```

**Why top-left.** It is a *state display* first: it must be visible without being hunted for,
and the top-left corner is where a reading eye starts. It is the one piece of chrome that answers
"what am I looking at?", so it sits where that question is asked.

**The second path is the keyboard (D-253):** `M` toggles the mode wherever the toggle is shown,
except while a text field has focus. ~~Long-press anywhere on the map, with a haptic
tick~~ is gone — with a mouse it is undiscoverable, and it cannot be reached from the keyboard.
A plain click on empty map still does nothing (§4.4).

> If the post-MVP route planner (D-070) wants a click on empty map for "set start point", that
> is the gesture this document holds in reserve (§10.5). The toggle does not move either way.

**Persistence.** localStorage, per device, restored before first paint (05 §5.3). It is a viewing
preference, not user data — it never syncs, and a fresh device starts at the default.

**Default: adventure** (05 §5.3). It is the product's identity. Atlas is one click, or `M`, away.

### 4.3 What actually changes between the modes

05 §5.2 is the authoritative table and it is expressed in shader uniforms. This is the same
switch stated in terms of what the user perceives, which is what the UI must be reviewed against:

| What you see | **Atlas** | **Adventure** |
|---|---|---|
| Unexplored ground | Dimmed, cool, clearly still a map. You can read it. | Near-opaque dark. A ghost of the street grid, no more. |
| Street names in unexplored ground | **Readable.** Labels sit above the fog. | **Hidden.** Labels sit below the fog. This is the discovery beat. |
| Street *geometry* in unexplored ground | Fully traceable — road lines drawn above the fog at ~0.5 | Only what `u_maxOpacity` 0.90 lets through *(was 0.94; `0119`'s tuning, `0098`)* |
| The frontier edge | A hairline warm rim; close to true coverage | A wide lantern glow with a ragged, organic edge |
| Motion | **None.** Static, always. | Mist drifts at 30 fps |
| Cold / rediscoverable ground | **Shown** (§4.6) | **Never shown** (D-133) |
| "Unexplored zones near me" (05 §8.4) | Available | Hidden |
| Your route lines | Thin, precise, above everything | Cream core inside an amber glow |

Three properties of the toggle are hard requirements, and a build that violates any of them is
wrong even if it looks good:

1. **The camera does not move.** Centre, zoom and bearing are untouched. Toggling is not
   navigation.
2. **Territory does not appear or disappear** (05 §5.4). Both modes render the identical cell set
   at the identical `revealScale`. If toggling ever reads as ground being granted or taken away,
   the app has lied about the one thing it promises never to lie about (D-020).
3. **The transition is a 320 ms cross-fade of the fog's uniforms and the route glow**, on one
   `ease-in-out` curve, and never a reload. ~~not a style swap~~ *(Amended by `0098`, operator,
   D-NEW-c.)* The basemap variant **is** swapped — a diffed `setStyle` at the start of the fade —
   because atlas's labels and road-fill copies sit on the other side of the fog (D-368), and no
   opacity animation moves a layer across another. So the road copies appear in one frame and the
   labels change on MapLibre's own ~300 ms symbol fade, not on the shared curve. The camera is
   still untouched (property 1) and nothing revealed changes (property 2). Under
   `prefers-reduced-motion` it is a hard cut — an instant change of a setting the user just asked
   for is honest; a 320 ms dissolve of the whole viewport is not, for someone who asked for less
   motion.

### 4.4 Controls and gestures

| Input | Does | Notes |
|---|---|---|
| Drag | Pan | Inertia on, rubber-band at bounds |
| Wheel, or trackpad pinch | Zoom, anchored at the cursor | z10 → z18 |
| Double-click | Zoom in one step, anchored at the cursor | |
| Arrow keys · `+` / `−` | Pan · zoom one step | While the map has focus (§2.2's focus order) |
| `M`, or a click on either row of the toggle | **Toggle atlas / adventure** | §4.2. Not a long-press (D-253) |
| Hover a route line | The cursor becomes a pointer | 24px slop. The only signifier that a line is clickable; no tooltip |
| Click on a route line | Inspect that run (§4.5) | 24px hit slop |
| Click on empty map | **Nothing** | Deliberate. See below |
| Click `⌖` | Recentre on the last run's end point, z14 | |
| Click fit-to-territory (beside `⌖`) | Fit the whole territory in view | The "look what I've done" control. Its own button, not a long-press on `⌖` (D-253) |
| `Esc` | Dismiss the §4.5 card or chip | |

**Dropped with the phone (D-253):** two-finger tap to zoom out, long-press anything, and the
wet-screen multi-contact rule. The plinth has no drag handle (§2.2).

**Rotation and tilt are disabled. Bearing is locked north-up, pitch locked to 0.** A rotated
street map with no compass is a map you cannot navigate by, and adding a compass to un-rotate it
means adding a control that exists only to undo an accident. Tilt buys nothing without 3D
buildings, which we do not have, and it costs label legibility at the horizon — D-051 decides
both.

**Zoom bounds are z10–z18.** Below z10 the fog's zoom bucketing (05 §6.1) coarsens territory into
a smear that misrepresents what you have explored; above z18 the basemap has nothing left to
show. Both bounds rubber-band rather than hard-stop, so the gesture never feels broken.

**Clicking empty map does nothing, on purpose.** A cell inspector — "you last ran here 211 days
ago" — is a genuinely interesting thing to build and it is a stats organ (§1.4) that turns the
map into a database browser. The one piece of that information that helps you decide something is
*rediscoverability*, and §4.6 shows it as colour instead of hiding it behind a click.

### 4.5 Routes over fog, and inspecting a past run

**Three route layers, all above the fog** (05 §4.4 fixes the order and the colours):

| Layer | What it is | Atlas | Adventure |
|---|---|---|---|
| **Trace web** | Every run you have ever done, accumulated (§3.5) | `--ink-300` @ 0.34, 1.5dp | `--ink-300` @ 0.22, 1.5dp |
| **Selected run** | The run being looked at | 2dp `--ink-800`, hard edges | 2.5dp `#fff2d0` core + 12dp `#ffb347` glow @ 0.35 |
| **Live corridor** | A run that just landed, drawn into the mask as a thick soft line before the server's cells round-trip (05 §4.4) | — | — |

On `/` the trace web is always drawn and **the last run is the selected run.** On `/run/:id` the
selected run is that run and the web dims to 0.18 beneath it, so the line you came to see is
unambiguous.

Route colour is fixed by 05 §4.4 and is not a palette choice: warm cream core with an amber glow
is the one combination that survives *both* parchment and near-black fog. Pure white blows out on
parchment; pure red disappears into it.

**Inspecting.** Click a line within 24px:

```
 ┌──────────────────────────────────────────────┐
 │                                              │
 │            ╱                                 │
 │      ═════╱══════   ← clicked here, 3 runs   │
 │          ╱             within 24px           │
 │                                              │
 │   ┌────────────────────────────────────┐     │  ← disambiguation card,
 │   │  3 runs pass here                  │     │    anchored above the click,
 │   │  ──────────────────────────────────│     │    flips below near the top edge
 │   │  Thu 28 Aug  ·  8.4 km  ·  21 new  │     │
 │   │  Sun 10 Aug  ·  12.1 km ·  4 new   │     │
 │   │  Tue 3 Jun   ·  5.0 km  ·  0 new   │     │
 │   └────────────────────────────────────┘     │
 └──────────────────────────────────────────────┘
```

- One match → skip the card, highlight that run immediately and show a one-line chip with the
  same three facts, clickable through to `/run/:id`.
- Rows are 32px. The card holds five rows then scrolls; it never becomes a panel.
- Click a row → `/run/:id` **end state** (§3.3), *not* the sequence. The sequence auto-plays once,
  on import, and never ambushes you again (§3.1). `⟲ Relive` in the end state is the only way to
  replay it, and it is a deliberate act.
- A click elsewhere on the map, `Esc`, or back dismisses the card. It never blocks panning.
- **Hover shows nothing but the pointer cursor** (§4.4). The card is the click's. A tooltip that
  appears on its own whenever the cursor crosses a dense trace web is noise, and §4.8 used to
  promise one; D-313 withdrew it.

### 4.6 Cold territory in atlas, without competing with the reveal edge (D-133)

D-133 is precise about the risk: a third visual state that fights the frontier for attention. The
design answer is that **cold ground is not a third fog state at all.** It is a wash painted
strictly *inside* already-revealed ground, and it is separated from the frontier on a different
perceptual channel.

**The two channels, kept apart:**

| | The frontier | Cold ground |
|---|---|---|
| Channel | **Luminance + warm glow** — a bright warm rim against dark fog | **Temperature + saturation** — a cool, desaturating wash on lit parchment |
| Where it lives | The boundary between explored and unexplored | The interior of explored territory only |
| Edge | A hairline, sharp by design in atlas | Soft, 40 px feather, no defined edge at all |
| Can they touch? | **No.** The wash is clipped 2 cell-widths inside the coverage mask, so there is always a band of plain warm parchment between cold ground and the frontier |

That clipping rule is the whole trick, and it is a one-line change to the mask sample: cold
opacity is multiplied by `smoothstep(0.0, 0.25, coverage - 0.75)`. Cold ground can never render
at the reveal edge, so the two can never be confused, even at a glance, even by someone who has
never used the app.

**The ramp, and why it is continuous.** Cold-ness is not a binary at the 6-month line. Opacity
ramps with `now - lastRunAt` (D-120 gives every cell that timestamp):

```
  wash opacity
   0.18 ┤                        ╭──────────────────  asymptote
        │                   ╭────╯
   0.10 ┤              ╭────╯   ← 6 months: re-armed for 50% discovery credit
        │         ╭────╯
   0.00 ┼────────╯
        └────┬────────┬────────┬────────┬─────────►  months since last run
             4        5        6        9
```

The ramp starting at month 5 is the useful part: **you can see ground coming back into season
before it arrives**, which is exactly the information that changes a Saturday's route, and it is
the visual twin of the chronicle line *"Ashgrove Lane comes back into season in nineteen days"*
(§3.5). It costs one uniform and no extra data.

**Colour.** `--cold-wash` `#7E93AD`, multiplied over the lit basemap, plus a −18% saturation
shift. Never a stipple, never a hatch, never a hex outline — patterns read as *information about
this specific cell* and invite tapping, and there is nothing to tap (§4.4).

**What it is never allowed to become:**

- Never visible in adventure mode. D-133, no exceptions, no "just a hint of it."
- Never a count, a badge, a percentage, or a list. "14 cells rediscoverable near you" is a chore
  disguised as a stat (D-013, N2).
- Never a call to action. It is terrain, not a task.
- Never darker than the fog. If cold ground ever reads as *less* explored than unexplored ground,
  the whole metaphor inverts.

**Discoverability, exactly once.** The first time atlas mode is opened, a small coach mark sits
above the plinth for 6 seconds with three swatches — `explored` / `rediscoverable` / `unexplored`
— and a single line of text. It is dismissible, it never returns, and it is not stored as
"onboarding progress." One flag in localStorage. (D-013: a legend you must re-dismiss is upkeep.)

### 4.7 The two modes, drawn

```
   ATLAS                                    ADVENTURE
 ┌───────────────────────────────┐        ┌───────────────────────────────┐
 │ ┌────────┐              ┌───┐ │        │ ┌────────┐              ┌───┐ │
 │ │▓ATLAS ▓│              │ ⚙ │ │        │ │ ATLAS  │              │ ⚙ │ │
 │ │ ADVENT │              └───┘ │        │ │▓ADVENT▓│              └───┘ │
 │ └────────┘                    │        │ └────────┘                    │
 │                               │        │                               │
 │  Mill Ln    ╭─────╮           │        │  Mill Ln    ╭─────╮           │
 │ ────┬────  ╱ cold  ╲          │        │ ────┬────  ╱░░░░░╲            │
 │     │     │ ≈≈≈≈≈≈≈ │  Kirk St│        │     │     │░░░░░░░│  ▒▒▒▒ ▒▒  │
 │  ═══╪══════ ≈≈≈≈≈ ══╪═════════│        │  ═══╪══════░░░░░░══╪═════════ │
 │     │      ╰───────╯          │        │     │      ╰░░░░░░╯           │
 │  Ashgrove   ░░░░░░░░░░░       │        │  ▒▒▒▒▒▒▒▒  ▓▓▓▓▓▓▓▓▓▓▓        │
 │  ┄┄┄┄┄┄┄┄  ░░ Beck Rd ░░      │        │  ┄┄┄┄┄┄┄┄  ▓▓▓▓▓▓▓▓▓▓▓▓▓      │
 │  ┄┄┄┄┄┄┄┄  ░░░░░░░░░░░░░      │        │            ▓▓▓▓▓▓▓▓▓▓▓▓▓      │
 │                               │        │                               │
 └───────────────────────────────┘        └───────────────────────────────┘
   ═══ selected run (thin, dark)            ═══ selected run (cream + amber glow)
   ┄┄┄ trace web                            ┄┄┄ trace web (dimmer)
   ░░░ fog @ 0.55 — roads and NAMES         ▓▓▓ fog @ 0.94 — grid ghost, no names
       still readable through it             ▒▒▒ names that exist but are hidden
   ≈≈≈ cold wash, interior only,                 (drawn here only to show what
       never touching the fog edge                adventure withholds)
```

The one line to take from this drawing: **in atlas, "Beck Rd" is legible inside the fog.** That
is D-051 discharged, and it is the reason atlas exists at all.

### 4.8 Loading, offline, and narrow windows

- **First paint is from cache, always** (§2.4): the last `explored-r11.<gen>.bin` (D-237) and cached tiles
  from IndexedDB render before any network call. The map is never blank while a request is in flight.
- **Missing tiles render as the flat basemap background** *(stock `light`'s, D-373; this said
  "flat parchment")*, never as a grey checkerboard and never as a spinner
  over the map. A hole in the basemap is a cosmetic gap; a checkerboard is an error message about
  something the user cannot fix.
- **Fog never waits on tiles.** Coverage is client-side and draws over whatever basemap has
  arrived, so an offline map still shows the correct shape of your territory.
- **WebGL context loss** (05 §4.5) rebuilds silently. If the rebuild fails, the map falls back to
  a static basemap *(stock colours, D-373)* with the trace web drawn as plain DOM-free canvas lines, and the
  plinth is untouched. The numbers never depend on the graphics (§3.4).
- **The desktop is not a case here any more — it is the document** (D-251, D-313). This bullet
  used to be the whole desktop adaptation ("the plinth becomes a fixed left rail at ≥1024px");
  §2.2 now specifies that rail in full, §4.4 is the mouse-and-keyboard table, and §4.2 carries
  `M`.
- **Below 1024px** the rail's content stacks as a card over the map and the controls keep their
  corners (§2.2). There are no narrow-only features and no narrow-only removals, because either
  would be a second product to maintain (P9).

---

## 5. The skills panel

### 5.1 The reference, and what we actually take from it

Runescape's skills tab is the explicitly-loved model (§1.3, D-030). It is worth being precise
about *why* it works, because copying its surface without its logic gives you a spreadsheet.

What it gets right, and what we take:

- **Every skill is on one surface, always, at a fixed position.** You learn the layout with your
  eyes, not by reading. Tile 3 is Fortitude forever.
- **One glance = one number per skill.** The level. Everything else is a tap away.
- **Total Level lives in the panel**, as the summary of the grid it sits in, in the pinned header
  and only there. RS also repeats it in the grid's corner; we did, until the operator found the
  second copy redundant with the header always in view (**D-289**).
- **A skill you have never trained still exists.** The panel shows you the shape of the whole
  game, not just the part you have played.

What we do *not* take:

- **No tooltips.** A pointer can hover, but a tooltip is information that only a mouse can find —
  not the keyboard, not a screen reader, not a glance. Everything RS puts in a tooltip goes into
  the detail dialog (§5.5), one click away. *(This bullet used to rest on "there is no hover on a
  phone", D-124; the conclusion survives D-251 on its own reasons.)*
- **No experience-per-hour, no goals, no ranks.** RS's panel is one click from a hiscores page.
  Ours is not, and never will be (N1, N4).
- **No fixed 3×8 board.** RS knows its 23 skills forever. We do not know ours — D-031 says a new
  workout type is a data row, and D-132 has already added one. The layout must grow.

### 5.2 Wireframe

```
┌──────────────────────────────────────────────┐
│  ←   SKILLS                                  │  ← app bar, back to /   
│ ┌──────────────────────────────────────────┐ │
│ │        ✦  TOTAL LEVEL  271               │ │  ← pinned header, never scrolls
│ │        ▓▓▓▓▓▓▓▓▓▓▓░░░░░░░  next: 300     │ │
│ │        Total XP  1,885,603               │ │
│ └──────────────────────────────────────────┘ │
│                                              │
│  ACTIVITY                                    │  ← section label, --ink-500, 12sp
│ ┌───────────┬───────────┬───────────┐        │
│ │    ⚹      │    ✥      │    ✜      │        │
│ │ Wayfaring │   Might   │ Fortitude │        │
│ │    47     │    31     │    28     │        │
│ │ ▓▓▓▓▓▓░░░ │ ▓▓▓░░░░░░ │ ▓░░░░░░░░ │        │
│ ├───────────┼───────────┼───────────┤        │
│ │    ⧗      │    ◈      │           │        │
│ │ Endurance │   Vigil   │           │        │
│ │    24     │     9     │           │        │
│ │ ▓▓▓▓▓░░░░ │ ▓▓░░░░░░░ │           │        │
│ └───────────┴───────────┴───────────┘        │
│                                              │
│  META                                        │
│ ┌───────────┬───────────┐                    │
│ │    ◇      │    ❖      │                    │  ← skills only: no crest tile.
│ │Cartography│Constitution│                   │    Total Level is the header's
│ │    52     │    58     │                    │    alone (D-289)
│ │ ▓▓▓▓░░░░░ │ ▓▓▓▓▓▓▓░░ │                    │
│ └───────────┴───────────┘                    │
│                                              │
│ ┌──────────────────────────────────────────┐ │
│ │  NEXT                                    │ │
│ │  ~9 runs to Wayfaring 48                 │ │  ← one line. Not a list.
│ └──────────────────────────────────────────┘ │
│                                              │
│  ▸ Untrained (2)                             │  ← collapsed. Slayer, Burpees…
└──────────────────────────────────────────────┘
```

Tile: 104 × 104dp, 8dp gutter, three across at 360dp width. **Five across at ≥1024px**, the
desktop breakpoint §2 already uses, with the panel widening to hold them (**D-289**). Two fixed
layouts and nothing between them — never `auto-fill`, which would reflow the grid on every resize
and make a tile's position depend on the window. On any one device the position stays a constant. Sigil 28dp, skill name 12sp
`--ink-600`, level 24sp `--ink-900` tabular figures, progress bar 3dp full-tile-width.

### 5.3 The rules that keep it readable in year ten

This panel has to survive an unbounded number of workout types (D-031) without ever becoming a
wall. Six rules do that work:

**1. Sections, not one list.** `ACTIVITY` / `META` / `Untrained`. A new workout type appends to
`ACTIVITY` and nothing else moves. Sections cap the *perceived* length of the panel: you never
scan more than one group to find a skill.

**2. Registry order, forever. Never sorted by level.** Sorting by level makes the panel a ranking
of your own body against itself (N4) and, worse, makes tiles move — which destroys the muscle
memory that is the entire reason RS's panel works. The order is `rules/xp-rules-v1.yaml`'s order
(04 §1.3). New skills append; existing skills never move.

**3. Untrained skills collapse.** A skill you have never once trained sits inside a collapsed
`▸ Untrained (n)` row at the bottom, showing name and level 1 when expanded. This is how the
panel holds twenty workout types without twelve dead tiles diluting the eight live ones — and it
still satisfies RS's "show me the whole game," just one tap down.

**4. The grid scrolls; the header does not.** Total Level and Total XP are pinned. They are the
two numbers P5 promises in two seconds, and they must not require a scroll at any skill count.

**5. Meta skills are tinted, not just labelled.** Activity bars fill `--gold-700` *(D-291; was `--gold-500`)*; meta bars fill
`--verdigris-500`. You can tell what kind of skill you are looking at without reading the section
header, which matters when the panel is long enough that the header has scrolled away.

**6. Nothing on this screen is an instruction.** No targets, no "train this," no neglected-skill
warnings, no decay. A skill at level 3 that you have not touched in a year looks exactly like a
skill at level 3 you trained yesterday (D-013, H2).

### 5.4 Vigil, and what it proves (D-132)

**Vigil is already the fifth activity skill.** It arrived in Round 4, after 04 §1.2 was written,
which makes it the first live test of D-031's promise that a new skill is a data row.

The panel-side test is exactly this: adding Vigil must require **no layout change, no new
section, no special case, and no design review.** In the wireframe above it is simply the fifth
tile. If a future workout type needs anything more than a row in the registry and a sigil in the
icon set, the schema is wrong — D-132 says so in the strongest terms available.

Two consequences worth writing down before someone hits them:

- **The MVP ceiling moves — and it has now moved three times.** This bullet originally said
  594 → 693. Vigil (`0028`) then Roving and Cadence (`0157`) each moved it again, and each was a
  data-only change. **Corrected by `0031`: 04 §1.2 no longer states a number, it states the
  arithmetic** — enabled rows × `maxLevel`, which is 9 × 99 = **891** at `v1`. Do not restate the
  figure here or anywhere else; that is what made it wrong three times. The plinth's milestone
  ladder is affected after all: see 04 §4.3 on the gap above 500.
- **Adding a skill mints a free Total Level point**, because Total Level sums every skill in the
  ruleset and an untrained skill is level 1. That is a *bookkeeping* increment, not an
  achievement. **It must never fire a level-up card** (§3, Beat 3) and must never appear in a
  ledger. If it happens to cross a Total Level milestone, suppress the milestone until the next
  genuinely-earned point crosses it. A celebration you did not earn devalues every one you did.
  **Amended by D-276 (09 audit, 2026-10-02), per D-257:** a skill minted since the `before`
  snapshot (`introducedIn > before.rulesVersion`, or — **D-300** — a row that existed but was not
  enabled, so did not count, when the snapshot was taken) yields **no level-up card at any level** in that
  first diff — including a level genuinely earned in that same activity. Deliberate; the next diff
  treats it normally. The guard is a pure function in `src/scoring/celebrate.ts`, consumed at the
  notification layer.
  **Superseded for the cards by D-297 (`0082`, 2026-10-13; recorded here at the `12` audit,
  2026-10-15).** The cards that actually play (`lib/level-up/cards.ts`, on `/run/:id` and `/log`)
  do not diff snapshots. A card exists only for a level **this activity's XP bought**, so a minted
  skill's free level 1 crosses nothing and the per-skill half of the guard falls out of
  attribution — and a minted skill's own *earned* levels (its first 1 → 2) **do** get cards.
  Total Level milestones are judged on an **earned** total: the real Total Level minus the free
  level of every enabled skill `isMinted` against one fixed baseline, the first ruleset that
  shipped (`BASELINE`, D-297/D-300). The snapshot-diff rule above still governs `0065`'s
  `celebrableLevelUps`, which no card path calls today.

### 5.5 The skill detail sheet — `/skills/:skillId`

Clicking any tile opens a dialog over the panel (§1.5: a route so back and deep links behave; §2.5
on why it has a scrim and the Chronicle does not). At a narrow window it rises from the bottom
edge instead of centring, as `0074` built it.

```
┌──────────────────────────────────────────────┐
│  ▁▁▁▁▁▁                                      │
│    ⚹   WAYFARING                             │
│        Level 47                              │
│        ▓▓▓▓▓▓▓▓░░░░░░  7,748 / 8,836         │
│        1,088 XP to 48   ·   ~9 runs          │  ← 04 §4.1's requirement, verbatim
│                                              │
│  Ground covered. 100 XP per kilometre;        │
│  half on ground you have run before.          │
│                                              │
│  ──  RECENT  ──────────────────────────────  │
│   Thu 28 Aug   8.4 km        +680            │
│   Sun 24 Aug   12.1 km       +915            │
│   Tue 19 Aug   5.1 km        +255            │
│   … 7 more                                   │
│                                              │
│  ──  AHEAD  ───────────────────────────────  │
│   50   Adept             ~4 months           │
│   75   Veteran           ~3 years            │
│   99   Mastery           ~11 years           │
│                                              │
│  ──  ON THE MAP  ──────────────────────────  │
│   ◈ Cairn at Level 25 — Beck Rd    → fly to  │
│                                              │
└──────────────────────────────────────────────┘
```

- **`~9 runs to 48` is required, not decorative** (04 §4.1). A percentage that moves 1.8% reads
  as nothing; "nine runs away" reads as a plan. It is computed from that skill's own trailing
  median session, so it is honest and it improves as you do.
- **`AHEAD` is the milestone ladder** with tier names (04 §4.3 — one ladder for every skill,
  **D-290**; earlier drafts of this mockup showed per-skill names, which no registry field
  carries) and an *estimate*, not a target.
  The estimates are deliberately shown at low precision — "~3 years" — because a precise date is
  a deadline, and a deadline is N2.
- **`ON THE MAP` is the payoff of place-bound milestones** (04 §4.3): the ones that put something
  on the map get a row here and a `→ fly to` that closes the sheet and flies the map there. This
  is the only navigation out of the sheet, and it points at the map, which is correct (P4).
  The rows are the `Landmark` records the pipeline writes as 50 and 99 are crossed (ticket `0248`,
  D-301), labelled `Cairn at Level 50` / `Shrine at Level 99`, followed by the street at it (or,
  failing that, the place) from the basemap's own archive (D-302, ticket `0263`) — `Cairn at Level
  50 — Kelp Street`. The name is read on every open, never stored, and the row draws without it
  until the archive answers. One earned on an activity with no route is listed without
  `→ fly to`. A skill with none omits the heading rather than showing it empty.
  The place `→ fly to` lands on is marked: every located `Landmark` is drawn on the home map as a
  cairn or a shrine (a torii), above the fog (ticket `0260`, `05` §4.4). The flight lands at z16
  (`AT_ZOOM`), closer than home's z14, because it names one spot rather than a neighbourhood.
- **`RECENT` is ten rows, not a history.** It is there to answer "is this thing moving," not to
  be browsed. Full history is the Chronicle's job.
- No charts. A line going up over time is a stats page (§1.4) and it invites comparison with your
  past self (N4). The bar and the ladder are enough.

---

## 6. Add workout (D-061)

### 6.1 The decision, and what it is protecting

D-061 is unusually specific, and its reasoning is the design:

> UI: an **"Add workout" button**, NOT per-exercise buttons on the home screen. It opens a
> dedicated page with multiple quick-log entries, one row per workout type. **Chosen
> specifically so adding future workout types does not clutter the home screen.**

The decision is not really about the home screen's tidiness. It is about **where growth lands.**
Per-exercise buttons put every future workout type on the most valuable surface in the app,
where each one competes with the map (P4) and where the fifth one forces a redesign. One button
routing to one page moves that growth to a page whose only job is to hold rows — and rows are the
one UI shape that scales without anyone thinking about it.

Everything in §6 follows from that: `/log` is a **list of rows generated from the skill registry**
(04 §1.3), and adding a workout type is adding a row to a YAML file. No layout decision, no
review, no ticket.

### 6.2 What the page is for, physically

~~The user is standing in a hallway, breathing hard, holding the phone in one hand, possibly with
sweat on the screen. That is the design brief.~~ *Amended by D-288 (`10` audit, 2026-10-07), per
D-251:* `/log` is a **desktop-browser** page. The phone is neither a viewing nor an input surface,
and the operator has said they do not log from it. The brief is a person at their desk just after
a workout who wants it recorded and gone. Two consequences, both non-negotiable:

- **One click logs the common case.** D-062: one-tap quick log for MVP.
- **Nothing waits on the network.** The page renders from cache; the write goes to IndexedDB and
  syncs behind you.
- ~~**Every interactive target is in the right-hand thumb arc and at least 56dp** (§9.2, §9.3).~~
  *Withdrawn by D-251.* Targets are ordinary desktop controls, and the page must still not break
  at a narrow width.

Target: **from the plinth's "Add workout" to logged, under three seconds, without looking twice.**

### 6.3 Wireframe

```
┌──────────────────────────────────────────────┐
│  ←   ADD WORKOUT                             │
│                                              │
│  ┌──────────────────────────────────────────┐│
│  │ ✥  MIGHT              pushups            ││
│  │                                          ││
│  │   ┌───┐   ┏━━━━━━━┓   ┌───┐   ┌────────┐ ││
│  │   │ − │   ┃  30   ┃   │ + │   │  LOG   │ ││  ← LOG on the right
│  │   └───┘   ┗━━━━━━━┛   └───┘   └────────┘ ││    edge (D-288)
│  └──────────────────────────────────────────┘│
│  ┌──────────────────────────────────────────┐│
│  │ ✜  FORTITUDE          situps             ││
│  │   ┌───┐   ┏━━━━━━━┓   ┌───┐   ┌────────┐ ││
│  │   │ − │   ┃  40   ┃   │ + │   │  LOG   │ ││
│  │   └───┘   ┗━━━━━━━┛   └───┘   └────────┘ ││
│  └──────────────────────────────────────────┘│
│  ┌──────────────────────────────────────────┐│
│  │ ⧗  ENDURANCE          plank              ││
│  │   ┌───┐   ┏━━━━━━━┓   ┌───┐   ┌────────┐ ││
│  │   │ − │   ┃ 1:30  ┃   │ + │   │  LOG   │ ││
│  │   └───┘   ┗━━━━━━━┛   └───┘   └────────┘ ││
│  └──────────────────────────────────────────┘│
│  ┌──────────────────────────────────────────┐│
│  │ ◈  VIGIL              treadmill / track  ││  ← D-132. Appeared as a
│  │   ┌───┐   ┏━━━━━━━┓   ┌───┐   ┌────────┐ ││    registry row. Nothing
│  │   │ − │   ┃ 5.0km ┃   │ + │   │  LOG   │ ││    else changed.
│  │   └───┘   ┗━━━━━━━┛   └───┘   └────────┘ ││
│  └──────────────────────────────────────────┘│
│                                              │
│              ▼  scrolls as types accumulate  │
└──────────────────────────────────────────────┘
```

Immediately after a tap, that row — and only that row — becomes:

```
  ┌──────────────────────────────────────────┐
  │ ✥  MIGHT   30 pushups                    │
  │    Might +120  →  L31        ⟲ Undo  7s  │  ← gold, 6dp bar wipe on the
  └──────────────────────────────────────────┘     skill bar, then settles
```

### 6.4 Row anatomy and the interaction rules

| Element | Behaviour |
|---|---|
| **Sigil + skill name + unit label** | From the registry. The unit label is the *plain-English* one (`pushups`, `plank`, `treadmill / track`), because "reps" and "seconds" are schema words |
| **The number** | Pre-filled with **your last logged value for this type**, not a goal, not an average, not a target. Tap it → numeric keypad, select-all on focus |
| **− / +** | Step by the exercise's `entry` kind (D-282): pushups ±5, situps ±5, plank ±15 s, Vigil ±0.5 km (D-286; a distance row also takes an optional time). Long-press repeats at 4/s. Clamped at the registry's `minUnitsForCredit` |
| **LOG** | Commits *that row* immediately. No page-level save button, no "done", no dialog |

**Committing.** The write lands in IndexedDB before the animation starts, is rendered
optimistically, and flushes to the API on a background-sync queue with an idempotency key — the
same machinery §7 uses for tickets, and the reason it is worth building once. A failed flush
retries silently and is never surfaced as an error on this page.

**Undo, 8 seconds, in-row.** This is the one place the app permits a destructive action, and it
needs a way back: a mis-tap that logs 30 pushups you did not do writes a permanent number into a
record whose whole value is that it is true. Undo is not upkeep (D-013) — it costs nothing when
unused and it never asks for anything.

**Level-ups still interrupt.** If a log crosses a level, the §3 Beat 3 card plays over the page,
identically. Strength work earns the same celebration running does — D-131 is explicit that
levels mean the same thing across disciplines, and the UI must not quietly disagree.

**What does not happen:** no reveal sequence (there is no territory), no navigation away, no
toast, no "workout saved!" confirmation banner. The row itself is the confirmation.

### 6.5 How a new workout type arrives

The whole point of D-061, stated as a procedure:

1. Add a row ~~to `rules/xp-rules-v1.yaml`~~ *(amended by D-288: to **a new
   `rules/xp-rules-vN.yaml`**, the newest version plus the row, because a shipped version is never
   edited — 02 §3.8, 04 §7.6, D-282. The operator's ledger moves onto it by a replay that moves no
   XP, as v3 did under D-286)* (04 §1.3): `id`, `name`, `kind: activity`, `logMode`,
   `unit`, `xpPerUnit`, `feeds: constitution`, and an `exercises` entry (`id`, `label`, `entry`,
   `quickValues`). The stepper's step comes from `entry` (D-282), not from the row.
2. Add one sigil to the icon set.
3. Ship.

`/log` gains a row at the bottom. `/skills` gains a tile in `ACTIVITY`. The home screen changes
by **zero pixels**. No component is written, no layout is revisited, no screen is redesigned.
That is the test D-031 and D-132 set, and it is the same test in both documents.

Two supporting rules keep it true:

- **Registry order, forever** — the same rule as §5.3. Rows never reorder by frequency,
  recency or level. A row that moves is a row you mis-tap.
- **When the page outgrows one screen, it scrolls.** It does not gain sections, tabs, search,
  favourites, or a "frequent" group. Those are all ways of reordering, and reordering is the
  thing we just forbade. Ten types is one short scroll; that is fine.

### 6.6 What is deferred, and how it fits later without a redesign

D-062 defers sets, reps-per-set and a rest timer, but requires the data model accommodate sets
from day one. The UI's forward path, so nobody has to invent it under pressure:

- Each quick log writes **one set** — `[{reps: 30}]` — not a scalar. The row is already logging
  the deferred shape.
- The post-MVP sets editor is opened by **an explicit control on the row** — not a long-press,
  which a mouse cannot discover (D-253's reasoning; this said "long-press on the row" until
  `0187`) — and shows per-set entry and a rest timer. The row's logging controls do not change,
  the page does not change, and one-click logging keeps working exactly as it does today.
- A rest timer is the one deferred feature that could violate D-013 — a timer is a thing that
  *runs*, and things that run create obligations. If it lands, it must be startable only from
  inside the sets sheet, must never notify, and must die when the sheet closes.

---

## 7. Ticket capture UI (D-092)

> **SUPERSEDED BY D-252 (2026-09-28).** There is no in-app ticket UI. D-092 is struck, and
> capability `17` is withdrawn with `0107`–`0111` declined. This section is kept as the record of
> what was designed. Build nothing from it.

`07-ticketsmith.md` §5 is the specification. This section is the UI half of it: placement,
wireframes, and the reasons the constraints are what they are. **Where the two documents appear
to differ, 07 wins.**

### 7.1 Why it is in this app at all

D-090 puts the ticket system in the project from day one; D-092 requires manual ticket creation
from the app UI, phone-friendly. Living inside Lost Soles rather than in a second tool is a
practical decision (07 §5.1): it inherits the PWA shell, the session, and the home-screen icon.
There is no second app to install and nothing else to log into with cold hands.

The capture is real and it is specific: **the idea you have at the end of a run.** That is the
moment this exists for, and it is a moment measured in seconds — you are standing outside, you
are out of breath, and if capture costs ninety seconds the thought is gone (07 §5.2).

**v1 is create + browse only** (D-093, 07 §2.2 Move 2). The phone writes into `tickets/inbox/`;
the agent edits, numbers and moves. Disjoint write sets, no merge conflicts, no sync engine.
**No editing in the UI is not a missing feature — it is the mechanism.**

### 7.2 Placement and access

- Route `/dev/tickets`, owner-gated by a hard allowlist on top of the session (07 §5.1).
- **Not on the plinth.** It is off the main path (§1.2) and reached from `/settings`, plus a
  PWA shortcut (long-press the home-screen icon → `New ticket`), which is the fastest path and
  the Android-native one (D-124).
- **The shortcut opens the capture sheet directly**, not the browse list. The thing you are
  there to do is write one sentence.

### 7.3 Capture

```
┌──────────────────────────────────────────────┐
│░░░░░░░░░░░  scrim over /dev/tickets ░░░░░░░░░│
│ ┌──────────────────────────────────────────┐ │
│ │ ▁▁▁▁▁▁                                   │ │
│ │  NEW TICKET                              │ │
│ │ ┌──────────────────────────────────────┐ │ │
│ │ │ Cold ground wash is too blue at z16▌ │ │ │ ← autofocused, keyboard
│ │ └──────────────────────────────────────┘ │ │   already up
│ │ ┌──────────────────────────────────────┐ │ │
│ │ │ (optional detail)                    │ │ │ ← 3 rows, grows
│ │ │                                      │ │ │
│ │ └──────────────────────────────────────┘ │ │
│ │  ⟨feature⟩ ⟨bug⟩ ⟨▓design▓⟩ ⟨chore⟩      │ │ ← single-tap chips
│ │  ⟨low⟩ ⟨▓med▓⟩ ⟨high⟩                    │ │
│ │                          ┌─────────────┐ │ │
│ │                          │    SAVE     │ │ │ ← bottom-right, above the
│ │                          └─────────────┘ │ │   keyboard, 56dp
│ └──────────────────────────────────────────┘ │
└──────────────────────────────────────────────┘
```

Title is the only required field; type defaults to `feature`, priority to `med` (07 §5.2).

Interaction requirements, all from 07 §5.2 and all testable:

- **Autofocus the title and raise the keyboard on open.** No tap to focus.
- **Voice dictation must work.** It is the fastest input mid-recovery, and it is why the title is
  a plain text field with no formatting affordances, no markdown toolbar, and no `#` autocomplete.
- **Chips are single-tap.** No dropdowns, no long-press, no multi-select.
- **Save dismisses immediately. Never show a spinner.** The write is local; the network is not
  the user's problem.
- **Resist every temptation to add fields** — acceptance criteria, capability picker, size
  estimate, dependencies, slug. All of that is triage's job, done later, at a keyboard, by
  someone who can think (07 §4.5, §5.2).

### 7.4 Offline, and the only sync UI there is

Connectivity outdoors is unreliable, and capture must never fail visibly (07 §5.3):

1. Save writes to **IndexedDB immediately** and the item renders optimistically at the top of the
   browse list with a `pending` marker.
2. A background-sync queue flushes to `POST /api/tickets/capture` with exponential backoff and a
   client-generated UUID as an idempotency key, so a retried flush cannot create two files.
3. A small **`2 pending`** badge appears in the app bar whenever the queue is non-empty. That
   badge is the *entire* sync UI. **There is no manual sync button**, no error toast, no retry
   dialog, and no red state — a failed flush that is still retrying is not a user-facing event.

### 7.5 Browse

```
┌──────────────────────────────────────────────┐
│  ←   TICKETS                    2 pending    │
│  ⟨open⟩ ⟨bug⟩ ⟨high⟩                          │ ← filter chips: status,
│                                              │   type, priority, capability
│  ── UNTRIAGED  (3) ───────────────────────── │
│   ◦  Cold ground wash too blue at z16        │ ← inbox items pinned on top
│   ◦  Undo on /log should survive backgrounding│
│   ◦  Vigil sigil reads as a compass          │
│                                              │
│  ── fog-rendering ─────────────────────────  │ ← grouped by capability
│   #0042 · feature · high · Half Wayfaring…   │
│   #0051 · bug · med · Mask FBO leaks on…     │
│                                              │
│  ── ingestion ─────────────────────────────  │
│   #0037 · chore · low · Archive raw traces…  │
└──────────────────────────────────────────────┘
```

Read-only, from the cached mirror (07 §5.4, §5.7). Default filter `status != closed`, grouped by
capability, sorted priority-then-id within a group. Untriaged inbox items pin to the top with a
distinct treatment, so you can see your capture landed **and watch the untriaged pile grow** —
which is the honest signal that triage is owed, and the only pressure the system ever applies.

Tapping a row opens the detail view (07 §5.5): rendered markdown, acceptance criteria as
**read-only** checkboxes, `depends_on` / `blocked_by` as tappable links with inline status.

### 7.6 v1 non-goals, restated because they will be argued with

No editing, no closing, no reordering, no comments, no kanban board, no charts, no
notifications, no assignment (07 §5.6). Every one of those either breaks the write-set
disjointness that makes the whole storage design work (07 §2.2), or is a feature that would be
used exactly twice.

And the constraint that governs the ticket system is the constraint that governs the app: a
capture form that takes ninety seconds is a capture form that does not get used, and a tool whose
upkeep exceeds its value gets abandoned (D-013).

---

## 8. Visual system

### 8.1 The constraint that shapes the whole palette

D-050 asks for dark fantasy — ink, parchment, lantern-light, gold leaf, deep navy. The naive
reading of that brief is a dark app. **R4 and D-053 rule it out for the map**, and the reasoning
is worth restating because it governs the chrome too:

> With a dark basemap, dark fog has almost no contrast against unexplored ground and **the reveal
> does not read at all.** The only fix would be to brighten explored ground instead, which means
> a framebuffer readback — expensive, awkward, and it discards the additive-only shader
> (05 §5.1).

So the map is **warm parchment with near-black-blue fog**, in both themes, forever. *(D-373: the
map's ground is now stock Protomaps `light`, not parchment — the operator rejected the parchment
recolouring as a filter over the map. It is still a light ground under dark fog, so the argument
above stands; the chrome below keeps its parchment.)* The
consequence for this section is that **UI chrome must sit comfortably against parchment first**,
and against dark fog second — not the other way round. The dark fantasy lives in the *ink*, the
*fog*, the *gold*, and the type; it does not live in a dark background behind the map.

One rule falls straight out of that and it is absolute:

> **No translucent chrome over the map.** A floating control at 85% opacity over a surface that
> swings from `#F5EDD9` parchment to `#0B1020` fog within one screen is illegible in one of the
> two states, and which one changes as you pan. Every floating control — the mode toggle, the
> recentre button, the plinth, the run-disambiguation card — is **opaque**, with a 1dp hairline
> and a soft warm shadow. No glass, no backdrop blur.

### 8.2 Primitive tokens

Six ramps. Nothing outside them ships.

```
/* Ink — the dark neutral. Blue-shifted, never neutral grey, never pure black. */
--ink-900  #14161C      --ink-600  #414A5E      --ink-300  #A9B3C2
--ink-800  #1E2230      --ink-500  #5C687F
--ink-700  #2C3242      --ink-400  #8592A6

/* Parchment — the light neutral. Warm, low saturation, high lightness (05 §5.1). */
--parch-50  #FBF6E9     --parch-200 #EDE2C6     --parch-400 #CDBB90
--parch-100 #F5EDD9     --parch-300 #E0D2AE

/* Deep navy — sheets, scrims, the dark theme's ground. */
--navy-900 #0B1020      --navy-800 #121A2E      --navy-700 #1A2237

/* Gold leaf — progress, level-ups, the selected state. Never an error colour. */
--gold-300 #E8C87A      --gold-500 #C9A227      --gold-700 #97761A

/* Lantern — the frontier, the route, the reveal. Fixed by 05 §4.4; do not retune. */
--lantern-300 #FFD79A   --lantern-500 #FFB347   --route-core #FFF2D0

/* Verdigris — meta skills only (§5.3 rule 5). Aged copper on an old map. */
--verdigris-500 #3E7C72 --verdigris-300 #6FA79C

/* Three one-offs, each with exactly one job. */
--cold-wash #7E93AD     /* §4.6, atlas only, multiply blend        */
--oxblood   #8C2F27     /* destructive confirm in /settings. Only. */
--frost-400 #7FA8C9     /* §3.2 beat 1, re-armed ground. Only (D-295) */
```

**Never `#000000`, never `#FFFFFF`.** Pure black on parchment reads as a printing error; pure
white on navy vibrates. `--ink-900` and `--parch-50` are the extremes.

### 8.3 Semantic tokens

| Token | Light (default) | Dark |
|---|---|---|
| `--bg` | `--parch-100` | `--navy-900` |
| `--surface` | `--parch-50` | `--navy-800` |
| `--surface-raised` | `--parch-50` | `--navy-700` |
| `--text-primary` | `--ink-900` | `--parch-100` |
| `--text-secondary` | `--ink-600` | `--ink-300` |
| `--text-muted` | `--ink-500` | `--ink-400` |
| `--text-chronicle` | `--ink-700` | `--parch-100` |
| `--line` | `--ink-400` @ 0.35 | `--parch-100` @ 0.18 |
| `--accent` | `--gold-500` | `--gold-300` |
| `--accent-text` | `--gold-700` | `--gold-300` |
| `--scrim` | `--navy-900` @ 0.72 | `--navy-900` @ 0.82 |
| `--progress-activity` | `--gold-700` *(D-291)* | `--gold-300` |
| `--progress-meta` | `--verdigris-500` | `--verdigris-300` |
| `--destructive` / `--on-destructive` | `--oxblood` / `--parch-50` | same — theme-invariant |
| `--route-glow` / `--route-line` | `--lantern-500` / `--route-core` | same — on the map |
| `--trace-line` | `--ink-300` | same — on the map |
| `--landmark-stone` / `--landmark-shrine` / `--landmark-ink` | `--parch-200` / `--gold-500` / `--ink-900` | same — on the map |

`--text-chronicle` is §3.2 beat 4's chronicle line (`0083`), the one text between primary and
secondary. `--destructive` is `/settings`' delete confirm and nothing else (`0089`). The route
(`0057`), trace (`0085`) and landmark (`0260`) tokens sit on the map, and the dark theme does not
darken the map, so they are deliberately absent from the dark theme. The unseen-run marks — the
plinth's `1 new run` rule and pulse, the Chronicle row's inset — are `--accent-text`, never
`--accent`: they carry meaning, and `--gold-500` is 2.1:1 on parchment *(D-335)*.

**The dark theme does not darken the map.** It restyles chrome and switches the basemap to its
*night parchment* variant — the same tiles at −8% lightness and +4% warmth — because a dark
basemap breaks the reveal (§8.1). *(D-373: there is no night parchment; the basemap is stock
`light` in both themes, which is what "does not darken the map" already required.)* Theme follows the system. ~~It has a manual override in
`/settings`~~ — *amended by ticket `0089`: `/settings` holds no preference control of any kind, so
the app offers no visual preference at all.*

**Measured contrast, so nobody has to guess:**

| Pair | Ratio | Verdict |
|---|---|---|
| `--ink-900` on `--parch-100` | **15.4:1** | Body text |
| `--ink-600` on `--parch-100` | **7.6:1** | Secondary text. AA at any size |
| `--ink-500` on `--parch-100` | **4.8:1** | AA for normal text, and the floor. Nothing lighter carries text |
| `--gold-700` on `--parch-100` | **3.7:1** | **Large text only** (≥24sp, or ≥19sp bold). Never body copy |
| `--gold-300` on `--navy-900` | **11.7:1** | The dark theme's accent text, unrestricted |
| `--gold-500` on `--parch-100` | 2.1:1 | **Fills and rules only. Never text, at any size** — and never a fill that carries meaning (D-291) |
| `--gold-700` on `--parch-50` | **3.95:1** | Activity progress fill: passes 3:1 as a non-text graphic (D-291) |
| `--verdigris-500` on `--parch-50` | **4.49:1** | Meta progress fill |

That last row is the palette's one genuine trap: gold leaf is the app's signature and it is a
poor text colour on parchment. Where gold must carry meaning in type — the level-up card — it
is either large (`--gold-700`, ≥24sp) or it sits on navy, where it is excellent. The plinth's
`1 new run` is not gold type: it is ink text with an `--accent-text` rule (§2.4, D-335). Elsewhere gold is the *fill* of a bar and `--ink-900` is the number beside it.

### 8.4 Typography

Two families, both open-licence, both self-hosted (no third-party font CDN on a page that must
render offline, §4.8).

- **Spectral** — serif. Display numerals, level headings, milestone tier names, and the chronicle
  line (§3, Beat 4, already specified as Spectral Italic 17sp). It carries the setting's voice.
- **Inter** — UI. Labels, buttons, chips, tables, ticket rows, settings. Anything you read to
  operate rather than to enjoy.

| Role | Family / weight | Size | Line height | Notes |
|---|---|---|---|---|
| Display | Spectral 600 | 34sp | 1.15 | Level-up card number only |
| Total Level | Spectral 600 | 28sp | 1.20 | The largest type on `/` |
| Title | Spectral 600 | 22sp | 1.25 | App bars, sheet headings |
| Skill level (tile) | Spectral 600 | 24sp | 1.10 | Tabular figures |
| Headline | Inter 600 | 17sp | 1.35 | Plinth rows, ticket titles |
| Chronicle | Spectral **italic** 400 | 17sp | 1.50 | §3 Beat 4 |
| Body | Inter 400 | 15sp | 1.50 | Prose, detail sheets |
| Label | Inter 500 | 13sp | 1.30 | Buttons, chips |
| Section rule | Inter 600, uppercase, `+0.08em` | 12sp | 1.20 | `ACTIVITY` · `META` · `AHEAD` |
| Caption | Inter 400 | 12sp | 1.35 | Timestamps, units |

**Nothing renders below 12sp, anywhere.** Not a unit suffix, not a timestamp, not a legend.
The reading distance is a monitor at arm's length, often glanced at rather than read (P5).

**All numerals are `font-variant-numeric: tabular-nums`.** Every number in this app either counts
up in an animation (§3, Beat 2) or sits in a column, and proportional figures make both jitter.

**Never letterspace lowercase Spectral.** Only uppercase type is tracked: the Inter section rules,
and uppercase Spectral where it is used — the level-up card's name and tier rules, and the ledger's
`RETURN FROM THE FOG` (D-297; *amended at the `12` audit, 2026-10-15*).

### 8.5 Spacing, shape and elevation

- **4dp base grid.** Permitted steps: `4 · 8 · 12 · 16 · 24 · 32 · 48`. Nothing else.
- **Screen margin 16dp.** Card padding 16dp. Grid gutter 8dp.
- **Radii:** controls and cards 8dp; sheets 16dp on the top corners only; chips 999dp (pill);
  the map's floating controls 8dp. One radius per role, no per-component variation.
- **Elevation is a hairline plus a warm shadow, not a material stack.** Neutral grey shadows on
  parchment read as dirt. Use `0 2dp 8dp rgba(20,22,28,0.10)` plus a 1dp `--line` border. Two
  levels only: flat, and raised (cards, floating controls, sheets). There is no level three.
- **Scrim** for every sheet and every level-up card: `--scrim`, fading in over 120ms.
- **Interactive targets:** never below 24 × 24px (WCAG 2.2 SC 2.5.8), 32px for ordinary chrome and
  rows, 40px for the plinth's destinations and the map's floating controls, 8px between adjacent
  targets. *(This was "56dp minimum touch target" until D-251 removed the touch case.)*

### 8.6 Iconography

- **Sigils** (skills, milestones, the frontier diamond): monoline, **1.5dp stroke**, 24dp box on
  an 8dp construction grid, no fills, no gradients, no two-tone. They are engraved marks on a
  map, not app icons.
- **Every sigil must be identifiable in silhouette, in one colour, at 24dp.** The review test is
  a peer naming the skill from the mark alone at arm's length. A sigil that needs its label is a
  sigil that has failed, and it will fail hardest in the skills grid where labels are 12sp.
- **The UI icon set is eight marks and stays that way:** back, settings, recentre, fit to
  territory, undo, plus, minus, frontier diamond. *(Fit to territory took the drag handle's
  place when D-253 made fit its own control and `0187` removed the plinth's handle.)* A ninth icon needs a justification the way a ninth screen
  does (§1.1).
- **No emoji, anywhere, ever.** They break the art direction and render differently per device.
- Icons inherit `currentColor`. No icon carries meaning by colour alone (§9.4).

### 8.7 Motion

Five durations. Nothing else is invented at the component level. These govern component chrome
— the plinth pulse, a camera fly. The post-run sequence is exempt: §3.2 is one
choreographed spec and keeps its own beat timings (700, 240, 180, 300, 500, 600, 900, 220 ms)
*(D-338)*.

| Duration | Used for |
|---|---|
| **120 ms** | State changes: chip selection, button press, scrim fade |
| **200 ms** | Exits and dismissals |
| **320 ms** | Sheet entry; the atlas ↔ adventure cross-fade (§4.3) |
| **400 ms** | The reveal wipe; the level-up card's gold border (§3) |
| **1400 ms** | One level-up card's full cycle (§3, Beat 3) |

Easing: `cubic-bezier(0.2, 0, 0, 1)` for everything. The **only** exception is the level-up
card's entry overshoot (`easeOutBack`, 1.02), already specified in §3 — it is the app's single
moment of exuberance and it is spent there deliberately.

**Five principles:**

1. **The map only animates when something happened.** Panning, zooming and the adventure-mode
   mist are the exceptions; nothing else on the map moves on its own. A map that idles with
   motion is a map you cannot read (D-051).
2. **Nothing loops except the mist** — 30 fps, adventure only, paused on `document.hidden`
   (05 §4.5). No pulsing buttons, no breathing badges, no shimmer.
3. **No spinners. Anywhere.** Cached content renders first (§2.4, §4.8); where there is genuinely
   nothing yet, a parchment-toned skeleton block holds the space. A spinner is an apology for
   architecture, and D-092's capture explicitly forbids one (07 §5.2).
4. **`prefers-reduced-motion` removes motion, never sequence** (§3.4). You still see the map
   before the numbers. Ambient mist stops, counting numbers become final, overshoots become
   fades, and the mode toggle becomes a hard cut.
5. **60 fps for anything under a finger, 30 fps cap for anything ambient.** Direct manipulation
   is the only thing allowed to spend the battery freely.

---

## 9. Accessibility and reality checks

Every screen in this document gets used in one physical situation: at a desk, in a desktop
browser, by someone who has come back from a run and wants to see what it did (D-227, D-251).
Most accessibility work is the same work as making that situation effortless, which is why they
are one section.

*(Until `0187` this section opened "outdoors, in daylight, one-handed", and §9.1–§9.3 were
sunlight, one-handed reach on a 6.8" Android phone, and sweaty thumbs. D-251 removed the phone as
a surface; what those sections required for their own sake is kept below, and what they
required only for the phone is gone. The numbering is kept so citations of §9.4–§9.6 hold.)*

### 9.1 Contrast and legibility

- **Contrast floor 4.5:1 for all text, 7:1 preferred** (§8.3 measures every pair). `--ink-500` is
  the lightest colour permitted to carry type; `--gold-500` carries none.
- **Nothing below 12sp** (§8.4), and no thin weights: Inter 400 is the lightest weight shipped.
- **No hairline-only affordances.** A 1px border may decorate a control but must never be the
  only thing that says it is a control — fill and label carry that.
- **Adventure mode at `u_maxOpacity` 0.94 is deliberately hard to read inside the fog.** That is
  the discovery beat (§4.3), and it is why atlas exists one click or `M` away (§4.2).
- **No auto-switching of the map mode** — not on the OS light/dark setting, not on the time of
  day, not on any sensor. A map that restyles itself is a map you cannot trust, and it would make
  the mode a thing you have to manage (D-013). The choice is the user's and it persists (§4.2).

### 9.2 Pointer and keyboard (D-253)

- **Everything is reachable from the keyboard**, in reading order (§2.2's focus order is the
  pattern for every screen). `Esc` closes whatever is open over a parent (§1.5).
- **The map takes keyboard input only while it holds focus**: arrows pan, `+`/`−` zoom. `M`
  toggles the mode anywhere the toggle is shown, except while a text field has focus. No other
  single-key shortcut is defined, and none is added without a decision.
- **No gesture is the only path to anything.** The mode toggle has its row and `M`; zoom has the
  wheel, double-click and `+`/`−`; fit-to-territory is its own control; every dismissal has Esc,
  a close control and back. There is no long-press and no drag handle. One swipe exists: below
  1024px a finger dragged down from a sheet's top dismisses it, touch only, never a mouse, and
  never the only way out — Esc, the close control and back still work *(D-314)*.
- **Hover never carries information** (§4.5, §5.1). It may change the cursor. Nothing appears on
  hover that is not also one click away.
- **Targets** follow §8.5: nothing below 24 × 24px, 40px for the plinth's destinations and the map
  controls, 8px between neighbours. A route line's click target is 24px either side (§4.4).
- **Undo, not confirmation dialogs.** `/log` works this way (§6.4, 8-second in-row undo). A confirm
  dialog asks for a second decision about a thing already decided; undo is one forgiving click,
  afterwards.
- **No drag-to-delete, no drag-to-reorder, no drag-and-drop anywhere.** They are hard to discover,
  impossible from the keyboard, and they always destroy something when they misfire.

### 9.3 Narrow windows

The "must not break" rule (D-251), as checks rather than a layout:

- **No horizontal page scroll** at any width down to ~360px, and nothing clipped or unreachable.
- **Below 1024px the rail becomes a bottom card** over the map, the Chronicle takes that card's
  place, and the right-edge map controls sit above it (§2.2). The skill dialog rises from the bottom
  edge (§5.5). Nothing else changes.
- **Nothing is optimised for a phone and nothing is tested on one.** A narrow window in the
  desktop browser is the test.

### 9.4 Vision, motion and assistive technology

- **Nothing is encoded by hue alone.** Activity vs meta bars differ in colour *and* live under
  separate section headers (§5.3). The selected route differs from the trace web in width and
  brightness, not hue (§4.5). Cold ground is a *desaturation* as much as a hue shift, so it
  survives deuteranopia and protanopia (§4.6) — and it gets a one-time three-swatch legend.
- **Browser zoom and text size to 200%.** Layouts reflow rather than truncate: the skills grid drops from three
  (or five, D-289) columns to two at ≥1.3× and to one at ≥1.8×; the rail scrolls internally rather than widening, and
  below 1024px the plinth card caps at 55% of the window height so the map keeps at least 45%
  (§2.2). Levels and XP never
  ellipsize; skill names may.
- **Screen readers** (NVDA, VoiceOver). The map is not a decorative image — its container carries a live text summary:
  *"Map. 12,480 cells revealed. Last run Thursday, 8.4 kilometres, 21 new."* Skill tiles announce
  *"Wayfaring, level 47, 88 percent to 48."* The §3 sequence announces each beat through a single
  `aria-live="polite"` region **in beat order**, so the reveal is narrated in the same sequence a
  sighted user sees, and the skip target is the whole screen.
- **Focus order follows reading order**, and every focusable element has a visible 2px
  `--accent` focus ring; the map's controls are keyboard-reachable and `M` toggles modes (§9.2).
- **`prefers-reduced-motion` is honoured everywhere** (§3.4, §8.7): it removes motion, never
  sequence, and it doubles as the manual battery-saver switch (05 §4.5).

### 9.5 Slow connections and no connection

The app is opened on whatever connection the desk has — usually good, sometimes a flaky café
or hotel network, occasionally none. The design rule is that **the network is never on the
critical path to seeing your map.**

- **First paint is cache-only.** Cached basemap tiles plus the last `explored-r11.<gen>.bin` (D-237)
  from IndexedDB render before any request is issued (§2.4, §4.8). Target: usable first paint in
  **under 1 s with the radio off.** *This applies to a running app (D-287): there is no service
  worker, so a cold load with no signal at all shows the browser's offline page.*
- **The fog payload is fetched after first paint, never before**, and revalidated with
  `If-None-Match` (05 §7.3). A 304 costs nothing; a changed payload swaps in without a flash.
- **There is no offline banner.** The plinth already shows *"Last: Thu · 8.4 km"*, which is the
  honest freshness signal — the date of the most recent thing the app knows about. A banner
  announcing a condition the user cannot fix is chrome that exists to blame the world.
- **Missing tiles are the flat basemap background, never a checkerboard, never a spinner** (§4.8, D-373).
- **Writes never block.** Workout logs (§6.4) go to IndexedDB and flush on a queue with
  idempotency keys. There is no sync UI in the app (the `/dev/tickets` `n pending` badge went with
  D-252).
- **API timeout 10 s, then queue.** No request is allowed to hold a screen.
- **No third-party requests at runtime.** Fonts are self-hosted (§8.4); there is no analytics, no
  tag manager, no font CDN. Every one of those is a slow-connection failure mode bought for
  nothing, and N5 means there is nobody to report analytics to.

### 9.6 The reality-check table

| Situation | What the app does |
|---|---|
| Adventure mode, trying to read a street inside the fog | It is hidden on purpose (§4.3); atlas is one click or `M` away; **no auto-switch** |
| The watch or phone died mid-run | Nothing. We do not record runs (N6, D-110). The adapter's data is the adapter's problem |
| Strava token expired | One quiet `--ink` line in the plinth → `/settings`. No badge, no modal, no red (§2.3) |
| Three weeks without opening it | Identical to any other day. No "welcome back", no summary of what you missed (D-013, H2) |
| A slow connection (devtools "Slow 3G") | Cached map paints in under a second; the fog payload catches up silently |
| No connection (devtools "Offline", app already open) | Everything above, plus logging still works and queues |
| 200% browser zoom | Grid reflows; the rail scrolls internally (or, below 1024px, the plinth card caps at 55% of the height and scrolls); nothing truncates |
| Screen reader only | Map summarised in text; the reveal narrated in beat order |

---

## 10. What we are deliberately NOT building

`00-vision.md` §6 lists six non-goals and, for each, the *disguises* a future proposal might
wear. This section is that list rendered as UI: the specific screens, controls and widgets that
are refused, so a proposal can be matched against a component rather than a principle.

The order of operations for any future UI proposal is: **§10 first, then the one-sentence test,
then design.**

### 10.1 Refused because of a vision non-goal

| Refused UI | Non-goal | Why, in one line |
|---|---|---|
| Feed, followers, likes, comments, clubs, challenges | **N1** | The presence of anyone else's number changes what the app *means*, even unread |
| Leaderboards of any kind, including family ones | **N1** | D-011: competing with people who have more time to run is the thing that killed INTVL |
| **"Share my map" — export, image, link, screenshot button** | **N1** | The disguise the vision names explicitly. It also detonates D-123, which permits full-fidelity home-location traces *only* because the map is never shown to anyone |
| "Suggested next run", "your week", target pace, HR zones | **N2** | A plan is an obligation and obligations are upkeep (P3) |
| Weekly/monthly goals, progress-to-goal rings | **N2** | A goal you miss is a loss condition, and this app has none |
| Custom habits, a generic "other activity" type, notes, mood, water, sleep | **N3** | The generic-activity request converts a fitness app into a habit tracker in one feature. This is precisely how Habitica ate itself |
| PBs presented as a contest, segments, percentiles, "top X%", a score that can fall | **N4** | Competing with your past self makes runs *worse*, not *new*, the goal |
| Landing page, signup, pricing, App Store listing, public roadmap | **N5** | Every one is upkeep, and generality costs the simplifications P9 entitles us to |
| A **Start Run** button, a recording screen, a live map, a lap timer | **N6** | D-110 settled it on evidence: a PWA cannot hold a trace in a pocket. Recording is an adapter concern (D-100) |

### 10.2 Refused screens (§1.4, restated so it is one list)

Dashboard · profile · achievement gallery · calendar heatmap · onboarding flow · notifications
inbox. Each is justified in §1.4; the shortest version is that a dashboard is a screen whose job
is to link to screens, a heatmap is a streak in disguise (H2), and a badge gallery is a list you
must hunt through, when milestones belong **on the map** as landmarks (04 §4.3).

### 10.3 Refused controls and patterns

These are smaller, they arrive one at a time, and each is individually defensible — which is why
they are written down.

| Refused | Instead | Source |
|---|---|---|
| A nav bar, tab strip or sidebar of links | The plinth. Each spends a strip of a map-first screen on links | §1.5 |
| Per-exercise buttons on the home screen | One `+ ADD WORKOUT` button → `/log` | **D-061** |
| Streaks, "days since", check-ins, reminders, decay | Nothing. Open it after three weeks and it is as pleased to see you | **D-013**, H2 |
| A nag when nothing has synced | The plinth shows the last run, whenever it was | §2.3 |
| Red error chrome, badges, modals for anything the user cannot fix | One quiet ink line, or silence | §2.3, §9.5 |
| Spinners | Cached content, then parchment skeletons | §8.7 |
| An offline banner | The date of the last thing we know about | §9.5 |
| Translucent / glassmorphic chrome over the map | Opaque fills with a hairline | §8.1 |
| Auto-switching the map mode — on the OS light/dark setting, the time of day, or any sensor | The user's explicit choice, persisted | §9.1 |
| Cold-territory counts, badges, or "rediscoverable near you" lists | A wash on the terrain, in atlas only | **D-133**, §4.6 |
| Cold territory in adventure mode, "just a hint" | Nothing. Adventure stays pure known/unknown | **D-133** |
| A cell inspector ("you last ran here 211 days ago") | The cold wash shows the only actionable part | §4.4 |
| Charts in the skill detail sheet | A bar and a milestone ladder | §5.5 |
| Sorting skills or log rows by level, frequency or recency | Registry order, forever | §5.3, §6.5 |
| Precise dates on milestone estimates | "~3 years". A precise date is a deadline | §5.5 |
| ~~Ticket editing, closing, comments, kanban, charts~~ | *Moot: D-252 withdrew the in-app ticket UI entirely* | **D-252** |
| Emoji in the UI | The sigil set | §8.6 |
| Third-party fonts, analytics, tag managers at runtime | Self-hosted, none, none | §9.5 |

### 10.4 Refused for now, by MVP scope (D-122)

Not wrong — **not yet.** These have designs waiting elsewhere and no pixels here:

- **Combat UI** — map encounters and boss quests. All combat is out (D-122, superseding D-042).
  No Slayer tile beyond the collapsed `Untrained` row (§5.3).
- **The route planner** (D-070). In scope as a *feature*, out of MVP. Its two hooks already exist
  and cost nothing: the frontier line at the bottom of the reveal (§3, Beat 5) and atlas mode's
  "unexplored zones near me" overlay (05 §8.4). When it lands, it may claim a click on empty
  map, which is held in reserve for it (§4.2, §10.5).
- **Equipment and loot screens.** Out of MVP, and D-134 has already removed the reason they would
  need prominence: gear grants no XP multipliers, only combat power, lantern radius and looks.
- **Sets, reps-per-set and a rest timer** (D-062). §6.6 specifies the forward path — an explicit
  control on an existing row, no layout change — and flags the rest timer as the one deferred feature
  that could violate D-013.

### 10.5 The standing conditions

Three things in this document are conditional, and each has a written trigger so that changing
them is a decision rather than a drift:

1. **D-123's privacy posture depends on there being no share feature.** Full-fidelity traces with
   no home-location masking are safe *because the map is shown to one person*. **Any** share,
   export, screenshot or friends-map feature reopens D-123 before it ships a single pixel. This
   is the strongest coupling in the document between a UI decision and a security one
   (`08-security-privacy.md` carries it as a standing condition).
2. **A click on empty map does nothing, and is held in reserve** until D-070's route planner is
   designed (§4.2, §4.4). *(This was "the long-press gesture is on loan"; D-253 removed long-press.)*
3. ~~**04 §1.2's Total Level ceiling needs a one-line correction**~~ — **DONE (`0031`).** §1.2 now
   derives the ceiling from the ruleset rather than stating it, because a literal was falsified
   three times by changes that were each supposed to be data-only. Adding a skill still mints a
   bookkeeping Total Level point that must never fire a level-up card (§5.4, D-146).

### 10.6 The test every future screen has to pass

`00-vision.md` §7, applied to UI:

> **Does it make an unexplored street more tempting, or a finished run more satisfying to look
> at — without asking me to do anything I would not otherwise do?**

The clause before the dash is the value test: a screen must serve novelty (P6) or the post-run
reveal (P2, P5). The clause after it is an absolute veto, not a trade-off — **a screen that adds
real value and a recurring ask still fails.**

And the UI-specific corollary, from §1.1: *what breaks if this does not exist, and where would
its content otherwise live?* Seven routes answered that question. An eighth has to answer it too.
