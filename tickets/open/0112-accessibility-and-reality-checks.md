---
id: 112
slug: accessibility-and-reality-checks
title: Accessibility and reality checks — screen reader, keyboard, zoom, reduced motion, slow connection
type: chore
priority: high
status: open
size: m
capability: 18-mvp-hardening
depends_on: [59, 85, 90, 101, 113]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
started: 2026-10-26T03:02:11Z
---

## Description

Work the `06-ui-ux.md` §9 accessibility requirements and run the §9.6 reality-check table as a
checklist, in the desktop browser on the real deployed app (D-251).

The §9.6 table, each row a pass/fail:

| Situation | What the app must do |
|---|---|
| ~~Bright sun, adventure mode~~ | ~~Still legible as a map (fog capped at 0.94, grid ghosts through); atlas one long-press away; **no auto-switch**~~ *(D-251, 0215 — the row is dropped; its **no auto-switch** rule stands, below)* |
| Phone died mid-run | Nothing. We do not record runs (N6, D-110). The adapter's data is the adapter's problem |
| Strava token expired | One quiet `--ink` line in the plinth → `/settings`. No badge, no modal, no red |
| Three weeks without opening it | Identical to any other day. No "welcome back", no summary of what you missed (D-013) |
| Slow connection (DevTools slow 3G) | Cached map paints in under a second; the fog payload catches up silently |
| Offline | All of the above, plus logging still works and queues (capture withdrawn, D-252) |
| 200% browser zoom | Layout reflows with no horizontal scroll; nothing truncates |
| Screen reader only | Map summarised in text; the reveal narrated in beat order |
| ~~Gloves in January~~ | ~~56dp targets, 16dp slop, no gesture-only paths; voice dictation for tickets~~ *(D-251, 0215)* |
| Keyboard only | Every action reachable without a pointer |
| ~~Dropped in a puddle, screen wet~~ | ~~Multi-contact taps treated as pans;~~ *(D-251, D-253, 0215)* Every destructive action has undo |

Plus the two motion and colour rules that are §9 definition-of-done boxes in their own right:

- **`prefers-reduced-motion` renders the fog static and stops the rAF loop** — not slows it,
  stops it. Adventure keeps its colours and falls back to atlas's static fog.
- **D-148: gold appears only as fill or rule, or as type at ≥24sp or on navy; all floating chrome
  is opaque.** Gold body text on parchment is 2.1:1 and is forbidden.

**No auto-switch** is a standing rule, though the sunlight row that carried it is dropped
(D-251): the app must never change map mode by itself. A map that changes mode by itself is a map
whose state you cannot predict, and prediction is the whole value of the toggle (D-253).

## Acceptance criteria

