---
id: 87
slug: home-screen-states
title: Home screen states — cold start, nothing imported, sync in progress, sync failed, offline
type: feature
priority: high
status: open
size: m
capability: 13-home-plinth-and-chronicle
depends_on: [86, 43]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
---

## Description

Every state the home screen can be in, per `06-ui-ux.md` §2.4. The theme running through all of them
is D-013: **no state of this screen is allowed to become a demand.**

| State | Plinth shows | Map shows |
|---|---|---|
| Cold start, cached | Cached totals immediately | Cached basemap + last `explored-r10.bin` from IndexedDB, drawn **before any network call** |
| Fresh import waiting | `1 new run — tap to open` in gold, **once**, never red, never repeating | Territory as of *before* the run — the reveal belongs to the post-run moment, not here |
| Nothing ever imported | `Connect Strava to begin` — the only call to action in the app | Parchment, **unfogged**, centred on device location |
| Three weeks idle | Identical to any other day | Identical |
| Offline | Everything above, from cache, with **no error chrome** | Cached tiles; missing tiles render as flat parchment, never a grey checkerboard |

**The empty state deserves its own note and it is easy to get wrong.** With no territory, a fogged
map is *all* fog and reads as broken. So **before the first import, fog is not drawn at all** — the
parchment map sits there clean, and the fog arrives, for the first time, as part of the first reveal.
*The first thing the fog ever does is burn back.*

**Sync in progress / sync failed.** Until capability `14` ships, ingest is the manual **Sync** action
(0043) and the app has upkeep — a knowing, scheduled violation of D-013 (roadmap §4.5). Surface it
honestly and quietly: a sync in flight shows a small inline progress indication on the plinth, never
a blocking spinner over the map. A failed sync shows nothing at all — a Strava silence is **not an
event** (§2.3). The **only** failure ever surfaced is a genuinely broken token, and it appears as a
quiet ink-coloured line, `Strava needs reconnecting` → `/settings`. **Never a red badge, never a
modal, never a nag.**

Cold start must paint from cache first and reconcile after. The user opening the app on a train with
one bar sees their territory immediately, not a spinner.

## Acceptance criteria

- [ ] On cold start with a populated IndexedDB, the map and plinth render from cache with **zero**
      network requests issued before first paint — asserted by an offline-mode test.
- [ ] With nothing ever imported, no fog layer is instantiated at all (not merely hidden), the map is
      clean parchment centred on device location, and the plinth reads `Connect Strava to begin`.
- [ ] With an unseen import, the plinth shows `1 new run — tap to open` in gold; it pulses once and
      then stops; it never changes colour and never re-pulses on subsequent renders.
- [ ] Tapping that line opens `/run/:id` and auto-plays (0078's entry-point matrix).
- [ ] The home map shows territory as of **before** the unseen run — the new cells are not revealed
      on `/` ahead of the sequence.
- [ ] A sync in progress shows an inline indication on the plinth only; no overlay, no blocked input,
      the map stays pannable throughout.
- [ ] A sync that returns no new activities changes nothing on screen and produces no message.
- [ ] A sync that fails for a non-auth reason produces **no** user-visible error.
- [ ] An expired/revoked token — and only that — produces one ink-coloured line linking to
      `/settings`. A test asserts no red token, badge, dot or modal is used.
- [ ] Offline: cached tiles render, missing tiles render as flat parchment, and there is no error
      chrome anywhere on the screen.
- [ ] With no activity for 21 days, the rendered home screen is identical (diffed) to one rendered
      with an activity yesterday, apart from the last-run line's own text.

## Notes

Depends on 0086 (the plinth) and 0043 (the manual Sync action, which is the only thing that can be
"in progress" until 0091–0095 land).

The temptation this ticket exists to resist is the "helpful" empty state: a card explaining what to
do next, a checklist, a progress-to-first-run meter. `06-ui-ux.md` §2.3 rules all of it out and
D-013 is the reason. One call to action, once, and then never again.

The unfogged empty map is a real implementation constraint, not a styling choice — do not ship a fog
layer with opacity 0 and call it done, because a zero-cell mask is also the state after a cache
clear, and the two must behave the same way.

## Operator validation

On the Android phone: turn on airplane mode and cold-start the app. Your territory and Total Level
must be on screen essentially instantly, with no spinner and no error. Turn the network back on and
confirm nothing flashes or re-lays-out when the reconcile completes.

Then, on a spare device or a freshly cleared install, open the app signed in but with nothing
imported. Look at the map: clean parchment, no fog, and one line inviting you to connect. It must not
look broken and it must not look like a setup wizard.

Finally, revoke the Strava connection from Strava's own settings page, then open the app. You should
see one quiet line about reconnecting — and you should have to look for it. If it grabs your
attention, it is too loud.
