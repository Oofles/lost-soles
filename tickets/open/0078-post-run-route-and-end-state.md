---
id: 78
slug: post-run-route-and-end-state
title: /run/:activityId route, its four entry points, and the persistent end state
type: feature
priority: high
status: open
size: m
capability: 12-post-run-moment
depends_on: [53, 62]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
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
| Push notification "your run is on the map" | Deep-link to `/run/:id`, auto-play from beat 1 |
| Plinth `1 new run — tap to open` | Same |
| App opened cold with an unseen import | Home renders first; the plinth line pulses **once**. It does **not** auto-play |
| Chronicle → any past run | Opens in **static end state**, with a `⟲ Relive` control |

The cold-open rule is not a nicety. Ambushing the user with an eight-second animation they did not
ask for is how a reward becomes an obstacle, and that is a D-013 failure wearing a costume.

The end state: lit map on top (pannable again), full ledger below, chronicle line, frontier line,
`⟲ Relive`, and route stats (distance, duration, date, source). It is persistent and scrollable
with **no timeout**. Android back returns to `/`.

Whether the sequence auto-plays is a function of `autoplay` intent passed by the entry point, not
of the run's age or the `seen` flag alone — the flag is owned by 0084. This ticket takes a boolean
and honours it.

## Acceptance criteria

- [ ] `/run/:activityId` resolves for any activity id the signed-in user owns and 404s for one
      they do not.
- [ ] Opening the route with no autoplay intent renders the static end state — map, ledger,
      chronicle line, frontier line, `⟲ Relive`, route stats — with no animation of any kind.
- [ ] `⟲ Relive` restarts the sequence from beat 1 and returns to this same end state.
- [ ] The end state has no timeout and no auto-navigation: left untouched for five minutes it is
      unchanged.
- [ ] Android back from the end state lands on `/`, not on a blank history entry.
- [ ] A deep link to `/run/:id` from a cold process start (app not running) opens the route
      directly and does not flash the home screen first.
- [ ] Opening the app cold with an unseen import lands on `/` — asserted by a test that the
      router never auto-navigates to `/run/:id`.
- [ ] The ledger and both text lines render correctly with WebGL disabled (map area falls back to
      a static image or blank parchment). The numbers never depend on the graphics (§3.4).

## Notes

Depends on 0053 (the MapLibre shell as the home route) for the map component and 0062 (the
`XpLedgerEntry` table) for the per-skill rows this page reads. The ledger read is a plain query by
`activityId`; no scoring happens here.

Beats 4 and 5 render *into* this page and are specified in 0083 — this ticket lays out their slots
and may render them from a stub string. The tally rows are 0081; render them un-animated here.

Do not put a "Run imported!" toast, a title card, or a spinner anywhere on this route. §3.2 forbids
all three, and the prohibition applies to the static entry as much as to the animated one.

## Operator validation

On the Android phone, from the Chronicle, tap a run from last week. It must open **static** — no
camera move, no counting numbers — and be immediately scrollable. Scroll to the bottom, confirm the
route stats and `⟲ Relive` are reachable one-handed. Press back once: you are on `/`. Now tap the
same run again and hit `⟲ Relive`; when it settles you are on this same page, in the same scroll
position rules, not somewhere new. Finally, turn the phone to landscape and confirm the ledger is
still legible and the map has not eaten the text.
