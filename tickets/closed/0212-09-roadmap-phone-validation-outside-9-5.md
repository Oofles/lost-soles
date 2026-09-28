---
id: 212
slug: 09-roadmap-phone-validation-outside-9-5
title: 09-roadmap.md still assumes validation on the phone outside §9.5
type: chore
priority: low
status: closed
size: s
capability: 12-post-run-moment
depends_on: []
blocked_by: []
source: agent
created: 2026-09-28T13:20:29Z
closed: 2026-09-28T16:54:39Z
---

## Description

`0208` corrected `09-roadmap.md` §9.5 to name the **desktop browser** as the validation surface
(D-240, following D-227). Its criterion 5 kept that edit to §9.5 and required every other phone
assumption in the doc to be listed and left for a follow-up. This is that follow-up. Found
2026-09-28 by grepping `09-roadmap.md` for `phone|Android|device`:

1. **§3, capability `08`, row 8**: *"Perf harness against the §6.4 budget on a real mid-range
   Android phone"*. D-240 dropped the phone run for `0059`, which ran on the desktop.
2. **§3, capability `08`, Done when**: *"the §6.3 frame budget is met on the actual phone,
   measured, not assumed."* Same decision. Capability `08`'s drift audit will meet this line.
3. **§3, capability `12`, Done when**: *"the sequence runs in 8.4 s ± 0.3 s on the real phone"*.
   After D-240 this is measured on the desktop.
4. **§9.5's fourth row**, which `0208` deliberately left as it was: *"The `06-ui-ux.md` §9.6
   reality-check table passes: sunlight, one-handed reach, sweaty thumbs."* That table is premised
   on a phone held outdoors. D-227 records that `06-ui-ux.md` itself has this stale premise. This
   row needs a decision, not a respelling: drop it, restate it for the desktop, or keep it as an
   in-use observation the operator raises (D-240's framing).

**Not stale**, so leave these alone: every capture-side reference (the quick-capture tile, GPSLogger,
Health Connect, *"a run finished on the phone appears on the map"* in §9.4). D-124 and D-227 keep
the phone as the **capture** device, and those lines are about capture.

## Acceptance criteria

- [x] Items 1–3 name the desktop browser and cite D-240, keeping D-124's capture role where the
      line mentions it.
- [x] Item 4 is resolved by an explicit choice the operator agrees to, and recorded in the doc.
- [x] Capture-side references are unchanged.
- [x] `docs/INDEX.md` (and `docs/.index-summaries.json` if a summary quotes the old wording) is
      regenerated.

## Notes

Filed by the agent from `0208`, 2026-09-28. Placed in capability `12` because `0208`'s Notes
expected `09-roadmap.md` to be reopened when capability `12` brings the post-run sequence into
scope. Filing it under `08` would also have added an open ticket in front of `08`'s drift audit
for a doc edit that can wait. Item 2 is worth raising **during** that audit rather than after it.

Related: `0208`, `0059`, D-124, D-227, D-240.

## Resolution

**All four items are done, in two commits. The decision on item 4 went further than the ticket
asked.**

- **Items 1 and 2** (capability `08`'s row 8 and its Done-when) were fixed in `98ee528`. That was
  the doc sweep during `08`'s drift audit, where this ticket's Notes asked for item 2 to be raised.
  Both lines now name the desktop browser and cite D-240.
- **Item 3** (capability `12`'s Done-when) was fixed in `b8f0381`. It now reads "in the desktop
  browser (D-240, D-251)". The operator chose the desktop over keeping a phone exception.
- **Item 4** (§9.5's fourth row) was fixed in `b8f0381`. The question offered four options: split
  by surface, drop, keep as an in-use observation, or restate everything for the desktop. The
  operator answered beyond them: *"The phone considerations are completely unnecessary. I don't
  want to spend extra effort and cycles designing and testing for a phone use case since my
  computer will be what I use 99% of the time."* That is recorded as **D-251**, which hardens D-227
  from "desktop primary" to "the phone is not a viewing surface". The row now gates only the
  `06` §9.6 rows that mean something in a desktop browser (token expired, three weeks away, slow or
  no connection, 200% zoom, screen reader). The phone-physical rows are dropped. §3 capability
  `18`'s row 1, which quotes the same checklist, was amended to match.

**What D-251 set off that this ticket does not do** (per D-152, nothing was widened):
- `0187`'s criteria 3 and 4 were amended in the same commit. They are its own criteria and now
  contradict a settled decision, so leaving them would have been drift.
- `0215` was filed to sweep the ~40 open tickets whose criteria assume phone viewing.
- D-251 records one open question for the operator: whether `/log` and ticket capture are used
  from a phone. If they are, they are capture and are out of D-251's reach.

**Capture-side references are unchanged.** This includes §3 capability `10`'s row 4 ("one-handed
reach on a large Android phone" for `/log`), which waits on that open question.

`docs/INDEX.md` was regenerated in both commits.

## Operator validation

None: a design-doc correction with no runtime behaviour. The check is a review of the diff against
D-240.

Verified by the agent, 2026-09-28. `git show 98ee528 b8f0381 -- docs/09-roadmap.md` touches only
the lines listed in Resolution. A grep of `09-roadmap.md` for `phone|Android` afterwards finds capture-side lines, struck lines,
capability `10`'s row 4 (held on purpose), and **two phone-viewing lines this ticket never listed**:
§3 capability `13`'s row 3 and Done-when (lines ~407 and ~412, "Android back … behaves"). They are
not in items 1–4, so rather than widen this ticket they are handed to `0215`, which now names them.
`build-index.mjs --check` is up to date, and `tickets.mjs validate` reports 0 errors.