- [x] Every row of the §9.6 table is evaluated in the desktop browser and recorded
      pass/fail with a note in `docs/capabilities/18-mvp-hardening.md`.
      *(0112: graded by code, tests and headless desktop Chromium. The rows that need human perception
      are marked **Operator** in the table, which are the screen reader's narration and the keyboard
      walk. The slow and no connection rows carry the operator's own 2026-10-25 check from `0113`.)*
- [x] At 200% browser zoom, every screen reflows to the layout `0187` defines for that width, with
      no horizontal scroll, and no text truncates or clips — screenshotted per screen.
      *(0112: **not met, recorded as FAIL.** Every screen was screenshotted
      (`docs/capabilities/assets/0112/`) and measured by `tools/a11y/run-zoom.mjs`. No screen
      scrolls horizontally, and no text truncates, clips or leaves the viewport. Below 1024px, the
      right-edge map controls overlap two surfaces. They sit over the bottom card on a 1280×800 window,
      and over the Chronicle at any width under 1024px. Fixing that is a layout decision, not a local
      change, so a follow-up ticket is proposed.)*
      — verified 2026-10-26: after `0314`, `node tools/a11y/run-zoom.mjs` on `main` prints
      `ZOOM HARNESS PASS`, 24 of 24 layouts with no overlap; `0314` refreshed `assets/0112/`.
- [x] With a screen reader on, `/` announces a text summary of the map (territory, last run, new cells)
      and the post-run reveal is narrated in beat order.
      *(0112: built and tested: `mapSummary` in a polite status region on `/`, and one narration
      region on `/run/:id`, spoken in beat order (`narration.ts`, `narration.test.tsx`). Left unticked
      because "with a screen reader on" is the operator's NVDA check (D-229).)*
      — verified 2026-10-26: operator, desktop browser on the deployed app, with a screen reader on.
      `/` announces the map summary sensibly, and a relived run is narrated in beat order.
- [x] ~~All interactive targets are ≥56dp with ≥16dp slop; a test measures rendered hit rects and
      fails on any smaller.~~ *(D-251, 0215)* No action anywhere is reachable only by a gesture, or
      only by a pointer.
      *(0112: `app/a11y-keyboard.test.ts`. Each pointer path off a button or link is listed with its
      keyboard twin.)*
- [x] `prefers-reduced-motion: reduce` renders static fog and schedules **zero** `requestAnimation
      Frame` callbacks after first paint — asserted by a spy, and confirmed by the frame counter
      flatlining in the DevTools performance panel.
      *(0112: the spy runs in a real browser. `tools/a11y/run-reduced-motion.mjs` drives real
      Chromium over DevTools, with `reduce` emulated, a real MapLibre Map and the shipped fog. It
      reads 0 rAF calls and 0 MapLibre renders in 3 s after first paint. The control, without
      `reduce`, reads ~300 and ~150. That is the DevTools frame counter's flatline, measured rather
      than eyeballed. Unit spies: `animation.test.ts`, `map-mode.test.ts`.)*
- [x] ~~Multi-contact taps are treated as pans; a two-and-three-finger contact test does not trigger
      zoom-out, mode toggle, or any navigation.~~ **Withdrawn by D-251 (0215) — tick when closing; nothing to build.**
- [x] Every destructive action has undo; an inventory of destructive actions is listed in the
      capability doc and each is matched to its undo.
- [x] A contrast audit shows no gold text below 24sp on parchment anywhere in the app, and every
      floating element has an opaque background (D-148).
      *(0112: `app/a11y-d148.test.ts`. The audit found five violations, now fixed: gold body type
      on `/settings`, `/run`'s kind control and `/log`. It also found the mode toggle's selected
      label at 1.39:1 in the dark theme.)*

## Notes


**Blocked 2026-10-26 on 0314:** §9.6 200% zoom row fails on the control overlap 0314 fixes

The rows that are hardest to pass honestly are the ones asserting the app does *nothing* — three
weeks away, phone died mid-run, token expired. Passing them means resisting the instinct to add a
"welcome back" or a red badge. Check for their *absence* deliberately; nobody notices a modal that
was never built until it is.

**2026-10-22 — depends on `0113`** (operator, wave-18 planning): the §9.6 *Slow connection* and *Offline* rows evaluate the behaviour `0113` builds, so they cannot be graded before it lands.

## Operator validation

In the desktop browser: read the street name nearest a recent finish in adventure mode, toggle to
atlas and read it again; walk every screen by keyboard alone and with a screen reader; turn on the
OS reduce-motion setting and 200% zoom and walk every screen. Record each result in the capability
doc; a row you did not actually perform is a row that fails.

~~Outdoors, midday, no shade, the operator's own Android phone … (sunlight read, one-thumb reach to
the capture sheet's Save and `⌖`, wet-thumb pan test).~~ *(D-251, D-252, 0215)*

## Resolution

**The §9.6 table is graded in `docs/capabilities/18-mvp-hardening.md`.** Eight rows pass. 200% zoom
**fails** on overlapping chrome below 1024px, and a follow-up ticket is proposed. The screen reader
row and the keyboard row pass on markup and audit, and wait on the operator's perceptual check. Built
from D-251/D-252/D-253 (desktop only, mouse and keyboard, capture withdrawn), D-313 (rail and bottom
card, 24/32/40px targets), D-376/D-375 (reduced motion), D-148, and `0113`/D-439 for the connection rows.

**Built.**

- **The map as text on `/`** (06 §9.4). `mapSummary(cells, latest)` in `lib/plinth/model.ts` builds
  the summary from the plinth's own inputs (it shares `lastRunParts` with the last-run line, so the
  two cannot disagree). An example: *"Map. 12,480 cells revealed. Last run Fri 28 Aug, 8.40 km,
  21 new cells."* `components/plinth/home-screen.tsx` renders it in a visually hidden
  `role="status"` `aria-live="polite"` paragraph before the map. The paragraph is mounted empty, so the
  region exists before its text arrives. Its text is `null` until the explored set is known, and is
  held back while an aggregate reveal veils the plinth. The clip style is `lib/a11y/visually-hidden.ts`.
- **The sequence narrated in beat order** (06 §9.4). `app/run/[activityId]/narration.ts` holds
  `revealWords` (beat 1) and `tallyWords`. `tallyWords` returns one string per line beat 2 counts in,
  index for index with `tallyFooters`. It also holds `narrationOrder`, the order written down as a pure
  function. `RunSequence` owns **one** polite region and appends each beat's settled words as the beat
  begins: beat 1 at t = 0, or at hand-off when it could not play. Each tally line is spoken as it
  fades in, at the clamped clock, so a line not yet on screen when a card lands is not spoken before
  the card. The chronicle line comes at beat 4 and the frontier at beat 5 (`frontierWords`, passed from
  `RunMoment`). `LevelUpQueue` gained `announce`: on the run page each card speaks through the
  sequence's region and draws no region of its own (`LevelUpCard silent`), while `/log` keeps its own.
  `cardWords` is the one sentence both voices use. §3.5 holds: a run with no new ground never says
  "0 cells" or "No new".
- **D-148 violations, fixed.** Gold `--accent-text` was the colour of body type on `/settings`
  (`styles.ts` `button`, which covers Connect and Sign out), on `/run`'s kind *Change*, *Save* and
  *Cancel* (`activity-kind.tsx`), and on `/log`'s LOG button and the whole confirmed row
  (`log-row.tsx`). That is 3.7–3.95:1 on parchment at 16px. The type is now ink inside the existing
  gold rule; the confirmed row gains a gold border so it keeps its signal. The mode toggle's selected
  label was `--text-primary` on `--accent`, which is 1.39:1 in the dark theme. It is now `--ink-900`
  (`mode-toggle.tsx`; `plinth.test.tsx` updated to match).
- **Guards.** `app/a11y-d148.test.ts` checks every gold `color` in `app/` and `components/` against a
  two-entry list of marks. It also checks that type on a gold fill is `--ink-900`, and that every fixed
  element is opaque in both themes or is a listed scrim, light or wrapper. It was mutation-checked:
  restoring the settings colour and the toggle colour turns two of its tests red.
  `app/a11y-keyboard.test.ts` requires every JSX pointer handler to sit on a button, link or control,
  or to be listed with its keyboard twin. It does the same for every hand-added pointer listener, and
  allows no drag-and-drop or context menu. `components/map/no-auto-switch.test.ts` checks that only the
  toggle writes the saved mode and that the mode store reads no theme, clock or sensor; it sits in
  `components/map/` because `check-mode-boundary.mjs` refuses the mode's name elsewhere.
  `app/a11y-reality.test.ts` checks that there is no recording screen.
- **Headless tools** (`tools/a11y/`, over CDP with Node's own WebSocket, so no new dependency):
  - `run-reduced-motion.mjs` builds a real MapLibre Map with the shipped fog layer and animator, wired
    as `use-fog-mask.ts` wires them, in adventure. `window.requestAnimationFrame` is spied from before
    any script runs. Under emulated `reduce` it reads **0 rAF calls and 0 renders** in the 3 s after
    first paint. The control without `reduce` reads ~300 calls and ~150 renders.
  - `run-zoom.mjs` renders every screen's real components over synthetic data (`zoom-screens.jsx`,
    with router, session and map stubbed in `stubs.jsx`) and uses the self-hosted fonts. It lays each
    screen out at 200% of 1280×800, 1920×1080 and 2560×1440 windows, measures horizontal scroll,
    clipped or off-screen text, stuck panels and overlapping fixed chrome, and screenshots the first
    two (`--commit` writes `docs/capabilities/assets/0112/`). A sabotage page must trip every detector
    first, or the run exits 2.
  - `cdp.mjs` closes Chromium with `Browser.close` and waits for the process to exit before it removes
    the profile. A SIGKILL reaches only the snap wrapper, and the profile was left behind in tmp/.
- **Doc.** `06` §9.4 said the focus ring was `--accent`. Every control ships `--text-primary`, and that
  is correct, because `--gold-500` is 2.1:1, under the 3:1 a focus indicator needs. The doc is amended
  in place. The 18 capability doc's ticket line carries the current title.

**Not changed, and why.**

- **The 200% overlap** at `/` on a 1280×800 window, and at `/chronicle` at any width under 1024px. The
  right-edge column (gear, jump-to, fit, `⌖`) does not fit beside a 55vh bottom card in 400px, and the
  Chronicle's panel runs under it. Moving the column is a layout decision across `PLINTH_CSS`,
  `MAP_CONTROLS_CSS`, `REGION_JUMP_CSS` and `CHRONICLE_CSS`. It is not a local fix, so a follow-up is
  proposed instead of widening this ticket.
- The post-run sequence keeps a rAF clock under reduced motion. §3.4 removes motion, never sequence,
  and the criterion is about the fog on the map.
- Measured, not acted on: in the control run MapLibre renders ~50/s while the animator requests ~29
  repaints/s, so something besides the fog loop triggers extra renders. The 30 fps cap itself holds.

**Files.** `lib/plinth/model.ts` (+ test), `components/plinth/home-screen.tsx`,
`components/plinth/plinth.test.tsx`, `lib/a11y/visually-hidden.ts`, `app/run/[activityId]/narration.ts`
(+ `narration.test.tsx`), `app/run/[activityId]/run-sequence.tsx`, `app/run/[activityId]/run-moment.tsx`,
`components/level-up-card.tsx`, `components/map/mode-toggle.tsx`, `app/settings/styles.ts`,
`app/run/[activityId]/activity-kind.tsx`, `app/log/log-row.tsx`, `app/a11y-d148.test.ts`,
`app/a11y-keyboard.test.ts`, `app/a11y-reality.test.ts`, `components/map/no-auto-switch.test.ts`,
`tools/a11y/{cdp.mjs,run-reduced-motion.mjs,reduced-motion-harness.js,run-zoom.mjs,zoom-screens.jsx,stubs.jsx}`,
`docs/capabilities/assets/0112/*.png` (16), `docs/capabilities/18-mvp-hardening.md`, `docs/06-ui-ux.md` §9.4.

**Operator, 2026-10-26, desktop browser, deployed app (wave 1 perceptual checks):** all pass.
1. Screen reader: the `/` map summary makes sense; a relived run narrates in beat order.
2. 200% zoom: no defects beyond the known overlaps (`0314`).
3. `⌖` renders as a crosshair, not an empty box; it could be slightly larger (filed as a ticket).
4. Keyboard: focus ring visible on every screen.
5. Gold-to-ink: `/settings` Connect and Sign out, the run page's "Change" and `/log`'s LOG button
   and confirmed row read as intended.
6. Dark theme: the mode toggle's selected label is readable.

Smoke, 2026-10-26 (orchestrator, after the green deploy of `65bb872`):
`tools/a11y/run-reduced-motion.mjs` printed `REDUCED MOTION HARNESS PASS` (0 rAF calls, 0 renders
after first paint under `reduce`; 336 and 164 in the control). `tools/a11y/run-zoom.mjs` printed
`ZOOM HARNESS FAIL (3)`, exactly the overlaps `0314` covers. The deployed `/` returns 200.

**Re-run after `0314`, 2026-10-26 (orchestrator, wave 18.3):** `tools/a11y/run-zoom.mjs` on `main`
(`83e39d6`, which carries `0314`) printed `ZOOM HARNESS PASS`. All 24 layouts (8 screens × 3 windows at
200%) have no horizontal scroll, no clipped text and no overlapping chrome. The §9.6 zoom row in the
capability doc is now **pass**, and the 200% criterion is ticked. The screenshots in `assets/0112/` were
already regenerated by `0314`; `--commit` reproduced them byte for byte.
