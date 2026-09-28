---
id: 68
slug: log-route-one-row-per-workout-type
title: /log route — one row per workout type, one click to log
type: feature
priority: high
status: open
size: m
capability: 10-add-workout
depends_on: [16, 60, 62, 70]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
---

## Description

**D-061 is unusually specific and its reasoning is the design:** an **"Add workout" button**,
**not** per-exercise buttons on the home screen. It opens a dedicated page with one quick-log
row per workout type.

The decision is not about the home screen's tidiness — it is about **where growth lands**.
Per-exercise buttons put every future workout type on the most valuable surface in the app,
competing with the map, and the fifth one forces a redesign. One button routing to one page
moves that growth onto a page whose only job is to hold rows, and rows are the one UI shape that
scales without anyone thinking about it.

So `/log` is a **list of rows generated from the skill registry** (T5, ordered by
`displayOrder`), not a hand-written list of components. Each row renders from the row's
`exercises` entry: sigil, skill name, plain-English unit label, a stepper, a value and a `LOG`
button.

D-060 is forced, not chosen: no API anywhere exposes reps or sets, so strength work is logged
in-app or not at all. **Strength work is never ingested from Strava.**

Route and navigation: `/log`, reached from the plinth's "Add workout" affordance, with the
browser back returning to `/`. It is a real route so the browser back button and deep links behave.

Scope here is the route, the registry-driven rendering and the commit path. Row anatomy and the
physical interaction rules are 0071; the adapter behind the write is 0069; the zero-code-diff
proof is 0072.

## Acceptance criteria

- [ ] `/log` exists as a route; the browser back button and the app-bar arrow both return to `/`.
- [ ] The page renders **one row per enabled registry skill with `logMode: reps | duration |
      trace-manual`**, in `displayOrder` order, with **no per-skill component and no hardcoded
      list** anywhere in the page.
- [ ] The home screen gains exactly one affordance — "Add workout" — and **no** per-exercise
      buttons; a diff of the home screen shows zero new controls per workout type.
- [ ] Clicking `LOG` on a row commits **that row alone**: no page-level save button, no "done",
      no confirmation dialog.
- [ ] The page renders from cache and **nothing waits on the network**; with the browser
      offline (DevTools → Offline) the page renders fully and a log still succeeds locally.
- [ ] The write lands in IndexedDB before the confirmation animation starts and flushes on a
      background-sync queue with an idempotency key; a failed flush retries silently and is
      never surfaced as an error on this page.
- [ ] A logged row shows the optimistic result in place — units, XP, resulting level — without
      navigating away.
- [ ] No skill id or exercise id is legible to the compiler in `(app)/log/` (I-25).
- [ ] Adding a row to `xp-rules-v1.yaml` adds a row to `/log` with an empty `.tsx` diff (proved
      properly in 0072).

## Notes

**Cross-capability dependency added during backlog validation (2026-08-30):** 0016 provides the app shell and route stubs /log mounts into.


~~`06-ui-ux.md` §6.2 states the physical brief: *the user is standing in a hallway, breathing
hard, holding the phone in one hand, possibly with sweat on the screen.*~~ *(D-251, 0215 — `/log`
is a desktop-browser feature.)* Target: **from the plinth's Add workout to logged, under three
seconds, without looking twice.**

~~The background-sync queue with idempotency keys is the same machinery the ticket-capture UI uses
(§7) — build it once, use it twice.~~ *(D-252, 0215 — there is no in-app ticket-capture UI.)*

When the page outgrows one screen it **scrolls**. It does not gain sections, tabs, search,
favourites, or a "frequent" group. Those are all ways of reordering, and reordering is what
§6.5 forbids.

## Operator validation

On **`/log`** in the desktop browser: click the plinth's "Add workout", log 40 pushups, and
return to the map — **under three seconds, without hunting for any control.** Then set DevTools
to Offline and repeat: identical behaviour, no spinner, no error.
