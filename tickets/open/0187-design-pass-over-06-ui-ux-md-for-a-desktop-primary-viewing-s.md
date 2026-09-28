---
id: 187
slug: design-pass-over-06-ui-ux-md-for-a-desktop-primary-viewing-s
title: Design pass over 06-ui-ux.md for a desktop-primary viewing surface
type: chore
priority: med
status: open
size: m
capability: 13-home-plinth-and-chronicle
depends_on: []
blocked_by: []
source: agent
created: 2026-09-09T16:54:51Z
---

## Description

**D-227 flipped the viewing surface and `06-ui-ux.md` has not caught up.** The operator stated,
twice and unprompted during `0053`'s validation: *"I plan to use this app primarily through a
browser on my computer, not trying to view it through a phone. Phone for tracking the runs, and
computer for viewing all the data via the webapp."*

`06-ui-ux.md` is written phone-first throughout. §1 opened with D-124's primacy, the information
architecture is built around a **thumb-arc plinth** with 56dp targets, and the desktop is a single
adaptation paragraph in §4.8. Two lines were amended in place when D-227 was recorded, so the
document no longer *states* the wrong premise — but it is still *shaped* by it, and that is the
part a search-and-replace cannot fix.

**This is filed rather than done inline because it is a DESIGN session, not an edit.** It changes
the primary layout of a 1,000-line document that four unbuilt capabilities depend on. Doing it
during a renderer ticket would be the scope creep D-152 forbids, and doing it badly is worse than
leaving the divergence recorded and visible.

**Scope it to the IA, not the palette.** The token system (§8) is surface-independent and D-051
(legibility beats atmosphere) is if anything easier to satisfy on a large screen. What actually
needs rethinking is where things *live* when the viewport is 1400px wide and there is no thumb.

## Acceptance criteria

- [ ] §1's screen map and §2's layout are written desktop-first; narrow widths only must not break
      (D-251) — the inverse of today. The seven routes do not change; `app/routes.test.ts` still passes.
- [ ] The plinth is specified for a wide viewport as the primary case. §4.8's left-rail sketch is
      either promoted to the main specification or replaced with something better.
- [ ] Every remaining phone-first assumption is **removed**, not restated: thumb arc, 56dp targets as
      a requirement, one-handed reach, sunlight legibility. *(Amended 2026-09-28 by D-251: it said
      "restated for desktop or explicitly kept with a reason".)*
- [ ] ~~The phone case is not deleted. It stays as a real, specified surface: D-124's capture half is
      untouched, and `05` §6.4's perf budget and `0059`'s mid-range-Android harness still stand,
      because the phone remains the worst case even when it is not the common case.~~
      **Superseded by D-251 (2026-09-28):** the phone is not a viewing surface, and no design goes
      into it. Replacement: the doc states once that layouts must not *break* at a narrow width
      (ordinary responsive CSS) and that nothing is optimised for the phone. `05` §6.4's budgets
      stand on their own, as measured on the desktop.
- [ ] `## Operator validation` conventions are stated once, in this doc: the desktop browser is the
      default surface, and the phone is never a validation surface; its only role is recording runs
      (D-251; operator 2026-09-28: no /log or capture from the phone).
- [ ] A `D-xxx` records anything the pass actually changes about the IA, rather than the change
      arriving only as a diff.

## Notes

**Twenty open tickets carry an `## Operator validation` step naming "the 6.8in Android phone".**
Deliberately not mass-edited here: a sweep would touch tickets across eight capabilities with no
one reading whether the check still makes sense on a desktop, which is how a validation step
becomes a ritual. Fix them as each ticket is picked up, against the convention this ticket writes
down. *Superseded: swept in 0215.*

Not urgent, and it blocks nothing. Capability `08`'s renderer is surface-independent; this matters
before capability `13` builds the plinth for real, which is why it sits there.

**2026-09-28, D-251.** The operator hardened D-227 from "desktop primary" to "the phone is not a
viewing surface at all", answering `0212`'s §9.5 question. Criteria 3 and 4 are amended above, and
the strikes are kept so the change is visible. This makes the pass simpler: remove phone-first
assumptions rather than keep and justify them. The matching sweep of open tickets' phone-viewing
criteria is `0215`. `06` is this ticket's alone; `0215` does not edit it.

**D-252 withdrew `06` §7** (the in-app ticket capture UI; marked superseded there), and **D-253
settles the map's input model**: a visible mode toggle plus a keyboard shortcut, a separate
fit-to-territory control beside `⌖`, mouse and keyboard gestures, no long-press. This ticket's IA
pass should reflect both.

## Operator validation

None — a design document. The pass is validated by the capability that builds against it, and the
first real test is whether `13`'s plinth can be built from §2 without re-deriving the layout.
