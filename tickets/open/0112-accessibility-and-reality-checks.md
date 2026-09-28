---
id: 112
slug: accessibility-and-reality-checks
title: Accessibility and reality checks — screen reader, keyboard, zoom, reduced motion, slow connection
type: chore
priority: high
status: open
size: m
capability: 18-mvp-hardening
depends_on: [59, 85, 90, 101]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
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

- [ ] Every row of the §9.6 table is evaluated in the desktop browser and recorded
      pass/fail with a note in `docs/capabilities/18-mvp-hardening.md`.
- [ ] At 200% browser zoom, every screen reflows to the layout `0187` defines for that width, with
      no horizontal scroll, and no text truncates or clips — screenshotted per screen.
- [ ] With a screen reader on, `/` announces a text summary of the map (territory, last run, new cells)
      and the post-run reveal is narrated in beat order.
- [ ] ~~All interactive targets are ≥56dp with ≥16dp slop; a test measures rendered hit rects and
      fails on any smaller.~~ *(D-251, 0215)* No action anywhere is reachable only by a gesture, or
      only by a pointer.
- [ ] `prefers-reduced-motion: reduce` renders static fog and schedules **zero** `requestAnimation
      Frame` callbacks after first paint — asserted by a spy, and confirmed by the frame counter
      flatlining in the DevTools performance panel.
- [ ] ~~Multi-contact taps are treated as pans; a two-and-three-finger contact test does not trigger
      zoom-out, mode toggle, or any navigation.~~ **Withdrawn by D-251 (0215) — tick when closing; nothing to build.**
- [ ] Every destructive action has undo; an inventory of destructive actions is listed in the
      capability doc and each is matched to its undo.
- [ ] A contrast audit shows no gold text below 24sp on parchment anywhere in the app, and every
      floating element has an opaque background (D-148).

## Notes

The rows that are hardest to pass honestly are the ones asserting the app does *nothing* — three
weeks away, phone died mid-run, token expired. Passing them means resisting the instinct to add a
"welcome back" or a red badge. Check for their *absence* deliberately; nobody notices a modal that
was never built until it is.

## Operator validation

In the desktop browser: read the street name nearest a recent finish in adventure mode, toggle to
atlas and read it again; walk every screen by keyboard alone and with a screen reader; turn on the
OS reduce-motion setting and 200% zoom and walk every screen. Record each result in the capability
doc; a row you did not actually perform is a row that fails.

~~Outdoors, midday, no shade, the operator's own Android phone … (sunlight read, one-thumb reach to
the capture sheet's Save and `⌖`, wet-thumb pan test).~~ *(D-251, D-252, 0215)*
