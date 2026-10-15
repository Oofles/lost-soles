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
started: 2026-10-15T15:50:47Z
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

## Resolution

A design pass over `docs/06-ui-ux.md`, in one file. No code changed; the seven routes are
untouched and `app/routes.test.ts` passes unchanged.

**Files touched**

- `docs/06-ui-ux.md` — the pass itself (below).
- this ticket — this section.

**What changed in `06`, by criterion**

1. *§1 and §2 desktop-first.* The preamble's binding-constraints list now carries D-227/D-251,
   D-252 and D-253 instead of "this document is still written phone-first", and gains **"The
   surface, stated once"**: the design case is a ~1280–1600px desktop window driven by mouse,
   trackpad and keyboard; narrow widths must not break and nothing is optimised for them; older
   `dp`/`sp`/"tap" wording reads as CSS px / click. §1.2's boxes say *dialog* and *panel* for
   the two things that open over a parent, `/dev/tickets` is marked withdrawn (D-252) with its
   removal left to `0216`. §1.4 and §3.1 drop the push notification (D-253). §1.5 is rewritten:
   no nav bar of any kind, browser back, Esc + close control on everything that opens over a
   parent, no swipe-down, and the rail at ≥1024px with a bottom-card fallback below.
2. *The plinth for a wide viewport.* §2.1–§2.2 are rewritten around a ~1440 × 900 wireframe and
   a numbered spec table that `0086` can build from directly. **§4.8's left rail is promoted to
   the main specification** (operator's choice, 2026-10-15, over the floating bottom-left card
   this pass first proposed): at ≥1024px a fixed, full-height, opaque rail 24rem wide on the
   left, content at its top — Total Level + cells, milestone bar, last-run line (the whole line
   is the link), three destinations in one row at 40px with columns `1fr 1.5fr 1fr`, then the
   interim Sync line — and the map filling the pane to its right. Mode toggle, `⚙`, fit, `⌖` and
   the attribution are positioned on the map pane, never under the rail. The camera needs no
   offset, because the pane is narrower, not occluded. Below 1024px the rail's content stacks as
   a bottom card over the map (one paragraph, "must not break" only). §2.1 records the costs
   accepted with the rail. Focus order is written out. New **§2.5** says where the Chronicle
   opens: in the rail's column, replacing its contents, no scrim, map usable beside it; the skill
   detail stays a scrimmed centred dialog, as `0074` built it.
3. *Phone-first assumptions removed.* Thumb arc, 56dp targets, one-handed reach, sunlight,
   gloves, wet screens, haptics, long-press, two-finger tap, swipe-down, TalkBack, "outdoors on
   one bar": all gone from §1, §2, §4, §8.4, §8.5, §9 and §10, not restated. §9.1–§9.3 keep their
   numbers (citations of §9.6 hold) under new titles — *Contrast and legibility*, *Pointer and
   keyboard (D-253)*, *Narrow windows* — keeping only what those sections required for its own
   sake (contrast floors, no gesture-only path, undo-not-confirm, no drag-to-delete). §9.6's
   table has exactly D-251's desktop rows, plus the two that were never phone-specific. §8.5's
   touch target becomes 24px floor / 32px chrome / 40px plinth and map controls. §4.4 is D-253's
   mouse-and-keyboard table.
4. *Narrow widths.* Stated once in the preamble, and checkably in §2.2's last paragraph and §9.3.
5. *Validation convention.* Stated once, in the preamble: desktop browser, perception only
   (D-229), the phone never a validation surface.
6. *A D-xxx for the IA change.* Proposed to the orchestrator as **D-NEW-a**; the doc cites the
   placeholder `D-NEW-a` in eight places, to be replaced with the allocated number.

**Decisions made in the pass (all under D-NEW-a, for the operator to confirm or overturn)**

- The rail over the floating card (operator's choice; above).
- **No drag handle on the plinth.** It was a thumb's second door to the place `RUNS` opens.
- **Hover shows only the pointer cursor on a route line** — the old §4.8 promise of a hover card
  with the three facts is withdrawn; a click gives the card. Tooltips stay refused (§5.1), now on
  their own reasons (keyboard, screen reader) rather than "no hover on a phone".
- The camera is **not** offset for the rail (D-249's framing stands as shipped).
- The empty state centres on the configured home, not device location (consistent with D-249's
  precedence and `0086`'s criterion).
- Interim: the manual Sync control lives on a caption line inside the rail until capability
  `14` deletes it (operator confirmed).
- The icon set's eighth mark is fit-to-territory instead of drag handle.
- A click on empty map is the gesture held in reserve for D-070 (replaces "long-press is on
  loan"). §6.6's post-MVP sets editor opens from an explicit row control, not a long-press.
- No map-mode auto-switch on the OS light/dark setting or time of day (the desktop analogue of
  the refused ambient-light switch).

**Not done here, deliberately:** `§7` stays as the superseded record (D-252). `§3`, `§5` and `§6`
were not reworded tap→click line by line; the preamble's units note covers them, and a sweep
would touch the post-run moment's prose for no design gain. `0086`, `0088` and `0098` are not
edited (other tickets); what they now need is in the orchestrator's report.
