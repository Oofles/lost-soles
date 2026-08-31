---
id: 112
slug: accessibility-and-reality-checks
title: Accessibility and reality checks — sunlight, one-handed reach, sweaty thumbs, reduced motion
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
checklist, on the actual device (D-124), not a simulator.

The §9.6 table, each row a pass/fail:

| Situation | What the app must do |
|---|---|
| Bright sun, adventure mode | Still legible as a map (fog capped at 0.94, grid ghosts through); atlas one long-press away; **no auto-switch** |
| Phone died mid-run | Nothing. We do not record runs (N6, D-110). The adapter's data is the adapter's problem |
| Strava token expired | One quiet `--ink` line in the plinth → `/settings`. No badge, no modal, no red |
| Three weeks without opening it | Identical to any other day. No "welcome back", no summary of what you missed (D-013) |
| Two bars of EDGE | Cached map paints in under a second; the fog payload catches up silently |
| Airplane mode | All of the above, plus logging and capture still work and queue |
| 200% font scale | Grid reflows to one column; map floors at 45% height; nothing truncates |
| TalkBack only | Map summarised in text; the reveal narrated in beat order |
| Gloves in January | 56dp targets, 16dp slop, no gesture-only paths; voice dictation for tickets |
| Dropped in a puddle, screen wet | Multi-contact taps treated as pans; every destructive action has undo |

Plus the two motion and colour rules that are §9 definition-of-done boxes in their own right:

- **`prefers-reduced-motion` renders the fog static and stops the rAF loop** — not slows it,
  stops it. Adventure keeps its colours and falls back to atlas's static fog.
- **D-148: gold appears only as fill or rule, or as type at ≥24sp or on navy; all floating chrome
  is opaque.** Gold body text on parchment is 2.1:1 and is forbidden.

"No auto-switch" in the sunlight row is load-bearing: the app must never decide for the user that
it is bright out. A map that changes mode by itself is a map whose state you cannot predict, and
prediction is the whole value of the long-press.

## Acceptance criteria

- [ ] Every row of the §9.6 table is evaluated on the operator's own Android phone and recorded
      pass/fail with a note in `docs/capabilities/18-mvp-hardening.md`.
- [ ] At 200% system font scale, every screen reflows to one column, the map floors at 45% of
      viewport height, and no text truncates or clips — screenshotted per screen.
- [ ] With TalkBack on, `/` announces a text summary of the map (territory, last run, new cells)
      and the post-run reveal is narrated in beat order.
- [ ] All interactive targets are ≥56dp with ≥16dp slop; a test measures rendered hit rects and
      fails on any smaller. No action anywhere is reachable only by a gesture.
- [ ] `prefers-reduced-motion: reduce` renders static fog and schedules **zero** `requestAnimation
      Frame` callbacks after first paint — asserted by a spy, and confirmed by watching the frame
      counter flatline on device.
- [ ] Multi-contact taps are treated as pans; a two-and-three-finger contact test does not trigger
      zoom-out, mode toggle, or any navigation.
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

Outdoors, midday, no shade, the operator's own Android phone at whatever brightness it defaults
to. Hold the phone in your right hand only, having just finished a run, and: (1) read the street
name nearest your finish point in adventure mode — if you tilt the screen or cup it, that is a
fail; (2) long-press to atlas and read it again; (3) reach the Save button on the capture sheet
and the `⌖` control with your thumb without regripping; (4) lick your thumb or run it under a tap,
then try to pan and tap a route line — the map must pan, never fire a stray action. Then indoors,
turn on Android's "Remove animations" and 200% font size and walk every screen. Record each result
in the capability doc; a row you did not physically perform is a row that fails.
